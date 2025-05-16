<script setup lang="ts">
import { ref, onMounted} from 'vue'
import { useTheme } from '../composables/useTheme'
import Swal from 'sweetalert2'
import type { Config } from '../types'
import { useRouter } from 'vue-router'
import { getAdminConfig, decodeBase64 } from '../api/config'

const router = useRouter()
const { toggleTheme, isDark } = useTheme()

const config = ref<Config>({
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
})

const isDialogOpen = ref(false)
const isLoading = ref(true)
const showPassword = ref(false)
const isAuthenticated = ref(false)
const adminPassword = ref('')
const loginError = ref('')

// 用于显示和编辑的明文密码
const plainPassword = ref('')

// 加载配置
const loadConfig = async () => {
  try {
    const configData = await getAdminConfig()
    config.value = configData
    
    // 如果没有健康过滤设置，默认为开启
    if (config.value.enableHealthFilter === undefined) {
      config.value.enableHealthFilter = true
    }
    
    // 如果有密码，解密后存储到 plainPassword
    if (config.value.loginPassword) {
      try {
        plainPassword.value = decodeBase64(config.value.loginPassword)
      } catch {
        plainPassword.value = config.value.loginPassword
      }
    } else {
      plainPassword.value = ''
    }
  } catch (error) {
    console.error('加载配置失败:', error)
    // 如果是401或403错误，清除登录状态
    if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
      sessionStorage.removeItem('adminToken')
      isAuthenticated.value = false
    }
  }
}

// 检查登录状态
const checkAuthStatus = () => {
  const token = sessionStorage.getItem('adminToken')
  if (token) {
    isAuthenticated.value = true
    return true
  }
  return false
}

// 检查管理员密码
const handleAdminLogin = async () => {
  const password = adminPassword.value?.trim() || ''
  if (!password) {
    loginError.value = '请输入密码'
    return
  }

  try {
    // 验证密码
    const response = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ 
        password: password,
        isAdmin: true
      })
    })

    const data = await response.json()
    
    if (!response.ok) {
      loginError.value = data.error || '登录失败'
      return
    }
    
    // 保存 token 到 sessionStorage
    if (data.token) {
      sessionStorage.setItem('adminToken', data.token)
      isAuthenticated.value = true
      loginError.value = ''
      
      // 登录成功后加载配置
      await loadConfig()
    } else {
      throw new Error('服务器未返回token')
    }
  } catch (error) {
    console.error('登录失败:', error)
    loginError.value = '登录失败，请重试'
  }
}

const handlePasswordInput = () => {
  loginError.value = ''
}

// 初始化加载配置
onMounted(async () => {
  try {
    // 先检查登录状态
    if (checkAuthStatus()) {
      isAuthenticated.value = true
      // 已登录才加载配置
      await loadConfig()
    }
  } finally {
    isLoading.value = false
  }
})

interface ResourceSite {
  url: string
  searchResultClass?: string
  remark: string
  active: boolean
  isPost?: boolean
  postData?: string
  adFilter?: {
    status: boolean
    item: string
    regularExpression?: string
  }
}

const deleteResourceSite = async (index: number) => {
  isDialogOpen.value = true
  const site = config.value.resourceSites[index]
  const siteInfo = site.remark ? ` "${site.remark}" ` : ''
  
  const result = await Swal.fire({
    title: '确认删除',
    html: `确定要删除这个${siteInfo}资源站点吗？<br><br>此操作无法撤销。`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: '确认删除',
    cancelButtonText: '取消',
    confirmButtonColor: '#EF4444',
    cancelButtonColor: '#6B7280',
    background: isDark.value ? '#1F2937' : '#FFFFFF',
    color: isDark.value ? '#FFFFFF' : '#000000',
    customClass: {
      title: 'text-xl font-medium',
      popup: 'swal2-popup',
      htmlContainer: '!mb-20',
      actions: '!block',
      confirmButton: '!absolute !right-6 !bottom-6 !shadow-none !ring-0',
      cancelButton: '!absolute !left-6 !bottom-6 !shadow-none'
    },
    buttonsStyling: true,
    showClass: {
      backdrop: 'swal2-noanimation',
      popup: 'swal2-noanimation'
    },
    hideClass: {
      popup: ''
    }
  })

  isDialogOpen.value = false

  if (result.isConfirmed) {
    config.value.resourceSites.splice(index, 1)
    await Swal.fire({
      title: '删除成功',
      icon: 'success',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
      background: isDark.value ? '#1F2937' : '#FFFFFF',
      color: isDark.value ? '#FFFFFF' : '#000000',
      customClass: {
        timerProgressBar: '!bg-primary-light/50 dark:!bg-primary-dark/50'
      },
      didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
      }
    })
  }
}

