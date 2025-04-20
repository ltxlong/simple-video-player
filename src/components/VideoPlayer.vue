<script setup lang="ts">
import { ref, onBeforeUnmount, watch} from 'vue'
import DPlayer from 'dplayer'
import Hls from 'hls.js'
import flvjs from 'flv.js'

interface Props {
  url: string
  parseApi: string
  refreshTrigger?: number  // 添加刷新触发器属性
}

const props = defineProps<Props>()
const playerContainer = ref<HTMLElement | null>(null)
const iframeContainer = ref<HTMLIFrameElement | null>(null) 
let player: DPlayer | null = null
let hls: Hls | null = null
let flvPlayer: flvjs.Player | null = null  // 添加 FLV 播放器实例变量
let retryCount = 0
const MAX_RETRY_COUNT = 1
const isHtmlVideo = ref(false)
const useProxyUrl = ref(false)

// 添加状态监控
let lastPlayingTime = 0
let lastCheckTime = 0
let stuckCheckTimer: number | null = null
let waitingTimer: number | null = null
const STUCK_THRESHOLD = 3000 // 3秒无响应认为卡住
const CHECK_INTERVAL = 3000 // 每3秒检查一次
const WAITING_TIMEOUT = 3000 // 等待数据超时时间

// 添加一个变量来记录用户最后选择的时间点
let userSelectedTime = 0

// 添加标志变量
let isUrlChanging = false

// 添加一个标志变量来标识是否是手动刷新
let isManualRefresh = false

