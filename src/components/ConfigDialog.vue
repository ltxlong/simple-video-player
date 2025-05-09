<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import type { Config } from '../types'
import { XMarkIcon, ExclamationCircleIcon, TrashIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, Cog6ToothIcon } from '@heroicons/vue/24/outline'
import Swal from 'sweetalert2'
import { useRouter } from 'vue-router'

const props = defineProps<{
  modelValue: boolean
  config: Config
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'update:config', value: { localConfig: Config, activeStatus: Record<string, boolean>, isMasterSwitch: boolean }): void
}>()

const router = useRouter()

const localConfig = ref<Config>({ ...props.config })
const tempConfig = ref<Config>({ ...props.config })
// 添加总开关状态
const masterSwitch = ref(false)
// 添加激活状态对象
const activeStatus = ref({
  resourceSites: false,
  parseApi: false,
  backgroundImage: false,
  announcement: false,
  customTitle: false,
  proxyVideoUrl: false,
  proxyLiveUrl: false,
  autoPlayNext: false,
  enableHotMovies: false
})

// 添加监听props.modelValue变化的watch
watch(() => props.modelValue, (newVal) => {
  // 当弹窗打开时重新加载配置
  if (newVal) {
    loadConfigFromStorage()
  }
})

// 从localStorage加载配置
const loadConfigFromStorage = () => {
  const storedConfig = localStorage.getItem('frontendConfig')
  if (storedConfig) {
    try {
      const parsedConfig = JSON.parse(storedConfig)
      localConfig.value = { ...props.config, ...parsedConfig }
      tempConfig.value = { ...localConfig.value }
      
      // 加载激活状态
      const storedActiveStatus = localStorage.getItem('frontendConfigActiveStatus')
      if (storedActiveStatus) {
        activeStatus.value = { ...activeStatus.value, ...JSON.parse(storedActiveStatus) }
      } else {
        // 初始化激活状态
        initActiveStatus()
      }
      
      // 加载总开关状态
      const storedMasterSwitch = localStorage.getItem('frontendConfigMasterSwitch')
      if (storedMasterSwitch !== null) {
        masterSwitch.value = JSON.parse(storedMasterSwitch)
      }
    } catch (error) {
      console.error('解析存储的配置失败:', error)
    }
  } else {
    // 初始化激活状态
    initActiveStatus()
  }
}

// 初始化激活状态
const initActiveStatus = () => {
  activeStatus.value = {
    resourceSites: !!localConfig.value.resourceSites?.length,
    parseApi: !!localConfig.value.parseApi,
    backgroundImage: !!localConfig.value.backgroundImage,
    announcement: !!localConfig.value.announcement,
    customTitle: !!localConfig.value.customTitle,
    proxyVideoUrl: !!localConfig.value.proxyVideoUrl,
    proxyLiveUrl: !!localConfig.value.proxyLiveUrl,
    autoPlayNext: !!localConfig.value.autoPlayNext,
    enableHotMovies: !!localConfig.value.enableHotMovies
  }
}

// 保存配置到localStorage
const saveConfigToStorage = (config: Config) => {
  try {
    // 确保enableHotMovies和autoPlayNext的值与activeStatus中的值一致
    config.enableHotMovies = activeStatus.value.enableHotMovies
    config.autoPlayNext = activeStatus.value.autoPlayNext
    localStorage.setItem('frontendConfig', JSON.stringify(config))
    localStorage.setItem('frontendConfigActiveStatus', JSON.stringify(activeStatus.value))
    localStorage.setItem('frontendConfigMasterSwitch', JSON.stringify(masterSwitch.value))
  } catch (error) {
    console.error('保存配置到localStorage失败:', error)
  }
}

onMounted(() => {
  loadConfigFromStorage()
})

// 计算属性用于控制弹窗显示
const showDialog = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// 处理配置更新
const handleConfigUpdate = () => {
  tempConfig.value = { ...localConfig.value }
}