const addResourceSite = async () => {
  isDialogOpen.value = true
  const result = await Swal.fire({
    title: '添加资源站点',
    titleText: '添加资源站点',
    customClass: {
      title: 'text-xl font-medium',
      popup: 'swal2-popup',
      htmlContainer: '!mb-20',
      validationMessage: '!absolute !bottom-20 !left-6 !right-6 !m-0 !p-0 text-red-500 text-sm',
      actions: '!block',
      confirmButton: '!absolute !right-6 !bottom-6 !shadow-none !ring-0',
      cancelButton: '!absolute !left-6 !bottom-6 !shadow-none'
    },
    html: `
      <input
        id="siteUrl"
        class="w-full p-2 mb-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
        placeholder="输入资源站点搜索URL（如：https://test.com/search?keyword=）"
      />
      <div class="flex items-center mb-3">
        <label class="flex items-center cursor-pointer">
          <input
            type="checkbox"
            id="isPost"
            class="sr-only peer"
          />
          <div class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-light dark:peer-checked:bg-primary-dark"></div>
          <span class="ms-3 text-sm font-medium text-gray-900 dark:text-gray-300">使用POST请求</span>
        </label>
        <a 
          href="javascript:void(0)" 
          class="ml-4 text-sm text-primary-light dark:text-primary-dark hover:underline"
          onclick="document.getElementById('postData').value = JSON.stringify({'搜索参数key':'{search_value}','其他参数key':'其他参数value'}, null, 4)"
        >
          参数模板
        </a>
      </div>
      <div id="postDataContainer" class="hidden mb-3">
        <textarea
          id="postData"
          class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm max-h-[150px] min-h-[50px] overflow-y-auto"
          placeholder="输入POST请求参数（JSON格式）"
          rows="4"
        ></textarea>
      </div>
      <input
        id="siteSearchResultClass"
        class="w-full p-2 mb-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
        placeholder="输入搜索结果列表类名（IPTV、api时为空）"
      />
      <div class="mb-3">
        <div class="flex items-center mb-2">
          <label class="flex items-center cursor-pointer">
            <input
              type="checkbox"
              id="adFilterStatus"
              class="sr-only peer"
              checked
            />
            <div class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-light dark:peer-checked:bg-primary-dark"></div>
            <span class="ms-3 text-sm font-medium text-gray-900 dark:text-gray-300">启用广告过滤</span>
          </label>
        </div>
        <select 
          id="adFilterItem" 
          class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
        >
          <option value="default_del_ad_tag_to_filter">默认通用广告过滤（base）</option>
          <option value="ad_tag_to_del_filter">根据标识删除过滤</option>
          <option value="ad_name_len_to_del_filter">根据名称长度删除过滤</option>
          <option value="ad_name_regular_to_del_filter">自定义正则匹配删除过滤（分片）</option>
          <option value="ad_all_regular_to_del_filter">自定义正则匹配删除过滤（全局）</option>
        </select>
        <div id="regularExpressionContainer" class="mt-2 hidden">
          <input
            id="regularExpression"
            class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
            placeholder="输入正则表达式"
          />
        </div>
      </div>
      <input
        id="siteRemark"
        class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
        placeholder="输入备注"
      />
    `,
    showCancelButton: true,
    confirmButtonText: '添加',
    cancelButtonText: '取消',
    confirmButtonColor: '#3B82F6',
    cancelButtonColor: '#6B7280',
    background: isDark.value ? '#1F2937' : '#FFFFFF',
    color: isDark.value ? '#FFFFFF' : '#000000',
    buttonsStyling: true,
    showClass: {
      backdrop: 'swal2-noanimation',
      popup: 'swal2-noanimation'
    },
    hideClass: {
      popup: ''
    },
    didOpen: () => {
      const isPostCheckbox = document.getElementById('isPost') as HTMLInputElement
      const postDataContainer = document.getElementById('postDataContainer')
      
      isPostCheckbox.addEventListener('change', () => {
        if (postDataContainer) {
          postDataContainer.classList.toggle('hidden', !isPostCheckbox.checked)
        }
      })
      
      // 添加广告过滤相关的事件监听
      const adFilterItem = document.getElementById('adFilterItem') as HTMLSelectElement
      const regularExpressionContainer = document.getElementById('regularExpressionContainer')
      
      adFilterItem.addEventListener('change', () => {
        if (regularExpressionContainer) {
          regularExpressionContainer.classList.toggle('hidden', adFilterItem.value !== 'ad_name_regular_to_del_filter' && adFilterItem.value !== 'ad_all_regular_to_del_filter')
        }
      })
    },
    preConfirm: () => {
      const url = (document.getElementById('siteUrl') as HTMLInputElement).value.trim()
      const searchResultClass = (document.getElementById('siteSearchResultClass') as HTMLInputElement).value.trim()
      const remark = (document.getElementById('siteRemark') as HTMLInputElement).value.trim()
      const isPost = (document.getElementById('isPost') as HTMLInputElement).checked
      const postData = (document.getElementById('postData') as HTMLTextAreaElement).value.trim()
      
      // 获取广告过滤相关的值
      const adFilterStatus = (document.getElementById('adFilterStatus') as HTMLInputElement).checked
      const adFilterItem = (document.getElementById('adFilterItem') as HTMLSelectElement).value
      const regularExpression = (document.getElementById('regularExpression') as HTMLInputElement).value.trim()

      if (!url) {
        Swal.showValidationMessage('请输入资源站点搜索URL')
        return false
      }

      if (!remark) {
        Swal.showValidationMessage('请输入备注')
        return false
      }

      if (isPost && postData) {
        try {
          JSON.parse(postData)
        } catch (e) {
          Swal.showValidationMessage('POST请求参数必须是有效的JSON格式')
          return false
        }
      }
      
      if ((adFilterItem === 'ad_name_regular_to_del_filter' || adFilterItem === 'ad_all_regular_to_del_filter') && !regularExpression) {
        Swal.showValidationMessage('请输入正则表达式')
        return false
      } else if ((adFilterItem === 'ad_name_regular_to_del_filter' || adFilterItem === 'ad_all_regular_to_del_filter') && regularExpression) {
        try {
          new RegExp(regularExpression)
        } catch(error) {
          Swal.showValidationMessage('请输入正确的正则表达式')
          return false
        }
      }

      return { 
        url, 
        searchResultClass, 
        remark, 
        isPost, 
        postData: isPost ? postData : undefined,
        adFilterStatus,
        adFilterItem,
        regularExpression: (adFilterItem === 'ad_name_regular_to_del_filter' || adFilterItem === 'ad_all_regular_to_del_filter') ? regularExpression : undefined
      }
    }
  })

  isDialogOpen.value = false

  if (result.isConfirmed && result.value) {
    config.value.resourceSites.push({
      url: result.value.url,
      searchResultClass: result.value.searchResultClass,
      remark: result.value.remark,
      active: true,
      isPost: result.value.isPost,
      postData: result.value.postData,
      adFilter: {
        status: result.value.adFilterStatus,
        item: result.value.adFilterItem,
        regularExpression: result.value.regularExpression
      }
    })
    await Swal.fire({
      title: '添加成功',
      icon: 'success',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
      background: isDark.value ? '#1F2937' : '#FFFFFF',
      color: isDark.value ? '#FFFFFF' : '#000000',
      customClass: {
        timerProgressBar: '!bg-primary-light/50 dark:!bg-primary-dark/50'
      },
      didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
      }
    })
  }
}

