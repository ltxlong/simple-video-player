<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import { useWindowSize } from '@vueuse/core'
import VideoPlayer from '../components/VideoPlayer.vue'
import { getHomeConfig } from '../api/config'
import type { Config } from '../types'
import SearchResults from '../components/SearchResults.vue'
import { BookmarkIcon, MagnifyingGlassIcon, ArrowPathIcon, PlayIcon } from '@heroicons/vue/24/outline'
import router from '@/router'

// 默认配置
const defaultConfig: Config = {
  resourceSites: [],
  parseApi: '',
  backgroundImage: '',
  enableLogin: false,
  loginPassword: '',
  announcement: '',
  customTitle: '',
  enableHealthFilter: true
}

const route = useRoute()
const { toggleTheme, isDark } = useTheme()
const { width } = useWindowSize()

const videoUrl = ref('')
const searchKeyword = ref('')
const videoPlayer = ref<InstanceType<typeof VideoPlayer> | null>(null)
const refreshTrigger = ref(0)  // 添加一个触发刷新的计数器
const isAuthenticated = ref(false)
const isLoading = ref(true)  // 添加loading状态
const loginPassword = ref('')
const loginError = ref('')
const config = ref<Config | null>(null)
const searchResults = ref<InstanceType<typeof SearchResults> | null>(null)

// 修改宽度控制相关的变量
const isDragging = ref(false)
const rightPanelRatio = ref(0.25) // 默认比例 25%
const MIN_RATIO = 0.25 // 最小比例 25%
const MAX_RATIO = 0.75 // 最大比例 75%

// 计算标题
const pageTitle = computed(() => {
  if (!config.value?.customTitle) {
    return null // 返回null表示使用默认图标
  }
  const title = String(config.value.customTitle).trim()
  if (title === '') {
    return null // 返回null表示使用默认图标
  }
  return title
})

// 检查登录状态并加载配置
const loadConfig = async () => {
  try {
    const configData = await getHomeConfig()
    config.value = configData
    
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
  } catch (error) {
    console.error('加载配置失败:', error)
    config.value = { ...defaultConfig, enableLogin: true }
    isAuthenticated.value = false
  }
}

onMounted(async () => {
  try {
    await loadConfig()
  } finally {
    isLoading.value = false
  }

  // 添加触摸事件监听器
  document.addEventListener('mousemove', handleDrag)
  document.addEventListener('mouseup', handleDragEnd)
  document.addEventListener('touchmove', handleDrag, { passive: false })
  document.addEventListener('touchend', handleDragEnd)

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
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', handleDragEnd)
  document.removeEventListener('touchmove', handleDrag)
  document.removeEventListener('touchend', handleDragEnd)
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
  if (width.value < 1024) return
  
  isDragging.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

const handleDragEnd = () => {
  if (width.value < 1024) return
  
  isDragging.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

const handleDrag = (e: MouseEvent | TouchEvent) => {
  if (!isDragging.value || width.value < 1024) return
  
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
const handleVideoUrlUpdate = (url: string) => {
  videoUrl.value = url
}

// 添加处理显示标签列表的方法
const handleShowTags = () => {
  if (searchResults.value) {
    searchResults.value.showTagsListDialog()
  }
}

const handleEnterPlay = () => {
  if (videoUrl.value.trim()) {
    setTimeout(() => {
      videoPlayer.value?.player.value?.play()
    }, 0)
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
          <p class="text-text-light dark:text-text-dark">加载中...</p>
        </div>
      </div>
    </template>
    
    <template v-else-if="isAuthenticated">
      <!-- 导航栏 -->
      <nav class="w-full px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <!-- 顶部栏 -->
        <div class="flex items-center">
          <h1 class="text-xl font-bold text-text-light dark:text-text-dark whitespace-nowrap flex items-center">
            <template v-if="pageTitle">{{ pageTitle }}</template>
            <template v-else>
              <PlayIcon class="w-6 h-6" />
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
      <div class="flex-1 flex flex-col lg:flex-row main-container relative">
        <!-- 左侧视频播放区 -->
        <div 
          :style="[
            width >= 1024 
              ? { width: `${(1 - rightPanelRatio) * 100}%` }
              : { height: '50%' }
          ]"
          class="lg:h-auto relative"
        >
          <!-- 内容区域 -->
          <div class="relative z-10 p-4 space-y-4">
            <!-- 视频链接输入区 -->
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                v-model="videoUrl"
                @keyup.enter="handleEnterPlay"
                type="text"
                placeholder="请输入视频链接"
                class="flex-1 p-2 rounded border-[0.5px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
              />
              <button
                @click="handlePlay"
                class="px-4 py-2 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium active:scale-95 flex items-center justify-center"
              >
                <ArrowPathIcon class="w-5 h-5" />
              </button>
            </div>

            <!-- 视频播放器区域 -->
            <div class="relative aspect-video">
              <!-- 背景图片容器 -->
              <div 
                v-if="config?.backgroundImage"
                class="absolute inset-0 w-full h-full"
                :style="{
                  backgroundImage: `url(${config.backgroundImage})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat'
                }"
              ></div>

              <!-- 视频播放器 -->
              <VideoPlayer
                v-if="videoUrl"
                :url="videoUrl"
                :parse-api="config?.parseApi || ''"
                :refresh-trigger="refreshTrigger"
                ref="videoPlayer"
                class="relative z-10 w-full h-full"
              />
            </div>
          </div>
        </div>

        <!-- 分隔线 -->
        <div
          class="hidden lg:block lg:w-1 lg:h-auto lg:-mx-[2px] bg-gray-200 dark:bg-gray-700 hover:bg-primary-light dark:hover:bg-primary-dark relative z-10 cursor-col-resize"
          @mousedown="handleDragStart"
          @touchstart="handleDragStart"
        >
          <!-- 拖动把手 -->
          <div class="absolute lg:inset-y-0 lg:-left-1 lg:-right-1"></div>
        </div>

        <!-- 右侧搜索区 -->
        <div
          :style="[
            width >= 1024 
              ? { width: `${rightPanelRatio * 100}%` }
              : { height: '50%' }
          ]"
          class="lg:h-auto p-4 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-y-auto"
        >
          <div class="space-y-4">
            <!-- 搜索输入框 -->
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                v-model="searchKeyword"
                type="text"
                placeholder="请输入关键词"
                @keyup.enter="handleSearch"
                class="flex-1 p-2 rounded border-[0.5px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light dark:text-text-dark focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
              />
              <div class="flex gap-2 justify-between w-full sm:w-auto">
                <button
                  @click="handleSearch"
                  class="px-4 py-2 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium active:scale-95 flex items-center justify-center"
                >
                  <MagnifyingGlassIcon class="w-5 h-5" />
                </button>
                <button
                  @click="handleShowTags"
                  class="px-4 py-2 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium active:scale-95 flex items-center justify-center"
                >
                  <BookmarkIcon class="w-5 h-5" />
                </button>
              </div>
            </div>

            <!-- 搜索结果列表 -->
            <SearchResults
              v-if="config?.resourceSites?.length"
              :sites="config.resourceSites"
              :keyword="searchKeyword"
              :enable-health-filter="config.enableHealthFilter"
              ref="searchResults"
              @updateVideoUrl="handleVideoUrlUpdate"
            />
          </div>
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
  max-height: calc(100vh - 200px); /* 限制最大高度 */
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
</style>