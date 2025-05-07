<script setup lang="ts">
import { ref, onBeforeUnmount, watch, nextTick } from 'vue'
import DPlayer from 'dplayer'
import Hls from 'hls.js'
import flvjs from 'flv.js'

interface Props {
  url: string
  backgroundImage: string
  parseApi: string
  refreshTrigger?: number  // 添加刷新触发器属性
  proxyVideoUrl?: string
  proxyLiveUrl?: string
  autoPlayNext?: boolean   // 添加自动连播属性
  currentVideoInfo?: {
    title: string    // 剧集标题
    episode: string  // 集数
    siteRemark: string  // 资源站点名称
    seriesName: string  // 剧集名称
    adFilter: object // 广告过滤信息
  }
}

let props = defineProps<Props>()
// 定义事件
const emit = defineEmits(['videoEnded', 'playNextEpisode', 'playPreviousEpisode'])

const playerContainer = ref<HTMLElement | null>(null)
const iframeContainer = ref<HTMLIFrameElement | null>(null) 
let player: DPlayer | null = null
// 添加新的 playerRef 变量用于触摸事件
const playerRef = ref<DPlayer | null>(null)
let hls: Hls | null = null
let flvPlayer: flvjs.Player | null = null  // 添加 FLV 播放器实例变量
let retryCount = 0
const MAX_RETRY_COUNT = 2
const isHtmlVideo = ref(false)
const useProxyUrl = ref(false)
const useProxyLiveUrl = ref(false)
const theReqMainUrl = ref('')
const adFilterType = ref('当前：默认通用广告过滤')
const autoNextPlayTip = ref('已开启自动连播')

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

// 添加滑动控制相关变量
let touchStartX = 0
let touchStartY = 0
let initialVolume = 0
let isHorizontalSwipe = false
let isVerticalSwipe = false
let currentTimeChange = 0
let currentVolumeChange = 0
let theTouchToast: HTMLElement | null = null

