<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { XMarkIcon, ArrowPathIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{
  modelValue: boolean
  enableHotMovies: boolean
  hotMoviesProxyUrl: string
  hotTvDefaultTag: string
  hotMovieDefaultTag: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'search', keyword: string): void
}>()

const isLoading = ref(true)
const error = ref('')

// 豆瓣数据状态
const doubanType = ref('tv') // 'movie' 或 'tv'
const currentTag = ref('热门')
// 为电视剧和电影分别保存各自的标签
const currentTvTag = ref('热门')
const currentMovieTag = ref('热门')
const defaultTvTag = ref('热门')
const defaultMovieTag = ref('热门')
const pageStart = ref(0)
// 添加电视剧和电影的页码变量
const tvPageStart = ref(0)
const moviePageStart = ref(0)
const pageSize = 16
// 添加分页按钮文本控制变量
const thePrevPageText = ref('上一页')
const theNextPageText = ref('下一页')
// 添加缓存状态
const currentTvResults = ref<any[]>([])
const currentMovieResults = ref<any[]>([])
const hasTagFetch = ref(false)

// 添加所有标签的缓存数据
const allTvTagStartResults = ref<Record<string, any[]>>({})
const allMovieTagStartResults = ref<Record<string, any[]>>({})

// 标签列表
const movieTags = ref(['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '动画'])
const tvTags = ref(['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'])

const showDialog = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// 关闭弹窗
const handleClose = () => {
  showDialog.value = false
}

// 获取豆瓣标签数据
const fetchDoubanTags = async () => {
  // 如果已经获取过标签，则不再重复请求
  if (hasTagFetch.value) return
  
  try {
    const movieTagsUrl = `https://movie.douban.com/j/search_tags?type=movie`
    const tvTagsUrl = `https://movie.douban.com/j/search_tags?type=tv`
    
    // 获取电影标签
    const movieData = await fetchDoubanData(movieTagsUrl)
    if (movieData && movieData.tags) {
      const theMovieTags = movieData.tags.filter((tag: string) => tag !== defaultMovieTag.value)
      theMovieTags.unshift(defaultMovieTag.value)
      movieTags.value = theMovieTags
    }
    
    // 获取电视剧标签
    const tvData = await fetchDoubanData(tvTagsUrl)
    if (tvData && tvData.tags) {
      const theTvTags = tvData.tags.filter((tag: string) => tag !== defaultTvTag.value)
      theTvTags.unshift(defaultTvTag.value)
      tvTags.value = theTvTags
    }
    
    // 标记已获取标签
    hasTagFetch.value = true
  } catch (error) {
    console.error('获取豆瓣标签失败:', error)
  }
}

// 获取豆瓣热门数据
const fetchHotItems = async () => {
  // 检查标签缓存
  if (pageStart.value === 0) {
    if (doubanType.value === 'tv' && allTvTagStartResults.value[currentTvTag.value]?.length > 0) {
      currentTvResults.value = allTvTagStartResults.value[currentTvTag.value]
      isLoading.value = false
      return
    }
    
    if (doubanType.value === 'movie' && allMovieTagStartResults.value[currentMovieTag.value]?.length > 0) {
      currentMovieResults.value = allMovieTagStartResults.value[currentMovieTag.value]
      isLoading.value = false
      return
    }
  }
  
  isLoading.value = true
  error.value = ''
  
  try {
    let theFetchTag = currentMovieTag.value
    if (doubanType.value === 'tv') {
      theFetchTag = currentTvTag.value
    }

    const url = `https://movie.douban.com/j/search_subjects?type=${doubanType.value}&tag=${theFetchTag}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart.value}`
    const data = await fetchDoubanData(url)
    
    if (data && data.subjects && data.subjects.length > 0) {
      // 保存到当前类型的结果变量
      if (doubanType.value === 'tv') {
        currentTvResults.value = data.subjects
      } else if (doubanType.value === 'movie') {
        currentMovieResults.value = data.subjects
      }
      
      // 缓存结果（更新为缓存所有标签的第一页数据）
      if (pageStart.value === 0) {
        // 保存到标签缓存
        if (doubanType.value === 'tv') {
          allTvTagStartResults.value[currentTvTag.value] = data.subjects
        } else if (doubanType.value === 'movie') {
          allMovieTagStartResults.value[currentMovieTag.value] = data.subjects
        }
      }
    } else {
      if (doubanType.value === 'tv') {
        currentTvResults.value = []
      } else {
        currentMovieResults.value = []
      }
    }
  } catch (e) {
    console.error('获取豆瓣热门数据失败:', e)
    error.value = '获取豆瓣热门数据失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

// 通用获取豆瓣数据的方法 - 直接请求，不使用代理
const fetchDoubanData = async (url: string) => {
  // 添加超时控制
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000) // 10秒超时
    
  // 设置请求选项
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Referer': 'https://movie.douban.com/',
      'Accept': 'application/json, text/plain, */*',
    }
  }

  try {
    // 检查是否有自定义代理
    const customProxyUrl = props.hotMoviesProxyUrl || ''
    
    // 使用自定义代理或直接请求
    let requestUrl = url
    if (customProxyUrl) {
      if (customProxyUrl.endsWith('=')) {
        // 如果以=号结尾，直接拼接
        requestUrl = `${customProxyUrl}${encodeURIComponent(url)}`
      } else if (customProxyUrl.endsWith('/')) {
        // 如果以/号结尾，直接拼接
        requestUrl = `${customProxyUrl}${encodeURIComponent(url)}`
      } else {
        // 如果既不以=号结尾也不以/号结尾，补全/号再拼接
        requestUrl = `${customProxyUrl}/${encodeURIComponent(url)}`
      }
    }
    
    const response = await fetch(requestUrl, fetchOptions)
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`)
    }
    
    return await response.json()
  } catch (err) {
    console.error("豆瓣 API 请求失败:", err)
    
    // 备用方法
    try {
      const fallbackUrl = `https://r.jina.ai/${encodeURIComponent(url)}`
      const fallbackResponse = await fetch(fallbackUrl, {
        headers: {
          'x-respond-with': 'text'
        }
      })
      
      if (!fallbackResponse.ok) {
        throw new Error(`备用API请求失败! 状态: ${fallbackResponse.status}`)
      }
      
      const data = await fallbackResponse.text()
      
      if (data) {
        return JSON.parse(data)
      } else {
        throw new Error("无法获取有效数据")
      }
    } catch (fallbackErr) {
      console.error("豆瓣 API 备用请求也失败:", fallbackErr)
      throw fallbackErr
    }
  }
}