// 修改检查重试函数
const checkAndRetry = () => {
  // 手动刷新或 URL 变化过程中不执行重试
  if (isManualRefresh || isUrlChanging) {
    return false
  }
  
  if (useProxyUrl.value) {
    return false
  }

  if (retryCount >= MAX_RETRY_COUNT) {
    console.error('已达到最大重试次数，停止重试')
    // 开启代理模式
    useProxyUrl.value = true
    if (!props.url.includes('/api/proxy?url=')) {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(props.url)}`
      initPlayer(proxyUrl)
    }

    return false
  }
  retryCount++
  console.log(`开始第 ${retryCount} 次重试...`)
  return true
}

// 检查播放器状态
const checkPlayerStatus = () => {
  if (!player?.video || !hls) return

  const currentTime = player.video.currentTime
  const now = Date.now()

  // 检查是否播放卡住
  if (player.video.paused) {
    // 暂停状态不检查
    lastCheckTime = now
    return
  }

  // 只在播放状态下检查
  if (player.video.readyState < 3) { // HAVE_FUTURE_DATA = 3
    // 还在缓冲中，延长检查间隔
    lastCheckTime = now
    return
  }

  // 检查视频是否真正在播放
  if (currentTime === lastPlayingTime && now - lastCheckTime > STUCK_THRESHOLD) {
    console.warn('检测到播放器可能卡住，尝试恢复...')
    handlePlaybackStuck()
  }

  lastPlayingTime = currentTime
  lastCheckTime = now
}

// 处理播放卡住
const handlePlaybackStuck = () => {
  if (!player?.video || !hls) return

  // 1. 先尝试重新加载当前时间点
  const currentTime = player.video.currentTime
  hls.startLoad(currentTime)
  
  // 2. 如果视频元素出错，重置视频元素
  if (player.video.error || player.video.networkState === 3) {
    player.video.load()
  }

  // 3. 如果还是无法恢复，使用 switchVideo 重新加载
  setTimeout(() => {
    if (player?.video && 
        (player.video.readyState === 0 || 
         player.video.networkState === 3 || 
         player.video.error)) {
      console.warn('播放器无法恢复，尝试重新加载...')
      const savedTime = currentTime
      // @ts-ignore
      player.switchVideo({
        url: props.url,
        type: detectVideoType(props.url)
      })
      
      // 等待视频加载完成后恢复进度
      const onCanPlay = () => {
        if (player?.video) {
          player.video.removeEventListener('canplay', onCanPlay)
          player.video.currentTime = savedTime
          player.video.play()
        }
      }
      player.video.addEventListener('canplay', onCanPlay)
    }
  }, 3000)
}

// 初始化状态监控
const initStatusMonitor = () => {
  if (!player) return

  // 清理旧的定时器
  if (stuckCheckTimer) {
    clearInterval(stuckCheckTimer)
  }
  if (waitingTimer) {
    clearTimeout(waitingTimer)
  }

  // 设置新的状态监控
  stuckCheckTimer = window.setInterval(checkPlayerStatus, CHECK_INTERVAL)

  // 监听播放器事件
  // @ts-ignore
  player.on('error', () => {
    if (!checkAndRetry()) return
    
    // 延迟一段时间后重试
    setTimeout(() => {
      console.log('尝试重新初始化播放器final...')
      initPlayer(props.url)
    }, 1000)

  })

  // @ts-ignore
  player.on('seeking', () => {
    if (player?.video) {
      const currentTime = player.video.currentTime
      userSelectedTime = currentTime
      
      lastPlayingTime = currentTime
      lastCheckTime = Date.now()
    }
  })

  // @ts-ignore
  player.on('waiting', () => {
    
    // 清理旧的等待定时器
    if (waitingTimer) {
      clearTimeout(waitingTimer)
    }
    
    // 设置新的等待超时处理
    waitingTimer = window.setTimeout(() => {
      if (!player?.video || !hls) return
      
      const targetTime = userSelectedTime || player.video.currentTime
      console.warn('等待数据超时，尝试恢复播放...', {
        currentTime: player.video.currentTime,
        targetTime,
        readyState: player.video.readyState,
        networkState: player.video.networkState,
        buffered: player.video.buffered.length > 0 ? {
          start: player.video.buffered.start(0),
          end: player.video.buffered.end(0)
        } : null
      })

      try {
        // 1. 先停止当前加载
        hls.stopLoad()
        
        // 2. 检查是否在缓冲区边界附近
        if (player.video.buffered.length > 0) {
          const bufferedEnd = player.video.buffered.end(player.video.buffered.length - 1)
          const isNearBufferEnd = Math.abs(targetTime - bufferedEnd) < 1 // 如果在缓冲区末尾1秒内
          
          if (isNearBufferEnd) {
            console.log('检测到在缓冲区边界，继续加载新数据')
            // 如果当前不是最低质量，切换到较低质量
            if (hls.currentLevel > 0) {
              console.log('切换到较低质量级别:', hls.currentLevel - 1)
              hls.nextLevel = hls.currentLevel - 1
            }
            
            // 继续尝试加载当前位置的数据
            hls.startLoad(targetTime)
            return // 直接返回，等待新数据加载
          }
        }
        
        // 如果不在缓冲区边界，也不要往回跳，就在当前位置继续等待
        console.log('继续等待数据加载...')
        if (hls.currentLevel > 0) {
          console.log('切换到较低质量级别:', hls.currentLevel - 1)
          hls.nextLevel = hls.currentLevel - 1
        }
        hls.startLoad(targetTime)
      } catch (error) {
        console.error('恢复播放出错:', error)
        if (checkAndRetry()) {
          console.log('尝试切换视频源...')
          // @ts-ignore
          player?.switchVideo({
            url: props.url,
            type: detectVideoType(props.url)
          })
        } else {
          console.log('尝试重新初始化播放器...')
          initPlayer(props.url)
        }
      }
    }, WAITING_TIMEOUT)
  })

  // @ts-ignore
  player.on('playing', () => {
    
    retryCount = 0  // 只在成功播放时重置重试计数
    
    // 清理等待定时器
    if (waitingTimer) {
      clearTimeout(waitingTimer)
      waitingTimer = null
    }
    lastPlayingTime = player?.video?.currentTime || 0
    lastCheckTime = Date.now()
  })

  // @ts-ignore
  player.on('pause', () => {
    // 暂停时更新检测时间
    lastCheckTime = Date.now()
  })

  // 监听网页全屏
  // @ts-ignore
  player.on('webfullscreen', () => {
    if (playerContainer.value) {
      document.body.classList.add('web-fullscreen')
    }
  })

  // 监听退出网页全屏
  // @ts-ignore
  player.on('webfullscreen_cancel', () => {
    if (playerContainer.value) {
      document.body.classList.remove('web-fullscreen')
    }
  })

  // 监听原生全屏
  // @ts-ignore
  player.on('fullscreen', () => {

    const isMobile = !!navigator.userAgent.match(/AppleWebKit.*Mobile.*/);

    if (isMobile) {
      try {
        screen.orientation.lock('landscape').catch(err => {
          console.warn('无法锁定屏幕方向:', err.message);
          player.notice('当前浏览器不支持自动横屏', 3000, 0.5)
        });
      } catch (error) {
        console.warn('屏幕方向锁定不受支持:', error);
      }
    }
  })

  // 监听原生退出全屏
  // @ts-ignore
  player.on('fullscreen_cancel', () => {  

    const isMobile = !!navigator.userAgent.match(/AppleWebKit.*Mobile.*/);

    if (isMobile) {
      try {
        screen.orientation.unlock();
      } catch (error) {
        console.warn('解除屏幕方向锁定不受支持:', error);
      }
    }
  })
}

// 检测视频格式
const detectVideoType = (url: string): string => {
  const extension = url.split('?')[0].split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'm3u8':
      return 'm3u8'
    case 'mp4':
      return 'auto'
    case 'webm':
      return 'auto'
    case 'ogv':
      return 'auto'
    case 'flv':
      return 'flv'
    case 'html':
      isHtmlVideo.value = true
      return 'html'
    case 'com':
      isHtmlVideo.value = true
      return 'html'
    case 'cn':
      isHtmlVideo.value = true
      return 'html'
    default:
      // 如果链接包含特定关键字
      if (url.includes('.m3u8')) {
        return 'm3u8'
      }
      if (url.includes('.html') || url.includes('.com') || url.includes('.cn')) {
        isHtmlVideo.value = true
        return 'html'
      }
      // 添加 RTMP 判断
      const rtmpPrefixes = ['rtmp://', 'rtmps://', 'rtmpt://', 'rtmpe://', 'rtmpte://']
      if (rtmpPrefixes.some(prefix => url.toLowerCase().startsWith(prefix))) {
        return 'flv'  // RTMP 流也返回 'flv'
      }

      return 'auto'
  }
}

// 获取解析后的URL
const getParseUrl = (url: string): string => {

  // 如果是HTML视频且存在解析API配置，则拼接URL
  if (isHtmlVideo.value && props.parseApi) {
    return `${props.parseApi}${url}`
  }
  return url
}

// 初始化视频
const initVideo = () => {

  // 重置HTML视频标记
  isHtmlVideo.value = false
  
  // 先检测视频类型 - 确保这一步总是执行
  const videoType = detectVideoType(props.url)
  
  if (videoType === 'html') {
    isHtmlVideo.value = true

    return true
  } else {
    return false
  }
}

const refreshVideoIframe = () => {
  if (isHtmlVideo.value && iframeContainer.value) {
    iframeContainer.value.src = getParseUrl(props.url);
  }
}

// 检测是否为直播流
const isLiveStream = (url: string): boolean => {
  // 处理 URL 中的空格
  const trimmedUrl = url.trim()
  
  // 直接检查是否是 RTMP 或 RTSP 协议
  const streamPrefixes = ['rtmp://', 'rtmps://', 'rtmpt://', 'rtmpe://', 'rtmpte://', 'rtsp://']
  if (streamPrefixes.some(prefix => trimmedUrl.toLowerCase().startsWith(prefix))) {
    return true
  }
  
  // 检查路径中是否包含直播相关的关键词
  const livePathPatterns = ['/live', '/stream', '/hls/']
  if (livePathPatterns.some(pattern => trimmedUrl.includes(pattern))) {
    return true
  }
  
  return false
}

const isLocalhost = () => {
  const hostname = window.location.hostname
  return hostname === 'localhost' 
    || hostname === '127.0.0.1'
    || hostname.startsWith('192.168.')  // 本地网络
    || hostname.startsWith('10.')       // 本地网络
    || hostname.endsWith('.local')      // mDNS local domain
    || hostname === ''                 // 空主机名也视为本地
}

// 初始化播放器
const initPlayer = (url: string) => {
  if (!playerContainer.value) {
    console.error('播放器容器不存在')
    return
  }

  try {
    // 清理旧的播放器实例
    if (player) {
      console.log('销毁旧的播放器实例')
      player.destroy()
      player = null
    }

    // 清理 HLS 实例
    if (hls) {
      console.log('销毁旧的 HLS 实例')
      hls.destroy()
      hls = null
    }

    // 清理 FLV 实例
    if (flvPlayer) {
      console.log('销毁旧的 FLV 实例')
      flvPlayer.destroy()
      flvPlayer = null
    }

    // 清空容器
    console.log('清空播放器容器')
    playerContainer.value.innerHTML = ''

    // 检测视频类型
    const videoType = detectVideoType(url)

    // 创建新的播放器实例
    player = new DPlayer({
      container: playerContainer.value,
      mutex: true,
      screenshot: true,
      airplay: true,
      chromecast: true,
      live: url.endsWith('live=true') || url.endsWith('live%3Dtrue'),
      video: {
        url: url,
        type: videoType,
        customType: {
          m3u8: (video: HTMLVideoElement, player: DPlayer) => {

            if (Hls.isSupported()) {

              hls = new Hls({
                // HLS 配置
                startLevel: -1,
                testBandwidth: true,
                maxBufferSize: 0,
                maxBufferLength: 150,
                manifestLoadingTimeOut: 10000,
                manifestLoadingMaxRetry: 3,
                levelLoadingTimeOut: 10000,
                levelLoadingMaxRetry: 3,
                fragLoadingTimeOut: 30000,
                fragLoadingMaxRetry: 5,
                fragLoadingRetryDelay: 1000,
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 90,
                //progressive: true, // 这个参数可能会让广告过滤失败，故注释掉
                appendErrorMaxRetry: 5,
                stretchShortVideoTrack: true,
                abrMaxWithRealBitrate: true,

                // 添加自定义加载器
                loader: customLoaderFactory(),
              })

              if (url.endsWith('live=true') || url.endsWith('live%3Dtrue')) {
                hls.config.startPosition = -1

                hls.on(Hls.Events.FRAG_BUFFERED, () => {
                  const buffered = player.video.buffered;
                  if (buffered.length > 0) {
                    const bufferedEnd = buffered.end(buffered.length - 1);
                    const currentTime = player.video.currentTime;
                    const timeToNextFrag = bufferedEnd - currentTime;

                    if (timeToNextFrag < 10) {
                      hls.startLoad(bufferedEnd)
                    }
                  }
                  
                })
              }

              let tmp_time_add = 0.1
              let tmp_max_buffer_length = hls.config.maxBufferLength
              
              hls.on(Hls.Events.FRAG_PARSED, (event, data) => {

                if (data.frag.endList && data.frag.minEndPTS < 60) {
                  
                  if (parseInt(hls.media.currentTime) < parseInt(hls.media.duration)) {

                    data.frag.endList = undefined;

                    const tmp_current_time = hls.media.currentTime
                    
                    if (tmp_time_add < 1) {
                      hls.config.maxBufferLength = 2 // 意味着距离广告点多少秒开始操作，也意味着漏会看几秒，建议 1~5；如果网速快可以设置为 1
                    } else {
                      hls.config.maxBufferLength = tmp_max_buffer_length
                    }

                    hls.loadSource(url)
                    hls.attachMedia(video)
                    hls.media.currentTime = tmp_current_time + tmp_time_add

                    if (tmp_time_add < 1) {
                      tmp_time_add = 5 // 快进广告的速度，每次快进多少秒，建议 1~5，越大会导致漏看的越多，5是快进键的默认速度，和一般切片的大小也相近；如果不介意等的久，可以设置为 1
                    } else {
                      tmp_time_add = 0.1
                    }
                    
                    player.video.play()

                  } else {
                    player.video.pause()
                  }
                }
              })

              // 绑定 HLS 事件
              hls.on(Hls.Events.ERROR, (event, data) => {
                if (!hls) {
                  console.error('HLS 实例不存在，无法处理错误')
                  return
                }

                console.error('HLS 错误:', data)
                if (data.fatal) {
                  switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                      console.log('尝试恢复网络错误...')
                      if (hls.media) {
                        if (checkAndRetry()) {
                          hls.startLoad()
                        }
                      }
                      break
                    case Hls.ErrorTypes.MEDIA_ERROR:
                      console.log('尝试恢复媒体错误...')
                      if (hls.media) {
                        hls.recoverMediaError()
                      }
                      break
                    default:
                      console.error('无法恢复的错误，尝试切换视频源')
                      if (checkAndRetry()) {
                        // @ts-ignore
                        player?.switchVideo({
                          url: url,
                          type: videoType
                        })
                      } else {
                        console.log('尝试重新初始化播放器...')
                        initPlayer(url)
                      }
                      break
                  }
                }
              })

              if (isLocalhost() || url.endsWith('live=true') || url.endsWith('live%3Dtrue')) {

                url = url.replace(/(?:\?|&)(live=true|live%3Dtrue)$/, '');

                let actualUrl = url.startsWith('http://') && !url.includes('/api/proxy?url=') ? `/api/proxy?url=${encodeURIComponent(url)}` : url
                if (actualUrl.includes('/api/proxy?url=')) {
                  useProxyUrl.value = true

                  // 添加代理URL
                  //actualUrl += '&proxy_url=true';
                }

                hls.loadSource(actualUrl)
              } else {
                hls.loadSource(url)
              }

              hls.attachMedia(video)

            } else {
              console.error('不支持 HLS 播放')
              player.notice('当前浏览器不支持 HLS 播放', 3000, 0.5)
            }
          },
          flv: (video: HTMLVideoElement, player: DPlayer) => {
            if (flvjs.isSupported()) {
              // 处理 URL 中的空格
              const trimmedUrl = url.trim()
              const isLive = isLiveStream(trimmedUrl)
              
              flvPlayer = flvjs.createPlayer({
                type: 'flv',
                url: trimmedUrl,
                isLive: isLive,
                cors: true,
                // 直播流优化配置
                ...((isLive) ? {
                  enableStashBuffer: true,  // 启用缓存
                  stashInitialSize: 512,    // 较大的初始缓存
                  enableWorker: true,        // 启用 Web Worker
                  autoCleanupSourceBuffer: true, // 自动清理源缓冲区
                  autoCleanupMaxBackwardDuration: 30, // 最大向后清理时长
                  autoCleanupMinBackwardDuration: 10,  // 最小向后清理时长

                } : {
                  // 点播流优化配置
                  enableStashBuffer: true,    // 启用缓存
                  stashInitialSize: 512,      // 较大的初始缓存
                  enableWorker: true,         // 启用 Web Worker
                  autoCleanupSourceBuffer: false, // 不自动清理源缓冲区
                  accurateSeek: true,         // 启用精确搜索
                  seekType: 'range',          // 使用范围搜索
                  lazyLoad: true,             // 启用延迟加载
                  reuseRedirectedURL: true    // 重用重定向 URL
                })
              })
              
              flvPlayer.attachMediaElement(video)
              
              // 等待视频元素准备好
              const waitForVideoReady = () => {
                return new Promise<void>((resolve) => {
                  if (video.readyState >= 2) { // HAVE_CURRENT_DATA = 2
                    resolve()
                  } else {
                    const onCanPlay = () => {
                      video.removeEventListener('canplay', onCanPlay)
                      resolve()
                    }
                    video.addEventListener('canplay', onCanPlay)
                  }
                })
              }
              
              // 加载并等待视频准备好
              flvPlayer.load()
              
              // 使用 Promise 链式处理播放
              waitForVideoReady()
                .then(() => {
                  console.log('视频已准备好')
                })
                .catch(error => {
                  console.warn('视频加载失败:', error)
                  if (player) {
                    player.notice('视频加载失败，请检查网络或视频地址', 3000, 0.5)
                  }
                })
              
              // 监听错误事件
              flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail) => {
                console.error('播放错误:', errorType, errorDetail)
                
                // 检查是否应该重试
                if (checkAndRetry()) {
                  // @ts-ignore
                  player?.switchVideo({
                    url: url,
                    type: videoType
                  })
                } else {
                  // 达到最大重试次数，停止播放
                  console.log('达到最大重试次数，停止播放')
                  if (player) {
                    player.pause()
                    player.notice('视频加载失败，请检查网络或视频地址', 5000, 0.5)
                  }
                }
              })

              // 如果是直播流添加额外的监控
              if (isLive) {
                // 监控播放状态
                let lastTime = 0
                let stuckCount = 0
                const checkInterval = setInterval(() => {
                  if (video.currentTime === lastTime) {
                    stuckCount++
                    if (stuckCount > 3) {
                      console.warn('流可能卡住，尝试恢复...')
                      if (flvPlayer) {
                        flvPlayer.unload()
                        flvPlayer.load()
                        flvPlayer.play()
                      }
                      stuckCount = 0
                    }
                  } else {
                    stuckCount = 0
                  }
                  lastTime = video.currentTime
                }, 5000)

                // 组件卸载时清理定时器
                onBeforeUnmount(() => {
                  clearInterval(checkInterval)
                })
              }
            } else {
              console.error('不支持 FLV 播放')
              player.notice('当前浏览器不支持 FLV 播放', 3000, 0.5)
            }
          }
        }
      },
      autoplay: true,
      theme: '#3B82F6',
      lang: 'zh-cn',
      hotkey: true,
      preload: 'auto',
      volume: 1.0,
      playbackSpeed: [0.5, 0.75, 1, 1.25, 1.5, 2]
    })

    // 初始化完成后启动状态监控
    if (player) {
      console.log('播放器初始化完成，启动状态监控')
      initStatusMonitor()
    }
  } catch (error) {
    console.error('初始化播放器失败:', error)
  }
}

// 重置播放器
const resetPlayer = async () => {
  useProxyUrl.value = false

  // 1. 暂停播放和停止加载
  if (player?.video) {
    try {
      player.pause()
      player.video.src = ''
      player.video.load()
    } catch (error) {
      console.warn('重置视频元素失败:', error)
    }
  }
  
  // 2. 停止并销毁 HLS 实例
  if (hls) {
    try {
      hls.stopLoad()
      hls.detachMedia()
      hls.destroy()
      hls = null
    } catch (error) {
      console.warn('销毁 HLS 实例失败:', error)
    }
  }

  // 3. 停止并销毁 FLV 实例
  if (flvPlayer) {
    try {
      flvPlayer.unload()
      flvPlayer.detachMediaElement()
      flvPlayer.destroy()
      flvPlayer = null
    } catch (error) {
      console.warn('销毁 FLV 实例失败:', error)
    }
  }
  
  // 4. 清理所有定时器
  if (stuckCheckTimer) {
    clearInterval(stuckCheckTimer)
    stuckCheckTimer = null
  }
  if (waitingTimer) {
    clearTimeout(waitingTimer)
    waitingTimer = null
  }
  
  // 5. 销毁播放器实例
  if (player) {
    try {
      player.destroy()
      player = null
    } catch (error) {
      console.warn('销毁播放器实例失败:', error)
    }
  }
  
  // 6. 重置所有状态
  retryCount = 0
  userSelectedTime = 0
  lastPlayingTime = 0
  lastCheckTime = Date.now()
  
  // 7. 清理 DOM
  if (playerContainer.value) {
    playerContainer.value.innerHTML = ''
  }
  
  // 8. 等待一小段时间确保清理完成
  await new Promise(resolve => setTimeout(resolve, 100))
}

// 暴露必要的方法和属性
defineExpose({ 
  player: {
    get value() { 
      return player 
    }
  },
  resetPlayer,
  initPlayer
})

// 修改 URL 监听函数
watch(() => props.url, async (newUrl, oldUrl) => {
  // 去掉空格后的 URL
  const trimmedNewUrl = newUrl?.trim() || ''
  const trimmedOldUrl = oldUrl?.trim() || ''

  // 只在 URL 真正改变时才执行重置和初始化
  if (trimmedNewUrl !== trimmedOldUrl) {

    useProxyUrl.value = false

    const initVideoFlag = initVideo()

    if (initVideoFlag) {
      return
    }

    if (!trimmedNewUrl) {
      await resetPlayer()
      return
    }
    
    // 设置标志，禁用重试逻辑
    isUrlChanging = true
    
    // 重置状态
    retryCount = 0
    userSelectedTime = 0  // URL 不同时重置进度
    lastPlayingTime = 0
    lastCheckTime = Date.now()
    
    // 清理定时器
    if (waitingTimer) {
      clearTimeout(waitingTimer)
      waitingTimer = null
    }
    if (stuckCheckTimer) {
      clearInterval(stuckCheckTimer)
      stuckCheckTimer = null
    }

    try {
      // 重置并初始化播放器
      await resetPlayer()
      initPlayer(trimmedNewUrl)
    } catch (error) {
      console.error('初始化播放器失败:', error)
    } finally {
      // 恢复重试逻辑
      isUrlChanging = false
    }
  }
}, { immediate: true })

// 修改组件卸载函数
onBeforeUnmount(async () => {
  await resetPlayer()
})

// 修改刷新触发器的监听
watch(() => props.refreshTrigger, async (newVal, oldVal) => {

  const initVideoFlag = initVideo()

  if (initVideoFlag) {
    refreshVideoIframe()
    return
  }

  // 忽略初始化时的触发
  if (newVal === oldVal || !props.url) return
  
  // 保存当前进度
  const currentTime = player?.video?.currentTime || 0
  userSelectedTime = currentTime
  
  try {
    // 设置手动刷新标志
    isManualRefresh = true
    
    // 重置并初始化播放器
    await resetPlayer()
    initPlayer(props.url)
    
    // 等待视频加载完成后恢复进度
    if (player?.video) {
      const onCanPlay = () => {
        if (player?.video) {
          player.video.removeEventListener('canplay', onCanPlay)
          console.log('恢复播放进度:', currentTime)
          
          // 确保 HLS 已经准备好
          if (hls) {
            const onFragLoaded = () => {
              hls?.off(Hls.Events.FRAG_LOADED, onFragLoaded)
              player.video.currentTime = currentTime
              userSelectedTime = currentTime
            }
            hls.on(Hls.Events.FRAG_LOADED, onFragLoaded)
          } else {
            // 非 HLS 视频直接设置进度
            player.video.currentTime = currentTime
            userSelectedTime = currentTime
          }
        }
      }
      player.video.addEventListener('canplay', onCanPlay)
    }
  } catch (error) {
    console.error('刷新播放器失败:', error)
  } finally {
    // 重置手动刷新标志
    isManualRefresh = false
  }
})

// 自定义加载器工厂函数
function customLoaderFactory() {
  // 获取默认加载器
  const DefaultLoader = Hls.DefaultConfig.loader;
  
  // 创建自定义加载器类
  class CustomLoader extends DefaultLoader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      
      this.load = function(context: any, config: any, callbacks: any) {

        if (context.type === 'manifest' || context.type === 'level') {

          // 覆盖原始回调
          const originalSuccessCallback = callbacks.onSuccess;
          callbacks.onSuccess = function(response: any, stats: any, context: any) {
            if (response.data) {

              const originalContent = response.data;
            
              let lines = originalContent.split('\n');
              let filteredLines = [];

              for (let i = 0; i < lines.length; i++) {
                let line = lines[i];
                
                if (line.startsWith('#EXT-X-DISCONTINUITY')) {
                  if (i > 0 && lines[i - 1].startsWith('#EXT-X-')) {
                        filteredLines.push(line);

                        continue;
                    } else {
                        continue;
                    }
                }

                if (useProxyUrl.value && (line.includes('.ts') || line.includes('.m3u8'))) {

                  if (context.url.includes('/api/proxy?url=')) {
                    try {
                      // 解析原始URL
                      const proxyUrl = context.url.split('/api/proxy?url=')[1]
                      const originalUrl = decodeURIComponent(proxyUrl)
                      const urlObj = new URL(originalUrl)
                      
                      // 正确处理基础URL和相对路径
                      let tsUrl = '';
                      if (line.startsWith('http')) {
                        // 如果是绝对路径
                        tsUrl = line
                      } else {
                        // 如果是相对路径
                        if (line.startsWith('/')) {
                          // 如果以斜杠开头，使用域名作为基础
                          tsUrl = `${urlObj.protocol}//${urlObj.host}${line}`
                        } else {
                          // 如果不以斜杠开头，需要考虑完整路径
                          // 获取原始URL的目录部分
                          const pathParts = urlObj.pathname.split('/');
                          pathParts.pop(); // 移除文件名
                          const basePath = pathParts.join('/');
                          tsUrl = `${urlObj.protocol}//${urlObj.host}${basePath}/${line}`
                        }
                      }

                      // 确保URL格式正确（防止双重编码）
                      let proxyTsUrl = encodeURIComponent(tsUrl)
                      let finalUrl = `/api/proxy?url=${proxyTsUrl}`
                      
                      // 特殊情况处理
                      if (line.includes('.m3u8?ts=')) {
                        const tpProxyUrl_split_arr = tsUrl.split('?ts=')
                        const tsProxyUrl_0 = tpProxyUrl_split_arr[0]
                        const tsProxyUrl_1 = tpProxyUrl_split_arr[1]
                        proxyTsUrl = encodeURIComponent(tsProxyUrl_0 + '_the_proxy_ts_url_' + tsProxyUrl_1)
                        finalUrl = `/api/proxy?url=${proxyTsUrl}`
                      }
                      
                      filteredLines.push(finalUrl)
                    } catch (error) {
                      console.error('构建代理URL时出错:', error)
                      filteredLines.push(line) // 出错时使用原始行
                    }
                    continue;
                  }
                }
                
                filteredLines.push(line);
              }

              const filteredContent = filteredLines.join('\n');
              response.data = filteredContent;
            }
            
            // 调用原始成功回调
            originalSuccessCallback(response, stats, context);
          };
        } else if (context.type === 'fragment' && useProxyUrl.value) {
          // 对于片段请求，确保添加必要的头信息
          const loadatetimeout = context.loadatetimeout || 0;
          
          // 添加请求超时
          context.loadatetimeout = loadatetimeout > 0 ? loadatetimeout : 30000;
          
          // 修改XHR对象以添加自定义头
          const originalXhrSetup = config.xhrSetup;
          config.xhrSetup = function(xhr: XMLHttpRequest, url: string) {
            if (originalXhrSetup) {
              originalXhrSetup(xhr, url);
            }
            
            // 添加必要的请求头
            xhr.withCredentials = true; // 允许跨域请求携带认证信息
            
            // 对媒体片段进行特殊处理 - 直接通过URL判断是否为.ts文件
            if (url.includes('.ts')) {
              // 所有.ts文件请求都设置为arraybuffer
              xhr.responseType = 'arraybuffer';
            }
            
          };
          
          // 处理HTTP错误
          const originalOnError = callbacks.onError;
          callbacks.onError = function(
            response: any, 
            context: any, 
            errorType: string, 
            requestURL: string
          ) {
            const status = response?.status || 0;
            console.error(`片段加载错误: ${status} ${errorType}`, {
              url: requestURL,
              status,
              errorType
            });
            
            // 调用原始错误回调
            if (originalOnError) {
              originalOnError(response, context, errorType, requestURL);
            }
          };
        }
        
        // 调用原始加载函数
        load(context, config, callbacks);
      };
    }
  }
  
  return CustomLoader;
}