// 创建自定义提示元素
const createToast = () => {
  // 如果已经存在 toast，先移除
  if (theTouchToast) {
    theTouchToast.remove()
  }
  
  const touchToast = document.createElement('div')
  touchToast.id = 'video-control-toast'
  touchToast.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    font-size: 16px;
    z-index: 9999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
  `
  // 将 toast 添加到播放器容器中
  if (playerContainer.value) {
    playerContainer.value.appendChild(touchToast)
  }
  return touchToast
}

// 显示提示
const showToast = (text: string) => {
  if (!theTouchToast) {
    theTouchToast = createToast()
  }
  theTouchToast.textContent = text
  theTouchToast.style.opacity = '1'
}

// 隐藏提示
const hideToast = () => {
  if (theTouchToast) {
    theTouchToast.style.opacity = '0'
  }
}

// 触摸开始处理函数
const handleTouchStart = (e: TouchEvent) => {
  if (!playerRef.value?.video || !playerContainer.value) return
  
  // 检查触摸点是否在播放器区域内
  const playerRect = playerContainer.value.getBoundingClientRect()
  const touchX = e.touches[0].clientX
  const touchY = e.touches[0].clientY
  
  if (touchX < playerRect.left || touchX > playerRect.right ||
      touchY < playerRect.top || touchY > playerRect.bottom) {
    return
  }
  
  touchStartX = touchX
  touchStartY = touchY
  initialVolume = playerRef.value.video.volume
  isHorizontalSwipe = false
  isVerticalSwipe = false
  currentTimeChange = 0
  currentVolumeChange = 0
  hideToast()
}

// 触摸移动处理函数
const handleTouchMove = (e: TouchEvent) => {
  if (!playerRef.value?.video || !touchStartX || !touchStartY || !playerContainer.value) return
  
  // 检查触摸点是否在播放器区域内
  const playerRect = playerContainer.value.getBoundingClientRect()
  const touchX = e.touches[0].clientX
  const touchY = e.touches[0].clientY
  
  if (touchX < playerRect.left || touchX > playerRect.right ||
      touchY < playerRect.top || touchY > playerRect.bottom) {
    return
  }
  
  const deltaX = touchX - touchStartX
  const deltaY = touchY - touchStartY

  // 判断滑动方向
  if (!isHorizontalSwipe && !isVerticalSwipe) {
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      isHorizontalSwipe = true
    } else {
      isVerticalSwipe = true
    }
  }

  // 水平滑动控制进度
  if (isHorizontalSwipe) {
    currentTimeChange = deltaX / 2 // 每像素改变0.5秒
    showToast(`${currentTimeChange > 0 ? '快进' : '快退'} ${Math.abs(Math.round(currentTimeChange))}秒`)
  }
  // 垂直滑动控制音量
  else if (isVerticalSwipe) {
    currentVolumeChange = -deltaY / 200 // 每像素改变0.005音量
    const newVolume = Math.max(0, Math.min(initialVolume + currentVolumeChange, 1))
    showToast(`音量 ${Math.round(newVolume * 100)}%`)
  }
}

// 触摸结束处理函数
const handleTouchEnd = () => {
  if (!playerRef.value?.video) return
  
  // 应用最终变化
  if (isHorizontalSwipe && currentTimeChange !== 0) {
    const oldTime = playerRef.value.video.currentTime
    const newTime = Math.max(0, Math.min(oldTime + currentTimeChange, playerRef.value.video.duration))
    playerRef.value.video.currentTime = newTime
  } else if (isVerticalSwipe && currentVolumeChange !== 0) {
    const newVolume = Math.max(0, Math.min(initialVolume + currentVolumeChange, 1))
    playerRef.value.video.volume = newVolume
  }

  // 重置状态
  touchStartX = 0
  touchStartY = 0
  initialVolume = 0
  isHorizontalSwipe = false
  isVerticalSwipe = false
  currentTimeChange = 0
  currentVolumeChange = 0
  hideToast()
}

// 添加移动端触摸控制
const addMobileTouchControl = () => {
  if (!playerRef.value?.video) return
  
  // 确保 toast 元素存在
  if (!theTouchToast) {
    theTouchToast = createToast()
  }
  
  // 添加事件监听到 body
  document.body.addEventListener('touchstart', handleTouchStart)
  document.body.addEventListener('touchmove', handleTouchMove)
  document.body.addEventListener('touchend', handleTouchEnd)
}

// 移除移动端触摸控制
const removeMobileTouchControl = () => {
  if (!playerRef.value?.video) return
  
  // 移除 body 上的事件监听
  document.body.removeEventListener('touchstart', handleTouchStart)
  document.body.removeEventListener('touchmove', handleTouchMove)
  document.body.removeEventListener('touchend', handleTouchEnd)
  
  // 移除提示元素
  if (theTouchToast) {
    theTouchToast.remove()
    theTouchToast = null
  }
}

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
    
    // 如果配置了代理URL，那么不开启，否则开启代理模式
    if (props.proxyVideoUrl || props.proxyLiveUrl) {
      return false
    }

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

  // 添加视频结束事件监听，用于自动连播
  // @ts-ignore
  player.on('ended', () => {
        
    // 只有非直播且开启了自动连播功能才触发连播
    if (props.autoPlayNext && props.currentVideoInfo?.seriesName !== 'IPTV') {
      // 触发连播事件
      setTimeout(() => {
        // 发送视频结束事件，通知父组件准备下一集
        emit('videoEnded')
      }, 1000)
    }
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

        if (player.video.currentTime === targetTime && player.video.readyState < 2) {

        }
        
        // 检查是否在缓冲区边界附近
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
          } else {
            // 如果当前时间小于1秒，则重新加载视频
            if (targetTime < 1) {
              const theCurrentTime = player.video.currentTime
              hls.loadSource(props.url)
              hls.attachMedia(player.video)
              player.video.currentTime = theCurrentTime + 0.1
              player.video.play()  
            }
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
      
      if (!props.url.endsWith('live=true') && !props.url.endsWith('live%3Dtrue')) {
        // 添加移动端触摸控制
        addMobileTouchControl()
      }
    }
  })

  // 监听原生退出全屏
  // @ts-ignore
  player.on('fullscreen_cancel', () => {
    const isMobile = !!navigator.userAgent.match(/AppleWebKit.*Mobile.*/);

    if (isMobile) {
      
      if (!props.url.endsWith('live=true') && !props.url.endsWith('live%3Dtrue')) {
        // 移除移动端触摸控制
        removeMobileTouchControl()
      }
      
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

// 在初始化播放器后显示当前播放信息
const updatePlayerTitle = () => {
  const isMobile = !!navigator.userAgent.match(/AppleWebKit.*Mobile.*/);

  if (player && props.currentVideoInfo && props.currentVideoInfo.seriesName !== 'IPTV') {
    // 查找工具栏控件容器
    setTimeout(() => {
      const controllerBar = playerContainer.value?.querySelector('.dplayer-controller');
      if (controllerBar) {
        // 查找是否已存在自定义标题元素
        let titleElement = controllerBar.querySelector('.dplayer-playing-title');
        
        // 如果不存在，创建一个新的
        if (!titleElement) {
          titleElement = document.createElement('div');
          const titleElem = titleElement as HTMLElement;
          titleElem.id = 'dplayer-playing-title';
          titleElem.className = 'dplayer-playing-title';
          titleElem.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:white;text-shadow:1px 1px 2px rgba(0,0,0,0.5);font-size:14px;text-align:center;pointer-events:none;max-width:50%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:100;';

          controllerBar.appendChild(titleElem);
        }
        
        // 更新标题内容
        if (titleElement && props.currentVideoInfo) {
          const { siteRemark, title, episode, seriesName, adFilter } = props.currentVideoInfo;

          // 构建显示文本：站点名称 - 剧集标题 - 剧集名称
          let displayText = '';

          if (props.autoPlayNext) {
            displayText = '连播 - '
          }
          
          if (siteRemark) {
            displayText += siteRemark;
          }
          
          if (episode) {
            if (displayText) displayText += ' - ';
            displayText += episode;
          }
                    
          if (seriesName) {
            if (displayText) displayText += ' - ';
            displayText += seriesName;
          }

          if (adFilter) {
            if (adFilter.status) {
              switch (adFilter.item) {
                case 'default_del_ad_tag_to_filter':
                  adFilterType.value = '当前：默认通用广告过滤'
                  break
                case 'ad_tag_to_del_filter':
                  adFilterType.value = '当前：根据标识删除广告'
                  break
                case 'ad_name_len_to_del_filter':
                  adFilterType.value = '当前：根据名长删除广告'
                  break
                case 'ad_name_regular_to_del_filter':
                  adFilterType.value = '当前：正则匹配删除广告'
                  break
                default:
                  adFilterType.value = '当前：默认通用广告过滤'
              }
            } else {
              if (displayText) displayText += ' - ';
              displayText += '已关闭广告过滤'
              adFilterType.value = '当前：已关闭广告过滤'
            }
          } else {
            adFilterType.value = '当前：默认通用广告过滤'
          }
          
          let disabled_hidden_str = ' disabled hidden' // 手机模式下，一些计算方法失效，只能这样

          if (isMobile) {
            if (episode) {
              titleElement.textContent = episode;
            }

            disabled_hidden_str = ''
          } else {
            titleElement.textContent = displayText;
            document.querySelectorAll(".dplayer-menu .dplayer-menu-item a")[0].textContent = adFilterType.value
          }
          
          // 在.dplayer-icons dplayer-icons-left内新增一个播放下一集的图标按钮
          // 这个下一集的图标，使用svg实现
          if (!controllerBar.querySelector('#dplayer-next-episode-icon')) {
            const nextEpisodeIcon = document.createElement('div');
            nextEpisodeIcon.id = 'dplayer-next-episode-icon';
            nextEpisodeIcon.className = 'dplayer-icon opacity-80 hover:opacity-100' + disabled_hidden_str;
            nextEpisodeIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18L14 12L6 6V18Z" fill="currentColor"/><path d="M16 6V18H18V6H16Z" fill="currentColor"/></svg>';
            
            const leftIcons = controllerBar.querySelector('.dplayer-icons.dplayer-icons-left');
            if (leftIcons) {
              leftIcons.appendChild(nextEpisodeIcon);
              
              // 添加点击事件监听器
              nextEpisodeIcon.addEventListener('click', () => {
                // 检查是否处于禁用状态
                if (nextEpisodeIcon.classList.contains('disabled')) {
                  return;
                }
                // 触发视频结束事件，通知父组件准备下一集
                emit('playNextEpisode');
              });
            }
          }

          // 在设置按钮里面添加一个播放下一集的按钮
          const settingBoxPanel = playerContainer.value?.querySelector('.dplayer-setting-box .dplayer-setting-origin-panel');
          if (!settingBoxPanel) return;

          if (!settingBoxPanel.querySelector('#dplayer-next-episode-setting')) {
            // 创建新的设置选项
            const previousEpisodeSettingItem = document.createElement('div');
            previousEpisodeSettingItem.id = 'dplayer-previous-episode-setting';
            previousEpisodeSettingItem.className = 'dplayer-setting-item ' + disabled_hidden_str;
            previousEpisodeSettingItem.innerHTML = '<span class="dplayer-label">播放上一集</span>';

            settingBoxPanel.appendChild(previousEpisodeSettingItem);

            // 添加点击事件监听器
            previousEpisodeSettingItem.addEventListener('click', () => {
              // 检查是否处于禁用状态
              if (previousEpisodeSettingItem.classList.contains('disabled')) {
                return;
              }

              emit('playPreviousEpisode');
            });
          }

          if (!settingBoxPanel.querySelector('#dplayer-next-episode-setting')) {
            // 创建新的设置选项
            const nextEpisodeSettingItem = document.createElement('div');
            nextEpisodeSettingItem.id = 'dplayer-next-episode-setting';
            nextEpisodeSettingItem.className = 'dplayer-setting-item ' + disabled_hidden_str;
            nextEpisodeSettingItem.innerHTML = '<span class="dplayer-label">播放下一集</span>';

            settingBoxPanel.appendChild(nextEpisodeSettingItem);

            // 添加点击事件监听器
            nextEpisodeSettingItem.addEventListener('click', () => {
              // 检查是否处于禁用状态
              if (nextEpisodeSettingItem.classList.contains('disabled')) {
                return;
              }

              emit('playNextEpisode');
            });
          }
          
        }
      }
    }, 1000); // 等待播放器DOM渲染完成
  }
}

// 监听播放信息变化
watch(() => props.currentVideoInfo, (newVal) => {
  if (newVal && player) {
    updatePlayerTitle();
  }
}, { deep: true });

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

    if ((url.endsWith('live=true') || url.endsWith('live%3Dtrue')) && props.proxyLiveUrl && !url.startsWith(props.proxyLiveUrl)) {
      url = props.proxyLiveUrl + url
    } else if (!url.endsWith('live=true') && !url.endsWith('live%3Dtrue') && props.proxyVideoUrl && !url.startsWith(props.proxyVideoUrl)) {
      url = props.proxyVideoUrl + url
    }

    theReqMainUrl.value = url

    // 创建新的播放器实例
    player = new DPlayer({
      container: playerContainer.value,
      mutex: true,
      screenshot: true,
      airplay: true,
      chromecast: true,
      live: url.endsWith('live=true') || url.endsWith('live%3Dtrue'),
      video: {
        url: url.replace(/(?:\?|&|%3F|%26)(live=true|live%3Dtrue)$/, ''),
        type: videoType,
        pic: props.backgroundImage || '',
        customType: {
          m3u8: (video: HTMLVideoElement, player: DPlayer) => {

            if (Hls.isSupported()) {

              hls = new Hls({
                // HLS 配置
                startLevel: -1,
                testBandwidth: true,
                maxBufferLength: (url.endsWith('live=true') || url.endsWith('live%3Dtrue')) ? 10 : 60,
                maxMaxBufferLength: (url.endsWith('live=true') || url.endsWith('live%3Dtrue')) ? 15 : 90,
                manifestLoadingTimeOut: 10000,
                manifestLoadingMaxRetry: 3,
                levelLoadingTimeOut: 10000,
                levelLoadingMaxRetry: 3,
                fragLoadingMaxRetry: 5,
                enableWorker: true,
                lowLatencyMode: url.endsWith('live=true') || url.endsWith('live%3Dtrue'),
                backBufferLength: 60,
                //progressive: true, // 这个参数可能会让广告过滤失败，故注释掉
                appendErrorMaxRetry: 5,
                stretchShortVideoTrack: true,
                abrMaxWithRealBitrate: true,
                liveSyncDurationCount: 3,
                liveMaxLatencyDurationCount: 5,

                // 添加自定义加载器
                loader: customLoaderFactory(),
              })

              if (url.endsWith('live=true') || url.endsWith('live%3Dtrue')) {
                hls.config.startPosition = -1

                hls.on(Hls.Events.FRAG_BUFFERED, (event, data) => {
                  const buffered = player.video.buffered;
                  if (buffered.length > 0) {
                    const bufferedEnd = buffered.end(buffered.length - 1);
                    const currentTime = player.video.currentTime;
                    const timeToNextFrag = bufferedEnd - currentTime;

                    if (timeToNextFrag < 5) {
                      hls?.startLoad(bufferedEnd)
                    }
                  }                  
                })
              }

              let tmp_time_add = 0.1
              let tmp_max_buffer_length = hls.config.maxBufferLength

              hls.on(Hls.Events.FRAG_PARSED, (event, data) => {
                            
                // data.frag.minEndPTS < 60 是区分正常资源和异常资源的关键
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

              if ((isLocalhost() || url.endsWith('live=true') || url.endsWith('live%3Dtrue')) && !props.proxyLiveUrl) {

                url = url.replace(/(?:\?|&|%3F|%26)(live=true|live%3Dtrue)$/, '');

                let actualUrl = url.startsWith('http://') && !url.includes('/api/proxy?url=') ? `/api/proxy?url=${encodeURIComponent(url)}` : url
                if (actualUrl.includes('/api/proxy?url=')) {
                  useProxyUrl.value = true
                }

                hls.loadSource(actualUrl)
              } else {
                hls.loadSource(url.replace(/(?:\?|&|%3F|%26)(live=true|live%3Dtrue)$/, ''))
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
              const isLive = isLiveStream(url.replace(/(?:\?|&|%3F|%26)(live=true|live%3Dtrue)$/, ''))
              
              flvPlayer = flvjs.createPlayer({
                type: 'flv',
                url: url.replace(/(?:\?|&|%3F|%26)(live=true|live%3Dtrue)$/, ''),
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
      playbackSpeed: [0.5, 0.75, 1, 1.25, 1.5, 2],
      contextmenu: [
        {
          text: adFilterType.value
        },
        {
          text: autoNextPlayTip.value
        }
      ]
    })

    // 初始化完成后启动状态监控
    if (player) {
      // 初始化完成后设置 playerRef
      playerRef.value = player

      // 重新创建 toast
      if (theTouchToast) {
        theTouchToast.remove()
        theTouchToast = null
      }
      theTouchToast = createToast()

      console.log('播放器初始化完成，启动状态监控')
      initStatusMonitor()
      
      // 添加显示当前播放信息
      updatePlayerTitle()

      // 如果视频类型不是 html，则添加 tabindex 和 click 事件，为了空格或点击暂停视频时，可以触发更新标签时间
      if (player?.video && videoType !== 'html') {
        player.video.setAttribute('tabindex', '0')

        player.video.addEventListener('click', () => {
          player.video.focus()
        })
      }
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

  // 重置 playerRef
  playerRef.value = null
}

// 显示/隐藏播放器工具栏的下一集图标
const showNextEpisodeIcon = (show: boolean) => {
  // 等待 DPlayer 初始化完成
  setTimeout(() => {
    const controllerBar = playerContainer.value?.querySelector('.dplayer-controller');
    if (controllerBar) {
      const nextEpisodeIcon = controllerBar.querySelector('#dplayer-next-episode-icon');
      if (nextEpisodeIcon) {
        if (show) {
          nextEpisodeIcon.classList.remove('disabled', 'hidden');
        } else {
          nextEpisodeIcon.classList.add('disabled', 'hidden');
        }
      }

      const nextEpisodeSettingItem = controllerBar.querySelector('#dplayer-next-episode-setting');
      if (nextEpisodeSettingItem) {
        if (show) {
          nextEpisodeSettingItem.classList.remove('disabled', 'hidden');
        } else {
          nextEpisodeSettingItem.classList.add('disabled', 'hidden');
        }
      }

      const previousEpisodeSettingItem = controllerBar.querySelector('#dplayer-previous-episode-setting');
      if (previousEpisodeSettingItem) {
        if (show) {
          previousEpisodeSettingItem.classList.remove('disabled', 'hidden');
        } else {
          previousEpisodeSettingItem.classList.add('disabled', 'hidden');
        } 
      }
    }
  }, 2000);
}

// 暴露必要的方法和属性
defineExpose({ 
  player: {
    get value() { 
      return player 
    }
  },
  resetPlayer,
  initPlayer,
  showNextEpisodeIcon
})

// 修改 URL 监听函数
watch(() => props.url, async (newUrl, oldUrl) => {
  // 去掉空格后的 URL
  // 如果后缀是live=true，那么是直播
  // 如果配置了代理URL，那么就使用代理
  useProxyLiveUrl.value = false

  newUrl = newUrl.trim()
  if (newUrl.endsWith('live=true') || newUrl.endsWith('live%3Dtrue')) {
    if (props.proxyLiveUrl) {
      useProxyLiveUrl.value = true
      let proxy_live_url = props.proxyLiveUrl
      if (!proxy_live_url.endsWith('/') && !proxy_live_url.endsWith('=')) {
        proxy_live_url += '/'
      }
      newUrl = proxy_live_url + encodeURIComponent(newUrl.replace(/live%3Dtrue$/, 'live=true'))
    }
  } else {
    if (props.proxyVideoUrl) {
      let proxy_video_url = props.proxyVideoUrl
      if (!proxy_video_url.endsWith('/') && !proxy_video_url.endsWith('=')) {
        proxy_video_url += '/'
      }
      newUrl = proxy_video_url + encodeURIComponent(newUrl)
    }
  }

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

// 监听自动连播配置
watch(() => props.autoPlayNext, async (newVal) => {
  if (newVal) {
    autoNextPlayTip.value = '已开启自动连播'
  } else {
    autoNextPlayTip.value = '已关闭自动连播'
  }

  // 等待DOM更新完成
  await nextTick()
  
  // 安全地更新菜单文本
  const menuItems = document.querySelectorAll(".dplayer-menu .dplayer-menu-item a")
  if (menuItems && menuItems.length > 1) {
    menuItems[1].textContent = autoNextPlayTip.value
  }
}, { immediate: true })

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

// 匹配 .ts 前面的数字
const extract_number_before_ts = (the_str: string) => {

  const match = the_str.match(/(\d+)\.ts/);

  if (match) {
      // 使用 parseInt 去掉前导 0
      return parseInt(match[1], 10);
  }

  return null; // 如果不匹配，返回 null
}

// 自定义加载器工厂函数
function customLoaderFactory() {
  // 获取默认加载器
  const DefaultLoader = Hls.DefaultConfig.loader;
  
  // 创建自定义加载器类
  class CustomLoader extends DefaultLoader {
    constructor(config: any) {
      super(config)
      const load = this.load.bind(this)
      
      this.load = function(context: any, config: any, callbacks: any) {

        if (context.type === 'manifest' || context.type === 'level') {

          // 覆盖原始回调
          const originalSuccessCallback = callbacks.onSuccess
          callbacks.onSuccess = function(response: any, stats: any, context: any) {
            if (response.data) {

              const originalContent = response.data
            
              let lines = originalContent.split('\n')
              let filteredLines = []
              
              // 广告过滤信息
              const adFilter = props.currentVideoInfo?.adFilter || {
                                  status: true,
                                  item: 'default_del_ad_tag_to_filter',
                                  regularExpression: ''
                                }
              
              let the_final_ts_len = 0 // 最终长度过滤判断使用
              if (adFilter.status && adFilter.item === 'ad_name_len_to_del_filter') {
                let first_ts_len = 0 // 一般名称长度
                let the_first_ts_len_n = 0
                let second_ts_len = 0 // 异常名称长度
                let the_second_ts_len_n = 0
                let the_extinf_n = 0 // #extinf 计数，只取样前20个ts
                let the_num_incr_index = 0 // 最新名称递增值
                let the_num_incr = 0 // 递增ts数
                let the_real_first_ts_len = 0 // 第一个ts的名称长度

                // 初始化 长度判断 相关参数
                for (let j = 0; j < lines.length; j++) {

                  if (lines[j].trim() === '') {
                    continue
                  }

                  if (lines[j].startsWith('#EXTINF') && lines[j + 1]) {

                    if (the_extinf_n === 0) {
                      the_real_first_ts_len = lines[j + 1].length
                    }

                    if (the_extinf_n === 20) {
                      if (the_real_first_ts_len !== lines[j + 1].length && the_num_incr > 10) {
                        // 类似： xxx1.ts、xxx2.ts。。。。。。xxx20.ts，长度判断不了
                        the_extinf_n = 0 // 阻止赋值 the_final_ts_len
                      }

                      break
                    }

                    const the_ts_index = extract_number_before_ts(lines[j + 1])
                    if (the_ts_index !== null && the_ts_index > the_num_incr_index) {
                      the_num_incr_index = the_ts_index
                      the_num_incr++
                    }

                    if (first_ts_len === 0) {
                      first_ts_len = lines[j + 1].length
                      the_first_ts_len_n++
                      the_extinf_n++
                    } else {
                      if (lines[j + 1].length === first_ts_len) {
                        the_first_ts_len_n++
                        the_extinf_n++
                      } else if (second_ts_len === 0) {
                        second_ts_len = lines[j + 1].length
                        the_second_ts_len_n++
                        the_extinf_n++
                      } else if (lines[j + 1].length === second_ts_len) {
                        the_second_ts_len_n++
                        the_extinf_n++
                      } else {
                        // 出现第三个长度，方法失败，退回默认过滤
                        the_extinf_n = 0
                        break
                      }
                    }
                  }
                }

                if (the_extinf_n) {
                  the_final_ts_len = the_first_ts_len_n >= the_second_ts_len_n ? first_ts_len : second_ts_len
                }
              }

              //console.log('--------------------------', lines)

              for (let i = 0; i < lines.length; i++) {
                let line = lines[i]

                if (line.trim() === '') {
                  continue
                }

                if (line.startsWith('#EXT-X-DISCONTINUITY')) {
                  if (i > 0 && lines[i - 1].startsWith('#EXT-X-')) {
                    filteredLines.push(line)

                    continue
                  } else {

                    if (adFilter.status) {
                      // 开启广告过滤
                      // 都基于 default_del_ad_tag_to_filter
                      if (adFilter.item === 'ad_tag_to_del_filter' && lines[i + 1]) {
                        i += 2
                      }

                      continue
                    } else {
                      // 关闭广告过滤
                      filteredLines.push(line)

                      continue
                    }
                  }
                }

                if (line.startsWith('#EXTINF:') && adFilter.status) {

                  if (adFilter.item === 'ad_name_len_to_del_filter') {
                    if (the_final_ts_len && lines[i + 1] && lines[i + 1].length !== the_final_ts_len) {
                      i += 1
                      continue
                    }
                  } else if (adFilter.item === 'ad_name_regular_to_del_filter') {
                    if (adFilter.regularExpression && (new RegExp(adFilter.regularExpression)).test(lines[i + 1])) {
                      i += 1
                      continue
                    }
                  }
                }

                if (!line.startsWith('#')) {
                  try {
                    if (theReqMainUrl.value.endsWith('live=true') || theReqMainUrl.value.endsWith('live%3Dtrue')) {
                      useProxyLiveUrl.value = true
                    }

                    let context_url = theReqMainUrl.value.replace(/(?:\?|&|%3F|%26)(live=true|live%3Dtrue)$/, '')
                    
                    if (useProxyLiveUrl.value && props.proxyLiveUrl && context_url.startsWith(props.proxyLiveUrl)) {
                      context_url = context_url.replace(props.proxyLiveUrl, '')
                    } else if (!useProxyLiveUrl.value && props.proxyVideoUrl && context_url.startsWith(props.proxyVideoUrl)) {
                      context_url = context_url.replace(props.proxyVideoUrl, '')
                    }
                    const originalUrl = decodeURIComponent(context_url)
                    const urlObj = new URL(originalUrl)

                    // 处理嵌套 m3u8 路径
                    if (line.endsWith('.m3u8')) {
                      if (line.startsWith('http')) {
                        theReqMainUrl.value = line
                      } else  {
                        if (line.startsWith('/')) {
                          theReqMainUrl.value = `${urlObj.protocol}//${urlObj.host}${line}`
                        } else if (!urlObj.pathname.endsWith(line)) {
                          const pathParts = urlObj.pathname.split('/')
                          pathParts.pop() // 移除文件名
                          const basePath = pathParts.join('/')
                          theReqMainUrl.value = `${urlObj.protocol}//${urlObj.host}${basePath}/${line}`
                        }
                      } 
                    }

                    // 正确处理基础URL和相对路径
                    let tsUrl = ''
                    if (line.startsWith('http')) {
                      // 如果是绝对路径
                      tsUrl = line
                    } else {
                      if (line.endsWith('.m3u8') && theReqMainUrl.value.endsWith(line)) {
                        tsUrl = theReqMainUrl.value
                      } else {
                        // 如果是相对路径
                        if (line.startsWith('/')) {
                          // 如果以斜杠开头，使用域名作为基础
                          tsUrl = `${urlObj.protocol}//${urlObj.host}${line}`
                        } else {
                          // 如果不以斜杠开头，需要考虑完整路径
                          // 获取原始URL的目录部分
                          const pathParts = urlObj.pathname.split('/')
                          pathParts.pop() // 移除文件名
                          const basePath = pathParts.join('/')
                          tsUrl = `${urlObj.protocol}//${urlObj.host}${basePath}/${line}`
                        }
                      }
                    }

                    if (props.proxyVideoUrl && tsUrl.startsWith(props.proxyVideoUrl)) {
                      tsUrl = tsUrl.replace(props.proxyVideoUrl, '')
                    } else if (props.proxyLiveUrl && tsUrl.startsWith(props.proxyLiveUrl)) {
                      tsUrl = tsUrl.replace(props.proxyLiveUrl, '')
                    } else if (useProxyUrl.value && tsUrl.startsWith('/api/proxy?url=')) {
                      tsUrl = tsUrl.replace('/api/proxy?url=', '')
                    }

                    if (props.proxyVideoUrl && !useProxyLiveUrl.value) {
                      // 使用视频代理
                      let proxyTsUrl = props.proxyVideoUrl + encodeURIComponent(tsUrl)
                      filteredLines.push(proxyTsUrl)
                    } else if (props.proxyLiveUrl && useProxyLiveUrl.value) {
                      // 使用直播代理
                      let proxyTsUrl = props.proxyLiveUrl + encodeURIComponent(tsUrl)
                      filteredLines.push(proxyTsUrl)
                    } else if (useProxyUrl.value) {
                      // 使用本地服务器代理
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
                    } else {
                      filteredLines.push(tsUrl)
                    }

                    continue
                  } catch (error) {
                    console.error('构建代理URL时出错:', error)
                    filteredLines.push(line) // 出错时使用原始行
                    continue
                  }
                } else if (line.startsWith('#EXT-X-MEDIA') ||
                    line.startsWith('#EXT-X-KEY') ||
                    line.startsWith('#EXT-X-SESSION-KEY') ||
                    line.startsWith('#EXT-X-MAP')) {
                    // 处理 #EXT-X-MEDIA, #EXT-X-KEY, #EXT-X-SESSION-KEY, #EXT-X-MAP 标签中的 URI
                    try {
                      const uriRegex = /URI="([^"]+)"/
                      const match = line.match(uriRegex)
                      if (match && match[1]) {
                        const originalUri = match[1]
                        if (theReqMainUrl.value.endsWith('live=true') || theReqMainUrl.value.endsWith('live%3Dtrue')) {
                          useProxyLiveUrl.value = true
                        }
                        let context_url = theReqMainUrl.value.replace(/(?:\?|&|%3F|%26)(live=true|live%3Dtrue)$/, '')
                        if (!useProxyLiveUrl.value && props.proxyVideoUrl && context_url.startsWith(props.proxyVideoUrl)) {
                          context_url = context_url.replace(props.proxyVideoUrl, '')
                        } else if (useProxyLiveUrl.value && props.proxyLiveUrl && context_url.startsWith(props.proxyLiveUrl)) {
                          context_url = context_url.replace(props.proxyLiveUrl, '')
                        } else if (useProxyUrl.value && context_url.startsWith('/api/proxy?url=')) {
                          context_url = context_url.replace('/api/proxy?url=', '')
                        }

                        const originalUrl = decodeURIComponent(context_url)
                        const urlObj = new URL(originalUrl)
                        
                        // 正确处理基础URL和相对路径
                        let the_uri = ''
                        if (originalUri.startsWith('http')) {
                          // 如果是绝对路径
                          the_uri = originalUri
                        } else {
                          // 如果是相对路径
                          if (originalUri.startsWith('/')) {
                            // 如果以斜杠开头，使用域名作为基础
                            the_uri = `${urlObj.protocol}//${urlObj.host}${originalUri}`
                          } else {
                            // 如果不以斜杠开头，需要考虑完整路径
                            // 获取原始URL的目录部分
                            const pathParts = urlObj.pathname.split('/')
                            pathParts.pop() // 移除文件名
                            const basePath = pathParts.join('/')
                            the_uri = `${urlObj.protocol}//${urlObj.host}${basePath}/${originalUri}`
                          }
                        }

                        if (props.proxyVideoUrl && the_uri.startsWith(props.proxyVideoUrl)) {
                          the_uri = the_uri.replace(props.proxyVideoUrl, '')
                        } else if (props.proxyLiveUrl && the_uri.startsWith(props.proxyLiveUrl)) {
                          the_uri = the_uri.replace(props.proxyLiveUrl, '')
                        } else if (useProxyUrl.value && the_uri.startsWith('/api/proxy?url=')) {
                          the_uri = the_uri.replace('/api/proxy?url=', '')
                        }

                        if (props.proxyVideoUrl && !useProxyLiveUrl.value) {
                          // 使用视频代理
                          let the_proxyUrl = props.proxyVideoUrl + encodeURIComponent(the_uri)
                          line = line.replace(originalUri, the_proxyUrl); // 替换 URI 的值
                        } else if (props.proxyLiveUrl && useProxyLiveUrl.value) {
                          // 使用直播代理
                          let the_proxyUrl = props.proxyLiveUrl + encodeURIComponent(the_uri)
                          line = line.replace(originalUri, the_proxyUrl); // 替换 URI 的值
                        } else if (useProxyUrl.value) {
                          // 使用本地服务器代理
                          // 确保URL格式正确（防止双重编码）
                          let the_proxyUrl = encodeURIComponent(the_uri)
                          let finalUrl = `/api/proxy?url=${the_proxyUrl}`
                          
                          // 特殊情况处理
                          if (originalUri.includes('.m3u8?ts=')) {
                            const tpProxyUrl_split_arr = the_uri.split('?ts=')
                            const tsProxyUrl_0 = tpProxyUrl_split_arr[0]
                            const tsProxyUrl_1 = tpProxyUrl_split_arr[1]
                            the_proxyUrl = encodeURIComponent(tsProxyUrl_0 + '_the_proxy_ts_url_' + tsProxyUrl_1)
                            finalUrl = `/api/proxy?url=${the_proxyUrl}`
                          }
                          
                          line = line.replace(originalUri, finalUrl); // 替换 URI 的值
                        }

                      }
                    } catch (error) {
                      console.error('构建代理URL时出错:', error)
                    }
                }
                
                filteredLines.push(line)
              }

              //console.log('===========================', filteredLines)

              const filteredContent = filteredLines.join('\n')
              response.data = filteredContent
            }
            
            // 调用原始成功回调
            originalSuccessCallback(response, stats, context)
          };
        } else if (context.type === 'fragment' && useProxyUrl.value) {
          // 对于片段请求，确保添加必要的头信息
          const loadatetimeout = context.loadatetimeout || 0
          
          // 添加请求超时
          context.loadatetimeout = loadatetimeout > 0 ? loadatetimeout : 30000
          
          // 修改XHR对象以添加自定义头
          const originalXhrSetup = config.xhrSetup
          config.xhrSetup = function(xhr: XMLHttpRequest, url: string) {
            if (originalXhrSetup) {
              originalXhrSetup(xhr, url)
            }
            
            // 添加必要的请求头
            xhr.withCredentials = true // 允许跨域请求携带认证信息
            
            // 对媒体片段进行特殊处理 - 直接通过URL判断是否为.ts文件
            if (url.includes('.ts')) {
              // 所有.ts文件请求都设置为arraybuffer
              xhr.responseType = 'arraybuffer'
            }
            
          };
          
          // 处理HTTP错误
          const originalOnError = callbacks.onError
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
              originalOnError(response, context, errorType, requestURL)
            }
          };
        }
        
        // 调用原始加载函数
        load(context, config, callbacks)
      };
    }
  }
  
  return CustomLoader
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