const editResourceSite = async (index: number) => {
  isDialogOpen.value = true
  const site = config.value.resourceSites[index]
  
  // 设置广告过滤的默认值
  const adFilter = site.adFilter || { status: true, item: 'default_del_ad_tag_to_filter' }
  
  const result = await Swal.fire({
    title: '编辑资源站点',
    titleText: '编辑资源站点',
    customClass: {
      title: 'text-xl font-medium',
      popup: 'swal2-popup',
      htmlContainer: '!mb-20',
      validationMessage: '!absolute !bottom-20 !left-6 !right-6 !m-0 !p-0 text-red-500 text-sm',
      actions: '!block',
      confirmButton: '!absolute !right-6 !bottom-6 !shadow-none !ring-0',
      cancelButton: '!absolute !left-6 !bottom-6 !shadow-none'
    },
    html: `
      <input
        id="siteUrl"
        class="w-full p-2 mb-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
        placeholder="输入资源站点搜索URL（如：https://test.com/search?keyword=）"
        value="${site.url}"
      />
      <div class="flex items-center mb-3">
        <label class="flex items-center cursor-pointer">
          <input
            type="checkbox"
            id="isPost"
            class="sr-only peer"
            ${site.isPost ? 'checked' : ''}
          />
          <div class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-light dark:peer-checked:bg-primary-dark"></div>
          <span class="ms-3 text-sm font-medium text-gray-900 dark:text-gray-300">使用POST请求</span>
        </label>
        <a 
          href="javascript:void(0)" 
          class="ml-4 text-sm text-primary-light dark:text-primary-dark hover:underline"
          onclick="document.getElementById('postData').value = JSON.stringify({'搜索参数key':'{search_value}','其他参数key':'其他参数value'}, null, 4)"
        >
          参数模板
        </a>
      </div>
      <div id="postDataContainer" class="${site.isPost ? '' : 'hidden'} mb-3">
        <textarea
          id="postData"
          class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm max-h-[150px] min-h-[50px] overflow-y-auto"
          placeholder="输入POST请求参数（JSON格式）"
          rows="4"
        >${site.postData || ''}</textarea>
      </div>
      <input
        id="siteSearchResultClass"
        class="w-full p-2 mb-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
        placeholder="输入搜索结果列表类名（IPTV、api时为空）"
        value="${site.searchResultClass || ''}"
      />
      <div class="mb-3">
        <div class="flex items-center mb-2">
          <label class="flex items-center cursor-pointer">
            <input
              type="checkbox"
              id="adFilterStatus"
              class="sr-only peer"
              ${adFilter.status ? 'checked' : ''}
            />
            <div class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-light dark:peer-checked:bg-primary-dark"></div>
            <span class="ms-3 text-sm font-medium text-gray-900 dark:text-gray-300">启用广告过滤</span>
          </label>
        </div>
        <select 
          id="adFilterItem" 
          class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
        >
          <option value="default_del_ad_tag_to_filter" ${adFilter.item === 'default_del_ad_tag_to_filter' ? 'selected' : ''}>默认通用广告过滤（base）</option>
          <option value="ad_tag_to_del_filter" ${adFilter.item === 'ad_tag_to_del_filter' ? 'selected' : ''}>根据标识删除过滤</option>
          <option value="ad_name_len_to_del_filter" ${adFilter.item === 'ad_name_len_to_del_filter' ? 'selected' : ''}>根据名称长度删除过滤</option>
          <option value="ad_name_regular_to_del_filter" ${adFilter.item === 'ad_name_regular_to_del_filter' ? 'selected' : ''}>自定义正则匹配删除过滤（分片）</option>
          <option value="ad_all_regular_to_del_filter" ${adFilter.item === 'ad_all_regular_to_del_filter' ? 'selected' : ''}>自定义正则匹配删除过滤（全局）</option>
        </select>
        <div id="regularExpressionContainer" class="mt-2 ${(adFilter.item === 'ad_name_regular_to_del_filter' || adFilter.item === 'ad_all_regular_to_del_filter') ? '' : 'hidden'}">
          <input
            id="regularExpression"
            class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
            placeholder="输入正则表达式"
            value="${adFilter.regularExpression || ''}"
          />
        </div>
      </div>
      <input
        id="siteRemark"
        class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark text-sm"
        placeholder="输入备注"
        value="${site.remark}"
      />
    `,
    showCancelButton: true,
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    confirmButtonColor: '#3B82F6',
    cancelButtonColor: '#6B7280',
    background: isDark.value ? '#1F2937' : '#FFFFFF',
    color: isDark.value ? '#FFFFFF' : '#000000',
    buttonsStyling: true,
    showClass: {
      backdrop: 'swal2-noanimation',
      popup: 'swal2-noanimation'
    },
    hideClass: {
      popup: ''
    },
    didOpen: () => {
      const isPostCheckbox = document.getElementById('isPost') as HTMLInputElement
      const postDataContainer = document.getElementById('postDataContainer')
      
      isPostCheckbox.addEventListener('change', () => {
        if (postDataContainer) {
          postDataContainer.classList.toggle('hidden', !isPostCheckbox.checked)
        }
      })
      
      // 添加广告过滤相关的事件监听
      const adFilterItem = document.getElementById('adFilterItem') as HTMLSelectElement
      const regularExpressionContainer = document.getElementById('regularExpressionContainer')
      
      adFilterItem.addEventListener('change', () => {
        if (regularExpressionContainer) {
          regularExpressionContainer.classList.toggle('hidden', adFilterItem.value !== 'ad_name_regular_to_del_filter' && adFilterItem.value !== 'ad_all_regular_to_del_filter')
        }
      })
    },
    preConfirm: () => {
      const url = (document.getElementById('siteUrl') as HTMLInputElement).value.trim()
      const searchResultClass = (document.getElementById('siteSearchResultClass') as HTMLInputElement).value.trim()
      const remark = (document.getElementById('siteRemark') as HTMLInputElement).value.trim()
      const isPost = (document.getElementById('isPost') as HTMLInputElement).checked
      const postData = (document.getElementById('postData') as HTMLTextAreaElement).value.trim()
      
      // 获取广告过滤相关的值
      const adFilterStatus = (document.getElementById('adFilterStatus') as HTMLInputElement).checked
      const adFilterItem = (document.getElementById('adFilterItem') as HTMLSelectElement).value
      const regularExpression = (document.getElementById('regularExpression') as HTMLInputElement).value.trim()

      if (!url) {
        Swal.showValidationMessage('请输入资源站点搜索URL')
        return false
      }

      if (!remark) {
        Swal.showValidationMessage('请输入备注')
        return false
      }

      if (isPost && postData) {
        try {
          JSON.parse(postData)
        } catch (e) {
          Swal.showValidationMessage('POST请求参数必须是有效的JSON格式')
          return false
        }
      }
      
      if ((adFilterItem === 'ad_name_regular_to_del_filter' || adFilterItem === 'ad_all_regular_to_del_filter') && !regularExpression) {
        Swal.showValidationMessage('请输入正则表达式')
        return false
      } else if ((adFilterItem === 'ad_name_regular_to_del_filter' || adFilterItem === 'ad_all_regular_to_del_filter') && regularExpression) {
        try {
          new RegExp(regularExpression)
        } catch(error) {
          Swal.showValidationMessage('请输入正确的正则表达式')
          return false
        }
      }

      return { 
        url, 
        searchResultClass, 
        remark, 
        isPost, 
        postData: isPost ? postData : undefined,
        adFilterStatus,
        adFilterItem,
        regularExpression: (adFilterItem === 'ad_name_regular_to_del_filter' || adFilterItem === 'ad_all_regular_to_del_filter') ? regularExpression : ''
      }
    }
  })

  isDialogOpen.value = false

  if (result.isConfirmed && result.value) {
    config.value.resourceSites[index] = {
      ...config.value.resourceSites[index],
      url: result.value.url,
      searchResultClass: result.value.searchResultClass,
      remark: result.value.remark,
      isPost: result.value.isPost,
      postData: result.value.postData,
      adFilter: {
        status: result.value.adFilterStatus,
        item: result.value.adFilterItem,
        regularExpression: result.value.regularExpression
      }
    }
    await Swal.fire({
      title: '保存成功',
      icon: 'success',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
      background: isDark.value ? '#1F2937' : '#FFFFFF',
      color: isDark.value ? '#FFFFFF' : '#000000',
      customClass: {
        timerProgressBar: '!bg-primary-light/50 dark:!bg-primary-dark/50'
      },
      didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
      }
    })
  }
}