// 处理资源站点操作
const handleAddSite = () => {
  if (!localConfig.value.resourceSites) {
    localConfig.value.resourceSites = []
  }
  localConfig.value.resourceSites.push({
    url: '',
    searchResultClass: '',
    remark: '',
    active: true,
    isPost: false,
    postData: '',
    adFilter: {
      status: true,
      item: 'default_del_ad_tag_to_filter',
      regularExpression: ''
    }
  })
  handleConfigUpdate()
}

const handleRemoveSite = (index: number) => {
  if (localConfig.value.resourceSites) {
    localConfig.value.resourceSites.splice(index, 1)
    handleConfigUpdate()
  }
}

const handleUpdateSite = (index: number, field: string, value: string | boolean) => {
  if (localConfig.value.resourceSites) {
    localConfig.value.resourceSites[index] = {
      ...localConfig.value.resourceSites[index],
      [field]: value
    }
    handleConfigUpdate()
  }
}

// 处理总开关状态变化
const handleMasterSwitchToggle = () => {
  masterSwitch.value = !masterSwitch.value
}

// 修改开关状态变化处理
const handleToggle = (key: keyof Config) => {
  if (key === 'enableLogin' || key === 'enableHealthFilter' || key === 'enableHotMovies' || key === 'autoPlayNext') {
    // 对于这些直接在Config中的布尔属性，直接更新localConfig和activeStatus
    localConfig.value[key] = !localConfig.value[key]
    if (key === 'enableHotMovies') {
      activeStatus.value.enableHotMovies = !activeStatus.value.enableHotMovies
    } else if (key === 'autoPlayNext') {
      activeStatus.value.autoPlayNext = !activeStatus.value.autoPlayNext
    }
  } else if (key === 'resourceSites') {
    activeStatus.value.resourceSites = !activeStatus.value.resourceSites
  } else if (key in activeStatus.value) {
    // @ts-ignore: 动态属性访问
    activeStatus.value[key] = !activeStatus.value[key]
  }
  handleConfigUpdate()
}

// 添加参数模板函数
const applyPostDataTemplate = (index: number) => {
  if (localConfig.value.resourceSites && localConfig.value.resourceSites[index]) {
    const templateData = {
      '搜索参数key': '{search_value}',
      '其他参数key': '其他参数value'
    }
    localConfig.value.resourceSites[index].postData = JSON.stringify(templateData, null, 4)
    handleConfigUpdate()
  }
}

// 处理站点开关状态变化
const handleSiteToggle = (index: number, field: string, value: boolean) => {
  if (localConfig.value.resourceSites) {
    localConfig.value.resourceSites[index] = {
      ...localConfig.value.resourceSites[index],
      [field]: value
    }
    handleConfigUpdate()
  }
}

// 处理站点广告过滤选项更新
const handleAdFilterUpdate = (index: number, field: string, value: any) => {
  if (localConfig.value.resourceSites) {
    if (!localConfig.value.resourceSites[index].adFilter) {
      localConfig.value.resourceSites[index].adFilter = {
        status: true,
        item: 'default_del_ad_tag_to_filter',
        regularExpression: ''
      }
    }
    
    localConfig.value.resourceSites[index].adFilter = {
      ...localConfig.value.resourceSites[index].adFilter,
      [field]: value
    }
    
    handleConfigUpdate()
  }
}