/* 在网页全屏模式下隐藏导航栏 */
body.web-fullscreen nav {
  display: none !important;
}

/* 在网页全屏模式下隐藏分割线和右侧面板 */
body.web-fullscreen .split_line_and_right_panel {
  display: none !important;
}

/* 在网页全屏模式下隐藏切换按钮 */
body.web-fullscreen .chevron_toggle_btn {
  display: none !important;
}

/* 在网页全屏模式下移除 video_player_container 的 justify-center */
body.web-fullscreen .video_player_container {
  justify-content: normal !important;
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
  /* 添加以下属性确保完全撑满 */
  min-width: 100vw !important;
  min-height: 100vh !important;
  max-width: 100vw !important;
  max-height: 100vh !important;
  transform: none !important;
  /* 确保视频容器也撑满 */
  .dplayer-video-wrap {
    width: 100% !important;
    height: 100% !important;
  }
  /* 确保视频元素也撑满 */
  .dplayer-video {
    width: 100% !important;
    height: 100% !important;
    object-fit: contain !important;
  }
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

/* 修改进度条的样式 */
.dplayer-volume-bar {
  height: 5px !important;
}

.dplayer-volume-bar-inner {
  opacity: 0.8 !important;
}

.dplayer-bar {
  height: 5px !important;
}

.dplayer-loaded {
  height: 5px !important;
}

.dplayer-played {
  height: 5px !important;
  opacity: 0.8 !important;
}

.dplayer-thumb {
  margin-top: 0px !important;
  height: 5px !important;
  width: 5px !important;
  display: none !important;
}

#dplayer-next-episode-icon.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

#dplayer-next-episode-icon.disabled.hidden {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
</style> 