// 保存配置
const saveConfig = async () => {
  try {
    const token = sessionStorage.getItem('adminToken')
    if (!token) {
      throw new Error('未登录')
    }

    // 处理所有输入值，去除前后空格
    const processedConfig = {
      ...config.value,
      backgroundImage: config.value.backgroundImage?.trim() || '',
      announcement: config.value.announcement?.trim() || '',
      customTitle: config.value.customTitle?.toString().trim() || '',
      // 使用明文密码
      loginPassword: plainPassword.value.trim()
    }

    isDialogOpen.value = true
    const result = await Swal.fire({
      title: '保存配置',
      html: '确定要保存当前配置吗？',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      confirmButtonColor: '#3B82F6',
      cancelButtonColor: '#6B7280',
      background: isDark.value ? '#1F2937' : '#FFFFFF',
      color: isDark.value ? '#FFFFFF' : '#000000',
      customClass: {
        title: 'text-xl font-medium',
        popup: 'swal2-popup',
        htmlContainer: '!mb-20',
        actions: '!block',
        confirmButton: '!absolute !right-6 !bottom-6 !shadow-none !ring-0',
        cancelButton: '!absolute !left-6 !bottom-6 !shadow-none'
      },
      buttonsStyling: true,
      showClass: {
        backdrop: 'swal2-noanimation',
        popup: 'swal2-noanimation'
      },
      hideClass: {
        popup: ''
      }
    })

    isDialogOpen.value = false

    if (result.isConfirmed) {
      const response = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(processedConfig)
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '保存失败')
      }

      // 显示成功提示
      await Swal.fire({
        title: '保存成功',
        icon: 'success',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
        background: isDark.value ? '#1F2937' : '#FFFFFF',
        color: isDark.value ? '#FFFFFF' : '#000000',
        customClass: {
          timerProgressBar: '!bg-primary-light/50 dark:!bg-primary-dark/50'
        },
        didOpen: (toast) => {
          toast.addEventListener('mouseenter', Swal.stopTimer)
          toast.addEventListener('mouseleave', Swal.resumeTimer)
        }
      })
    }
  } catch (error) {
    console.error('保存配置失败:', error)
    // 显示错误提示
    await Swal.fire({
      title: '保存失败',
      text: error instanceof Error ? error.message : '未知错误',
      icon: 'error',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
      background: isDark.value ? '#1F2937' : '#FFFFFF',
      color: isDark.value ? '#FFFFFF' : '#000000',
      customClass: {
        timerProgressBar: '!bg-primary-light/50 dark:!bg-primary-dark/50'
      },
      didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
      }
    })
  }
}