// 添加验证资源站点配置的函数
const validateResourceSites = () => {
  if (!localConfig.value.resourceSites || !Array.isArray(localConfig.value.resourceSites)) {
    return { valid: true } // 没有资源站点配置，不需要验证
  }

  for (let i = 0; i < localConfig.value.resourceSites.length; i++) {
    const site = localConfig.value.resourceSites[i]
    // 只验证激活状态的站点
    if (site.active) {
      // 检查URL是否为空
      if (!site.url || site.url.trim() === '') {
        return {
          valid: false,
          message: `站点 #${i+1} URL不能为空`,
          index: i
        }
      }
      
      // 检查广告过滤的正则表达式是否为空
      if (site.adFilter && site.adFilter.status && 
      (site.adFilter.item === 'ad_name_regular_to_del_filter' || site.adFilter.item === 'ad_all_regular_to_del_filter') && (
      !site.adFilter.regularExpression || 
      site.adFilter.regularExpression.trim() === '')) {
        return {
          valid: false,
          message: `站点 #${i+1} 广告过滤的正则表达式不能为空`,
          index: i
        }
      } else if (site.adFilter && site.adFilter.status && 
      (site.adFilter.item === 'ad_name_regular_to_del_filter' || site.adFilter.item === 'ad_all_regular_to_del_filter') && 
      site.adFilter.regularExpression) {
        try {
          new RegExp(site.adFilter.regularExpression)
        } catch (error) {
          return {
            valid: false,
            message: `站点 #${i+1} 广告过滤的正则表达式格式不正确`,
            index: i
          }
        }
      }

      // 检查remark是否为空
      if (!site.remark || site.remark.trim() === '') {
        return {
          valid: false,
          message: `站点 #${i+1} 备注不能为空`,
          index: i
        }
      }
      
      // 检查POST参数格式
      if (site.isPost && site.postData) {
        try {
          JSON.parse(site.postData)
        } catch (e) {
          return {
            valid: false,
            message: `站点 #${i+1} POST参数格式无效，必须是有效的JSON`,
            index: i
          }
        }
      }
    }
  }
  
  return { valid: true }
}

// 处理错误状态
const errorMessage = ref('')

// 处理确定
const handleConfirm = () => {
  // 如果总开关关闭，则使用默认配置
  if (!masterSwitch.value) {
    emit('update:config', { localConfig: props.config, activeStatus: activeStatus.value, isMasterSwitch: false })
    saveConfigToStorage(localConfig.value)
    showDialog.value = false
    return
  }
  
  // 如果资源站点配置开关打开，验证资源站点配置
  if (activeStatus.value.resourceSites) {
    const validationResult = validateResourceSites()
    if (!validationResult.valid) {
      errorMessage.value = validationResult.message || '资源站点配置无效'
      // 滚动到对应的站点配置位置
      if (validationResult.index !== undefined) {
        nextTick(() => {
          const siteElement = document.querySelector(`.resource-site-item-${validationResult.index}`)
          if (siteElement) {
            siteElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        })
      }
      return
    }
  }
  
  // 清除错误信息
  errorMessage.value = ''
  
  // 创建一个基于默认配置的新配置对象
  const finalConfig = { ...props.config } as any;
  
  // 针对每个配置项检查：总开关开启 + 对应配置开关开启 + 配置值不为空
  
  // 资源站点配置
  if (activeStatus.value.resourceSites && localConfig.value.resourceSites?.length) {
    finalConfig.resourceSites = localConfig.value.resourceSites.filter(site => site.active && typeof site.url === 'string' && site.url.trim() !== '');
  }
  
  // 解析API配置
  if (activeStatus.value.parseApi && typeof localConfig.value.parseApi === 'string' && localConfig.value.parseApi.trim() !== '') {
    finalConfig.parseApi = localConfig.value.parseApi;
  }
  
  // 视频代理URL配置
  if (activeStatus.value.proxyVideoUrl && typeof localConfig.value.proxyVideoUrl === 'string') {
    finalConfig.proxyVideoUrl = localConfig.value.proxyVideoUrl;
  }
  
  // 直播代理URL配置
  if (activeStatus.value.proxyLiveUrl && typeof localConfig.value.proxyLiveUrl === 'string') {
    finalConfig.proxyLiveUrl = localConfig.value.proxyLiveUrl;
  }
  
  // 背景图片配置
  if (activeStatus.value.backgroundImage && typeof localConfig.value.backgroundImage === 'string') {
    finalConfig.backgroundImage = localConfig.value.backgroundImage;
  }
  
  // 公告配置
  if (activeStatus.value.announcement && typeof localConfig.value.announcement === 'string') {
    finalConfig.announcement = localConfig.value.announcement;
  }
  
  // 首页名称配置
  if (activeStatus.value.customTitle && typeof localConfig.value.customTitle === 'string') {
    finalConfig.customTitle = localConfig.value.customTitle;
  }
  
  // 豆瓣热门配置
  finalConfig.enableHotMovies = activeStatus.value.enableHotMovies;
  if (localConfig.value.hotMoviesProxyUrl && typeof localConfig.value.hotMoviesProxyUrl === 'string') {
    finalConfig.hotMoviesProxyUrl = localConfig.value.hotMoviesProxyUrl;
  }
  if (localConfig.value.hotTvDefaultTag && typeof localConfig.value.hotTvDefaultTag === 'string') {
    finalConfig.hotTvDefaultTag = localConfig.value.hotTvDefaultTag;
  }
  if (localConfig.value.hotMovieDefaultTag && typeof localConfig.value.hotMovieDefaultTag === 'string') {
    finalConfig.hotMovieDefaultTag = localConfig.value.hotMovieDefaultTag;
  }
  
  emit('update:config', { localConfig: finalConfig, activeStatus: activeStatus.value, isMasterSwitch: true })
  saveConfigToStorage(localConfig.value)
  showDialog.value = false
}

// 导出资源站点配置
const exportSiteConfig = () => {
  try {
    // 检查是否有数据
    if (!localConfig.value.resourceSites || localConfig.value.resourceSites.length === 0) {
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'info',
        title: '没有资源站点数据可导出',
        showConfirmButton: false,
        timer: 2000
      })
      return
    }
    
    // 直接导出资源站点数组
    const jsonStr = JSON.stringify(localConfig.value.resourceSites, null, 2)
    
    // 创建Blob对象
    const blob = new Blob([jsonStr], { type: 'application/json' })
    
    // 创建下载链接
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'video_harvest_site_config.json'
    
    // 触发下载
    document.body.appendChild(a)
    a.click()
    
    // 清理
    URL.revokeObjectURL(url)
    document.body.removeChild(a)
    
    // 导出成功提示
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: '导出成功',
      showConfirmButton: false,
      timer: 2000
    })
  } catch (error) {
    console.error('导出配置失败:', error)
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'error',
      title: '导出配置失败',
      showConfirmButton: false,
      timer: 2000
    })
  }
}