// 切换电影/电视剧
const switchType = (type: string) => {
  if (doubanType.value !== type) {
    doubanType.value = type
    
    // 保持当前标签，但切换数据类型
    const currentSelectedTag = type === 'tv' ? currentTvTag.value : currentMovieTag.value
    currentTag.value = currentSelectedTag
    
    // 根据切换的类型，更新pageStart
    if (type === 'tv') {
      pageStart.value = tvPageStart.value
    } else {
      pageStart.value = moviePageStart.value
    }
    
    // 直接使用currentTvResults和currentMovieResults作为上次访问的数据
    if (type === 'tv' && currentTvResults.value.length > 0) {
      isLoading.value = false
    } else if (type === 'movie' && currentMovieResults.value.length > 0) {
      isLoading.value = false
    } else {
      // 没有缓存，请求新数据
      fetchHotItems()
    }
  }
}

// 切换标签
const switchTag = (tag: string) => {
  if (currentTag.value !== tag) {
    currentTag.value = tag
    
    // 更新对应类型的标签记忆
    if (doubanType.value === 'tv') {
      currentTvTag.value = tag
      // 重置电视剧页码
      pageStart.value = 0
      tvPageStart.value = 0
    } else if (doubanType.value === 'movie') {
      currentMovieTag.value = tag
      // 重置电影页码
      pageStart.value = 0
      moviePageStart.value = 0
    }
    
    // 检查当前标签是否有缓存
    if (doubanType.value === 'tv' && allTvTagStartResults.value[tag]?.length > 0) {
      currentTvResults.value = allTvTagStartResults.value[tag]
      isLoading.value = false
      return
    }
    
    if (doubanType.value === 'movie' && allMovieTagStartResults.value[tag]?.length > 0) {
      currentMovieResults.value = allMovieTagStartResults.value[tag]
      isLoading.value = false
      return
    }
    
    // 非热门标签或无缓存，请求新数据
    fetchHotItems()
  }
}

