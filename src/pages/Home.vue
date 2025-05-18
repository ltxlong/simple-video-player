<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import VideoPlayer from '../components/VideoPlayer.vue'
import { getHomeConfig } from '../api/config'
import type { Config, ResourceSite } from '../types'
import SearchResults from '../components/SearchResults.vue'
import ConfigDialog from '../components/ConfigDialog.vue'
import { BookmarkIcon, MagnifyingGlassIcon, ArrowPathIcon, PlayIcon, FireIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/vue/24/outline'
import router from '@/router'
import HotMoviesDialog from '../components/HotMoviesDialog.vue'

// 默认配置
const defaultConfig: Config = {
  resourceSites: [],
  parseApi: '',
  backgroundImage: '',
  enableLogin: false,
  loginPassword: '',
  announcement: '',
  customTitle: '',
  enableHealthFilter: true,
  proxyVideoUrl: '',
  proxyLiveUrl: '',
  enableHotMovies: false,
  hotMoviesProxyUrl: '',
  hotTvDefaultTag: '',
  hotMovieDefaultTag: '',
  autoPlayNext: false
}

const route = useRoute()
const { toggleTheme, isDark } = useTheme()
const isMobile = !!navigator.userAgent.match(/AppleWebKit.*Mobile.*/)

// 添加背景图片计算属性
const randomBackgroundImage = computed(() => {
  if (!config.value?.backgroundImage) return ''
  
  if (!config.value.backgroundImage.includes(',')) {
    return config.value.backgroundImage.trim()
  }

  // 将逗号分隔的字符串转换为数组
  const imageUrls = config.value.backgroundImage.split(',').map(url => url.trim()).filter(url => url)
  
  // 如果有多个URL，随机选择一个
  if (imageUrls.length > 1) {
    const randomIndex = Math.floor(Math.random() * imageUrls.length)
    return imageUrls[randomIndex]
  }
  
  // 如果只有一个URL，直接返回
  return imageUrls[0] || ''
})

const videoUrl = ref('')
const searchKeyword = ref('')
const videoPlayer = ref<InstanceType<typeof VideoPlayer> | null>(null)
const refreshTrigger = ref(0)  // 添加一个触发刷新的计数器
const isAuthenticated = ref(false)
const isLoading = ref(true)  // 添加loading状态
const loginPassword = ref('')
const loginError = ref('')
const config = ref<Config | null>(null)
const adminConfig = ref<Config | null>(null)
const searchResults = ref<InstanceType<typeof SearchResults> | null>(null)
const useBlueIcon = ref(false)
const pageTitle = ref<{ isImage: boolean; value: string } | null>(null)
const isCurrentTagTab = ref(true)
const isSearching = ref(false)
const isChevronButtonHovered = ref(false)

// 添加用于存储当前播放信息的状态
const currentVideoInfo = ref<{
  title: string;  // 剧集标题
  episode: string; // 集数
  siteRemark: string; // 资源站点名称
  seriesName: string; // 剧集名称
  adFilter: object; // 广告过滤信息
  isTagTab?: boolean; // 是否是标签页播放
}>({ title: '', episode: '', siteRemark: '', seriesName: '', adFilter: {
  status: true,
  item: 'default_del_ad_tag_to_filter',
  regularExpression: ''
} })

// 添加用于存储当前剧集列表和索引的变量，用于自动连播功能

const episodeLists = ref<{ [key: string]: Array<any> }>({});
const episodeIndex = ref<{ [key: string]: number }>({});
const episodeReversed = ref<{ [key: string]: boolean }>({});

// 添加一个变量来存储剧集列表的排序状态(true为倒序,false为正序)


// 修改计算属性的判断逻辑
const canPlayPrevious = computed(() => {
  // 如果没有剧集列表，或者列表长度小于等于1，或者当前索引无效，则不能播放上一集
  if (!episodeLists.value[currentVideoInfo.value.siteRemark] || 
      episodeLists.value[currentVideoInfo.value.siteRemark].length <= 1 || 
      episodeIndex.value[currentVideoInfo.value.siteRemark] < 0) {
    return false
  }
  
  // 根据排序状态判断是否可以播放上一集
  return episodeReversed.value[currentVideoInfo.value.siteRemark] 
    ? episodeIndex.value[currentVideoInfo.value.siteRemark] < episodeLists.value[currentVideoInfo.value.siteRemark].length - 1
    : episodeIndex.value[currentVideoInfo.value.siteRemark] > 0
})

const canPlayNext = computed(() => {
  // 如果没有剧集列表，或者列表长度小于等于1，或者当前索引无效，则不能播放下一集
  if (!episodeLists.value[currentVideoInfo.value.siteRemark] || 
      episodeLists.value[currentVideoInfo.value.siteRemark].length <= 1 || 
      episodeIndex.value[currentVideoInfo.value.siteRemark] < 0) {

    // 下一集图标隐藏
    videoPlayer.value?.showNextEpisodeIcon(false)
    
    return false
  }
  
  // 根据排序状态判断是否可以播放下一集
  const playNextFlag = episodeReversed.value[currentVideoInfo.value.siteRemark] 
    ? episodeIndex.value[currentVideoInfo.value.siteRemark] > 0
    : episodeIndex.value[currentVideoInfo.value.siteRemark] < episodeLists.value[currentVideoInfo.value.siteRemark].length - 1
  
  // 下一集图标显示/隐藏
  if (playNextFlag) {
    videoPlayer.value?.showNextEpisodeIcon(true)
  } else {
    videoPlayer.value?.showNextEpisodeIcon(false)
  }

  return playNextFlag
})

// 修改宽度控制相关的变量
const isDragging = ref(false)
const rightPanelRatio = ref(0.25) // 默认比例 25%
const MIN_RATIO = 0.25 // 最小比例 25%
const MAX_RATIO = 0.75 // 最大比例 75%
const isRightPanelHidden = ref(false) // 添加右侧面板隐藏状态

const showConfigDialog = ref(false)
const showHotMoviesDialog = ref(false)
const localConfig = ref<Config>({ ...defaultConfig })

// 添加资源站点开关状态和总开关状态的追踪变量
const prevResourceSitesEnabled = ref(false)
const prevMasterSwitchEnabled = ref(false)
// 添加跟踪激活资源站点数量的变量
const prevActiveResourceSitesCount = ref(0)

// 用于计算标题的函数
const computedPageTitle = (customTitle: any) =>{
  if (!customTitle) {
    return null // 返回null表示使用默认图标
  }
  const title = String(customTitle).trim()
  if (title === '') {
    return null // 返回null表示使用默认图标
  }
  // 检查是否是图片链接
  const isImageUrl = /^(https?:\/\/|data:image\/)/i.test(title) || 
                    /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(title) ||
                    /^data:image\/(jpeg|png|gif|webp|svg\+xml);base64,/.test(title)
  return {
    isImage: isImageUrl,
    value: title
  }
}

// 更新标题函数
const updatePageTitle = () => {
  pageTitle.value = computedPageTitle(config.value?.customTitle)
}

// 更新是否使用蓝色图标
const updateUseBlueIcon = () => {
  // 从localStorage获取前端配置的总开关状态
  const storedMasterSwitch = localStorage.getItem('frontendConfigMasterSwitch')
  const frontendConfigEnabled = storedMasterSwitch === 'true'
  
  // 从localStorage获取前端配置的首页名称激活状态
  const storedActiveStatus = localStorage.getItem('frontendConfigActiveStatus')
  let customTitleEnabled = false
  if (storedActiveStatus) {
    try {
      const activeStatus = JSON.parse(storedActiveStatus)
      customTitleEnabled = activeStatus.customTitle || false
    } catch (e) {
      console.error('解析配置激活状态失败:', e)
    }
  }
  
  // 从localStorage获取前端配置
  const storedConfig = localStorage.getItem('frontendConfig')
  let customTitleValue = ''
  if (storedConfig) {
    try {
      const parsedConfig = JSON.parse(storedConfig)
      customTitleValue = parsedConfig.customTitle || ''
    } catch (e) {
      console.error('解析存储的配置失败:', e)
    }
  }
  
  // 总开关开启 && (首页名称开关关闭 || 首页名称为空)
  useBlueIcon.value = frontendConfigEnabled && (!customTitleEnabled || !customTitleValue.trim())
}

const updateCurrentTagTime = (time: any, nextEpisode?: any) => {
  try {
    if (currentVideoInfo.value) {
      const siteName = currentVideoInfo.value.siteRemark || '';
      const seriesName = currentVideoInfo.value.seriesName || '';
      
      // 检查是否有标签
      if (siteName && seriesName) {
        // 从localStorage获取标签
        const tags = JSON.parse(localStorage.getItem('video_tags') || '{}');
        const key = `${siteName}::${seriesName}`.trim();
        
        // 如果有此标签，清空进度信息，更新追更集数
        if (tags[key]) {
          tags[key].currentTime = time || 0;
          tags[key].episodeNumber = nextEpisode ? nextEpisode.episode : (currentVideoInfo.value.episode || '');
          localStorage.setItem('video_tags', JSON.stringify(tags));
        }
      }
    }
  } catch (e) {
    console.error('修改标签信息出错:', e)
  }
}

const handleSpaceUpdateCurrentTagTime = (e: KeyboardEvent) => {
  if (e.code === 'Space' && document.activeElement === videoPlayer.value?.player.value?.video && !videoPlayer.value?.player.value?.video.paused) {
    updateCurrentTagTime(videoPlayer.value?.player.value?.video.currentTime)
  }
}

const handleClickUpdateCurrentTagTime = () => {
  if (document.activeElement === videoPlayer.value?.player.value?.video && videoPlayer.value?.player.value?.video.paused) {
    updateCurrentTagTime(videoPlayer.value?.player.value?.video.currentTime)
  }
}

// 检查登录状态并加载配置
const loadConfig = async () => {
  try {
    const configData = await getHomeConfig()
    config.value = configData
    adminConfig.value = JSON.parse(JSON.stringify(configData))
    
    // 如果不需要登录，直接设置为已认证状态
    if (!configData.enableLogin) {
      isAuthenticated.value = true
    } else {
      // 如果需要登录，检查是否有token
      const token = sessionStorage.getItem('token')
      isAuthenticated.value = !!token
    }

    // 如果已认证，加载URL参数
    if (isAuthenticated.value) {
      const urlParam = route.query.url as string
      if (urlParam) {
        videoUrl.value = urlParam.trim()
      }
    }

    // 加载前端配置，判断覆盖后端配置
    const localConfigFlag = localStorage.getItem('frontendConfigMasterSwitch')
    if (localConfigFlag === 'true') {
      const localConfig = localStorage.getItem('frontendConfig')
      const localConfigActiveStatus = localStorage.getItem('frontendConfigActiveStatus')
      if (localConfig && localConfigActiveStatus) {
        const localConfigData = JSON.parse(localConfig)
        const localConfigActiveStatusData = JSON.parse(localConfigActiveStatus)
        if (localConfigActiveStatusData.resourceSites && localConfigData.resourceSites && config.value) {
          config.value.resourceSites = localConfigData.resourceSites
        }
        if (localConfigActiveStatusData.parseApi && localConfigData.parseApi && config.value) {
          config.value.parseApi = localConfigData.parseApi
        }
        if (localConfigActiveStatusData.proxyVideoUrl && config.value) {
          config.value.proxyVideoUrl = localConfigData.proxyVideoUrl || ''
        }
        if (localConfigActiveStatusData.proxyLiveUrl && config.value) {
          config.value.proxyLiveUrl = localConfigData.proxyLiveUrl || ''
        }
        if (localConfigActiveStatusData.backgroundImage && config.value) {
          config.value.backgroundImage = localConfigData.backgroundImage || ''
        }
        if (localConfigActiveStatusData.announcement && config.value) {
          config.value.announcement = localConfigData.announcement || ''
        }
        if (localConfigActiveStatusData.customTitle && config.value) {
          config.value.customTitle = localConfigData.customTitle || ''
        }
        // 豆瓣热门配置 和 自动连播配置 - 前端总开关打开时始终覆盖后端配置，无论开关是否打开
        if (config.value) {
          // 从前端配置中获取豆瓣热门状态
          config.value.enableHotMovies = localConfigActiveStatusData.enableHotMovies || false

          if (localConfigData.hotMoviesProxyUrl) {
            config.value.hotMoviesProxyUrl = localConfigData.hotMoviesProxyUrl
          }
          if (localConfigData.hotTvDefaultTag) {
            config.value.hotTvDefaultTag = localConfigData.hotTvDefaultTag
          }
          if (localConfigData.hotMovieDefaultTag) {
            config.value.hotMovieDefaultTag = localConfigData.hotMovieDefaultTag
          }

          // 从前端配置中获取自动连播状态
          config.value.autoPlayNext = localConfigActiveStatusData.autoPlayNext || false
        }
      }
    }
    
    // 更新依赖于配置的数据
    updatePageTitle()
    updateUseBlueIcon()
    
    // 配置更新后，同步更新当前视频的 adFilter
    updateCurrentVideoAdFilter()

  } catch (error) {
    console.error('加载配置失败:', error)
    config.value = { ...defaultConfig, enableLogin: true }
    isAuthenticated.value = false
  }
}

onMounted(async () => {
  try {
    await loadConfig()
    
    // 初始化前一次配置状态变量
    const storedActiveStatus = localStorage.getItem('frontendConfigActiveStatus')
    if (storedActiveStatus) {
      try {
        const activeStatus = JSON.parse(storedActiveStatus)
        prevResourceSitesEnabled.value = activeStatus.resourceSites || false
      } catch (e) {
        console.error('解析frontendConfigActiveStatus失败:', e)
      }
    }
    
    const storedMasterSwitch = localStorage.getItem('frontendConfigMasterSwitch')
    prevMasterSwitchEnabled.value = storedMasterSwitch === 'true'
    
  } finally {
    isLoading.value = false
  }

  // 添加触摸事件监听器
  document.addEventListener('mousemove', handleDrag)
  document.addEventListener('mouseup', handleDragEnd)
  document.addEventListener('touchmove', handleDrag, { passive: false })
  document.addEventListener('touchend', handleDragEnd)

  // 添加键盘事件监听器
  document.addEventListener('keydown', handleSpaceUpdateCurrentTagTime)

  // 添加点击事件监听器
  document.addEventListener('click', handleClickUpdateCurrentTagTime)

  const htmlVideoUrl = route.query.url as string
  if (htmlVideoUrl) {
    videoUrl.value = htmlVideoUrl
    router.replace(
      {
        path: route.path,
        query: {}
      }
    )
  }

  // 从localStorage加载右侧面板状态
  const savedState = localStorage.getItem('rightPanelState')
  if (savedState) {
    const { isHidden, ratio } = JSON.parse(savedState)
    isRightPanelHidden.value = isHidden
    if (!isHidden) {
      rightPanelRatio.value = ratio
    }
  }
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', handleDragEnd)
  document.removeEventListener('touchmove', handleDrag)
  document.removeEventListener('touchend', handleDragEnd)
  document.removeEventListener('keydown', handleSpaceUpdateCurrentTagTime)
  document.removeEventListener('click', handleClickUpdateCurrentTagTime)
})

const handlePlay = () => {
  const url = videoUrl.value?.trim() || ''
  if (!url) return
  
  // 增加计数器触发刷新
  refreshTrigger.value++
}

const handleSearch = () => {
  searchKeyword.value = searchKeyword.value?.trim() || ''
  
  // 如果SearchResults组件存在
  if (searchResults.value) {
    // 执行切换到第一个非标签标签页的操作
    searchResults.value?.switchToFirstNonTagTab()
    // 执行搜索
    searchResults.value?.performSearch()
  }
}

const handleLogin = async () => {
  try {
    const password = loginPassword.value?.trim() || ''
    if (!password) {
      loginError.value = '请输入密码'
      return
    }

    // 验证密码
    const response = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        password: password,
        isAdmin: false
      })
    })

    const data = await response.json()
    
    if (!response.ok) {
      loginError.value = data.error || '登录失败'
      return
    }

    // 保存 token 到 sessionStorage
    sessionStorage.setItem('token', data.token)
    isAuthenticated.value = true
    loginError.value = ''
    
    // 登录成功后加载配置
    await loadConfig()
  } catch (error) {
    console.error('登录失败:', error)
    loginError.value = '登录失败，请重试'
  }
}