// 导入资源站点配置
const importSiteConfig = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input?.files?.[0]
  
  if (!file) return
  
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string
      const importedConfig = JSON.parse(content)
      
      // 验证导入的数据是否有效
      if (Array.isArray(importedConfig)) {
        // 确保 resourceSites 已初始化
        if (!Array.isArray(localConfig.value.resourceSites)) {
          localConfig.value.resourceSites = []
        }
        
        // 对导入的站点进行去重处理
        let addedCount = 0
        const existingUrls = new Set(localConfig.value.resourceSites.map(site => site.url))
        
        importedConfig.forEach(site => {
          // 如果该站点URL不在现有配置中，则添加它
          if (site.url && !existingUrls.has(site.url)) {
            localConfig.value.resourceSites.push(site)
            existingUrls.add(site.url)
            addedCount++
          }
        })
        
        handleConfigUpdate()
        
        // 根据导入结果显示不同提示
        if (addedCount > 0) {
          Swal.fire({
            toast: true,
            position: 'top',
            icon: 'success',
            title: `导入成功，新增${addedCount}个站点`,
            showConfirmButton: false,
            timer: 2000
          })
        } else {
          Swal.fire({
            toast: true,
            position: 'top',
            icon: 'info',
            title: '所有站点已存在，未添加新站点',
            showConfirmButton: false,
            timer: 2000
          })
        }
      } else {
        throw new Error('无效的配置文件')
      }
    } catch (error) {
      console.error('导入配置失败:', error)
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'error',
        title: '导入配置失败，请检查文件格式',
        showConfirmButton: false,
        timer: 2000
      })
    }
  }
  
  reader.readAsText(file)
  
  // 重置input，允许再次选择同一文件
  input.value = ''
}