// 下一批
const getNextItems = async () => {
  pageStart.value += pageSize
  if (pageStart.value > 9 * pageSize) {
    pageStart.value = 0
  }
  
  // 同时更新对应类型的页码变量
  if (doubanType.value === 'tv') {
    tvPageStart.value = pageStart.value
  } else {
    moviePageStart.value = pageStart.value
  }
  
  // 刷新总是请求新数据
  isLoading.value = true
  error.value = ''
  
  try {
    const url = `https://movie.douban.com/j/search_subjects?type=${doubanType.value}&tag=${currentTag.value}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart.value}`
    const data = await fetchDoubanData(url)
    
    if (data && data.subjects && data.subjects.length > 0) {
      // 保存到对应类型的结果缓存
      if (doubanType.value === 'tv') {
        currentTvResults.value = data.subjects
      } else if (doubanType.value === 'movie') {
        currentMovieResults.value = data.subjects
      }
      
      // 同时保存到标签缓存
      if (pageStart.value === 0) {
        if (doubanType.value === 'tv') {
          allTvTagStartResults.value[currentTag.value] = data.subjects
        } else if (doubanType.value === 'movie') {
          allMovieTagStartResults.value[currentTag.value] = data.subjects
        }
      }
    } else {
      if (doubanType.value === 'tv') {
        currentTvResults.value = []
      } else {
        currentMovieResults.value = []
      }
    }
  } catch (e) {
    console.error('获取豆瓣热门数据失败:', e)
    error.value = '获取豆瓣热门数据失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

// 上一批
const getPrevItems = async () => {
  if (pageStart.value >= pageSize) {
    pageStart.value -= pageSize
 
    if (pageStart.value < 0) {
      pageStart.value = 0
    }
    
    // 同时更新对应类型的页码变量
    if (doubanType.value === 'tv') {
      tvPageStart.value = pageStart.value
    } else {
      moviePageStart.value = pageStart.value
    }
    
    // 请求新数据
    isLoading.value = true
    error.value = ''
    
    try {
      const url = `https://movie.douban.com/j/search_subjects?type=${doubanType.value}&tag=${currentTag.value}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart.value}`
      const data = await fetchDoubanData(url)
      
      if (data && data.subjects && data.subjects.length > 0) {
        // 保存到对应类型的结果缓存
        if (doubanType.value === 'tv') {
          currentTvResults.value = data.subjects
        } else if (doubanType.value === 'movie') {
          currentMovieResults.value = data.subjects
        }
      } else {
        if (doubanType.value === 'tv') {
          currentTvResults.value = []
        } else {
          currentMovieResults.value = []
        }
      }
    } catch (e) {
      console.error('获取豆瓣热门数据失败:', e)
      error.value = '获取豆瓣热门数据失败，请稍后重试'
    } finally {
      isLoading.value = false
    }
  }
}

// 点击卡片，触发搜索
const handleSearch = (title: string) => {
  if (!title) return
  
  // 先关闭对话框，再发送搜索事件给父组件
  showDialog.value = false
  
  // 使用nextTick确保DOM更新后再触发搜索事件
  nextTick(() => {
    emit('search', title)
  })
}

// 生成标签类名
const getTagClass = (tag: string) => {
  return tag === currentTag.value
    ? 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 bg-primary-light dark:bg-primary-dark text-white shadow-md'
    : 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 hover:!text-white'
}

// 监听enableHotMovies属性变化
watch(() => props.enableHotMovies, (newVal) => {
  // 只有当props.enableHotMovies为true时才执行
  if (newVal === true) {
    // 无论弹窗是否显示，都预先请求标签和热门数据
    fetchDoubanTags()

    defaultTvTag.value = props.hotTvDefaultTag || '热门'
    defaultMovieTag.value = props.hotMovieDefaultTag  || '热门'
    currentTvTag.value = props.hotTvDefaultTag  || '热门'
    currentMovieTag.value = props.hotMovieDefaultTag  || '热门'
    
    // 预请求电视剧数据
    const fetchDefaultTvData = async () => {
      if (currentTvResults.value.length === 0) {
        const url = `https://movie.douban.com/j/search_subjects?type=tv&tag=${defaultTvTag.value}&sort=recommend&page_limit=${pageSize}&page_start=0`
        try {
          const data = await fetchDoubanData(url)
          if (data && data.subjects && data.subjects.length > 0) {
            currentTvResults.value = data.subjects
            allTvTagStartResults.value[defaultTvTag.value] = data.subjects
          }
        } catch (error) {
          console.error('预请求电视剧数据失败:', error)
        }
      }
    }
    
    // 预请求电影数据
    const fetchDefaultMovieData = async () => {
      if (currentMovieResults.value.length === 0) {
        const url = `https://movie.douban.com/j/search_subjects?type=movie&tag=${defaultMovieTag.value}&sort=recommend&page_limit=${pageSize}&page_start=0`
        try {
          const data = await fetchDoubanData(url)
          if (data && data.subjects && data.subjects.length > 0) {
            currentMovieResults.value = data.subjects
            allMovieTagStartResults.value[defaultMovieTag.value] = data.subjects
          }
        } catch (error) {
          console.error('预请求电影数据失败:', error)
        }
      }
    }
    
    // 执行预请求
    fetchDefaultTvData()
    fetchDefaultMovieData()
  }
  
  // 初始化当前类型的标签（不管enableHotMovies值如何都执行）
  if (doubanType.value === 'tv') {
    currentTag.value = currentTvTag.value
  } else {
    currentTag.value = currentMovieTag.value
  }
}, { immediate: true })

// 监听弹窗打开事件
watch(() => showDialog.value, (newVal: boolean) => {
  if (newVal) {
    // 检测是否为移动设备，设置对应的分页按钮文本
    const isMobile = !!navigator.userAgent.match(/AppleWebKit.*Mobile.*/)
    if (isMobile) {
      thePrevPageText.value = '上页'
      theNextPageText.value = '下页'
    } else {
      thePrevPageText.value = '上一页'
      theNextPageText.value = '下一页'
    }

    if (props.hotTvDefaultTag) {
      defaultTvTag.value = props.hotTvDefaultTag
      currentTvTag.value = props.hotTvDefaultTag
      const theTvTags = tvTags.value.filter((tag: string) => tag !== props.hotTvDefaultTag)
      theTvTags.unshift(props.hotTvDefaultTag)
      tvTags.value = theTvTags
    }

    if (props.hotMovieDefaultTag) {
      defaultMovieTag.value = props.hotMovieDefaultTag
      currentMovieTag.value = props.hotMovieDefaultTag
      const theMovieTags = movieTags.value.filter((tag: string) => tag !== props.hotMovieDefaultTag)
      theMovieTags.unshift(props.hotMovieDefaultTag)
      movieTags.value = theMovieTags
    }
    
    // 弹窗打开时，如果没有缓存数据，只有在启用豆瓣热门功能时才请求新数据
    if (props.enableHotMovies === true && !hasTagFetch.value) {
      fetchDoubanTags()
    }
    
    if (doubanType.value === 'tv') {
      // 加载电视剧数据
      if (currentTvResults.value.length === 0 && props.enableHotMovies === true) {
        fetchHotItems()
      } else {
        isLoading.value = false
      }
    } else {
      // 加载电影数据
      if (currentMovieResults.value.length === 0 && props.enableHotMovies === true) {
        fetchHotItems()
      } else {
        isLoading.value = false
      }
    }
  }
}, { immediate: true })
</script>

<template>
  <div v-if="showDialog" class="fixed inset-0 z-50 overflow-y-auto">
    <div class="flex min-h-screen items-center justify-center p-4">
      <!-- 背景遮罩 -->
      <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="handleClose"></div>
      
      <!-- 弹窗内容 -->
      <div class="relative w-full max-w-7xl h-[90vh] flex flex-col rounded-lg bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
        <!-- 头部 -->
        <div class="flex flex-col p-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xl font-bold text-text-light dark:text-text-dark">豆瓣</h2>
            <button
              @click="handleClose"
              class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="关闭"
            >
              <XMarkIcon class="w-6 h-6 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          
          <!-- 电影/电视剧切换和换一批按钮 -->
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center space-x-4">
              <!-- 合并成单个开关 -->
              <div class="flex items-center bg-gray-100 dark:bg-gray-700 p-1 rounded-full">
                <button 
                  class="px-3 py-1 rounded-full text-sm font-medium transition-all duration-300"
                  :class="doubanType === 'tv' 
                    ? 'bg-primary-light dark:bg-primary-dark text-white shadow-md' 
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'"
                  @click="switchType('tv')"
                >
                  电视剧
                </button>
                <button 
                  class="px-3 py-1 rounded-full text-sm font-medium transition-all duration-300"
                  :class="doubanType === 'movie' 
                    ? 'bg-primary-light dark:bg-primary-dark text-white shadow-md' 
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'"
                  @click="switchType('movie')"
                >
                  电影
                </button>
              </div>
            </div>
            
            <div class="flex items-center space-x-2">
              <button 
                v-if="pageStart > 0"
                @click="getPrevItems"
                class="flex items-center space-x-1 px-3 py-1.5 rounded text-sm bg-primary-light/10 dark:bg-primary-dark/10 text-primary-light dark:text-primary-dark hover:bg-primary-light/20 dark:hover:bg-primary-dark/20 transition-colors"
              >
                <ArrowPathIcon class="w-4 h-4" />
                <span>{{ thePrevPageText }}</span>
              </button>
              
              <button 
                @click="getNextItems"
                class="flex items-center space-x-1 px-3 py-1.5 rounded text-sm bg-primary-light/10 dark:bg-primary-dark/10 text-primary-light dark:text-primary-dark hover:bg-primary-light/20 dark:hover:bg-primary-dark/20 transition-colors"
              >
                <ArrowPathIcon class="w-4 h-4" />
                <span>{{ theNextPageText }}</span>
              </button>
            </div>
          </div>
          
          <!-- 标签列表 -->
          <div class="flex flex-wrap gap-2">
            <button 
              v-for="tag in doubanType === 'movie' ? movieTags : tvTags" 
              :key="tag"
              :class="getTagClass(tag)"
              @click="switchTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
        </div>
        
        <!-- 内容区域 - 固定高度 -->
        <div class="flex-1 overflow-hidden relative">
          <!-- 加载遮罩层 - 只在加载时显示 -->
          <div v-if="isLoading" class="absolute inset-0 bg-white/70 dark:bg-gray-800/70 flex items-center justify-center z-50">
            <div class="text-center space-y-3">
              <div class="w-12 h-12 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p class="text-primary-light dark:text-primary-dark">加载中...</p>
            </div>
          </div>
          
          <!-- 滚动内容区域 -->
          <div class="h-full overflow-y-auto p-6">
            <!-- 错误状态 -->
            <div v-if="error" class="absolute inset-0 bg-white dark:bg-gray-800 p-6 text-center z-10">
              <div class="text-red-500 dark:text-red-400">{{ error }}</div>
              <button
                @click="fetchHotItems"
                class="mt-4 px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded-lg hover:opacity-90 transition-colors"
              >
                重新加载
              </button>
            </div>
            
            <!-- 没有数据时显示 -->
            <div v-if="!isLoading && !error && ((doubanType === 'tv' && currentTvResults.length === 0) || (doubanType === 'movie' && currentMovieResults.length === 0))" class="h-full flex items-center justify-center">
              <div class="text-center p-6">
                <div class="text-primary-light dark:text-primary-dark">暂无数据，请尝试其他分类或刷新</div>
                <button
                  @click="getPrevItems"
                  class="mt-4 px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded-lg hover:opacity-90 transition-colors"
                >
                  换一批
                </button>
              </div>
            </div>
            
            <!-- 电影/电视剧列表 -->
            <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-8 gap-3">
              <div 
                v-for="item in doubanType === 'tv' ? currentTvResults : currentMovieResults" 
                :key="item.id"
                class="bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 transform hover:scale-105 border border-gray-200 dark:border-gray-700 flex flex-col cursor-pointer group"
                @click="handleSearch(item.title)"
              >
                <!-- 封面 -->
                <div class="relative pt-[140%] overflow-hidden">
                  <img 
                    :src="item.cover" 
                    :alt="item.title"
                    class="absolute inset-0 w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                    @error="(e: Event) => { const target = e.target as HTMLImageElement; if (target) target.src = item.cover.replace('https://', 'http://'); }"
                    loading="lazy" 
                    referrerpolicy="no-referrer"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-60"></div>
                  
                  <!-- 影片链接和评分 -->
                  <div class="absolute bottom-0 left-0 right-0 flex justify-between items-center p-2">
                    <div class="flex items-center bg-black/70 text-white text-xs px-2 py-1 rounded-sm">
                      <span class="text-yellow-400 mr-1">★</span>
                      <span>{{ item.rate || '暂无' }}</span>
                    </div>
                    <div class="bg-black/70 text-white text-xs px-2 py-1 rounded-sm hover:bg-gray-800 transition-colors">
                      <a :href="item.url" target="_blank" rel="noopener noreferrer" title="在豆瓣查看" class="text-white">
                        🔗
                      </a>
                    </div>
                  </div>
                </div>
                
                <!-- 标题 -->
                <div class="p-2 text-center">
                  <div 
                    class="text-sm font-medium text-text-light dark:text-text-dark truncate w-full group-hover:!text-primary-light dark:group-hover:!text-primary-dark transition-colors duration-300"
                    :title="item.title"
                  >
                    {{ item.title }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style> 