const handleExportConfig = () => {
  // 导出完整的resourceSites配置，包括active状态
  const exportConfig = config.value.resourceSites

  // 创建Blob对象
  const blob = new Blob([JSON.stringify(exportConfig, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  
  // 创建下载链接并触发下载
  const link = document.createElement('a')
  link.href = url
  link.download = 'video_harvest_site_config.json'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  // 显示成功提示
  Swal.fire({
    title: '导出成功',
    icon: 'success',
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true,
    background: isDark.value ? '#1F2937' : '#FFFFFF',
    color: isDark.value ? '#FFFFFF' : '#000000',
    customClass: {
      timerProgressBar: '!bg-primary-light/50 dark:!bg-primary-dark/50'
    }
  })
}

const handleImportConfig = async () => {
  try {
    // 创建文件输入元素
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string
          const importedSites = JSON.parse(content)

          // 验证导入的配置格式
          if (!Array.isArray(importedSites)) {
            throw new Error('无效的配置文件格式')
          }

          // 检查重复项并合并
          const existingUrls = new Set(config.value.resourceSites.map(site => site.url))
          const newSites: ResourceSite[] = []
          const duplicateSites: ResourceSite[] = []

          for (const site of importedSites as ResourceSite[]) {
            if (existingUrls.has(site.url)) {
              duplicateSites.push(site)
            } else {
              newSites.push({
                ...site,
                active: typeof site.active === 'boolean' ? site.active : true
              })
              existingUrls.add(site.url)
            }
          }

          if (duplicateSites.length > 0) {
            // 询问用户如何处理重复项
            const result = await Swal.fire({
              title: '发现重复的资源站点',
              html: `
                发现${duplicateSites.length}个重复的资源站点。<br>
                请选择处理方式：<br>
                - 跳过：保留现有配置<br>
                - 覆盖：使用新的配置<br>
                - 全部保留：保留所有配置
              `,
              icon: 'warning',
              showDenyButton: true,
              showCancelButton: true,
              confirmButtonText: '覆盖',
              denyButtonText: '全部保留',
              cancelButtonText: '跳过',
              background: isDark.value ? '#1F2937' : '#FFFFFF',
              color: isDark.value ? '#FFFFFF' : '#000000'
            })

            if (result.isConfirmed) {
              // 覆盖重复项
              config.value.resourceSites = config.value.resourceSites.filter(site => 
                !duplicateSites.some(dupSite => dupSite.url === site.url)
              )
              config.value.resourceSites.push(...duplicateSites.map(site => ({
                ...site,
                active: typeof site.active === 'boolean' ? site.active : true
              })))
            } else if (result.isDenied) {
              // 保留所有配置（包括重复项）
              config.value.resourceSites.push(...duplicateSites.map(site => ({
                ...site,
                active: typeof site.active === 'boolean' ? site.active : true
              })))
            }
            // 如果是取消，则跳过重复项
          }

          // 添加新的非重复站点
          config.value.resourceSites.push(...newSites)

          // 显示成功提示
          await Swal.fire({
            title: '导入成功',
            html: `
              成功导入${newSites.length}个新站点<br>
              ${duplicateSites.length > 0 ? `处理了${duplicateSites.length}个重复站点<br>` : ''}
              记得点击【保存配置】按钮
            `,
            icon: 'success',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: isDark.value ? '#1F2937' : '#FFFFFF',
            color: isDark.value ? '#FFFFFF' : '#000000',
            customClass: {
              timerProgressBar: '!bg-primary-light/50 dark:!bg-primary-dark/50'
            }
          })
        } catch (error) {
          await Swal.fire({
            title: '导入失败',
            text: '请确保文件内容是有效的JSON格式',
            icon: 'error',
            background: isDark.value ? '#1F2937' : '#FFFFFF',
            color: isDark.value ? '#FFFFFF' : '#000000'
          })
        }
      }
      reader.readAsText(file)
    }

    input.click()
  } catch (error) {
    console.error('导入配置失败:', error)
    await Swal.fire({
      title: '导入失败',
      text: error instanceof Error ? error.message : '未知错误',
      icon: 'error',
      background: isDark.value ? '#1F2937' : '#FFFFFF',
      color: isDark.value ? '#FFFFFF' : '#000000'
    })
  }
}
</script>