// 触发文件选择对话框
const triggerFileInput = () => {
  const fileInput = document.getElementById('site-config-file-input') as HTMLInputElement
  fileInput?.click()
}

// 处理取消
const handleCancel = () => {
  localConfig.value = { ...props.config }
  // 重新初始化激活状态
  initActiveStatus()
  // 清除错误信息
  errorMessage.value = ''
  showDialog.value = false
}
</script>

<template>
  <div v-if="showDialog" class="fixed inset-0 z-50 overflow-y-auto">
    <div class="flex min-h-screen items-center justify-center p-4">
      <div class="fixed inset-0 bg-black/30" @click="handleCancel"></div>
      
      <div class="relative w-full max-w-2xl min-h-[70vh] max-h-[80vh] flex flex-col rounded-lg bg-white dark:bg-gray-800 shadow-xl">
        <!-- 头部 -->
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center space-x-2 flex-1 min-w-0">
            <div class="flex items-center flex-shrink-0">
              <button 
                @click="handleMasterSwitchToggle"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors mr-2"
                :class="masterSwitch ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="masterSwitch ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
            <div class="flex items-center">
              <h3 class="text-lg font-medium text-text-light dark:text-text-dark">前端配置</h3>
              <div class="relative group ml-1">
                <ExclamationCircleIcon class="h-5 w-5 text-amber-500 cursor-pointer" />
                <div class="absolute left-0 top-5 whitespace-nowrap bg-gray-800 text-white text-sm py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
                  前端配置保存在浏览器本地
                </div>
              </div>
              <span class="ml-1 text-sm text-gray-500 dark:text-gray-400">覆盖后端的</span>
              <button 
                @click="() => router.push('/admin')"
                class="p-1 ml-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                title="进入管理后台"
              >
                <Cog6ToothIcon class="h-4 w-4" />
              </button>
            </div>
          </div>
          <button @click="handleCancel" class="text-gray-400 hover:text-gray-500 flex-shrink-0 ml-2">
            <XMarkIcon class="h-6 w-6" />
          </button>
        </div>

        <!-- 内容 -->
        <div class="flex-1 overflow-y-auto p-4 space-y-6">
          <!-- 剧集自动连播 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <label class="text-sm font-medium text-text-light dark:text-text-dark">剧集自动连播</label>
                <div class="relative group ml-1">
                  <ExclamationCircleIcon class="h-5 w-5 text-amber-500 cursor-pointer" />
                  <div class="absolute left-0 top-5 whitespace-normal w-[calc(50vw-4rem)] max-w-md bg-gray-800 text-white text-sm py-2 px-3 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
                    启用剧集自动连播功能，可以自动播放下一集
                  </div>
                </div>
              </div>
              <button 
                @click="handleToggle('autoPlayNext')"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="activeStatus.autoPlayNext ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="activeStatus.autoPlayNext ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
          </div>

          <!-- 豆瓣热门配置 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <label class="text-sm font-medium text-text-light dark:text-text-dark">豆瓣热门</label>
                <div class="relative group ml-1">
                  <ExclamationCircleIcon class="h-5 w-5 text-amber-500 cursor-pointer" />
                  <div class="absolute left-0 top-5 whitespace-normal w-[calc(50vw-4rem)] max-w-md bg-gray-800 text-white text-sm py-2 px-3 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
                    启用豆瓣热门功能，可以快速浏览热门电影和电视剧，会在刷新按钮右侧显示热门按钮
                  </div>
                </div>
              </div>
              <button 
                @click="handleToggle('enableHotMovies')"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="activeStatus.enableHotMovies ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="activeStatus.enableHotMovies ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
            <input
              v-if="activeStatus.enableHotMovies"
              v-model="localConfig.hotMoviesProxyUrl"
              @input="handleConfigUpdate"
              placeholder="（可选）自定义代理URL请求豆瓣接口"
              class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            />
            <input
              v-if="activeStatus.enableHotMovies"
              v-model="localConfig.hotTvDefaultTag"
              @input="handleConfigUpdate"
              placeholder="（可选）设置电视剧默认标签：国产剧"
              class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            />
            <input
              v-if="activeStatus.enableHotMovies"
              v-model="localConfig.hotMovieDefaultTag"
              @input="handleConfigUpdate"
              placeholder="（可选）设置电影默认标签：科幻"
              class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            />
          </div>

          <!-- 资源站点配置 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <label class="text-sm font-medium text-text-light dark:text-text-dark">资源站点配置</label>
                <div class="relative group ml-1">
                  <ExclamationCircleIcon class="h-5 w-5 text-amber-500 cursor-pointer" />
                  <div class="absolute left-0 top-5 whitespace-normal w-[calc(50vw-4rem)] max-w-md bg-gray-800 text-white text-sm py-2 px-3 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
                    为空即默认使用后端配置
                  </div>
                </div>
                <button
                  @click="exportSiteConfig"
                  class="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                  title="导出资源站点配置"
                >
                  <ArrowDownTrayIcon class="h-4 w-4" />
                </button>
                <button
                  @click="triggerFileInput"
                  class="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                  title="导入资源站点配置（.json后缀）"
                >
                  <ArrowUpTrayIcon class="h-4 w-4" />
                </button>
                <input
                  id="site-config-file-input"
                  type="file"
                  accept=".json"
                  @change="importSiteConfig"
                  class="hidden"
                />
              </div>
              <button 
                @click="handleToggle('resourceSites')"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="activeStatus.resourceSites ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="activeStatus.resourceSites ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
            <div v-if="activeStatus.resourceSites" class="space-y-4">
              <div 
                v-for="(site, index) in localConfig.resourceSites" 
                :key="index" 
                :class="['space-y-2 p-4 border rounded-lg border-gray-200 dark:border-gray-700', `resource-site-item-${index}`]"
              >
                <div class="flex items-center justify-between">
                  <label class="text-sm text-gray-500 dark:text-gray-400">支持IPTV URL 和 JSON API<br>以上不能配置搜索结果列表类名</label>
                  <button
                    @click="handleRemoveSite(index)"
                    class="p-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors"
                    title="删除站点"
                  >
                    <TrashIcon class="h-5 w-5" />
                  </button>
                </div>
                <div class="grid grid-cols-1 gap-2">
                  <div class="flex items-center justify-between">
                    <label class="text-sm text-text-light dark:text-text-dark">站点 #{{ index + 1 }} 启用 -></label>
                    <button 
                      @click="handleSiteToggle(index, 'active', !site.active)"
                      class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                      :class="site.active ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
                    >
                      <span
                        class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                        :class="site.active ? 'translate-x-6' : 'translate-x-1'"
                      ></span>
                    </button>
                  </div>
                  <input
                    v-model="site.url"
                    @input="(e: Event) => handleUpdateSite(index, 'url', (e.target as HTMLInputElement).value)"
                    placeholder="输入资源站点搜索URL（如：https://test.com/search?keyword=）"
                    class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                  />
                  <div class="flex items-center justify-between">
                    <label class="text-sm text-text-light dark:text-text-dark">POST请求</label>
                    <a 
                      href="javascript:void(0)" 
                      class="ml-4 text-sm text-primary-light dark:text-primary-dark hover:underline"
                      @click="applyPostDataTemplate(index)"
                    >
                      参数模板
                    </a>
                    <button 
                      @click="handleSiteToggle(index, 'isPost', !site.isPost)"
                      class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                      :class="site.isPost ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
                    >
                      <span
                        class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                        :class="site.isPost ? 'translate-x-6' : 'translate-x-1'"
                      ></span>
                    </button>
                  </div>
                  <textarea
                    v-if="site.isPost"
                    v-model="site.postData"
                    @input="(e: Event) => handleUpdateSite(index, 'postData', (e.target as HTMLTextAreaElement).value)"
                    placeholder="POST请求参数（JSON格式）"
                    class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark min-h-[50px] max-h-[100px] resize-y"
                  ></textarea>
                  <input
                    v-model="site.searchResultClass"
                    @input="(e: Event) => handleUpdateSite(index, 'searchResultClass', (e.target as HTMLInputElement).value)"
                    placeholder="输入搜索结果列表类名"
                    class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                  />
                  <!-- 广告过滤配置 -->
                  <div class="mt-2 space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <div class="flex items-center justify-between">
                      <label class="text-sm text-text-light dark:text-text-dark">广告过滤</label>
                      <button 
                        @click="handleAdFilterUpdate(index, 'status', !(site.adFilter?.status ?? true))"
                        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                        :class="(site.adFilter?.status ?? true) ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
                      >
                        <span
                          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                          :class="(site.adFilter?.status ?? true) ? 'translate-x-6' : 'translate-x-1'"
                        ></span>
                      </button>
                    </div>
                    <select
                      :value="site.adFilter?.item || 'default_del_ad_tag_to_filter'"
                      @change="(e: Event) => handleAdFilterUpdate(index, 'item', (e.target as HTMLSelectElement).value)"
                      class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                    >
                      <option value="default_del_ad_tag_to_filter">默认通用广告过滤（base）</option>
                      <option value="ad_tag_to_del_filter">根据标识删除过滤</option>
                      <option value="ad_name_len_to_del_filter">根据名称长度删除过滤</option>
                      <option value="ad_name_regular_to_del_filter">自定义正则匹配删除过滤（分片）</option>
                      <option value="ad_all_regular_to_del_filter">自定义正则匹配删除过滤（全局）</option>
                    </select>
                    <!-- 正则表达式输入框，仅在选择 ad_name_regular_to_del_filter 或 ad_all_regular_to_del_filter 时显示 -->
                    <input
                      v-if="site.adFilter && (site.adFilter.item === 'ad_name_regular_to_del_filter' || site.adFilter.item === 'ad_all_regular_to_del_filter')"
                      v-model="site.adFilter.regularExpression"
                      @input="(e: Event) => handleAdFilterUpdate(index, 'regularExpression', (e.target as HTMLInputElement).value)"
                      placeholder="输入正则表达式"
                      class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                    />
                  </div>
                  <input
                    v-model="site.remark"
                    @input="(e: Event) => handleUpdateSite(index, 'remark', (e.target as HTMLInputElement).value)"
                    placeholder="输入备注"
                    class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                  />
                </div>
              </div>
              <button
                @click="handleAddSite"
                class="w-full p-2 text-primary-light dark:text-primary-dark hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                + 添加站点
              </button>
            </div>
          </div>

          <!-- 解析API配置 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <label class="text-sm font-medium text-text-light dark:text-text-dark">解析API配置</label>
                <div class="relative group ml-1">
                  <ExclamationCircleIcon class="h-5 w-5 text-amber-500 cursor-pointer" />
                  <div class="absolute left-0 top-5 whitespace-normal w-[calc(50vw-4rem)] max-w-md bg-gray-800 text-white text-sm py-2 px-3 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
                    解析是前端直接请求完成，不会对服务器产生额外的流量，不会解析资源站点的视频，只解析页面的
                  </div>
                </div>
              </div>
              <button 
                @click="handleToggle('parseApi')"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="activeStatus.parseApi ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="activeStatus.parseApi ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
            <input
              v-if="activeStatus.parseApi"
              v-model="localConfig.parseApi"
              @input="handleConfigUpdate"
              placeholder="解析API地址，为空即不使用解析"
              class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            />
          </div>

          <!-- 视频代理URL配置 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <label class="text-sm font-medium text-text-light dark:text-text-dark">视频代理URL配置</label>
                <div class="relative group ml-1">
                  <ExclamationCircleIcon class="h-5 w-5 text-amber-500 cursor-pointer" />
                  <div class="absolute left-0 top-5 whitespace-normal w-[calc(50vw-4rem)] max-w-md bg-gray-800 text-white text-sm py-2 px-3 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
                    视频代理是前端代理请求，URL会暴露在请求信息，但相对于后端代理请求而言，不会对服务器产生额外的流量<br><br>
                    如果不配置该代理URL，直接前端完成请求；只有在请求重试都失败后，才尝试服务器后端代理 /api/proxy<br><br>
                    只要配置了代理URL，无论是 视频 还是 直播 代理，那么在请求重试都失败后，也不会尝试服务器代理请求
                  </div>
                </div>
              </div>
              <button 
                @click="handleToggle('proxyVideoUrl')"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="activeStatus.proxyVideoUrl ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="activeStatus.proxyVideoUrl ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
            <input
              v-if="activeStatus.proxyVideoUrl"
              v-model="localConfig.proxyVideoUrl"
              @input="handleConfigUpdate"
              placeholder="视频代理URL地址，为空即不使用代理"
              class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            />
          </div>

          <!-- 直播代理URL配置 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <label class="text-sm font-medium text-text-light dark:text-text-dark">直播代理URL配置</label>
                <div class="relative group ml-1">
                  <ExclamationCircleIcon class="h-5 w-5 text-amber-500 cursor-pointer" />
                  <div class="absolute left-0 top-5 whitespace-normal w-[calc(50vw-4rem)] max-w-md bg-gray-800 text-white text-sm py-2 px-3 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
                    直播代理是前端代理请求，URL会暴露在请求信息，但相对于后端代理请求而言，不会对服务器产生额外的流量<br><br>
                    如果不配置该代理URL，那么http链接默认走的是服务器后端代理流量 /api/proxy，代理是为了能够正常请求<br><br>
                    只要配置了代理URL，无论是 视频 还是 直播 代理，那么在请求重试都失败后，也不会尝试服务器代理请求
                  </div>
                </div>
              </div>
              <button 
                @click="handleToggle('proxyLiveUrl')"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="activeStatus.proxyLiveUrl ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="activeStatus.proxyLiveUrl ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
            <input
              v-if="activeStatus.proxyLiveUrl"
              v-model="localConfig.proxyLiveUrl"
              @input="handleConfigUpdate"
              placeholder="直播代理URL地址，为空即不使用代理"
              class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            />
          </div>

          <!-- 背景图片配置 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-text-light dark:text-text-dark">背景图片配置</label>
              <button 
                @click="handleToggle('backgroundImage')"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="activeStatus.backgroundImage ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="activeStatus.backgroundImage ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
            <input
              v-if="activeStatus.backgroundImage"
              v-model="localConfig.backgroundImage"
              @input="handleConfigUpdate"
              placeholder="背景图片地址，为空即不显示背景"
              class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            />
          </div>

          <!-- 公告配置 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-text-light dark:text-text-dark">公告配置</label>
              <button 
                @click="handleToggle('announcement')"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="activeStatus.announcement ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="activeStatus.announcement ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
            <input
              v-if="activeStatus.announcement"
              v-model="localConfig.announcement"
              @input="handleConfigUpdate"
              placeholder="公告内容，为空即不显示公告"
              class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            />
          </div>

          <!-- 首页名称配置 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-text-light dark:text-text-dark">首页名称配置</label>
              <button 
                @click="handleToggle('customTitle')"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                :class="activeStatus.customTitle ? 'bg-primary-light dark:bg-primary-dark' : 'bg-gray-200 dark:bg-gray-700'"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="activeStatus.customTitle ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
            <input
              v-if="activeStatus.customTitle"
              v-model="localConfig.customTitle"
              @input="handleConfigUpdate"
              placeholder="首页名称或图片链接，为空即默认图标"
              class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            />
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="flex flex-col p-4 border-t border-gray-200 dark:border-gray-700">
          <!-- 错误信息显示 -->
          <div v-if="errorMessage" class="mb-3 p-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-sm text-center">
            {{ errorMessage }}
          </div>
          
          <div class="flex justify-between">
            <button
              @click="handleCancel"
              class="px-4 py-2 text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
            >
              取消
            </button>
            <button
              @click="handleConfirm"
              class="px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:bg-opacity-90"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template> 