</script>

<template>
  <div v-if="!isHtmlVideo" ref="playerContainer" class="relative w-full aspect-video bg-black"></div>
  <iframe
    v-else
    ref="iframeContainer"
    :src="getParseUrl(url)"
    class="w-full aspect-video border-0"
    allowfullscreen
    frameborder="0"
  >
  </iframe>
</template>

<style>
.web-fullscreen {
  overflow: hidden !important;
}

/* 在网页全屏模式下隐藏分割线和右侧面板 */
body.web-fullscreen .lg\:block.lg\:w-1,
body.web-fullscreen .lg\:h-auto.p-4 {
  display: none !important;
}

/* 在网页全屏模式下让视频区域占满宽度 */
body.web-fullscreen .lg\:h-auto.relative {
  width: 100% !important;
}

.web-fullscreen .dplayer {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  bottom: 0 !important;
  right: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  margin: 0 !important;
  padding: 0 !important;
  z-index: 9999 !important;
}

.web-fullscreen .dplayer-video-wrap {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100% !important;
  height: 100% !important;
}

.web-fullscreen .dplayer-video-current {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
  max-height: 100vh !important;
}

.dplayer-web-fullscreen-fix {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  margin: 0 !important;
  padding: 0 !important;
  z-index: 9999 !important;
}
</style> 