const handlePasswordInput = () => {
  loginError.value = ''
}

// 处理拖动
const handleDragStart = (e: MouseEvent | TouchEvent) => {
  // 移动端不处理拖动
  if (isMobile) return
  
  isDragging.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

const handleDragEnd = () => {
  if (isMobile) return
  
  isDragging.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

const handleDrag = (e: MouseEvent | TouchEvent) => {
  if (!isDragging.value || isMobile) return
  
  const container = document.querySelector('.main-container')
  if (!container) return
  
  const containerRect = container.getBoundingClientRect()
  const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX
  const totalWidth = containerRect.width
  const rightWidth = containerRect.right - clientX
  const newRatio = rightWidth / totalWidth
  
  if (newRatio >= MIN_RATIO && newRatio <= MAX_RATIO) {
    rightPanelRatio.value = newRatio
  }
}

// 添加更新视频URL的处理函数
const handleVideoUrlUpdate = (url: string, videoInfo: { 
  title: string, 
  episode: string, 
  siteRemark: string, 
  seriesName: string, 
  adFilter: object,
  isTagTab: boolean 
}, episodeList: Array<any> = [], index: number = -1, isReversed: boolean = false) => {
  videoUrl.value = url
  currentVideoInfo.value = videoInfo
  // 保存剧集列表和当前索引，用于自动连播
  episodeLists.value[videoInfo.siteRemark] = episodeList
  episodeIndex.value[videoInfo.siteRemark] = index
  // 保存排序状态
  episodeReversed.value[videoInfo.siteRemark] = isReversed
  
  // 如果有配置更新，确保获取最新的 adFilter
  if (config.value && config.value.resourceSites) {
    updateCurrentVideoAdFilter()
  }
}

// 添加更新 currentVideoInfo 中 adFilter 的函数
const updateCurrentVideoAdFilter = () => {
  if (!currentVideoInfo.value || !currentVideoInfo.value.siteRemark || !config.value || !config.value.resourceSites) {
    return
  }

  // 查找当前视频对应的资源站点
  const currentSite = config.value.resourceSites.find(
    (site) => site.remark === currentVideoInfo.value.siteRemark
  )

  // 如果找到了站点，更新 adFilter
  if (currentSite && currentSite.adFilter) {
    currentVideoInfo.value.adFilter = currentSite.adFilter
  }
}

// 添加处理显示标签列表的方法
const handleShowTags = () => {
  if (searchResults.value) {
    searchResults.value.showTagsListDialog()
  }
}

// 添加处理显示热门电影的方法
const handleShowHotMovies = () => {
  showHotMoviesDialog.value = true
}

const handleEnterPlay = () => {
  if (videoUrl.value.trim()) {
    setTimeout(() => {
      videoPlayer.value?.player.value?.play()
    }, 0)
  }
}

// 处理配置更新
const handleConfigUpdate = (newConfig: any) => {
  localConfig.value = newConfig.localConfig

  // 先还原后端配置（使用深拷贝而不是引用赋值）
  config.value = JSON.parse(JSON.stringify(adminConfig.value))

  // 记录状态变化
  const currentMasterSwitchEnabled = newConfig.isMasterSwitch
  const currentResourceSitesEnabled = newConfig.activeStatus.resourceSites
  
  // 总开关从开到关的情况
  const masterSwitchTurnedOff = prevMasterSwitchEnabled.value && !currentMasterSwitchEnabled
  
  // 总开关开启的情况下，资源站点开关变化的情况
  let shouldTriggerSearch = false
  
  if (currentMasterSwitchEnabled) {
    // 总开关开启状态下：

    // 检查资源站点配置是否为空
    const isResourceSitesEmpty = () => {
      // 1. 没有资源配置
      if (!Array.isArray(newConfig.localConfig.resourceSites) || 
          newConfig.localConfig.resourceSites.length === 0) {
        return true
      }
      
      // 2. 有资源配置，但所有站点的active都是false
      const hasActiveSite = newConfig.localConfig.resourceSites.some((site: ResourceSite) => site.active === true)
      if (!hasActiveSite) {
        return true
      }
      
      // 3. 有资源配置，active为true的站点中，存在url或remark为空的情况
      const hasInvalidActiveSite = newConfig.localConfig.resourceSites.some(
        (site: ResourceSite) => {
          if (!site.active) return false
          
          // 检查URL是否为空
          if (!site.url || site.url.trim() === '') {
            return true
          }
          
          // 检查remark是否为空
          if (!site.remark || site.remark.trim() === '') {
            return true
          }
          
          // 检查POST参数格式
          if (site.isPost && site.postData) {
            try {
              JSON.parse(site.postData)
            } catch (e) {
              return true // POST数据不是有效的JSON格式
            }
          }
          
          return false
        }
      )
      
      return hasInvalidActiveSite
    }
    
    // 计算当前有效激活资源站点的数量
    const getActiveResourceSitesCount = () => {
      if (!Array.isArray(newConfig.localConfig.resourceSites)) {
        return 0
      }
      
      return newConfig.localConfig.resourceSites.filter((site: ResourceSite) => {
        if (!site.active) return false
        
        // 检查URL是否为空
        if (!site.url || site.url.trim() === '') {
          return false
        }
        
        // 检查remark是否为空
        if (!site.remark || site.remark.trim() === '') {
          return false
        }
        
        // 检查POST参数格式
        if (site.isPost && site.postData) {
          try {
            JSON.parse(site.postData)
          } catch (e) {
            return false // POST数据不是有效的JSON格式
          }
        }
        
        return true
      }).length
    }
    
    // 获取当前激活的资源站点数量
    const currentActiveResourceSitesCount = getActiveResourceSitesCount()
    
    // 资源站点配置的开关从关闭到打开，并且资源站点配置不为空
    if (!prevResourceSitesEnabled.value && currentResourceSitesEnabled && 
        !isResourceSitesEmpty()) {
      shouldTriggerSearch = true
    }
    
    // 资源站点配置的开关从打开到关闭
    if (prevResourceSitesEnabled.value && !currentResourceSitesEnabled) {
      shouldTriggerSearch = true
    }
    
    // 检测激活资源站点数量的变化
    if (currentResourceSitesEnabled &&
        (prevActiveResourceSitesCount.value !== currentActiveResourceSitesCount)) {
      shouldTriggerSearch = true
    }
    
    // 更新资源站点配置
    if (currentResourceSitesEnabled && config.value) {
      // 判断前端资源站点配置是否为空
      if (isResourceSitesEmpty()) {
        // 如果前端配置为空，使用后端配置
        config.value.resourceSites = adminConfig.value?.resourceSites || [];
      } else {
        // 前端配置不为空，才使用前端配置
        config.value.resourceSites = newConfig.localConfig.resourceSites;
      }

    }
    
    // 更新前一次激活资源站点的数量
    prevActiveResourceSitesCount.value = currentActiveResourceSitesCount
  }
  
  // 如果总开关从打开到关闭，也触发搜索
  if (masterSwitchTurnedOff) {
    shouldTriggerSearch = true
  }
  
  // 如果配置项有值，则覆盖后端的配置
  if (newConfig.isMasterSwitch) {
    if (newConfig.activeStatus.parseApi && newConfig.parseApi && config.value) config.value.parseApi = newConfig.localConfig.parseApi
    if (newConfig.activeStatus.backgroundImage && config.value) config.value.backgroundImage = newConfig.localConfig.backgroundImage
    if (newConfig.activeStatus.announcement && config.value) config.value.announcement = newConfig.localConfig.announcement
    if (newConfig.activeStatus.customTitle && config.value) { config.value.customTitle = newConfig.localConfig.customTitle }
    if (newConfig.activeStatus.proxyVideoUrl && config.value) config.value.proxyVideoUrl = newConfig.localConfig.proxyVideoUrl
    if (newConfig.activeStatus.proxyLiveUrl && config.value) config.value.proxyLiveUrl = newConfig.localConfig.proxyLiveUrl
    
    // 设置豆瓣热门开关状态和代理URL 和 自动连播开关状态
    if (config.value) {
      config.value.enableHotMovies = newConfig.activeStatus.enableHotMovies
      if (newConfig.activeStatus.enableHotMovies) {
        if (newConfig.localConfig.hotMoviesProxyUrl) {
          config.value.hotMoviesProxyUrl = newConfig.localConfig.hotMoviesProxyUrl
        } else {
          config.value.hotMoviesProxyUrl = adminConfig.value?.hotMoviesProxyUrl || ''
        }
        if (newConfig.localConfig.hotTvDefaultTag) {
          config.value.hotTvDefaultTag = newConfig.localConfig.hotTvDefaultTag
        } else {
          config.value.hotTvDefaultTag = adminConfig.value?.hotTvDefaultTag || ''
        }
        if (newConfig.localConfig.hotMovieDefaultTag) {
          config.value.hotMovieDefaultTag = newConfig.localConfig.hotMovieDefaultTag
        } else {
          config.value.hotMovieDefaultTag = adminConfig.value?.hotMovieDefaultTag || ''
        }
      }

      config.value.autoPlayNext = newConfig.activeStatus.autoPlayNext
    }
    
    // 更新计算属性相关的值
    updatePageTitle()
    useBlueIcon.value = true
  } else {
    useBlueIcon.value = false
  }
  
  // 配置更新后，同步更新当前视频的 adFilter
  updateCurrentVideoAdFilter()
  
  // 如果需要触发搜索，则在DOM更新后执行
  if (shouldTriggerSearch) {
    nextTick(() => {
      handleSearch()
    })
  }
  
  // 更新前一次状态
  prevResourceSitesEnabled.value = currentResourceSitesEnabled
  prevMasterSwitchEnabled.value = currentMasterSwitchEnabled

  // 保存右侧面板状态
  saveRightPanelState()
}

// 添加处理热门电影搜索的方法
const handleHotMoviesSearch = (keyword: string) => {
  if (keyword && keyword.trim()) {
    // 如果右侧面板是隐藏的，先显示
    if (isRightPanelHidden.value) {
      isRightPanelHidden.value = false
      saveRightPanelState()
    }
    // 先设置搜索关键词
    searchKeyword.value = keyword.trim()
    // 确保在DOM更新后再执行搜索
    nextTick(() => {
      // 如果SearchResults组件存在
      if (searchResults.value) {
        // 执行切换到第一个非标签标签页的操作
        searchResults.value.switchToFirstNonTagTab()
        // 执行搜索
        searchResults.value.performSearch()
      } else {
        // 如果组件不存在，直接调用handleSearch
        handleSearch()
      }
    })
  }
}

// 添加自动播放下一集的方法
const autoNextPlayVideo = () => {
  // 检查是否有剧集列表和有效的当前索引
  if (!episodeLists.value[currentVideoInfo.value.siteRemark] || 
      !episodeIndex.value[currentVideoInfo.value.siteRemark] && 
      episodeIndex.value[currentVideoInfo.value.siteRemark] !== 0 || 
      episodeIndex.value[currentVideoInfo.value.siteRemark] < 0) {
    return
  }
  
  // 根据排序状态计算下一集的索引
  const nextIndex = episodeReversed.value[currentVideoInfo.value.siteRemark] 
    ? episodeIndex.value[currentVideoInfo.value.siteRemark] - 1  // 倒序，索引减1
    : episodeIndex.value[currentVideoInfo.value.siteRemark] + 1  // 正序，索引加1
  
  // 检查是否还有下一集
  if (nextIndex >= 0 && nextIndex < episodeLists.value[currentVideoInfo.value.siteRemark].length) {

    // 提示即将播放下一集
    videoPlayer.value?.player.value?.notice('即将播放下一集', 2000, 1)

    setTimeout(() => {
      // 获取下一集信息
      const nextEpisode = episodeLists.value[currentVideoInfo.value.siteRemark][nextIndex]
      
      // 更新视频URL和相关信息
      if (nextEpisode && nextEpisode.url) {      
        
        // 更新当前播放索引
        episodeIndex.value[currentVideoInfo.value.siteRemark] = nextIndex
        
        // 模拟点击剧集按钮(如果找得到对应按钮)
        nextTick(() => {
          const episodeButton = document.querySelector(`.m3u8-item[data-url="${nextEpisode.url}"]`);

          if (episodeButton && (!nextEpisode.isTagTab || (nextEpisode.isTagTab && isCurrentTagTab.value))) {
            // 使用HTMLElement的click方法
            (episodeButton as HTMLElement).click();
          } else {
            // 如果无法获取站点信息或SearchResults组件不可用，直接赋值播放链接
            videoUrl.value = nextEpisode.url;
            currentVideoInfo.value.title = nextEpisode.title || '';
            currentVideoInfo.value.episode = nextEpisode.episode || '';

            if (searchResults.value && nextEpisode.siteRemark) {
              // 调用SearchResults组件的updateAutoActiveEpisode方法
              searchResults.value.updateAutoActiveEpisode(nextEpisode.url, nextEpisode.siteRemark, nextEpisode.isTagTab);
            }
          }

          // 修改标签信息
          updateCurrentTagTime(0, nextEpisode)
        })
      }
    }, 2000)
  }
}

// 从localStorage加载右侧面板状态
const saveRightPanelState = () => {
  localStorage.setItem('rightPanelState', JSON.stringify({
    isHidden: isRightPanelHidden.value,
    ratio: rightPanelRatio.value
  }))
}

// 切换右侧面板显示状态
const toggleRightPanel = () => {
  if (!isMobile) {
    if (isRightPanelHidden.value) {
      // 显示面板时，使用之前保存的比例
      const savedState = localStorage.getItem('rightPanelState')
      if (savedState) {
        const { ratio } = JSON.parse(savedState)
        rightPanelRatio.value = ratio
      }
    } else {
      // 隐藏面板时，设置为最小比例，使左侧面板最大化（为了美观，隐藏和显示都是固定比例了）
      rightPanelRatio.value = MIN_RATIO
    }
  }
  isRightPanelHidden.value = !isRightPanelHidden.value
  saveRightPanelState()
}

// 添加播放上一集的方法
const playPreviousEpisode = () => {
  if (!canPlayPrevious.value) return
  
  const prevIndex = episodeReversed.value[currentVideoInfo.value.siteRemark] 
    ? episodeIndex.value[currentVideoInfo.value.siteRemark] + 1
    : episodeIndex.value[currentVideoInfo.value.siteRemark] - 1
  
  const prevEpisode = episodeLists.value[currentVideoInfo.value.siteRemark][prevIndex]
  if (prevEpisode && prevEpisode.url) {
    episodeIndex.value[currentVideoInfo.value.siteRemark] = prevIndex
    videoUrl.value = prevEpisode.url
    currentVideoInfo.value.title = prevEpisode.title || ''
    currentVideoInfo.value.episode = prevEpisode.episode || ''
    
    if (searchResults.value && prevEpisode.siteRemark) {
      searchResults.value.updateAutoActiveEpisode(prevEpisode.url, prevEpisode.siteRemark, prevEpisode.isTagTab)
    }

    // 修改标签信息
    updateCurrentTagTime(0, prevEpisode)
  }
}

// 添加播放下一集的方法
const playNextEpisode = () => {
  if (!canPlayNext.value) return
  
  const nextIndex = episodeReversed.value[currentVideoInfo.value.siteRemark] 
    ? episodeIndex.value[currentVideoInfo.value.siteRemark] - 1
    : episodeIndex.value[currentVideoInfo.value.siteRemark] + 1
  
  const nextEpisode = episodeLists.value[currentVideoInfo.value.siteRemark][nextIndex]
  if (nextEpisode && nextEpisode.url) {
    episodeIndex.value[currentVideoInfo.value.siteRemark] = nextIndex
    videoUrl.value = nextEpisode.url
    currentVideoInfo.value.title = nextEpisode.title || ''
    currentVideoInfo.value.episode = nextEpisode.episode || ''
    
    if (searchResults.value && nextEpisode.siteRemark) {
      searchResults.value.updateAutoActiveEpisode(nextEpisode.url, nextEpisode.siteRemark, nextEpisode.isTagTab)
    }

    // 修改标签信息
    updateCurrentTagTime(0, nextEpisode)
  }
}
</script>

<template>
  <div class="min-h-screen flex flex-col transition-colors duration-0 bg-background-light dark:bg-background-dark">
    <!-- 添加loading状态显示 -->
    <template v-if="isLoading">
      <div class="min-h-screen flex items-center justify-center">
        <div class="text-center space-y-3">
          <div class="w-12 h-12 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p class="text-primary-light dark:text-primary-dark">加载中...</p>
        </div>
      </div>
    </template>
    
    <template v-else-if="isAuthenticated">
      <!-- 导航栏 -->
      <nav class="w-full px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <!-- 顶部栏 -->
        <div class="flex items-center">
          <h1 
            class="text-xl font-bold text-text-light dark:text-text-dark whitespace-nowrap flex items-center cursor-pointer hover:text-primary-light dark:hover:text-primary-dark"
            @click="showConfigDialog = true"
          >
            <template v-if="pageTitle">
              <template v-if="pageTitle.isImage">
                <img :src="pageTitle.value" alt="Logo" class="h-6 w-auto object-contain" />
              </template>
              <template v-else>
                {{ pageTitle.value }}
              </template>
            </template>
            <template v-else>
              <!-- 根据useBlueIcon的值动态改变图标颜色 -->
              <PlayIcon class="w-6 h-6" :class="{'text-primary-light dark:text-primary-dark': useBlueIcon}" />
            </template>
          </h1>
          
          <!-- 公告栏 -->
          <div v-if="config?.announcement" class="flex-1 px-4 text-center text-sm text-gray-500 dark:text-gray-400 truncate">
            {{ config.announcement }}
          </div>
          <!-- 无公告时的占位符 -->
          <div v-else class="flex-1"></div>

          <button
            @click="toggleTheme"
            class="h-10 w-10 flex items-center justify-center rounded-lg bg-background-light dark:bg-background-dark text-primary-light dark:text-primary-dark hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap"
            :title="isDark ? '切换到日间模式' : '切换到夜间模式'"
          >
            <el-icon class="text-xl"><component :is="isDark ? 'Sunny' : 'Moon'" /></el-icon>
          </button>
        </div>
      </nav>

      <!-- 主要内容区 -->
      <div class="flex-1 flex flex-col lg:flex-row main-container relative overflow-x-hidden">
        <!-- 左侧视频播放区容器 -->
        <div 
          class="video_player_container lg:h-auto relative"
          :class="{ 'w-full flex justify-center': isRightPanelHidden }"
          :style="[
            !isMobile && !isRightPanelHidden
              ? { width: `${(1 - rightPanelRatio) * 100}%` }
              : {}
          ]"
        >
          <!-- 内容区域 -->
          <div 
            class="relative z-10 px-4 pt-4 pb-2 w-full transform-gpu"
            :style="[
              !isMobile && isRightPanelHidden
                ? { 
                    width: `${(1 - rightPanelRatio) * 100}vw`, 
                    maxWidth: `${(1 - rightPanelRatio) * 100}%`,
                    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                  }
                : {
                    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                  }
            ]"
          >
            <!-- 视频链接输入区 -->
            <div class="flex flex-col sm:flex-row gap-2 w-full">
              <div class="flex-1 flex gap-2">
                <input
                  v-model="videoUrl"
                  @keyup.enter="handleEnterPlay"
                  type="text"
                  class="flex-1 p-2 rounded border-[0.5px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-200 focus:text-gray-500 dark:text-gray-700 focus:dark:text-gray-300 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                />
                <button
                  @click="handlePlay"
                  class="px-4 py-2 rounded bg-white dark:bg-gray-800 text-gray-500 hover:text-primary-light dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium active:scale-95 flex items-center justify-center"
                >
                  <ArrowPathIcon class="w-5 h-5" />
                </button>
                <button
                  @click="handleShowHotMovies"
                  v-if="config?.enableHotMovies === true"
                  class="px-4 py-2 rounded bg-white dark:bg-gray-800 text-gray-500 hover:text-primary-light dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium active:scale-95 flex items-center justify-center"
                >
                  <FireIcon class="w-5 h-5" />
                </button>
              </div>
            </div>

            <!-- 视频播放器区域 -->
            <div class="relative aspect-video mt-4">
              <!-- 背景图片容器 -->
              <div 
                v-if="randomBackgroundImage"
                class="absolute inset-0 w-full h-full"
                :style="{
                  backgroundImage: `url(${randomBackgroundImage})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat'
                }"
              ></div>

              <!-- 视频播放器 -->
              <VideoPlayer
                v-if="videoUrl"
                :url="videoUrl"
                :background-image="config?.backgroundImage || ''"
                :parse-api="config?.parseApi || ''"
                :refresh-trigger="refreshTrigger"
                :proxy-video-url="config?.proxyVideoUrl || ''"
                :proxy-live-url="config?.proxyLiveUrl || ''"
                :current-video-info="currentVideoInfo"
                :auto-play-next="config?.autoPlayNext || false"
                @video-ended="autoNextPlayVideo"
                @play-next-episode="playNextEpisode"
                @play-previous-episode="playPreviousEpisode"
                ref="videoPlayer"
                class="relative z-10 w-full h-full"
              />
            </div>

            <!-- 添加剧集导航按钮 -->
            <div v-if="episodeLists[currentVideoInfo.siteRemark] && 
                       episodeLists[currentVideoInfo.siteRemark].length > 1 && 
                       episodeIndex[currentVideoInfo.siteRemark] >= 0 && 
                       !isMobile" 
                         class="flex justify-between items-center mt-3">
              <button
                @click="playPreviousEpisode"
                :disabled="!canPlayPrevious"
                class="flex items-center gap-2 px-4 py-2 rounded bg-white dark:bg-gray-800 text-gray-200 hover:text-primary-light dark:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium active:scale-95 disabled:hover:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-gray-800 disabled:hover:border-gray-200 dark:disabled:hover:border-gray-700"
              >
                <ChevronLeftIcon class="w-5 h-5" />
                <span>上一集</span>
              </button>
              <button
                @click="playNextEpisode"
                :disabled="!canPlayNext"
                class="flex items-center gap-2 px-4 py-2 rounded bg-white dark:bg-gray-800 text-gray-200 hover:text-primary-light dark:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium active:scale-95 disabled:hover:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-gray-800 disabled:hover:border-gray-200 dark:disabled:hover:border-gray-700"
              >
                <span>下一集</span>
                <ChevronRightIcon class="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <!-- 分隔线和右侧面板容器 -->
        <div 
          class="split_line_and_right_panel lg:absolute right-0 top-0 bottom-0 transform-gpu"
          :style="[
            !isMobile 
              ? { 
                  width: `${rightPanelRatio * 100}%`,
                  opacity: isRightPanelHidden ? 0 : 1,
                  visibility: isRightPanelHidden ? 'hidden' : 'visible',
                  transform: isRightPanelHidden ? 'translateX(100%)' : 'translateX(0)',
                  transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }
              : { height: '50%' }
          ]"
        >
          <!-- 分隔线 -->
          <div
            v-if="!isMobile"
            class="absolute left-0 top-0 bottom-0 hover:w-1 w-0 -mx-0 bg-gray-200 dark:bg-gray-700 hover:bg-primary-light dark:hover:bg-primary-dark z-10 cursor-col-resize transition-opacity duration-300"
            :class="{ 'opacity-0': isRightPanelHidden }"
            @mousedown="handleDragStart"
            @touchstart="handleDragStart"
          >
            <!-- 拖动把手 -->
            <div class="absolute inset-y-0 -left-1 -right-1"></div>
          </div>

          <!-- 右侧搜索区 -->
          <div
            class="h-full p-4 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-y-auto transition-opacity duration-300"
            :class="{ 'opacity-0': !isMobile && isRightPanelHidden }"
          >
            <div class="space-y-4">
              <!-- 搜索输入框 -->
              <div class="flex flex-col sm:flex-row gap-2 w-full">
                <div class="flex-1 flex gap-2">
                  <input
                    v-model="searchKeyword"
                    type="text"
                    :disabled="isSearching"
                    @keyup.enter="handleSearch"
                    class="flex-1 p-2 rounded border-[0.5px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light dark:text-text-dark focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                  />
                  <div class="flex gap-2">
                    <button
                      :disabled="isSearching"
                      @click="handleSearch"
                      class="px-4 py-2 rounded bg-white dark:bg-gray-800 text-gray-500 hover:text-primary-light dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium active:scale-95 flex items-center justify-center"
                    >
                      <MagnifyingGlassIcon class="w-5 h-5" />
                    </button>
                    <button
                      @click="handleShowTags"
                      class="px-4 py-2 rounded bg-white dark:bg-gray-800 text-gray-500 hover:text-primary-light dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium active:scale-95 flex items-center justify-center"
                    >
                      <BookmarkIcon class="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- 搜索结果列表 -->
              <SearchResults
                v-if="config && config.resourceSites.length > 0"
                :sites="config.resourceSites"
                :keyword="searchKeyword"
                :enable-health-filter="config?.enableHealthFilter ?? true"
                :refresh-trigger="refreshTrigger"
                :video-player="videoPlayer"
                @updateVideoUrl="handleVideoUrlUpdate"
                v-model:isSearching = "isSearching"
                v-model:isCurrentTagTab="isCurrentTagTab"
                ref="searchResults"
              />
            </div>
          </div>
        </div>

        <!-- 添加悬浮按钮 -->
        <div
          v-if="!isMobile"
          class="chevron_toggle_btn hidden lg:block fixed right-0 top-1/2 transform -translate-y-1/2 z-50"
        >
          <!-- 隐藏按钮 -->
          <button
            v-if="!isRightPanelHidden"
            @click="toggleRightPanel"
            @mouseenter="isChevronButtonHovered = true"
            @mouseleave="isChevronButtonHovered = false"
            :class="[
              'chevron-toggle-btn w-6 transition-all duration-300 flex items-center justify-center group relative overflow-hidden',
              isChevronButtonHovered ? 'h-40' : 'h-20'
            ]"
            class="bg-white/30 dark:bg-gray-800/30 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 rounded-l shadow-lg hover:bg-white dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
          >
            <ChevronRightIcon class="h-5 w-5 text-gray-500 dark:text-gray-400 group-hover:text-primary-light transition-colors duration-200 z-10" />
          </button>

          <!-- 显示按钮 -->
          <button
            v-else
            @click="toggleRightPanel"
            @mouseenter="isChevronButtonHovered = true"
            @mouseleave="isChevronButtonHovered = false"
            :class="[
              'chevron-toggle-btn w-6 transition-all duration-300 flex items-center justify-center group relative overflow-hidden',
              isChevronButtonHovered ? 'h-40' : 'h-20'
            ]"
            class="bg-white/30 dark:bg-gray-800/30 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 rounded-l shadow-lg hover:bg-white dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
          >
          <ChevronLeftIcon class="h-5 w-5 text-gray-500 dark:text-gray-400 group-hover:text-primary-light transition-colors duration-200" />
          </button>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
        <div class="p-8 w-[360px] rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] border border-gray-100/20 dark:border-gray-700/20">
          <div class="space-y-4">
            <input
              type="password"
              placeholder="请输入密码"
              class="w-full p-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light dark:text-text-dark focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
              @keyup.enter="handleLogin"
              @input="handlePasswordInput"
              v-model="loginPassword"
            />
            <div v-if="loginError" class="text-red-500 text-sm">{{ loginError }}</div>
            <button
              @click="handleLogin"
              class="w-full p-3 bg-primary-light dark:bg-primary-dark text-white rounded relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary-light/20 dark:hover:shadow-primary-dark/20 active:scale-[0.98] hover:before:opacity-100 before:opacity-0 before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent before:transition-opacity before:duration-300"
            >
              登录
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>

  <!-- 配置弹窗 -->
  <ConfigDialog
    v-model="showConfigDialog"
    :config="localConfig"
    @update:config="handleConfigUpdate"
  />

  <!-- 热门电影弹窗 -->
  <HotMoviesDialog
    v-model="showHotMoviesDialog"
    :enable-hot-movies="config?.enableHotMovies ?? false"
    :hot-movies-proxy-url="config?.hotMoviesProxyUrl ?? ''"
    :hot-tv-default-tag="config?.hotTvDefaultTag ?? ''"
    :hot-movie-default-tag="config?.hotMovieDefaultTag ?? ''"
    @search="handleHotMoviesSearch"
  />
</template>

<style>
/* 确保视频播放器容器保持合适的宽高比 */
.video-container {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 16:9 宽高比 */
}

.video-container > * {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

/* 禁止在拖动时选中文本 */
.main-container {
  user-select: none;
}

/* 确保分隔线区域有足够的可点击区域 */
.main-container > div {
  min-width: 0;
}

/* 滚动条整体样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

/* 滚动条轨道 */
::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 4px;
}

/* 滚动条滑块 */
::-webkit-scrollbar-thumb {
  background-color: #94a3b8;
  border-radius: 4px;
  transition: all 0.2s ease;
}

/* 鼠标悬停时的滑块样式 */
::-webkit-scrollbar-thumb:hover {
  background-color: #64748b;
}

/* 适配深色模式 */
.dark ::-webkit-scrollbar-thumb {
  background-color: #475569;
}

.dark ::-webkit-scrollbar-thumb:hover {
  background-color: #64748b;
}

/* 美化标签页横向滚动条 */
nav.w-full::-webkit-scrollbar {
  height: 0;
  display: none;
}

/* 标签页导航的滚动条 */
nav[aria-label="Tabs"]::-webkit-scrollbar {
  height: 4px;
  transition: height 0.2s ease;
}

nav[aria-label="Tabs"]:hover::-webkit-scrollbar {
  height: 8px;
}

nav[aria-label="Tabs"]::-webkit-scrollbar-thumb {
  background-color: #94a3b8;
  border-radius: 4px;
  transition: all 0.2s ease;
}

nav[aria-label="Tabs"]::-webkit-scrollbar-thumb:hover {
  background-color: #64748b;
}

/* 适配深色模式 */
.dark nav[aria-label="Tabs"]::-webkit-scrollbar-thumb {
  background-color: #475569;
}

.dark nav[aria-label="Tabs"]::-webkit-scrollbar-thumb:hover {
  background-color: #64748b;
}

nav[aria-label="Tabs"]::-webkit-scrollbar-track {
  background: transparent;
}

/* 隐藏搜索结果容器的横向滚动条 */
.search-results-container {
  scrollbar-width: none;
  -ms-overflow-style: none;
  max-height: calc(100vh - 220px); /* 限制最大高度 */
  overflow-y: auto; /* 启用垂直滚动 */
}

.search-results-container::-webkit-scrollbar {
  display: none;
}

/* 在移动设备上使用不同的最大高度 */
@media (max-width: 1023px) {
  .search-results-container {
    max-height: calc(50vh - 130px); /* 移动设备上右侧面板高度是50%，所以调整最大高度 */
  }
}

/* 添加悬浮按钮的动画样式 */
@keyframes slideIn {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

@keyframes slideOut {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(100%);
  }
}

/* 移除之前的过渡效果 */
.main-container > div {
  will-change: transform, width, opacity;
}

/* 添加新的过渡效果 */
.w-full {
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.flex {
  transition: flex 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}


/* chevron-toggle-btn 的高度过渡动画 */
.chevron-toggle-btn {
  transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.chevron-toggle-btn:hover, .chevron-toggle-btn:focus {
  height: 10rem !important;
}
</style>