<template>
  <div v-if="isLoading" class="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
    <div class="text-center">
      <div class="w-12 h-12 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin mb-4"></div>
      <p class="text-primary-light dark:text-primary-dark">加载中...</p>
    </div>
  </div>
  
  <template v-else-if="!isAuthenticated">
    <div class="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
      <div class="p-8 w-[360px] rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] border border-gray-100/20 dark:border-gray-700/20">
        <div class="space-y-4">
          <input
            type="password"
            placeholder="请输入密码"
            class="w-full p-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light dark:text-text-dark focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
            @keyup.enter="handleAdminLogin"
            @input="handlePasswordInput"
            v-model="adminPassword"
          />
          <div v-if="loginError" class="text-red-500 text-sm">{{ loginError }}</div>
          <div class="flex justify-between">
            <button
              @click="router.push('/')"
              class="w-24 p-3 bg-gray-500 text-white rounded relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-gray-500/20 active:scale-[0.98]"
            >
              首页
            </button>
            <button
              @click="handleAdminLogin"
              class="w-24 p-3 bg-primary-light dark:bg-primary-dark text-white rounded relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary-light/20 dark:hover:shadow-primary-dark/20 active:scale-[0.98] hover:before:opacity-100 before:opacity-0 before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent before:transition-opacity before:duration-300"
            >
              登录
            </button>
          </div>
        </div>
      </div>
    </div>
  </template>

  <div v-else class="min-h-screen bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark p-6" :class="{ 'blur-[2px]': isDialogOpen }">
    <div class="max-w-4xl mx-auto">
      <div class="flex justify-between items-center mb-6">
        <div class="flex items-center gap-3">
          <button
            @click="router.push('/')"
            class="h-10 w-10 flex items-center justify-center rounded-lg bg-background-light dark:bg-background-dark text-primary-light dark:text-primary-dark hover:bg-gray-100 dark:hover:bg-gray-800"
            title="返回首页"
          >
            <el-icon class="text-xl"><VideoPlay /></el-icon>
          </button>
          <h1 class="text-2xl font-bold">管理后台</h1>
        </div>
        <button
          @click="toggleTheme"
          class="h-10 w-10 flex items-center justify-center rounded-lg bg-background-light dark:bg-background-dark text-primary-light dark:text-primary-dark hover:bg-gray-100 dark:hover:bg-gray-800"
          :title="isDark ? '切换到日间模式' : '切换到夜间模式'"
        >
          <el-icon class="text-xl"><component :is="isDark ? 'Sunny' : 'Moon'" /></el-icon>
        </button>
      </div>
      
      <div class="space-y-6">
        <!-- 资源站点配置 -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div class="flex flex-col sm:flex-row flex-wrap justify-between items-center gap-4 mb-4">
            <div class="flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-start">
              <el-icon class="text-xl text-primary-light dark:text-primary-dark"><Link /></el-icon>
              <h2 class="text-xl font-semibold">资源站点配置</h2>
            </div>
            <div class="flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-end flex-wrap">
              <button
                @click="handleExportConfig"
                class="px-4 py-2 bg-orange-500 text-white rounded hover:opacity-90"
              >
                导出
              </button>
              <button
                @click="handleImportConfig"
                class="px-4 py-2 bg-green-500 text-white rounded hover:opacity-90"
              >
                导入
              </button>
              <button
                @click="addResourceSite"
                class="px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:opacity-90"
              >
                添加
              </button>
            </div>
          </div>
          <div class="space-y-4">
            <div v-for="(site, index) in config.resourceSites" :key="index">
              <div class="flex flex-col sm:flex-row gap-2 items-center bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <label class="relative flex items-center cursor-pointer shrink-0">
                  <input
                    v-model="site.active"
                    type="checkbox"
                    class="sr-only peer"
                  />
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-light dark:peer-checked:bg-primary-dark"></div>
                  <span class="sr-only">激活/暂停</span>
                </label>
                <div class="flex-1 flex flex-col sm:flex-row gap-2 min-w-0 w-full">
                  <div class="w-full sm:w-[40%] min-w-0 p-2 rounded bg-gray-50 dark:bg-gray-700/30 flex items-center">
                    <div class="truncate" :title="site.url">{{ site.url }}</div>
                  </div>
                  <div class="w-full sm:w-[30%] min-w-0 p-2 rounded bg-gray-50 dark:bg-gray-700/30">
                    <div class="text-sm text-gray-500 dark:text-gray-400">搜索结果列表类名</div>
                    <div class="truncate" :title="site.searchResultClass || '无'">{{ site.searchResultClass || '无' }}</div>
                  </div>
                  <div class="w-full sm:w-[30%] min-w-0 p-2 rounded bg-gray-50 dark:bg-gray-700/30">
                    <div class="text-sm text-gray-500 dark:text-gray-400">备注</div>
                    <div class="truncate" :title="site.remark || '无备注'">{{ site.remark || '无备注' }}</div>
                  </div>
                </div>
                <div class="flex gap-2 shrink-0 mt-2 sm:mt-0">
                  <button
                    @click="editResourceSite(index)"
                    class="h-10 w-10 flex items-center justify-center bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                    title="编辑"
                  >
                    <el-icon class="text-xl"><Edit /></el-icon>
                  </button>
                  <button
                    @click="deleteResourceSite(index)"
                    class="h-10 w-10 flex items-center justify-center bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                    title="删除"
                  >
                    <el-icon class="text-base"><CircleClose /></el-icon>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- API配置 -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div class="flex items-center gap-2 mb-4">
            <el-icon class="text-xl text-primary-light dark:text-primary-dark"><Monitor /></el-icon>
            <h2 class="text-xl font-semibold">API 配置</h2>
          </div>
          <div class="space-y-4">
            <div>
              <label class="block mb-2">解析 API <br><span class="text-xs text-gray-500 dark:text-gray-400">( 是前端直接请求完成，不会对服务器产生额外的流量，不会解析资源站点的视频，只解析页面的 )</span><br><span class="text-xs text-gray-500 dark:text-gray-400">( 去除解析页面的弹窗广告请安装 https://greasyfork.org/zh-CN/scripts/535880-jx-filter-ad )</span></label>
              <input
                v-model="config.parseApi"
                type="text"
                class="w-[200px] p-2 rounded border-[0.5px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light dark:text-text-dark focus:outline-none focus:border-primary-light dark:focus:border-primary-dark focus:w-full transition-[width] duration-200"
                placeholder="输入解析API地址"
              />
            </div>
            <div>
              <label class="block mb-2">视频代理 URL <br><span class="text-xs text-gray-500 dark:text-gray-400">( 是前端代理请求，URL会暴露在请求信息，但相对于后端代理请求而言，不会对服务器产生额外的流量 )</span><br><span class="text-xs text-gray-500 dark:text-gray-400">( 如果不配置该代理URL，直接前端完成请求；只有在请求重试都失败后，才尝试服务器后端代理 /api/proxy )</span><br><span class="text-xs text-gray-500 dark:text-gray-400">( 只要配置了代理URL，无论是 视频 还是 直播 代理，那么在请求重试都失败后，也不会尝试服务器代理请求 )</span></label>
              <input
                v-model="config.proxyVideoUrl"
                type="text"
                class="w-[200px] p-2 rounded border-[0.5px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light dark:text-text-dark focus:outline-none focus:border-primary-light dark:focus:border-primary-dark focus:w-full transition-[width] duration-200"
                placeholder="输入视频代理URL地址"
              />
            </div>
            <div>
              <label class="block mb-2">直播代理 URL <br><span class="text-xs text-gray-500 dark:text-gray-400">( 是前端代理请求，URL会暴露在请求信息，但相对于后端代理请求而言，不会对服务器产生额外的流量 )</span><br><span class="text-xs text-gray-500 dark:text-gray-400">( 如果不配置该代理URL，那么http链接默认走的是服务器后端代理流量 /api/proxy，代理是为了能够正常请求 )</span><br><span class="text-xs text-gray-500 dark:text-gray-400">( 只要配置了代理URL，无论是 视频 还是 直播 代理，那么在请求重试都失败后，也不会尝试服务器代理请求 )</span></label>
              <input
                v-model="config.proxyLiveUrl"
                type="text"
                class="w-[200px] p-2 rounded border-[0.5px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light dark:text-text-dark focus:outline-none focus:border-primary-light dark:focus:border-primary-dark focus:w-full transition-[width] duration-200"
                placeholder="输入直播代理URL地址"
              />
            </div>
          </div>
        </div>

        <!-- 功能开关 -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div class="flex items-center gap-2 mb-4">
            <el-icon class="text-xl text-primary-light dark:text-primary-dark"><Setting /></el-icon>
            <h2 class="text-xl font-semibold">功能开关</h2>
          </div>
          <div class="space-y-4">
            <label class="flex items-center gap-3 cursor-pointer p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg group">
              <div class="relative">
                <input
                  v-model="config.enableLogin"
                  type="checkbox"
                  class="sr-only peer"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-light dark:peer-checked:bg-primary-dark"></div>
              </div>
              <span class="text-gray-700 dark:text-gray-200 group-hover:text-primary-light dark:group-hover:text-primary-dark transition-colors">
                启用登录功能
              </span>
            </label>
            
            <!-- 登录密码配置 -->
            <div v-if="config.enableLogin" class="mt-2 ml-14">
              <div class="relative">
                <input
                  v-model="plainPassword"
                  :type="showPassword ? 'text' : 'password'"
                  class="w-full p-2 pr-10 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                  placeholder="设置登录密码"
                />
                <button
                  @click="showPassword = !showPassword"
                  type="button"
                  class="absolute inset-y-0 right-0 px-3 flex items-center"
                >
                  <el-icon v-if="showPassword"><Hide /></el-icon>
                  <el-icon v-else><View /></el-icon>
                </button>
              </div>
            </div>
            
            <!-- 健康过滤开关 -->
            <label class="flex items-center gap-3 cursor-pointer p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg group">
              <div class="relative">
                <input
                  v-model="config.enableHealthFilter"
                  type="checkbox"
                  class="sr-only peer"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-light dark:peer-checked:bg-primary-dark"></div>
              </div>
              <span class="text-gray-700 dark:text-gray-200 group-hover:text-primary-light dark:group-hover:text-primary-dark transition-colors">
                启用健康过滤（搜索时，根据分类过滤掉不健康的资源，有的站点没有不健康的分类就过滤不了）
              </span>
            </label>
            
            <!-- 豆瓣热门功能开关 -->
            <label class="flex items-center gap-3 cursor-pointer p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg group">
              <div class="relative">
                <input
                  v-model="config.enableHotMovies"
                  type="checkbox"
                  class="sr-only peer"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-light dark:peer-checked:bg-primary-dark"></div>
              </div>
              <span class="text-gray-700 dark:text-gray-200 group-hover:text-primary-light dark:group-hover:text-primary-dark transition-colors">
                启用豆瓣热门功能
              </span>
            </label>
            
            <!-- 豆瓣代理URL配置 -->
            <div v-if="config.enableHotMovies" class="mt-2 ml-14">
              <input
                v-model="config.hotMoviesProxyUrl"
                type="text"
                class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark mb-2"
                placeholder="（可选）自定义代理URL请求豆瓣接口"
              />
              <input
                v-model="config.hotTvDefaultTag"
                type="text"
                class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark mb-2"
                placeholder="（可选）设置电视剧默认标签：国产剧"
              />
              <input
                v-model="config.hotMovieDefaultTag"
                type="text"
                class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                placeholder="（可选）设置电影默认标签：科幻"
              />
            </div>
            
            <!-- 剧集自动连播开关 -->
            <label class="flex items-center gap-3 cursor-pointer p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg group">
              <div class="relative">
                <input
                  v-model="config.autoPlayNext"
                  type="checkbox"
                  class="sr-only peer"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-light dark:peer-checked:bg-primary-dark"></div>
              </div>
              <span class="text-gray-700 dark:text-gray-200 group-hover:text-primary-light dark:group-hover:text-primary-dark transition-colors">
                启用剧集自动连播
              </span>
            </label>
          </div>
        </div>

        <!-- 其他设置 -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div class="flex items-center gap-2 mb-4">
            <el-icon><Operation /></el-icon>
            <h2 class="text-xl font-semibold">其他设置</h2>
          </div>
          <div class="space-y-4">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                背景图片链接
              </label>
              <input
                v-model="config.backgroundImage"
                type="text"
                class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                placeholder="输入图片链接（多个用英文逗号隔开，随机显示），为空即不显示背景"
              />
            </div>

            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                自定义首页名称/logo
              </label>
              <input
                v-model="config.customTitle"
                type="text"
                class="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-primary-light dark:focus:border-primary-dark"
                placeholder="不配置则使用默认图标"
              />
            </div>

            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                公告内容
              </label>
              <textarea
                v-model="config.announcement"
                rows="4"
                class="w-full p-2 rounded border-[0.5px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light dark:text-text-dark focus:outline-none focus:border-primary-light dark:focus:border-primary-dark resize-none"
                placeholder="输入公告内容"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- 保存按钮 -->
        <div class="flex justify-end">
          <button
            @click="saveConfig"
            class="px-6 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:opacity-90 mx-0"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.icon {
  font-size: 1.25em;
  line-height: 1;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
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

/* 隐藏水平滚动条 */
.overflow-x-auto {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.overflow-x-auto::-webkit-scrollbar {
  display: none;
}
</style>
