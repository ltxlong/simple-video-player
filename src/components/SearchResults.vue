<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import type { ResourceSite } from '../types'
import { load } from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import Swal from 'sweetalert2'
import { useTheme } from '../composables/useTheme'
import { BookmarkIcon } from '@heroicons/vue/24/outline'

interface Props {
  sites: ResourceSite[]
  keyword: string
  enableHealthFilter: boolean
  refreshTrigger?: number
  videoPlayer?: any
}

const props = defineProps<Props>()
const activeTab = ref(0)
const hasSearched = ref(false)
const searchResults = ref<{ [key: string]: string }>({})
const isLoading = ref<{ [key: string]: boolean }>({})
const isProxySearching = ref<{ [key: string]: boolean }>({})
const emit = defineEmits(['updateVideoUrl', 'update:isCurrentTagTab', 'update:isSearching'])
const searchResultsContainer = ref<HTMLDivElement | null>(null)
const { isDark } = useTheme()
const isMobile = !!navigator.userAgent.match(/AppleWebKit.*Mobile.*/)

// 添加排序状态
const isReversedArr = ref<{ [key: string]: boolean }>({})

// 添加 IPTV 源相关状态
const isIPTVSource = ref<{ [key: string]: boolean }>({})
const iptvTabContents = ref<{ [key: string]: string }>({})

// 添加一个新的状态变量来跟踪当前是否在显示剧集列表
const isShowingEpisodes = ref(false)
// 添加一个新的状态来跟踪每个tab的剧集列表显示状态
const tabEpisodesState = ref<{ [key: string]: boolean }>({})
const previousResults = ref<{ [key: string]: string }>({})

// 添加一个新的状态来保存每个标签页的原始搜索关键词
const tabOriginalKeywords = ref<{ [key: string]: string }>({})

// 添加标签相关的状态变量
const currentVideoInfo = ref<{
  title: string;
  url: string;
  episode: string;
  siteRemark: string;
  detailPageUrl?: string;
  adFilter: object
}>({ title: '', url: '', episode: '', siteRemark: '', adFilter: {
  status: true,
  item: 'default_del_ad_tag_to_filter',
  regularExpression: ''
} })

// 添加一个新的状态变量来保存当前激活的剧集 URL
const activeEpisodeUrls = ref<{ [key: string]: string }>({})

// 添加一个新的状态变量来保存搜索关键词
const savedKeyword = ref('')

// 添加标签页相关的状态变量，默认显示标签页
const showTagsTab = ref(true)
const tagsTabContent = ref('')

// 添加右键菜单相关的状态变量
const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  episodeUrl: string;
  episodeTitle: string;
  episodeIndex: string;
  vodId: string;
  vodUrl: string;
}>({
  visible: false,
  x: 0,
  y: 0,
  episodeUrl: '',
  episodeTitle: '',
  episodeIndex: '',
  vodId: '',
  vodUrl: ''
})

// 使用VPS端点标志
let vpsEndpointFlag = false
// 在运行时读取环境变量，规避编译时错误
try {
  vpsEndpointFlag = import.meta.env.VITE_VPS_ENDPOINT_FLAG === 'true'
} catch (e) {
  console.error('读取环境变量失败:', e)
}

// 检查站点 URL 是否为 IPTV 源
const isIPTVSourceUrl = (url: string): boolean => {
  if (!url) return false
  const lowerCaseUrl = url.toLowerCase()
  return lowerCaseUrl.endsWith('.m3u') || lowerCaseUrl.endsWith('.m3u8') || lowerCaseUrl.endsWith('.txt')
}

// 处理响应内容的解析和渲染
const handleIPTVResponseContent = async (site: ResourceSite, index: number, content: string) => {

  // 解析 IPTV 内容
  let resultHtml = `
    <div class="space-y-4">
      <div class="flex flex-wrap justify-between items-center">
        <div class="text-lg font-medium text-gray-900 dark:text-gray-100">IPTV源</div>
        <div class="flex items-center max-w-[180px]">
          <input 
            type="text" 
            placeholder="搜索频道..." 
            class="w-full px-3 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-light dark:focus:ring-primary-dark" 
            onkeyup="document.dispatchEvent(new CustomEvent('searchChannel', {detail: this.value}))"
          />
        </div>
        <button 
          class="px-4 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium"
          onclick="document.dispatchEvent(new CustomEvent('showTagDialog'))"
        >
          标签
        </button>
      </div>
      <div class="iptv-results flex flex-col space-y-2">
  `
  
  // 解析 m3u 或 m3u8 或 txt 文件
  let groupedChannels: { [group: string]: {title: string, url: string}[] } = {}
  let currentGroup = '默认分组'
  // 用于跟踪分组添加顺序的数组
  let groupOrder: string[] = []
  
  if (site.url.toLowerCase().endsWith('.m3u') || site.url.toLowerCase().endsWith('.m3u8')) {
    // 解析 m3u 或 m3u8 格式
    const lines = content.split('\n')
    let currentTitle = ''
    let lastGroupTitle = ''
    let currentTvgName = ''
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      
      if (line.startsWith('#EXTINF:')) {
        // 获取 tvg-name
        const tvgNameMatch = line.match(/tvg-name="([^"]+)"/)
        currentTvgName = tvgNameMatch ? tvgNameMatch[1].trim() : ''
        
        // 获取频道标题 (优先使用 tvg-name,如果没有则使用逗号后的标题)
        const titleMatch = line.match(/,(.+)$/)
        currentTitle = currentTvgName || (titleMatch ? titleMatch[1].trim() : `频道 ${Object.values(groupedChannels).flat().length + 1}`)
        
        // 尝试获取分组信息
        const groupMatch = line.match(/group-title="([^"]+)"/)
        if (groupMatch) {
          currentGroup = groupMatch[1].trim()
          lastGroupTitle = currentGroup
          // 如果是新分组，添加到顺序数组中
          if (!groupOrder.includes(currentGroup)) {
            groupOrder.unshift(currentGroup)
          }
        } else {
          // 如果没有组标题,使用上一个组标题或默认分组
          currentGroup = lastGroupTitle || '默认分组'
        }
      } else if (line && !line.startsWith('#') && (line.includes('http://') || line.includes('https://'))) {
        // 找到播放URL(必须是#EXTINF:的下一行)
        if (currentTitle) {
          if (!groupedChannels[currentGroup]) {
            groupedChannels[currentGroup] = []
          }
          
          groupedChannels[currentGroup].unshift({
            title: currentTitle,
            url: line
          })
          
          // 重置当前标题和tvg-name,确保只处理#EXTINF:的下一行
          currentTitle = ''
          currentTvgName = ''
        }
      }
    }
  } else if (site.url.toLowerCase().endsWith('.txt')) {
    // 解析 txt 格式
    const lines = content.split('\n')
    
    // 先用一个循环，判断是否有#EXTM3U
    let hasExtm3u = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line && line.includes('#EXTM3U')) {
        hasExtm3u = true
        break
      } else if (line && line.includes('#genre#')) {
        break
      } else if (line && line.includes(',http') && lines[i + 1] && lines[i + 1].includes(',http') && !line.startsWith('#')) {
        break
      } else if (line && line.includes('，http') && lines[i + 1] && lines[i + 1].includes('，http') && !line.startsWith('#')) {
        break
      } else if (line && line.includes('$http') && lines[i + 1] && lines[i + 1].includes('$http') && !line.startsWith('#')) {
        break
      } else if (line && line.startsWith('http') && lines[i + 1] && lines[i + 1].startsWith('http') && !line.startsWith('#')) {
        break
      }
    }

    let currentTitle = ''
    let lastGroupTitle = ''
    let currentTvgName = ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      
      if (hasExtm3u) {
        // 解析 m3u 格式
        if (line.startsWith('#EXTINF:')) {
          // 获取 tvg-name
          const tvgNameMatch = line.match(/tvg-name="([^"]+)"/)
          currentTvgName = tvgNameMatch ? tvgNameMatch[1].trim() : ''
          
          // 获取频道标题 (优先使用 tvg-name,如果没有则使用逗号后的标题)
          const titleMatch = line.match(/,(.+)$/)
          currentTitle = currentTvgName || (titleMatch ? titleMatch[1].trim() : `频道 ${Object.values(groupedChannels).flat().length + 1}`)
          
          // 尝试获取分组信息
          const groupMatch = line.match(/group-title="([^"]+)"/)
          if (groupMatch) {
            currentGroup = groupMatch[1].trim()
            lastGroupTitle = currentGroup
            // 如果是新分组，添加到顺序数组中
            if (!groupOrder.includes(currentGroup)) {
              groupOrder.unshift(currentGroup)
            }
          } else {
            // 如果没有组标题,使用上一个组标题或默认分组
            currentGroup = lastGroupTitle || '默认分组'
          }
        } else if (line && !line.startsWith('#') && (line.includes('http://') || line.includes('https://'))) {
          // 找到播放URL(必须是#EXTINF:的下一行)
          if (currentTitle) {
            if (!groupedChannels[currentGroup]) {
              groupedChannels[currentGroup] = []
            }
            
            groupedChannels[currentGroup].unshift({
              title: currentTitle,
              url: line
            })
            
            // 重置当前标题和tvg-name,确保只处理#EXTINF:的下一行
            currentTitle = ''
            currentTvgName = ''
          }
        }

      } else {
        // 检查是否是分组标记行
        if (line.includes('#genre#')) {
          // 格式: "分组名,#genre#"
          const parts = line.split(/,#genre#|，#genre#/)
          currentGroup = parts[0].trim() || '默认分组'
          if (!groupedChannels[currentGroup]) {
            groupedChannels[currentGroup] = []
            // 如果是新分组，添加到顺序数组中
            if (!groupOrder.includes(currentGroup)) {
              groupOrder.unshift(currentGroup)
            }
          }
          continue
        } else if (line.includes('$c_start') && line.includes('$c_end')) {
          // 格式: "$c_start分组名$c_end"
          const parts = line.split('$c_start')
          currentGroup = parts[1].split('$c_end')[0].trim() || '默认分组'
          if (!groupedChannels[currentGroup]) {
            groupedChannels[currentGroup] = []
            // 如果是新分组，添加到顺序数组中
            if (!groupOrder.includes(currentGroup)) {
              groupOrder.unshift(currentGroup)
            }
          }
          continue
        }
        
        // 尝试解析不同格式
        if ((line.includes(',') || line.includes('，')) && (line.includes('http://') || line.includes('https://'))) {
          // 格式: "标题,URL" 或者 "标题，URL"
          const parts = line.split(/,|，/)
          let title = parts[0].trim()
          let url = parts.slice(1).join(',').trim()
          
          if (title && url) {
            if (!groupedChannels[currentGroup]) {
              groupedChannels[currentGroup] = []
            }
            
            groupedChannels[currentGroup].unshift({ title, url })
          }
        } else if (line.includes('$') && (line.includes('http://') || line.includes('https://'))) {
          // 格式: "标题$URL"
          const parts = line.split('$')
          const title = parts[0].trim()
          const url = parts.slice(1).join('$').trim()
          
          if (url) {
            if (!groupedChannels[currentGroup]) {
              groupedChannels[currentGroup] = []
            }
            
            groupedChannels[currentGroup].unshift({ 
              title: title || `频道 ${groupedChannels[currentGroup].length + 1}`, 
              url 
            })
          }
        } else if (line.match(/^https?:\/\//)) {
          // 仅包含URL，使用递增的频道名称
          if (!groupedChannels[currentGroup]) {
            groupedChannels[currentGroup] = []
          }
          
          groupedChannels[currentGroup].unshift({
            title: `频道 ${groupedChannels[currentGroup].length + 1}`,
            url: line
          })
        }
      }
    }
  }
  
  // 转换分组对象为有序数组，使用添加顺序而不是字母排序
  let sortedGroups = [...groupOrder]
  
  // 确保默认分组存在并放在最前面
  if (!sortedGroups.includes('默认分组') && groupedChannels['默认分组']) {
    sortedGroups.unshift('默认分组')
  } else if (sortedGroups.includes('默认分组') && sortedGroups[0] !== '默认分组') {
    // 如果默认分组不在第一位，将其移到第一位
    sortedGroups = ['默认分组', ...sortedGroups.filter(g => g !== '默认分组')]
  }
  
  // 添加未在groupOrder中的分组（以防万一）
  Object.keys(groupedChannels).forEach(group => {
    if (!sortedGroups.includes(group)) {
      sortedGroups.push(group)
    }
  })
  
  sortedGroups.reverse()
  
  // 渲染分组和频道列表
  let totalChannels = 0
  
  sortedGroups.forEach(groupName => {
    const channels = groupedChannels[groupName]
    
    if (channels && channels.length > 0) {
      // 添加分组标题
      resultHtml += `
        <div class="iptv-group-header mb-3 mt-5">
          <div class="text-base font-medium py-2.5 px-4 bg-gray-100 dark:bg-gray-700 rounded text-gray-800 dark:text-gray-200 flex items-center justify-center shadow-sm hover:shadow-md transition-shadow duration-300">
            <span class="mx-auto flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-primary-light dark:text-primary-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                <path d="M 12 18 L 12 22"></path>
                <path d="M 8 22 L 16 22"></path>
              </svg>
              ${groupName} <span class="inline-block ml-1 px-2 py-0.5 bg-primary-light/10 dark:bg-primary-dark/20 text-primary-light dark:text-primary-dark rounded-full text-xs">${channels.length}</span>
            </span>
          </div>
        </div>
      `
      
      // 根据排序状态排序
      let sortedChannels = [...channels]
      
      sortedChannels.reverse()
      
      // 渲染频道列表
      sortedChannels.forEach(({ title, url }) => {
        totalChannels++
        resultHtml += `
          <div class="m3u8-item iptv-item w-full group relative bg-white dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm hover:shadow-md dark:shadow-gray-900/10 border border-gray-100 dark:border-gray-700"
                data-url="${url}"
          >
            <div class="p-3 text-sm font-medium text-gray-700 dark:text-gray-200 group-hover:text-primary-light dark:group-hover:text-primary-dark break-words" title="${title}">
              ${title}
            </div>
            <div class="absolute inset-0 rounded ring-1 ring-inset ring-gray-200 dark:ring-gray-700 group-hover:ring-primary-light/20 dark:group-hover:ring-primary-dark/20"></div>
          </div>
        `
      })
    }
  })
  
  resultHtml += '</div></div>'
  
  // 保存生成的HTML
  iptvTabContents.value[index] = resultHtml
  
  // 如果没有找到任何频道，显示错误信息
  if (totalChannels === 0) {
    iptvTabContents.value[index] = `
      <div class="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-100 dark:border-red-900/30">
        <p class="font-medium">未找到可播放的频道</p>
        <p class="mt-2 text-sm">请检查 IPTV 源格式是否正确</p>
      </div>
    `
  }
}

// 解析 IPTV 源内容
const parseIPTVSource = async (site: ResourceSite, index: number) => {
  try {
    isLoading.value[index] = true
    
    // 根据环境选择正确的 API 端点
    const apiEndpoint = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || vpsEndpointFlag 
      ? '/api/search' 
      : '/functions/api/search'
    
    // 发送请求获取 IPTV 源内容
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: site.url })
    })

    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`)
    }

    const content = await response.text()
    
    await handleIPTVResponseContent(site, index, content)
    
  } catch (error) {
    try {
      isLoading.value[index] = true
    
      // 使用代理重试
      const proxyUrl = `https://r.jina.ai/${site.url}`
      
      // 发送请求获取 IPTV 源内容
      const proxyResponse = await fetch(proxyUrl, {
        headers: {
          'Accept': '*/*',
          'X-No-Cache': 'true',
          'X-Timeout': '5'
        }
      })

      if (!proxyResponse.ok) {
        throw new Error(`代理请求失败: ${proxyResponse.status}`)
      }

      const proxyContent = await proxyResponse.text()

      await handleIPTVResponseContent(site, index, proxyContent)

    } catch (error) {
      console.error('解析 IPTV 源失败:', error)
      iptvTabContents.value[index] = `
        <div class="error-message p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-100 dark:border-red-900/30">
          <p class="font-medium">解析 IPTV 源失败:</p>
          <p class="mt-1">${error instanceof Error ? error.message : '未知错误'}</p>
          <p class="mt-2 text-sm">请检查网络连接或稍后重试</p>
          <button 
            class="mt-3 px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 transition-colors shadow-sm"
            onclick="document.dispatchEvent(new CustomEvent('retryParseIPTV', {detail: ${index}}))"
          >
            重试
          </button>
        </div>
      `
    }
  } finally {
    isLoading.value[index] = false
  }
}

// 处理重试解析IPTV源事件
const handleRetryParseIPTV = (event: CustomEvent) => {
  const index = event.detail
  if (typeof index === 'number') {
    const site = props.sites.filter(s => s.active)[index]
    if (site) {
      parseIPTVSource(site, index)
    }
  }
}

// 创建一个Helper函数来处理SweetAlert2样式问题
const setupSwalButtonStyles = () => {
  // 全局添加一次样式就足够了
  if (!document.getElementById('swal-custom-styles')) {
    const style = document.createElement('style');
    style.id = 'swal-custom-styles';
    style.innerHTML = `
      .swal2-actions button:focus,
      .swal2-actions button:focus-visible {
        box-shadow: none !important;
        outline: none !important;
        border: none !important;
      }
      .swal2-button-no-focus:focus {
        box-shadow: none !important;
        outline: none !important;
        border-color: transparent !important;
      }
    `;
    document.head.appendChild(style);
  }
  
  // 返回通用的SweetAlert2配置
  return {
    buttonsStyling: true,
    customClass: {
      confirmButton: 'swal2-button-no-focus',
      cancelButton: 'swal2-button-no-focus',
      denyButton: 'swal2-button-no-focus'
    },
    didOpen: (popup: HTMLElement) => {
      // 对当前弹窗中的所有按钮添加点击事件，去除焦点
      document.querySelectorAll('.swal2-actions button').forEach(button => {
        (button as HTMLButtonElement).addEventListener('click', () => (button as HTMLButtonElement).blur());
        (button as HTMLButtonElement).addEventListener('focus', (e) => {
          // 防止默认聚焦样式
          const target = e.currentTarget as HTMLButtonElement;
          if (target) {
            target.style.boxShadow = 'none';
            target.style.outline = 'none';
            target.style.border = 'none';
          }
        });
      });
    }
  };
}

// 修改标签信息的类型定义
interface TagInfo {
  note: string;
  seriesName?: string;
  episodeNumber?: string;
  siteName?: string;
  detailPageUrl?: string;
  updateDays?: number[];
  timestamp: string;
  currentTime?: number;
  vodId?: number;
}

// 生成标签的唯一标识符
const generateTagKey = (siteName: string, seriesName: string): string => {
  return `${siteName}::${seriesName}`.trim()
}

// 检查视频是否已添加标签
const hasTag = (siteName: string, seriesName: string): boolean => {
  try {
    const tags = JSON.parse(localStorage.getItem('video_tags') || '{}')
    
    // 使用资源站点+剧集名称作为唯一标识符
    const key = generateTagKey(siteName, seriesName)
    return !!tags[key]
  } catch (e) {
    console.error('解析标签数据失败:', e)
    return false
  }
}

// 获取标签信息
const getTagInfo = (siteName: string, seriesName: string): TagInfo | null => {
  try {
    const tags = JSON.parse(localStorage.getItem('video_tags') || '{}')
    
    // 使用资源站点+剧集名称作为唯一标识符
    const key = generateTagKey(siteName, seriesName)
    return tags[key] || null
  } catch (e) {
    console.error('获取标签信息失败:', e)
    return null
  }
}

// 保存标签信息
const saveTag = (siteName: string, seriesName: string, episodeNumber: string, detailPageUrl: string, note: string, updateDays: number[], videoPlayer?: any) => {
  try {
    const tags = JSON.parse(localStorage.getItem('video_tags') || '{}')

    // 使用资源站点+剧集名称作为唯一标识符
    const key = generateTagKey(siteName, seriesName)
    
    // 获取当前播放时间
    let currentTime = 0

    const theSiteName = showTagsTab.value ? 'tag_' + siteName : siteName
    
    // 如果当前剧集的URL和正在播放的URL一样，并且不是IPTV，则获取当前播放时间
    if (videoPlayer && currentVideoInfo.value.url === activeEpisodeUrls.value[theSiteName] && seriesName !== 'IPTV') {
      try {
        // 获取当前播放时间
        currentTime = videoPlayer.player?.value?.video?.currentTime || 0
      } catch (e) {
        console.error('获取播放时间失败:', e)
      }
    }
    
    // 保存标签信息
    tags[key] = { 
      note, 
      seriesName,
      episodeNumber,
      siteName,
      detailPageUrl, // 剧集列表页面URL
      updateDays, // 更新日期
      currentTime, // 保存当前播放时间
      timestamp: new Date().toISOString()
    }
    
    localStorage.setItem('video_tags', JSON.stringify(tags))
  } catch (e) {
    console.error('保存标签失败:', e)
  }
}

// 删除标签
const removeTag = (siteName: string, seriesName: string) => {
  try {
    const tags = JSON.parse(localStorage.getItem('video_tags') || '{}')
    
    // 使用资源站点+剧集名称作为唯一标识符
    const key = generateTagKey(siteName, seriesName)
    if (tags[key]) {
      delete tags[key]
    }
    
    localStorage.setItem('video_tags', JSON.stringify(tags))
  } catch (e) {
    console.error('删除标签失败:', e)
  }
}

// 添加一个新的状态变量来保存标签详细信息
const currentTagInfo = ref<TagInfo | null>(null)

// 修改标签对话框显示函数
const showTagDialog = (vodUrl?: string, title?: string) => {

  // 如果是在标签页且有保存的标签信息，直接使用保存的信息
  if (showTagsTab.value && currentTagInfo.value) {
    // 使用保存的标签信息来构建弹窗
    const tag = currentTagInfo.value

    // 检查detailUrl的类型，判断是否是html
    const videoType = detectVideoType(tag.detailPageUrl || '')

    const isHtmlType = videoType === 'html' || videoType === 'm3u8str' || videoType === 'jsonApi'
    const isEpisodeNumberEditable = isHtmlType
    
    Swal.fire({
      title: '视频标签',
      html: `
        <div class="text-left space-y-3">
          <div class="mb-2">
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">剧集名称
            ${!isEpisodeNumberEditable ? '<span class="text-xs text-yellow-500 ml-1">(不可编辑，IPTV源)</span>' : ''}</div>
            <input id="seriesName" class="mt-1 w-full p-2 rounded border border-gray-200 dark:border-gray-700 ${!isEpisodeNumberEditable ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed' : 'bg-white dark:bg-gray-800'} text-gray-900 dark:text-white" value="${tag.seriesName || ''}" ${!isEpisodeNumberEditable ? 'disabled' : ''}>
          </div>
          <div class="mb-2">
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">
              追更集数
              ${!isEpisodeNumberEditable ? '<span class="text-xs text-yellow-500 ml-1">(不可编辑，IPTV源)</span>' : ''}
            </div>
            <input id="episodeNumber" class="mt-1 w-full p-2 rounded border border-gray-200 dark:border-gray-700 ${!isEpisodeNumberEditable ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed' : 'bg-white dark:bg-gray-800'} text-gray-900 dark:text-white" value="${tag.episodeNumber || ''}" ${!isEpisodeNumberEditable ? 'disabled' : ''}>
          </div>
          <div class="mb-2">
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">资源站点</div>
            <div class="mt-1 p-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">${tag.siteName || ''}</div>
          </div>
          <input type="hidden" id="detailPageUrl" value="${tag.detailPageUrl || ''}">
          <div class="mb-2">
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">更新日期</div>
            <div class="mt-1 flex flex-wrap gap-3">
              ${['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day, index) => `
                <label class="inline-flex items-center">
                  <input type="checkbox" 
                    id="updateDay${index}" 
                    class="form-checkbox h-4 w-4 text-blue-500 dark:text-blue-400 border-gray-300 dark:border-gray-600 rounded"
                    ${tag.updateDays?.includes(index) ? 'checked' : ''}
                  >
                  <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">${day}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="mb-2">
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">标签备注</div>
            <textarea id="tagNote" class="mt-1 w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-h-[50px] max-h-[100px] overflow-y-auto resize-y" rows="3">${tag.note || ''}</textarea>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '保存标签',
      cancelButtonText: '删除标签',
      confirmButtonColor: '#3B82F6',
      cancelButtonColor: '#EF4444',
      showDenyButton: true,
      denyButtonText: '取消',
      denyButtonColor: '#6B7280',
      background: isDark.value ? '#1F2937' : '#FFFFFF',
      color: isDark.value ? '#FFFFFF' : '#000000',
      showClass: {
        backdrop: 'swal2-noanimation',
        popup: 'swal2-noanimation'
      },
      hideClass: {
        popup: ''
      },
      preConfirm: () => {
        // 在弹窗关闭前获取值
        const popup = Swal.getPopup();
        const seriesNameElement = popup?.querySelector('#seriesName') as HTMLInputElement;
        const episodeNumberElement = popup?.querySelector('#episodeNumber') as HTMLInputElement;
        const detailPageUrlElement = popup?.querySelector('#detailPageUrl') as HTMLInputElement;
        const noteElement = popup?.querySelector('#tagNote') as HTMLTextAreaElement;
        
        const seriesName = seriesNameElement?.value || '';
        const episodeNumber = episodeNumberElement?.value || '';
        const detailPageUrl = detailPageUrlElement?.value || '';
        const note = noteElement?.value || '';
        
        // 获取选中的更新日期
        const updateDays = Array.from({ length: 7 }, (_, i: number) => {
          const checkbox = popup?.querySelector(`#updateDay${i}`) as HTMLInputElement;
          return checkbox?.checked ? i : -1;
        }).filter((i: number) => i !== -1);

        // 返回所有值供 then 回调使用
        return { seriesName, episodeNumber, detailPageUrl, note, updateDays };
      },
      // 使用helper函数设置按钮样式
      ...setupSwalButtonStyles()
    }).then((result) => {
      if (result.isConfirmed) {
        let { seriesName, episodeNumber, detailPageUrl, note, updateDays } = result.value

        if (vodUrl) {
          // json api
          detailPageUrl = vodUrl
        }
        
        // 保存标签
        saveTag(tag.siteName || '', seriesName, episodeNumber, detailPageUrl, note, updateDays, props.videoPlayer)
        
        // 更新当前标签信息
        currentTagInfo.value = {
          note,
          seriesName: seriesName,
          episodeNumber,
          siteName: tag.siteName || '',
          detailPageUrl,
          updateDays,
          timestamp: new Date().toISOString()
        }
        
        // 更新按钮样式（重新渲染）
        if (tagsTabContent.value) {
          const $ = load(tagsTabContent.value)
          const $tagButton = $('button[onclick*="showTagDialog"]')
          if ($tagButton.length) {
            $tagButton.html(getTagButtonContent(tag.siteName || '', seriesName))
            tagsTabContent.value = $.html()
          }
        }
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        // 删除标签
        removeTag(tag.siteName || '', tag.seriesName || '')
        
        // 清空当前标签信息
        currentTagInfo.value = null
        
        // 更新按钮样式
        if (tagsTabContent.value) {
          const $ = load(tagsTabContent.value)
          const $tagButton = $('button[onclick*="showTagDialog"]')
          if ($tagButton.length) {
            $tagButton.html(getTagButtonContent(tag.siteName || '', tag.seriesName || ''))
            tagsTabContent.value = $.html()
          }
        }
      }
    })
    
    return
  }

  // 当前资源站点 - 修改此处逻辑
  let currentSite = '';

  if (showTagsTab.value && currentTagInfo.value?.siteName) {
    // 如果是标签页模式，直接使用当前视频信息中保存的站点备注
    currentSite = currentTagInfo.value.siteName;

  } else {
    // 否则使用正常的逻辑
    currentSite = props.sites.filter(s => s.active)[activeTab.value]?.remark || '';

  }
  
  let seriesName = title ? title : (savedKeyword.value || (props.keyword || ''))

  // 如果当前站点是IPTV源，则使用IPTV作为剧集名称
  if (isIPTVSource.value[activeTab.value]) {
    seriesName = 'IPTV';
  }
  
  // 获取追更集数或最新集数
  let currentEpisode = ''

  // 尝试获取现有的标签信息
  const tagInfo = getTagInfo(currentSite, seriesName)
  
  // 优先级1：如果没有找到激活状态的剧集，但有标签保存的值，则使用标签中保存的集数
  if (tagInfo && tagInfo.episodeNumber) {
    currentEpisode = tagInfo.episodeNumber
  }
  
  // 优先级2：如果还是没有找到集数，尝试从搜索结果中获取最新的一集
  if (!currentEpisode && searchResults.value[activeTab.value]) {
    const $ = load(searchResults.value[activeTab.value])
    const $firstEpisode = $('.m3u8-item').first()
    if ($firstEpisode.length) {
      const textElement = $firstEpisode.find('.text-center, [class*="text-center"]').first()
      if (textElement.length) {
        currentEpisode = textElement.text().trim()
      } else {
        currentEpisode = $firstEpisode.text().trim()
      }
    }
  }
  
  // 获取剧集列表页面URL
  let detailPageUrl = ''
  if (isShowingEpisodes.value) {
    // 如果当前正在显示剧集列表，则使用上一次点击的URL
    detailPageUrl = currentVideoInfo.value.detailPageUrl || ''
  }
  
  if (tagInfo) {
    // 如果找到了标签信息，使用保存的值
    seriesName = tagInfo.seriesName || seriesName
    detailPageUrl = tagInfo.detailPageUrl || detailPageUrl
  }
  
  const note = tagInfo?.note || ''
  const isTagged = hasTag(currentSite, seriesName)
  const updateDays = tagInfo?.updateDays || []
  
  // 检查detailUrl的类型，判断是否是html
  const videoType = detectVideoType(detailPageUrl || '')

  const isHtmlType = videoType === 'html' || videoType === 'm3u8str' || videoType === 'jsonApi'
  const isEpisodeNumberEditable = isHtmlType
  
  Swal.fire({
    title: '视频标签',
    html: `
      <div class="text-left space-y-3">
        <div class="mb-2">
          <div class="text-sm font-medium text-gray-500 dark:text-gray-400">剧集名称
          ${!isEpisodeNumberEditable ? '<span class="text-xs text-yellow-500 ml-1">(不可编辑，IPTV源)</span>' : ''}</div>
          <input id="seriesName" class="mt-1 w-full p-2 rounded border border-gray-200 dark:border-gray-700 ${!isEpisodeNumberEditable ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed' : 'bg-white dark:bg-gray-800'} text-gray-900 dark:text-white" value="${seriesName}" ${!isEpisodeNumberEditable ? 'disabled' : ''}>
        </div>
        <div class="mb-2">
          <div class="text-sm font-medium text-gray-500 dark:text-gray-400">
            追更集数
            ${!isEpisodeNumberEditable ? '<span class="text-xs text-yellow-500 ml-1">(不可编辑，IPTV源)</span>' : ''}
          </div>
          <input id="episodeNumber" class="mt-1 w-full p-2 rounded border border-gray-200 dark:border-gray-700 ${!isEpisodeNumberEditable ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed' : 'bg-white dark:bg-gray-800'} text-gray-900 dark:text-white" value="${currentEpisode}" ${!isEpisodeNumberEditable ? 'disabled' : ''}>
        </div>
        <div class="mb-2">
          <div class="text-sm font-medium text-gray-500 dark:text-gray-400">资源站点</div>
          <div class="mt-1 p-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">${currentSite}</div>
        </div>
        <input type="hidden" id="detailPageUrl" value="${detailPageUrl}">
        <div class="mb-2">
          <div class="text-sm font-medium text-gray-500 dark:text-gray-400">更新日期</div>
          <div class="mt-1 flex flex-wrap gap-3">
            ${['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day, index) => `
              <label class="inline-flex items-center">
                <input type="checkbox" 
                  id="updateDay${index}" 
                  class="form-checkbox h-4 w-4 text-blue-500 dark:text-blue-400 border-gray-300 dark:border-gray-600 rounded"
                  ${updateDays.includes(index) ? 'checked' : ''}
                >
                <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">${day}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="mb-2">
          <div class="text-sm font-medium text-gray-500 dark:text-gray-400">标签备注</div>
          <textarea id="tagNote" class="mt-1 w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-h-[50px] max-h-[100px] overflow-y-auto resize-y" rows="3">${note}</textarea>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '保存标签',
    cancelButtonText: isTagged ? '删除标签' : '取消',
    confirmButtonColor: '#3B82F6',
    cancelButtonColor: isTagged ? '#EF4444' : '#6B7280',
    showDenyButton: isTagged,
    denyButtonText: '取消',
    denyButtonColor: '#6B7280',
    background: isDark.value ? '#1F2937' : '#FFFFFF',
    color: isDark.value ? '#FFFFFF' : '#000000',
    showClass: {
      backdrop: 'swal2-noanimation',
      popup: 'swal2-noanimation'
    },
    hideClass: {
      popup: ''
    },
    preConfirm: () => {
      // 在弹窗关闭前获取值
      const popup = Swal.getPopup();
      const seriesNameElement = popup?.querySelector('#seriesName') as HTMLInputElement;
      const episodeNumberElement = popup?.querySelector('#episodeNumber') as HTMLInputElement;
      const detailPageUrlElement = popup?.querySelector('#detailPageUrl') as HTMLInputElement;
      const noteElement = popup?.querySelector('#tagNote') as HTMLTextAreaElement;
      
      const seriesName = seriesNameElement?.value || '';
      const episodeNumber = episodeNumberElement?.value || '';
      const detailPageUrl = detailPageUrlElement?.value || '';
      const note = noteElement?.value || '';
      
      // 获取选中的更新日期
      const updateDays = Array.from({ length: 7 }, (_, i: number) => {
        const checkbox = popup?.querySelector(`#updateDay${i}`) as HTMLInputElement;
        return checkbox?.checked ? i : -1;
      }).filter((i: number) => i !== -1);

      // 返回所有值供 then 回调使用
      return { seriesName, episodeNumber, detailPageUrl, note, updateDays };
    },
    // 使用helper函数设置按钮样式
    ...setupSwalButtonStyles()
  }).then((result) => {
    if (result.isConfirmed) {
      let { seriesName, episodeNumber, detailPageUrl, note, updateDays } = result.value

      if (vodUrl) {
        // json api
        detailPageUrl = vodUrl
      }
      
      // 保存标签
      saveTag(tagInfo?.siteName || currentSite, seriesName, episodeNumber, detailPageUrl, note, updateDays, props.videoPlayer)
      
      // 更新当前标签信息
      if (showTagsTab.value) {
        
        currentTagInfo.value = {
          note,
          seriesName: seriesName,
          episodeNumber,
          siteName: tagInfo?.siteName || '',
          detailPageUrl,
          updateDays,
          timestamp: new Date().toISOString()
        }
      }
      
      // 更新按钮样式（重新渲染）
      if (searchResults.value[activeTab.value]) {
        const $ = load(searchResults.value[activeTab.value])
        const $tagButton = $('button[onclick*="showTagDialog"]')
        if ($tagButton.length) {
          $tagButton.html(getTagButtonContent(tagInfo?.siteName || currentSite, seriesName))
          searchResults.value[activeTab.value] = $.html()
        }
      }
    } else if (result.dismiss === Swal.DismissReason.cancel && isTagged) {
      // 删除标签
      removeTag(tagInfo?.siteName || currentSite, seriesName)
      
      // 如果在标签页中，清空当前标签信息
      if (showTagsTab.value) {
        currentTagInfo.value = null
      }
      
      // 更新按钮样式
      if (searchResults.value[activeTab.value]) {
        const $ = load(searchResults.value[activeTab.value])
        const $tagButton = $('button[onclick*="showTagDialog"]')
        if ($tagButton.length) {
          $tagButton.html(getTagButtonContent(tagInfo?.siteName || currentSite, seriesName))
          searchResults.value[activeTab.value] = $.html()
        }
      }
    }
  })
}

// 获取标签按钮的内容
const getTagButtonContent = (siteName: string = '', seriesName: string = '') => {
  const hasTagged = hasTag(siteName, seriesName)
  return hasTagged
    ? '<span class="mr-1 text-green-500">✓</span>标签'
    : '<span class="mr-1 text-gray-400">?</span>标签'
}

// 执行所有站点的搜索
const performSearch = async () => {
  if (!props.keyword) return
  
  // 设置搜索状态为true
  emit('update:isSearching', true)

  // 获取所有激活站点
  const activeSites = props.sites.filter(s => s.active)
  
  // 过滤出非IPTV源站点
  const nonIptvSites = activeSites.filter(site => !isIPTVSourceUrl(site.url))
  
  // 如果没有非IPTV源站点，则提示用户
  if (nonIptvSites.length === 0) {
    const noSitesMessage = document.createElement('div')
    noSitesMessage.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-white px-4 py-2 rounded shadow z-[9999] flex items-center'
    noSitesMessage.innerHTML = `
      <span>没有可搜索的资源站点，请添加或者启用非IPTV资源站点</span>
    `
    document.body.appendChild(noSitesMessage)
    setTimeout(() => noSitesMessage.remove(), 5000)

    // 重置搜索状态
    emit('update:isSearching', false)
    
    return
  }
  
  // 添加右上角搜索中提示
  const searchingMessage = document.createElement('div')
  searchingMessage.id = 'searching-message'
  searchingMessage.className = 'fixed top-4 right-4 bg-blue-500 text-white px-4 py-2 rounded shadow z-[9999] flex items-center'
  searchingMessage.innerHTML = `
    <div class="mr-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
    <span>正在搜索中...</span>
  `
  document.body.appendChild(searchingMessage)
  
  // 保存搜索关键词
  savedKeyword.value = props.keyword
  
  // 重置所有状态
  hasSearched.value = true
  isLoading.value = {}
  searchResults.value = {}
  
  // 初始化所有激活站点的加载状态
  
  // 记录搜索完成的站点数
  let completedSites = 0
  
  const searchPromises = activeSites.map((site, index) => {
    // 跳过 IPTV 源站点，不参与搜索
    if (isIPTVSource.value[index]) {
      completedSites++
      return Promise.resolve()
    }
    
    // 为每个标签页保存原始搜索关键词
    tabOriginalKeywords.value[index] = props.keyword
    
    isLoading.value[index] = true
    return new Promise<void>(async (resolve) => {
      await searchSite(site, index)
      completedSites++
      
      // 如果所有站点都已搜索完成，移除提示
      if (completedSites === activeSites.length) {
        const message = document.getElementById('searching-message')
        if (message) {
          message.remove()
          // 显示搜索完成提示
          const completeMessage = document.createElement('div')
          completeMessage.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow z-[9999]'
          completeMessage.textContent = '搜索完成'
          document.body.appendChild(completeMessage)
          setTimeout(() => completeMessage.remove(), 2000)
        }
      }
      resolve()
    })
  })
  
  try {
    // 等待所有搜索完成
    await Promise.all(searchPromises)
  } finally {
    // 搜索完成后，重置搜索状态
    emit('update:isSearching', false)
  }
}

// 执行单个站点的搜索
const searchSite = async (site: ResourceSite, index: number) => {
  if (!site.active) return

  try {
    isLoading.value[index] = true

    // 如果searchResultClass为空，并且不是 IPTV 源链接，则是json api
    if (!site.searchResultClass && !isIPTVSourceUrl(site.url)) {
      
      // 显示加载动画
      searchResults.value[index] = `
        <div class="flex flex-col items-center justify-center py-8 space-y-4">
          <div class="w-8 h-8 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin"></div>
          <div class="text-primary-light dark:text-primary-dark">进行中...</div>
        </div>
      `
      
      // 等待DOM更新后再调用searchJsonApi
      await nextTick()
      
      searchJsonApi(site, index)

      return
    }
    
    // 构建搜索URL
    const searchUrl = site.url.includes('?') ? `${site.url}${savedKeyword.value}` : (site.isPost ? site.url : `${site.url}${savedKeyword.value}`)

    // 准备请求参数
    const requestData = {
      url: searchUrl,
      searchResultClass: site.searchResultClass,
      isPost: site.isPost,
      postData: site.postData ? JSON.parse(site.postData.replace('{search_value}', savedKeyword.value)) : undefined
    }

    // 打印FormData格式的请求数据
    if (site.isPost && requestData.postData) {
      const formData = new FormData()
      Object.entries(requestData.postData).forEach(([key, value]) => {
        formData.append(key, String(value))
      })
    }

    // 根据环境选择正确的 API 端点
    // 本地开发环境使用 /api/search, Cloudflare/Vercel 环境使用 /functions/api/search
    const apiEndpoint = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || vpsEndpointFlag 
      ? '/api/search' 
      : '/functions/api/search'

    // 发送请求
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData)
    })

    if (!response.ok) {
      // 如果状态码是429（Too Many Requests），尝试使用代理搜索
      if (response.status === 429 && !requestData.isPost) {
        console.warn('遇到请求限制(429)，尝试使用代理搜索...')
        searchResults.value[index] = `
          <div class="flex flex-col items-center justify-center py-8 space-y-4">
            <div class="w-8 h-8 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin"></div>
            <div class="text-primary-light dark:text-primary-dark">
              代理搜索进行中...
            </div>
          </div>
        `
        return tryProxySearch(searchUrl, site, index)
      }
      
      const errorText = await response.text()
      console.error('请求失败:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      })
      throw new Error(`搜索失败: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const html = await response.text()
    if (!html.trim()) {
      console.warn('返回的内容为空')
      throw new Error('返回的内容为空')
    }

    // 解析内容
    const $ = load(html)

    // 处理搜索结果
    await processResults($, searchUrl, site, index)

  } catch (error: any) {
    console.error(`搜索失败 (${site.remark}):`, error)
    
    searchResults.value[index] = `
      <div class="error-message p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-100 dark:border-red-900/30">
        <p class="font-medium">搜索 "${savedKeyword.value}" 出错:</p>
        <p class="mt-1">${error.message}</p>
        <p class="mt-2 text-sm">${error.message.includes('429') ? '请求太频繁，请稍后再重试' : '请检查网络连接或稍后重试'}</p>
        <button 
          class="mt-3 px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 transition-colors shadow-sm"
          onclick="document.dispatchEvent(new CustomEvent('retrySearch', {detail: ${index}}))"
        >
          重试
        </button>
      </div>
    `

  } finally {
    isLoading.value[index] = false
  }
}

// 处理搜索结果的函数
const processResults = async ($: CheerioAPI, searchUrl: string, site: ResourceSite, index: number) => {

  let resultHtml = '<div class="search-results space-y-2">'
  resultHtml += `
    <div class="flex justify-between items-center">
      <div class="mb-2 text-sm text-gray-500 dark:text-gray-400 text-center w-full">
        搜索 "${savedKeyword.value}" 的结果
      </div>
    </div>
  `
  let linkCount = 0

  if (site.searchResultClass) {

    const $results = $(`.${site.searchResultClass}`)

    if ($results.length > 0) {
      const $container = $results.first()

      const $items = $container.children().filter((_, li) => {
        const $li = $(li)
        const isPagination = 
          $li.closest('.mac_pages, .page_tip, .page_info, .pages').length > 0 ||
          /^[0-9]+$/.test($li.text().trim()) ||
          /^(首页|尾页|上一页|下一页|跳页|跳转)/.test($li.text().trim()) ||
          $li.find('.page_link, .page_current, .page_input, .page_btn, .mac_page_go').length > 0 ||
          !$li.find('a').length ||
          $li.find('a').text().trim().match(/^([0-9]+|首页|尾页|上一页|下一页|跳页|跳转)$/)
        return !isPagination
      })


      // 如果找到了匹配元素但没有有效列表项，尝试使用代理服务
      if ($items.length === 0) {
        searchResults.value[index] = `
          <div class="flex flex-col items-center justify-center py-8 space-y-4">
            <div class="w-8 h-8 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin"></div>
            <div class="text-primary-light dark:text-primary-dark">
              代理搜索进行中...
            </div>
          </div>
        `
        return tryProxySearch(searchUrl, site, index)
      }

      $items.each((_, item) => {
        const $item = $(item)
        const $link = $item.find('a').first()
        const $type = $item.find('.type').first()
        const $time = $item.find('.time').first()
        
        if ($link.length) {
          const href = $link.attr('href')
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            linkCount++
            try {
              const absoluteUrl = new URL(href, searchUrl).href
              const title = $link.text().trim()
              const type = $type.text().trim()
              const time = $time.text().trim()

              // 健康过滤
              let healthFilterFlag = false;
              if (props.enableHealthFilter) {
                if (type) {
                  healthFilterFlag = ['伦理片', '色情片', '同性片', '福利视频', '福利片', '福利姬', '福利', '里番', '里番动漫', '门事件', '萝莉', '萝莉少女', '少女萝莉', '制服诱惑', '国产传媒', 'cosplay', '黑丝诱惑', '中文字幕', '自拍偷拍', '偷拍自拍', '无码影片', '无码', '无码专区', '日本无码', '有码', '日本有码', '素人', '网络主播'].includes(type);
                } else if (title) {
                  healthFilterFlag = title.includes('伦理片') || title.includes('色情片') || title.includes('同性片') || title.includes('福利视频') || title.includes('福利片') || title.includes('福利姬') || title.includes('里番动漫') || title.includes('门事件') || title.includes('自拍偷拍') || title.includes('偷拍自拍') || title.includes('国产传媒') || title.includes('日本无码') || title.includes('日本有码');
                }
              }

              if (healthFilterFlag) {
                linkCount--
              } else {
                resultHtml += `
                  <div class="result-item">
                    <div class="block p-4 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer shadow-sm dark:shadow-gray-900/10"
                        data-url="${absoluteUrl}" data-title="${title}"
                    >
                      <div class="flex flex-col gap-2">
                        <div class="text-lg font-medium text-gray-900 dark:text-gray-100">${title}</div>
                        ${type ? `<div class="text-sm text-gray-500 dark:text-gray-400">${type}</div>` : ''}
                        ${time ? `<div class="text-sm text-gray-400 dark:text-gray-500">${time}</div>` : ''}
                      </div>
                    </div>
                  </div>
                `
              }
            } catch (e) {
              console.warn('URL转换失败:', e)
            }
          }
        }
      })
    } else {
      console.warn('未找到匹配的搜索结果容器')
      searchResults.value[index] = `
        <div class="flex flex-col items-center justify-center py-8 space-y-4">
          <div class="w-8 h-8 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin"></div>
          <div class="text-primary-light dark:text-primary-dark">
            代理搜索进行中...
          </div>
        </div>
      `
      return tryProxySearch(searchUrl, site, index)
    }
  } else {
    console.warn('未指定搜索结果类名')
    searchResults.value[index] = `
      <div class="flex flex-col items-center justify-center py-8 space-y-4">
        <div class="w-8 h-8 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin"></div>
        <div class="text-primary-light dark:text-primary-dark">
          代理搜索进行中...
        </div>
      </div>
    `
    return tryProxySearch(searchUrl, site, index)
  }

  if (linkCount === 0) {
    searchResults.value[index] = `
      <div class="flex flex-col items-center justify-center py-8 space-y-4">
        <div class="w-8 h-8 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin"></div>
        <div class="text-primary-light dark:text-primary-dark">
          代理搜索进行中...
        </div>
      </div>
    `
    return tryProxySearch(searchUrl, site, index)
  }

  resultHtml += '</div>'
  searchResults.value[index] = resultHtml

  return true
}

const applyJsonApi = async (siteName: string, seriesName: string, jsonApiUrl: string, key: string, tagEpisodeNumber: string) => {
  try {
     // 根据环境选择正确的 API 端点
    // 本地开发环境使用 /api/search-json, Cloudflare/Vercel 环境使用 /functions/api/search-json
    const apiEndpoint = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || vpsEndpointFlag 
      ? '/api/search-json' 
      : '/functions/api/search-json'

        // 发送请求
        const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({url: jsonApiUrl})
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error('JSON API搜索失败:' + response.statusText)
    }

    if (!data || !data.list || !Array.isArray(data.list)) {
      throw new Error('JSON API搜索结果格式错误')
    }

    // 健康过滤
    if (props.enableHealthFilter) {
      data.list = data.list.filter((item: any) => {
        return !['伦理片', '色情片', '同性片', '福利视频', '福利片', '福利姬', '福利', '里番', '里番动漫', '门事件', '萝莉', '萝莉少女', '少女萝莉', '制服诱惑', '国产传媒', 'cosplay', '黑丝诱惑', '中文字幕', '自拍偷拍', '偷拍自拍', '无码影片', '无码', '无码专区', '日本无码', '有码', '日本有码', '素人', '网络主播'].includes(item.type_name)
      })
    }

    // 处理json api搜索结果
    // 生成剧集列表HTML
    let resultHtml = `
          <div class="space-y-4">
            <div class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2 text-center">
              ${seriesName || '未知剧集'}
            </div>
            <div class="flex justify-between items-center">
              <div class="text-sm text-gray-500 dark:text-gray-400" id="tag_site_name">${siteName || '未知站点'}</div>
              <div class="flex items-center gap-2">
                <button 
                  class="px-4 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium"
                  onclick="document.dispatchEvent(new CustomEvent('showTagDialog', {detail: {pageUrl: '${jsonApiUrl}', title: '${seriesName}'}}))"
                >
                  ${getTagButtonContent(siteName, seriesName)}
                </button>
                <button 
                  class="px-4 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium"
                  onclick="document.dispatchEvent(new CustomEvent('toggleSort'))"
                >
                  ${isReversedArr.value[siteName] ? '切换为正序' : '切换为倒序'}
                  <span class="ml-1 opacity-60">${isReversedArr.value[siteName] ? '↑' : '↓'}</span>
                </button>
              </div>
            </div>
            <div class="m3u8-results flex flex-wrap gap-3">
        `

    const theVodPlayUrl = data.list[0].vod_play_url
    let playUrls = theVodPlayUrl.split('$$$')
    if (theVodPlayUrl.includes('.m3u8')) {
      playUrls = playUrls.filter((vodPlayUrl: string) => {
        return vodPlayUrl.includes('.m3u8')
      })
    }

    let links = playUrls[0].split('#').map((item: string) => {
      const itemArr = item.split('$')
      return {
        the_title: itemArr[0],
        the_url: itemArr[1]
      }
    })
    
    // 检查第一个链接的标题格式来决定宽度类
    let minWidthClass = ''
    const firstLink = links[0]
    if (firstLink) {

      const firstTitle = firstLink.the_title
      
      // 判断是否是"第x集"格式
      if (/^第\d+集$/.test(firstTitle)) {
        minWidthClass = 'min-w-[93px]' // 足够容纳"第xxx集"
      } else {
        minWidthClass = 'min-w-[67px]' // 足够容纳"xxx"
      }
    }

    links.reverse()

    isReversedArr.value['tag_' + siteName] = true

    const jsonApiUrlArr = jsonApiUrl.split('?ac=detail&ids=')

    // 生成HTML
    links.forEach(({ the_title, the_url }) => {
      // 检查当前URL是否与当前激活的剧集URL匹配
      const isCurrentVideo = the_title === tagEpisodeNumber
      
      resultHtml += `
        <div class="m3u8-item group relative ${minWidthClass} bg-white dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm hover:shadow-md dark:shadow-gray-900/10 border border-gray-100 dark:border-gray-700 ${isCurrentVideo ? 'ring-2 ring-primary-light dark:ring-primary-dark active' : ''}"
             data-url="${the_url}"
             data-vod-id="${jsonApiUrlArr[1]}"
             data-vod-url="${jsonApiUrl}"
        >
          <div class="px-3 py-3 text-sm font-medium ${isCurrentVideo ? 'text-primary-light dark:text-primary-dark' : 'text-gray-700 dark:text-gray-200'} text-center group-hover:text-primary-light dark:group-hover:text-primary-dark line-clamp-2 break-words" title="${the_title}">
            ${the_title}
          </div>
          <div class="absolute inset-0 rounded ring-1 ring-inset ring-gray-200 dark:ring-gray-700 group-hover:ring-primary-light/20 dark:group-hover:ring-primary-dark/20"></div>
          <div class="absolute inset-0 rounded bg-primary-light dark:bg-primary-dark ${isCurrentVideo ? 'opacity-10' : 'opacity-0'} group-hover:opacity-10 transition-opacity duration-200 bg-active"></div>
          <div class="absolute inset-0 rounded ring-2 ring-primary-light dark:ring-primary-dark ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ${isCurrentVideo ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 transition-opacity duration-200 ring-active"></div>
        </div>
      `
    })
    
    resultHtml += '</div></div>'
    
    if (links.length === 0) {
      console.warn('未找到可播放的剧集')
      resultHtml = `
        <div class="no-results p-4 text-center text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded">
          未找到可播放的剧集
          <div class="mt-2 text-sm">页面内容片段：</div>
          <div class="mt-2 text-xs text-left bg-white dark:bg-gray-800 p-4 rounded overflow-auto max-h-40 border border-gray-100 dark:border-gray-700">
            ${$('body').html()?.substring(0, 500) || '无法获取页面内容'}
          </div>
        </div>
      `
    }
    
    // 设置标签页内容
    tagsTabContent.value = resultHtml

    // 添加提示
    const message = document.createElement('div')
    message.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow'
    message.textContent = '已应用标签'
    document.body.appendChild(message)
    setTimeout(() => message.remove(), 2000)

  } catch (e) {
    console.error('应用标签失败:', e)
    
    // 显示错误提示在标签页中
    tagsTabContent.value = `
      <div class="error-message p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-100 dark:border-red-900/30">
        <p class="font-medium">应用标签失败:</p>
        <p class="mt-1">${e instanceof Error ? e.message : '未知错误'}</p>
        <p class="mt-2 text-sm">请检查网络连接或稍后重试</p>
        <button 
          class="mt-3 px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 transition-colors shadow-sm"
          onclick="document.dispatchEvent(new CustomEvent('retryApplyTag', {detail: '${key}'}))"
        >
          重试
        </button>
      </div>
    `
  }
}

const searchJsonApi = async (site: ResourceSite, index: number) => {
  try {

    let theUrl = ''
    let theReqBaseUrl = ''
    // json api 搜索参数固定为 ?ac=videolist&wd=
    if (site.url.endsWith('?ac=videolist&wd=')) {
      theUrl = site.url + savedKeyword.value
      theReqBaseUrl = site.url
    } else if (site.url.endsWith('?ac=list')) {
      theUrl = site.url.replace('?ac=list', '?ac=videolist&wd=' + savedKeyword.value)
      theReqBaseUrl = site.url.replace('?ac=list', '?ac=videolist&wd=')
    } else if (site.url.endsWith('?ac=list&wd=')) {
      theUrl = site.url.replace('?ac=list&wd=', '?ac=videolist&wd=' + savedKeyword.value)
      theReqBaseUrl = site.url.replace('?ac=list&wd=', '?ac=videolist&wd=')
    } else {
      theUrl = site.url + '?ac=videolist&wd=' + savedKeyword.value
      theReqBaseUrl = site.url + '?ac=videolist&wd='
    }

    // 准备请求参数
    const requestData = {
      url: theUrl,
      isPost: site.isPost,
      postData: site.postData ? JSON.parse(site.postData.replace('{search_value}', savedKeyword.value)) : undefined
    }

    // 打印FormData格式的请求数据
    if (site.isPost && requestData.postData) {
      const formData = new FormData()
      Object.entries(requestData.postData).forEach(([key, value]) => {
        formData.append(key, String(value))
      })
    }

    // 根据环境选择正确的 API 端点
    // 本地开发环境使用 /api/search-json, Cloudflare/Vercel 环境使用 /functions/api/search-json
    const apiEndpoint = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || vpsEndpointFlag 
      ? '/api/search-json' 
      : '/functions/api/search-json'

    // 发送请求
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData)
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error('JSON API搜索失败:' + response.statusText)
    }

    if (!data || !data.list || !Array.isArray(data.list)) {
      throw new Error('JSON API搜索结果格式错误')
    }

    // 健康过滤
    if (props.enableHealthFilter) {
      data.list = data.list.filter((item: any) => {
        return !['伦理片', '色情片', '同性片', '福利视频', '福利片', '福利姬', '福利', '里番', '里番动漫', '门事件', '萝莉', '萝莉少女', '少女萝莉', '制服诱惑', '国产传媒', 'cosplay', '黑丝诱惑', '中文字幕', '自拍偷拍', '偷拍自拍', '无码影片', '无码', '无码专区', '日本无码', '有码', '日本有码', '素人', '网络主播'].includes(item.type_name)
      })
    }
    
    // 处理json api搜索结果
    await processJsonApiResults(data.list, index, theReqBaseUrl)

  } catch (error) {
    console.error('JSON API搜索失败:', error)
    searchResults.value[index] = `
      <div class="error-message p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-100 dark:border-red-900/30">
        <p class="font-medium">JSON API搜索 "${savedKeyword.value}" 失败:</p>
        <p class="mt-1">${error instanceof Error ? error.message : '未知错误'}</p>
        <p class="mt-2 text-sm">请检查网络连接或稍后重试</p>
        <button 
          class="mt-3 px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 transition-colors shadow-sm"
          onclick="document.dispatchEvent(new CustomEvent('retrySearch', {detail: ${index}}))"
        >
          重试
        </button>
      </div>
    `
  } finally {
    // 确保在完成时设置加载状态为false
    isLoading.value[index] = false
  }
}

const processJsonApiResults = async (data: any, index: number, reqBaseUrl: string) => {

  let resultHtml = '<div class="search-results space-y-4">'

  // 添加搜索结果标题
  resultHtml += `
    <div class="flex justify-between items-center">
      <div class="mb-3 text-sm text-gray-500 dark:text-gray-400 text-center w-full">
        搜索 "${savedKeyword.value}" 的结果
      </div>
    </div>
    <div class="grid grid-cols-2 sm:flex sm:flex-wrap sm:gap-4 sm:justify-start gap-4 min-[1024px]:justify-start" style="--min-card-width: 160px;">
  `

  // 处理每个视频项
  data.forEach((item: any) => {
    // 处理播放地址
    const vodPlayUrlArr = item.vod_play_url.split('$$$')
    let playUrls = vodPlayUrlArr
    if (item.vod_play_url.includes('.m3u8')) {
      playUrls = vodPlayUrlArr.filter((vodPlayUrl: string) => {
        return vodPlayUrl.includes('.m3u8')
      })
    }

    // 生成卡片 HTML - 使用更小的固定宽度
    resultHtml += `
      <div class="result-item group ${isMobile ? 'w-[42vw]' : 'w-[10vw]'} flex-shrink-0 sm:flex-grow-0"
      >
        <div class="block bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg cursor-pointer shadow-sm hover:shadow-md dark:shadow-gray-900/10 border border-gray-100 dark:border-gray-700 transition-all duration-200 w-full h-[320px]"
             data-url="${playUrls[0]}"
             data-vod-id="${item.vod_id}"
             data-type="json"
             data-title="${item.vod_name}"
             data-vod-url="${reqBaseUrl}"
        >
          <div class="flex flex-col h-full">
            <!-- 封面图片容器 -->
            <div class="relative w-full h-[200px] flex-shrink-0 overflow-hidden rounded-t-lg">
              <img 
                src="${item.vod_pic || (item.vod_pic_thumb || (item.vod_pic_slide || ''))}" 
                alt="${item.vod_name}"
                class="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500"
                onerror="this.onerror=null; this.src='' "
              >
            </div>
            
            <!-- 信息容器 -->
            <div class="flex-1 p-2 flex flex-col items-center justify-between" title="${item.vod_content}">
              <!-- 标题 - 添加完整title提示 -->
              <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100 truncate text-center w-full mb-1"
                  title="${item.vod_name}"
              >
                ${item.vod_name}
              </h3>
              
              <!-- 类型和年份 -->
              <div class="text-xs text-gray-500 dark:text-gray-400 mb-1 text-center w-full truncate">
                ${item.type_name || ''} ${item.vod_year ? `· ${item.vod_year}` : ''}
              </div>

              <!-- 更新时间 -->
              <div class="text-xs text-gray-500 dark:text-gray-400 mb-1 text-center w-full">
                ${item.vod_time || ''}
              </div>
              
              <!-- 更新状态 -->
              <div class="text-xs text-primary-light dark:text-primary-dark font-medium text-center w-full truncate">
                ${item.vod_remarks || '完结'}
              </div>
            </div>
          </div>
        </div>
      </div>
    `
  })

  resultHtml += '</div></div>'

  searchResults.value[index] = resultHtml
}

// 修改代理搜索函数
const tryProxySearch = async (originalUrl: string, site: ResourceSite, index: number) => {
  try {
    // 设置代理搜索状态
    isLoading.value[index] = true
    isProxySearching.value[index] = true
    await nextTick()
    
    const proxyUrl = `https://r.jina.ai/${originalUrl}`

    const response = await fetch(proxyUrl, {
      headers: {
        'Accept': 'text/event-stream',
        'X-No-Cache': 'true',
        'X-Timeout': '5'
      }
    })

    if (!response.ok) {
      throw new Error(`代理请求失败: ${response.status}`)
    }

    const text = await response.text()
    
    // 解析 markdown 格式的响应
    const markdownLinkPattern = /\[(.*?)\]\((.*?)\)/g
    let match
    let matches = new Map<string, { title: string, url: string }>()
    
    // 先收集所有匹配项，使用 Map 进行去重
    while ((match = markdownLinkPattern.exec(text)) !== null) {
      const [_, title, url] = match
      if (title && url && (title.includes('更新') || url.includes('detail')) && title !== '点击进入' && !title.includes('豆瓣')) {
        // 使用标题作为键来去重
        const key = title.trim()
        if (!matches.has(key)) {
          matches.set(key, { title: title.trim(), url })
        }
      }
    }

    // 如果没有找到链接，设置空结果
    if (matches.size === 0) {
      searchResults.value[index] = '<div class="no-results">未找到有效链接</div>'
      return false
    }

    // 转换为数组并排序
    const uniqueMatches = Array.from(matches.values())
    uniqueMatches.sort((a, b) => a.title.localeCompare(b.title))

    // 生成结果HTML
    let resultHtml = '<div class="search-results space-y-2">'

    resultHtml += `
    <div class="flex justify-between items-center">
      <div class="mb-2 text-sm text-gray-500 dark:text-gray-400 text-center w-full">
        搜索 "${savedKeyword.value}" 的结果
      </div>
    </div>
  `
    
    // 生成HTML
    for (const { title, url } of uniqueMatches) {
      try {
        const absoluteUrl = new URL(url, originalUrl).href
        resultHtml += `
          <div class="result-item">
            <div class="block p-4 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer shadow-sm dark:shadow-gray-900/10"
                 data-url="${absoluteUrl}"
            >
              <div class="flex flex-col gap-2">
                <div class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2 text-center">
                  ${title}
                </div>
              </div>
            </div>
          </div>
        `
      } catch (e) {
        console.warn('URL转换失败:', e)
      }
    }

    resultHtml += '</div>'
    
    // 设置搜索结果
    searchResults.value[index] = resultHtml
    
    return true

  } catch (error) {
    console.error('代理搜索失败:', error)
    searchResults.value[index] = `
      <div class="error-message p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-100 dark:border-red-900/30">
        <p class="font-medium">代理搜索 "${savedKeyword.value}" 失败:</p>
        <p class="mt-1">${error instanceof Error ? error.message : '未知错误'}</p>
        <p class="mt-2 text-sm">请检查网络连接或稍后重试</p>
        <button 
          class="mt-3 px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 transition-colors shadow-sm"
          onclick="document.dispatchEvent(new CustomEvent('retrySearch', {detail: ${index}}))"
        >
          重试
        </button>
      </div>
    `

    return false
  } finally {
    isLoading.value[index] = false
    isProxySearching.value[index] = false
  }
}

// 处理点击事件获取m3u8链接
const handleResultClick = async (url: string, title?: string, type?: string, vodId?: string, vodUrl?: string) => {

  try {
    isLoading.value[activeTab.value] = true
    
    // 保存当前的搜索结果到对应的tab
    previousResults.value[activeTab.value] = searchResults.value[activeTab.value]
    isShowingEpisodes.value = true
    // 记录当前tab的剧集列表显示状态
    tabEpisodesState.value[activeTab.value] = true

    // 保存剧集列表页面URL
    currentVideoInfo.value.detailPageUrl = url
    
    // 如果提供了剧集名称，使用它
    if (title) {

      title = title
        // 移除方括号及其内容
        .replace(/[\[【].*?[\]】]/g, '')
        // 移除更新状态相关文字
        .replace(/更新至.*$/, '')
        .replace(/已完结.*$/, '')
        .replace(/全\d+集.*$/, '')
        .replace(/\d+集全.*$/, '')
        // 移除第x集及其后内容
        .replace(/第.*集.*$/, '')
        // 移除末尾可能的空格、标点等
        .trim()

      savedKeyword.value = title
    }

    let links: { the_title: string; the_url: string }[] = []
    if (type === 'json') {
      // 直接解析url来得到links
      links = url.split('#').map(item => {
        const itemArr = item.split('$')
        return {
          the_title: itemArr[0],
          the_url: itemArr[1]
        }
      })
    } else {
      // 根据环境选择正确的 API 端点
      const apiEndpoint = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || vpsEndpointFlag 
        ? '/api/search' 
        : '/functions/api/search'
      
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url })
      })

      if (!response.ok) {
        console.error('请求失败:', response.status)
        throw new Error(`请求失败: ${response.status}`)
      }

      const html = await response.text()
      
      const $ = load(html)
      
      // 查找m3u8链接
      const playLinks = $('span, a').filter(function(this: any) {
        const $el = $(this)
        const text = $el.text().trim()
        return text.toLowerCase().includes('.m3u8')
      })

      // 使用 Map 来存储链接，以 URL 为键，确保去重
      const linksMap = new Map<string, { the_title: string; the_url: string }>()
      
      // 收集所有链接
      let autoNumberIndex = 1
      playLinks.each((_, link) => {
        const $link = $(link)
        const text = $link.text().trim()
        
        // 处理包含$分隔符的情况
        const parts = text.split('$')
        if (parts.length >= 2) {
          const videoTitle = parts[0].trim()
          const videoUrl = parts[1].trim()
          
          if (videoUrl.toLowerCase().includes('.m3u8')) {
            // 如果标题为空，使用自动编号，否则使用原标题
            const finalTitle = !videoTitle ? String(autoNumberIndex++) : videoTitle
            // 使用 URL 作为键来去重
            if (!linksMap.has(videoUrl)) {
              linksMap.set(videoUrl, { the_title: finalTitle, the_url: videoUrl })
            }
          }
        }
      }) 
    
      // 转换为数组
      links = Array.from(linksMap.values())
    }

    // 检查第一个链接的标题格式来决定宽度类
    let minWidthClass = ''
    const firstLink = links[0]
    if (firstLink) {

      const firstTitle = firstLink.the_title
      
      // 判断是否是"第x集"格式
      if (/^第\d+集$/.test(firstTitle)) {
        minWidthClass = 'min-w-[6.5vw]' // 足够容纳"第xxx集"
      } else {
        minWidthClass = 'min-w-[4.5vw]' // 足够容纳"xxx"
      }
    }

    links.reverse()

    if (vodUrl && vodId) {
      vodUrl = vodUrl.replace('?ac=videolist&wd=', '?ac=detail&ids=' + vodId)
    }

    const siteRemark = props.sites.filter(s => s.active)[activeTab.value]?.remark || ''

    isReversedArr.value[siteRemark] = true

    // 创建结果容器
    let resultHtml = `
      <div class="space-y-4" data-search-keyword="${savedKeyword.value}">
        <div class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2 text-center">${title}</div>
        <div class="flex justify-between items-center">
          <button 
            class="px-4 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium flex items-center gap-1"
            onclick="document.dispatchEvent(new CustomEvent('goBack'))"
          >
            <span class="opacity-60">←</span>
            返回
          </button>
          <button 
            class="px-4 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium"
            onclick="document.dispatchEvent(new CustomEvent('showTagDialog', {detail: {pageUrl: '${vodUrl}', title: '${title}'}}))"
          >
            ${getTagButtonContent(siteRemark, savedKeyword.value)}
          </button>
          <button 
            class="px-4 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium"
            onclick="document.dispatchEvent(new CustomEvent('toggleSort'))"
          >
            ${isReversedArr.value[siteRemark] ? '切换为正序' : '切换为倒序'}
            <span class="ml-1 opacity-60">${isReversedArr.value[siteRemark] ? '↑' : '↓'}</span>
          </button>
        </div>
        <div class="m3u8-results flex flex-wrap gap-3">
    `

    // 生成HTML
    links.forEach(({ the_title, the_url }) => {
      // 检查当前URL是否与当前激活的剧集URL匹配
      const isCurrentVideo = the_url === activeEpisodeUrls.value[siteRemark]
      
      resultHtml += `
        <div class="m3u8-item group relative ${minWidthClass} bg-white dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm hover:shadow-md dark:shadow-gray-900/10 border border-gray-100 dark:border-gray-700 ${isCurrentVideo ? 'ring-2 ring-primary-light dark:ring-primary-dark active' : ''}"
             data-url="${the_url}"
             data-vod-id="${vodId}"
             data-vod-url="${vodUrl}"
        >
          <div class="px-3 py-3 text-sm font-medium ${isCurrentVideo ? 'text-primary-light dark:text-primary-dark' : 'text-gray-700 dark:text-gray-200'} text-center group-hover:text-primary-light dark:group-hover:text-primary-dark line-clamp-2 break-words" title="${the_title}">
            ${the_title}
          </div>
          <div class="absolute inset-0 rounded ring-1 ring-inset ring-gray-200 dark:ring-gray-700 group-hover:ring-primary-light/20 dark:group-hover:ring-primary-dark/20"></div>
          <div class="absolute inset-0 rounded bg-primary-light dark:bg-primary-dark ${isCurrentVideo ? 'opacity-10' : 'opacity-0'} group-hover:opacity-10 transition-opacity duration-200 bg-active"></div>
          <div class="absolute inset-0 rounded ring-2 ring-primary-light dark:ring-primary-dark ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ${isCurrentVideo ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 transition-opacity duration-200 ring-active"></div>
        </div>
      `
    })
    
    resultHtml += '</div></div>'
    
    if (links.length === 0) {
      console.warn('未找到可播放的剧集')
      resultHtml = `
        <div class="no-results p-4 text-center text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded">
          未找到可播放的剧集
          <div class="mt-2 text-sm">页面内容片段：</div>
          <div class="mt-2 text-xs text-left bg-white dark:bg-gray-800 p-4 rounded overflow-auto max-h-40 border border-gray-100 dark:border-gray-700">
            ${$('body').html()?.substring(0, 500) || '无法获取页面内容'}
          </div>
        </div>
      `
    }
    
    searchResults.value[activeTab.value] = resultHtml

  } catch (error) {
    console.error('获取剧集链接失败:', error)
    searchResults.value[activeTab.value] = `
      <div class="error-message p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-100 dark:border-red-900/30">
        <p class="font-medium">获取剧集链接失败:</p>
        <p class="mt-1">${error instanceof Error ? error.message : '未知错误'}</p>
        <p class="mt-2 text-sm">请检查网络连接或稍后重试</p>
        <div class="mt-3 flex justify-center items-center">
          <button 
            class="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors shadow-sm"
            onclick="document.dispatchEvent(new CustomEvent('goBack'))"
          >
            返回
          </button>
        </div>
      </div>
    `

  } finally {
    isLoading.value[activeTab.value] = false
  }
}

// 修改事件委托处理函数
const handleContainerClick = (event: MouseEvent) => {
  // 如果右键菜单是可见的，先关闭它
  if (contextMenu.value.visible) {
    closeContextMenu()
    return
  }
  
  const target = event.target as HTMLElement
  const clickedItem = target.closest('[data-url]')

  if (clickedItem) {
    let url = clickedItem.getAttribute('data-url')
    let siteRemark = '';
    if (url) {

      const type = clickedItem.getAttribute('data-type') || '' // 如果data-type为json，则是json api搜索结果的剧集
      const vodId = clickedItem.getAttribute('data-vod-id') || ''

      // 检查是否是m3u8链接，兼容需要解析的剧集链接
      if ((url.toLowerCase().includes('.m3u8') || isIPTVSource.value[activeTab.value] || 
        url.includes('.qq.com') || 
        url.includes('.iqiyi.com') || 
        url.includes('.iq.com') || 
        url.includes('.youku.com') || 
        url.includes('.tudou.com') || 
        url.includes('.bilibili.com') || 
        url.includes('.mgtv.com') || 
        url.includes('.sohu.com') || 
        url.includes('.pptv.com') || 
        url.includes('.le.com') || 
        url.includes('.1905.com') || 
        url.includes('.acfun.com')) && type !== 'json') {
        
        // 保存当前视频信息用于标签功能
        const title = clickedItem.querySelector('.text-center, .text-primary-light, .text-primary-dark, [class*="text-primary"], [class*="text-center"]')?.textContent?.trim() || ''

        // 在标签页模式下保留原有的站点信息
        if (showTagsTab.value && currentTagInfo.value?.siteName) {
          // 如果在标签页模式，保留原有的站点备注
          siteRemark = currentTagInfo.value.siteName;
        } else {
          // 否则使用正常的逻辑
          siteRemark = props.sites.filter(s => s.active)[activeTab.value]?.remark || '';
        }

        currentVideoInfo.value = {
          title: title,
          episode: title,
          url: url,
          siteRemark: siteRemark,
          detailPageUrl: currentVideoInfo.value.detailPageUrl || url,
          adFilter: (() => {
            // 获取当前资源站点的最新 adFilter
            const currentSite = props.sites.find(site => site.remark === siteRemark)
            return currentSite ? currentSite.adFilter : {
              status: true,
              item: 'default_del_ad_tag_to_filter',
              regularExpression: ''
            }
          })()
        }

        const theSiteName = showTagsTab.value ? 'tag_' + siteRemark : siteRemark
        // 更新激活的剧集 URL
        activeEpisodeUrls.value[theSiteName] = url
        
        // 获取当前标签页中的所有剧集按钮
        let m3u8Items: NodeListOf<Element>;
        if (showTagsTab.value) {
          // 如果在标签页中，只选择标签页中的剧集按钮
          m3u8Items = document.querySelectorAll('.search-results-container .m3u8-item');
        } else {
          // 如果在搜索结果页中，只选择当前活动标签页中的剧集按钮
          const activeTabContainer = document.querySelector(`.search-results-container[data-tab-index="${activeTab.value}"]`);
          if (activeTabContainer) {
            m3u8Items = activeTabContainer.querySelectorAll('.m3u8-item');
          } else {
            m3u8Items = document.querySelectorAll('.search-results-container .m3u8-item');
          }
        }
        
        // 移除所有剧集的active类和激活状态样式
        m3u8Items.forEach(item => {
          // 移除active类
          item.classList.remove('active')
          
          // 移除ring-2和ring-primary相关类（蓝色边框）
          item.classList.remove('ring-2', 'ring-primary-light', 'ring-primary-dark')
          
          // 移除活动状态的样式
          const rings = item.querySelectorAll('.ring-active')
          rings.forEach(ring => {
            ring.classList.remove('opacity-100')
            ring.classList.add('opacity-0')
          })
          
          const bg = item.querySelector('.bg-active')
          if (bg) {
            bg.classList.remove('opacity-10')
            bg.classList.add('opacity-0')
          }
          
          // 恢复文本颜色
          const textElement = item.querySelector('.text-primary-light, .text-primary-dark')
          if (textElement) {
            textElement.classList.remove('text-primary-light', 'text-primary-dark')
            textElement.classList.add('text-gray-700', 'dark:text-gray-200')
          }
        })
        
        // 为当前点击的项目添加active类和样式
        clickedItem.classList.add('active')
        
        // 添加蓝色边框
        clickedItem.classList.add('ring-2', 'ring-primary-light', 'dark:ring-primary-dark')
        
        // 添加活动状态的样式
        const rings = clickedItem.querySelectorAll('.ring-active')
        rings.forEach(ring => {
          ring.classList.remove('opacity-0')
          ring.classList.add('opacity-100')
        })
        
        const bg = clickedItem.querySelector('.bg-active')
        if (bg) {
          bg.classList.remove('opacity-0')
          bg.classList.add('opacity-10')
        }
        
        // 更新文本颜色
        const textElement = clickedItem.querySelector('.text-gray-700, .dark\\:text-gray-200')
        if (textElement) {
          textElement.classList.remove('text-gray-700', 'dark:text-gray-200')
          textElement.classList.add('text-primary-light', 'dark:text-primary-dark')
        }
        
        // 如果当前URL是IPTV源，并且不是标签tab；或者人标签tab，并且是IPTV源
        const videoType = detectVideoType(currentVideoInfo.value.detailPageUrl || '')
        const isHtmlType = videoType === 'html' || videoType === 'm3u8str' || videoType === 'jsonApi'

        if ((isIPTVSource.value[activeTab.value] && !showTagsTab.value) || (showTagsTab.value && !isHtmlType)) {
          if (!url.includes('&live=true') && !url.includes('?live=true')) {
            if (url.includes('?')) {
              url += '&live=true'
            } else {
              url += '?live=true'
            }
          }
        }

        // 获取当前剧集所属的系列名称
        let seriesName = '';
        if (showTagsTab.value && currentTagInfo.value?.seriesName) {
          seriesName = currentTagInfo.value.seriesName;
        } else {
          seriesName = savedKeyword.value || props.keyword || '';
        }

        // 如果当前是IPTV源，设置seriesName为'IPTV'
        if ((!showTagsTab.value && isIPTVSource.value[activeTab.value]) || (showTagsTab.value && !isHtmlType)) {
          seriesName = 'IPTV';
        }

        setTimeout(() => {
          // 检查是否有保存的播放进度
          if (props.videoPlayer && !isIPTVSource.value[activeTab.value]) {
            // 获取标签信息
            const tagInfo = getTagInfo(siteRemark, seriesName);

            // 检查是否满足恢复进度条件
            if (tagInfo && 
                tagInfo.seriesName !== 'IPTV' && 
                tagInfo.episodeNumber === title && 
                tagInfo.currentTime && 
                tagInfo.currentTime > 0) {
              
              // 等待视频加载完成后显示恢复提示
              setTimeout(() => {
                try {                  
                  // 创建恢复进度的通知
                  const noticeText = `标签会保存播放进度`;
                  
                  // 显示通知，时长5秒，透明度0.8
                  props.videoPlayer.player.value.notice(noticeText, 5000, 0.8);
                  
                  // 恢复播放进度
                  props.videoPlayer.player.value.video.currentTime = tagInfo.currentTime as number;
                  
                } catch (e) {
                  console.error('创建恢复进度通知失败:', e);
                }
              }, 1000); // 等待视频加载一段时间后再显示通知
            }
          }
        }, 1000)
        
        // 确保事件被正确触发
        const currentSite = props.sites.find(site => site.remark === siteRemark)
        const adFilter = currentSite ? currentSite.adFilter : {
          status: true,
          item: 'default_del_ad_tag_to_filter',
          regularExpression: ''
        }
        
        // 获取当前显示的所有剧集元素
        const allItems = m3u8Items || document.querySelectorAll('.search-results-container .m3u8-item')
        
        // 创建剧集列表
        const episodeList: {
          url: string;
          title: string;
          episode: string;
          siteRemark: string;
          isTagTab?: boolean;
        }[] = []
        let currentIndex = -1

        // 遍历剧集元素，构建完整剧集列表并找到当前集的索引
        allItems.forEach((episode, index) => {
          const episodeUrl = episode.getAttribute('data-url') || ''
          const episodeTitle = episode.querySelector('div')?.textContent?.trim() || ''
          
          if (episodeUrl) {
            episodeList.push({
              url: episodeUrl,
              title: episodeTitle,
              episode: episodeTitle,
              siteRemark: siteRemark,
              isTagTab: showTagsTab.value // 标记是否是标签页
            })
            
            // 如果这是当前播放的剧集，记录索引
            if (episodeUrl === url) {
              currentIndex = index
            }
          }
        })
        
        // 触发事件，更新视频URL和信息
        emit('updateVideoUrl', url, {
          title: title,
          episode: title,
          siteRemark: siteRemark,
          seriesName: seriesName,
          adFilter: adFilter,
          isTagTab: showTagsTab.value
        }, episodeList, currentIndex, isReversedArr.value[theSiteName])

        if (allItems.length === 1) {
          // 修改 视频播放器工具栏 的显示内容
          setTimeout(() => {
            const titleElem = document.querySelector('#dplayer-playing-title')
            if (titleElem) {
              titleElem.innerHTML = titleElem.innerHTML.replace('连播 - ', '')
            }

            const nextEpisodeIcon = document.querySelector('#dplayer-next-episode-icon');
            if (nextEpisodeIcon) {
              nextEpisodeIcon.classList.add('disabled', 'hidden');
            }

            const nextEpisodeSettingItem = document.querySelector('#dplayer-next-episode-setting');
            if (nextEpisodeSettingItem) {
              nextEpisodeSettingItem.classList.add('disabled', 'hidden');
            }
          }, 2000)
        }

        // 添加一个提示，表明链接已播放
        const message = document.createElement('div')
        message.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow z-[9999]'
        message.textContent = '链接已播放'
        document.body.appendChild(message)
        setTimeout(() => message.remove(), 2000)
      } else {
        const title = clickedItem.getAttribute('data-title') || ''
        const vodUrl = clickedItem.getAttribute('data-vod-url') || ''

        handleResultClick(url, title, type, vodId, vodUrl)
      }
    }
  }
}

// 切换排序
const toggleSort = () => {
  
  let siteRemark = ''

  if (showTagsTab.value) {
    siteRemark = currentTagInfo.value?.siteName ? 'tag_' + currentTagInfo.value?.siteName : ''
  } else {
    siteRemark = props.sites.filter(s => s.active)[activeTab.value]?.remark || ''
  }

  isReversedArr.value[siteRemark] = !isReversedArr.value[siteRemark]

  // 重新渲染当前结果
  const content = showTagsTab.value ? tagsTabContent.value : searchResults.value[activeTab.value]
  
  if (content) {
    
    // 保存当前激活的URL（已存在activeEpisodeUrl.value中）
    const currentActiveUrl = activeEpisodeUrls.value[siteRemark]
    
    const $ = load(content)
    const $results = $('.m3u8-results')
    if ($results.length) {

      // 首先清除所有项目的激活状态
      $('.m3u8-item').removeClass('active ring-2 ring-primary-light dark:ring-primary-dark')
        .find('.bg-active').removeClass('opacity-10').addClass('opacity-0').end()
        .find('.ring-active').removeClass('opacity-100').addClass('opacity-0').end()
        .find('.text-primary-light, .text-primary-dark').removeClass('text-primary-light dark:text-primary-dark').addClass('text-gray-700 dark:text-gray-200')

      const items = $results.children('.m3u8-item').toArray()
      items.reverse()
      $results.empty()
      items.forEach(item => $results.append(item))
      // 更新排序按钮文本，使用更具体的选择器
      $('button[onclick*="toggleSort"]').html(`
        ${isReversedArr.value[siteRemark] ? '切换为正序' : '切换为倒序'}
        <span class="ml-1 opacity-60">${isReversedArr.value[siteRemark] ? '↑' : '↓'}</span>
      `)
      
      // 重新应用激活状态
      if (currentActiveUrl) {
        const $activeItem = $(`[data-url="${currentActiveUrl}"]`)
        if ($activeItem.length) {
          // 添加active类
          $activeItem.addClass('active ring-2 ring-primary-light dark:ring-primary-dark')
          
          // 设置内部元素的样式
          $activeItem.find('.bg-active').removeClass('opacity-0').addClass('opacity-10')
          $activeItem.find('.ring-active').removeClass('opacity-0').addClass('opacity-100')
          
          // 更新文本颜色
          const $textElement = $activeItem.find('.text-gray-700, .dark\\:text-gray-200')
          if ($textElement.length) {
            $textElement.removeClass('text-gray-700 dark:text-gray-200').addClass('text-primary-light dark:text-primary-dark')
          }
        }
      }
      
      if (showTagsTab.value) {
        tagsTabContent.value = $.html()
      } else {
        searchResults.value[activeTab.value] = $.html()
      }
    }
  }
}

const changeTabActiveBtn = (activeTabValue?: any, theActiveUrl?: string) => {
  const content = showTagsTab.value ? tagsTabContent.value : (searchResults.value[activeTabValue] || '')
  if (content) {
    const $ = load(content)
    const $results = $('.m3u8-results')
    if ($results.length) {
      const $active = $('div.active')
      if ($active.length === 0) {
        // 重新应用激活状态
        if (theActiveUrl) {
          const $activeItem = $(`[data-url="${theActiveUrl}"]`)
          if ($activeItem.length) {
            // 添加active类
            $activeItem.addClass('active ring-2 ring-primary-light dark:ring-primary-dark')
            
            // 设置内部元素的样式
            $activeItem.find('.bg-active').removeClass('opacity-0').addClass('opacity-10')
            $activeItem.find('.ring-active').removeClass('opacity-0').addClass('opacity-100')
            
            // 更新文本颜色
            const $textElement = $activeItem.find('.text-gray-700, .dark\\:text-gray-200')
            if ($textElement.length) {
              $textElement.removeClass('text-gray-700 dark:text-gray-200').addClass('text-primary-light dark:text-primary-dark')
            }

            if (showTagsTab.value) {
              tagsTabContent.value = $.html()
            } else {
              searchResults.value[activeTabValue] = $.html()
            }
          }
        }
      }
    }
  }
}

// 处理标签对话框显示
const handleShowTagDialog = (event: CustomEvent) => {
  const vodUrl = event.detail?.pageUrl || ''
  const title = event.detail?.title || ''
  showTagDialog(vodUrl, title)
}

// 修改 handleGoBack 函数
const handleGoBack = () => {
  const currentTab = activeTab.value
  if (tabEpisodesState.value[currentTab] && previousResults.value[currentTab]) {
    // 只恢复当前激活tab的历史记录
    searchResults.value[currentTab] = previousResults.value[currentTab]
    // 重置当前tab的状态
    tabEpisodesState.value[currentTab] = false
    // 检查是否所有tab都不在显示剧集列表
    const stillShowingEpisodes = Object.values(tabEpisodesState.value).some(state => state)
    isShowingEpisodes.value = stillShowingEpisodes
  }
}

// 获取所有保存的标签
const getAllTags = (): Array<{
  key: string;
  seriesName: string;
  episodeNumber: string;
  siteName: string;
  note: string;
  url: string;
  timestamp: string;
  detailPageUrl?: string;
  updateDays?: number[];
}> => {
  try {
    const tags = JSON.parse(localStorage.getItem('video_tags') || '{}')
    return Object.entries(tags).map(([key, value]) => ({
      key,
      ...(value as any)
    }))
  } catch (e) {
    console.error('获取所有标签失败:', e)
    return []
  }
}

// 显示标签列表弹窗
const showTagsListDialog = () => {
  const allTags = getAllTags()
  
  if (allTags.length === 0) {
    Swal.fire({
      title: '标签列表',
      text: '暂无保存的标签',
      icon: 'info',
      confirmButtonText: '确定',
      confirmButtonColor: '#3B82F6',
      background: isDark.value ? '#1F2937' : '#FFFFFF',
      color: isDark.value ? '#FFFFFF' : '#000000',
      showClass: {
        backdrop: 'swal2-noanimation',
        popup: 'swal2-noanimation'
      },
      hideClass: {
        popup: ''
      },
      // 使用helper函数设置按钮样式
      ...setupSwalButtonStyles()
    })
    return
  }
  
  // 按时间戳排序，最新的在前面
  allTags.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  
  let tagsHtml = `
    <div class="text-left space-y-4 max-h-[60vh] overflow-y-auto pr-4 mr-[-1rem]">
  `
  
  // 定义星期几的数组
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  
  allTags.forEach(tag => {
    const siteName = tag.siteName || '未知站点'
    const seriesName = tag.seriesName || '未知剧集'
    const episodeNumber = tag.episodeNumber || '未知集数'
    const date = new Date(tag.timestamp).toLocaleString()
    const hasDetailUrl = !!tag.detailPageUrl && seriesName !== 'IPTV'
    
    // 转换更新日期为可读文本
    const updateDaysText = tag.updateDays?.length 
      ? tag.updateDays.map((i: number) => weekdays[i]).join('、')
      : '未设置'
    
    tagsHtml += `
      <div class="p-4 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        <div class="flex justify-between items-start">
          <div class="flex-1 mr-4">
            <div class="font-medium text-gray-900 dark:text-gray-100">${seriesName}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">站点: ${siteName}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">集数: ${episodeNumber}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">更新: ${updateDaysText}</div>
            <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">保存时间: ${date}</div>
            ${hasDetailUrl ? '<div class="text-xs text-green-500 mt-1">✓ 包含剧集列表</div>' : '<div class="text-xs text-gray-400 mt-1">✗ 无剧集列表</div>'}
          </div>
          <div class="flex space-x-2">
            <button 
              class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 active:scale-95"
              onclick="document.dispatchEvent(new CustomEvent('applyTag', {detail: '${tag.key}'}))"
            >
              应用
            </button>
            <button 
              class="px-2 py-1 text-xs rounded bg-gray-500 text-white hover:bg-gray-600 active:scale-95"
              onclick="document.dispatchEvent(new CustomEvent('viewTag', {detail: '${tag.key}'}))"
            >
              查看
            </button>
            <button 
              class="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600 active:scale-95"
              onclick="document.dispatchEvent(new CustomEvent('deleteTag', {detail: '${tag.key}'}))"
            >
              删除
            </button>
          </div>
        </div>
        ${tag.note ? `<div class="mt-2 text-sm text-gray-600 dark:text-gray-300 border-t border-gray-200 dark:border-gray-700 pt-2">${tag.note}</div>` : ''}
      </div>
    `
  })
  
  tagsHtml += `</div>`
  
  Swal.fire({
    title: '标签列表',
    html: tagsHtml,
    showCancelButton: false,
    confirmButtonText: '关闭',
    confirmButtonColor: '#3B82F6',
    background: isDark.value ? '#1F2937' : '#FFFFFF',
    color: isDark.value ? '#FFFFFF' : '#000000',
    width: '600px',
    showClass: {
      backdrop: 'swal2-noanimation',
      popup: 'swal2-noanimation'
    },
    hideClass: {
      popup: ''
    },
    // 使用helper函数设置按钮样式但保留自定义容器类
    ...setupSwalButtonStyles(),
    // 合并customClass
    customClass: {
      ...setupSwalButtonStyles().customClass,
      container: 'tag-list-container'
    }
  })
}

// 应用标签
const applyTag = (key: string) => {
  try {
    const tags = JSON.parse(localStorage.getItem('video_tags') || '{}')
    const tag = tags[key]
    
    if (tag) {
      // 保存最后应用的标签
      //localStorage.setItem('last_applied_tag', key)
      
      // 确保显示搜索结果区域
      hasSearched.value = true
      
      // 保存标签的剧集名称作为搜索关键词
      if (tag.seriesName) {
        savedKeyword.value = tag.seriesName
      }
      
      // 更新当前视频信息
      currentVideoInfo.value = {
        title: tag.seriesName || '',
        url: '',
        episode: tag.episodeNumber || '',
        siteRemark: tag.siteName || '',
        detailPageUrl: tag.detailPageUrl || '',
        adFilter: tag.adFilter || {
          status: true,
          item: 'default_del_ad_tag_to_filter',
          regularExpression: ''
        }
      }
      
      // 保存当前标签的详细信息以供后续使用
      currentTagInfo.value = { ...tag, key }
      
      // 切换到标签页
      showTagsTab.value = true
      
      // 关闭标签列表弹窗
      Swal.close()
      
      const videoType = detectVideoType(tag.detailPageUrl)

      // 如果有剧集列表URL，先加载剧集列表
      if (tag.detailPageUrl && (videoType === 'html' || videoType === 'jsonApi')) {
        // 在标签页中显示加载状态，而不是使用弹窗
        tagsTabContent.value = `
          <div class="flex flex-col items-center justify-center py-8 space-y-4">
            <div class="w-8 h-8 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin"></div>
            <div class="text-gray-500 dark:text-gray-400">
              正在加载剧集列表...
            </div>
          </div>
        `
        if (videoType === 'jsonApi') {
          applyJsonApi(tag.siteName, tag.seriesName, tag.detailPageUrl, key, tag.episodeNumber)

          return
        }
        
        // 根据环境选择正确的 API 端点
        const apiEndpoint = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || vpsEndpointFlag 
          ? '/api/search' 
          : '/functions/api/search'
        
        // 加载剧集列表
        fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: tag.detailPageUrl })
        }).then(async response => {
          if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`)
          }
          
          const html = await response.text()
          const $ = load(html)

          isReversedArr.value['tag_' + tag.siteName] = true
          
          // 生成剧集列表HTML
          let resultHtml = `
            <div class="space-y-4">
              <div class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2 text-center">
                ${tag.seriesName || '未知剧集'}
              </div>
              <div class="flex justify-between items-center">
                <div class="text-sm text-gray-500 dark:text-gray-400" id="tag_site_name">${tag.siteName || '未知站点'}</div>
                <div class="flex items-center gap-2">
                  <button 
                    class="px-4 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium"
                    onclick="document.dispatchEvent(new CustomEvent('showTagDialog', {detail: {pageUrl: '${tag.detailPageUrl}', title: '${tag.seriesName}'}}))"
                  >
                    ${getTagButtonContent(tag.siteName, tag.seriesName)}
                  </button>
                  <button 
                    class="px-4 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium"
                    onclick="document.dispatchEvent(new CustomEvent('toggleSort'))"
                  >
                    ${isReversedArr.value['tag_' + tag.siteName] ? '切换为正序' : '切换为倒序'}
                    <span class="ml-1 opacity-60">${isReversedArr.value['tag_' + tag.siteName] ? '↑' : '↓'}</span>
                  </button>
                </div>
              </div>
              <div class="m3u8-results flex flex-wrap gap-3">
          `
          
          // 查找m3u8链接
          const playLinks = $('span, a').filter(function(this: any) {
            const $el = $(this)
            const text = $el.text().trim()
            return text.toLowerCase().includes('.m3u8')
          })
          
          // 使用 Map 来存储链接，以 URL 为键，确保去重
          const linksMap = new Map<string, { title: string; url: string }>()
          let autoNumberIndex = 1
          
          playLinks.each((_, link) => {
            const $link = $(link)
            const text = $link.text().trim()
            
            // 处理包含$分隔符的情况
            const parts = text.split('$')
            if (parts.length >= 2) {
              const title = parts[0].trim()
              const videoUrl = parts[1].trim()
              
              if (videoUrl.toLowerCase().includes('.m3u8')) {
                const finalTitle = !title ? String(autoNumberIndex++) : title
                if (!linksMap.has(videoUrl)) {
                  linksMap.set(videoUrl, { title: finalTitle, url: videoUrl })
                }
              }
            }
          })
          
          // 转换为数组
          let links = Array.from(linksMap.values())

          links.reverse()

          // 检查第一个链接的标题格式来决定宽度类
          let minWidthClass = ''
          const firstLink = playLinks.first()
          if (firstLink.length) {
            const firstText = firstLink.text().trim()
            const parts = firstText.split('$')
            const firstTitle = parts[0].trim()
            
            // 判断是否是"第x集"格式
            if (/^第\d+集$/.test(firstTitle)) {
              minWidthClass = 'min-w-[93px]' // 足够容纳"第xxx集"
            } else {
              minWidthClass = 'min-w-[67px]' // 足够容纳"xxx"
            }
          }
          
          // 生成HTML
          links.forEach(({ title, url }) => {
            // 检查当前URL是否与当前激活的剧集URL匹配
            const isCurrentVideo = title === tag.episodeNumber
            resultHtml += `
              <div class="m3u8-item group relative ${minWidthClass} bg-white dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm hover:shadow-md dark:shadow-gray-900/10 border border-gray-100 dark:border-gray-700 ${isCurrentVideo ? 'ring-2 ring-primary-light dark:ring-primary-dark active' : ''}"
                   data-url="${url}" data-title="${title}"
              >
                <div class="px-3 py-3 text-sm font-medium ${isCurrentVideo ? 'text-primary-light dark:text-primary-dark' : 'text-gray-700 dark:text-gray-200'} text-center group-hover:text-primary-light dark:group-hover:text-primary-dark line-clamp-2 break-words" title="${title}">
                  ${title}
                </div>
                <div class="absolute inset-0 rounded ring-1 ring-inset ring-gray-200 dark:ring-gray-700 group-hover:ring-primary-light/20 dark:group-hover:ring-primary-dark/20"></div>
                <div class="absolute inset-0 rounded bg-primary-light dark:bg-primary-dark ${isCurrentVideo ? 'opacity-10' : 'opacity-0'} group-hover:opacity-10 transition-opacity duration-200 bg-active"></div>
                <div class="absolute inset-0 rounded ring-2 ring-primary-light dark:ring-primary-dark ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ${isCurrentVideo ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 transition-opacity duration-200 ring-active"></div>
              </div>
            `
          })
          
          resultHtml += '</div></div>'
          
          // 设置标签页内容
          tagsTabContent.value = resultHtml
          
        }).catch(error => {
          console.error('加载剧集列表失败:', error)
          // 在标签页中显示错误信息
          tagsTabContent.value = `
            <div class="error-message p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-100 dark:border-red-900/30">
              <p class="font-medium">加载剧集列表失败:</p>
              <p class="mt-1">${error instanceof Error ? error.message : '未知错误'}</p>
              <p class="mt-2 text-sm">请检查网络连接或稍后重试</p>
              <button 
                class="mt-3 px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 transition-colors shadow-sm"
                onclick="document.dispatchEvent(new CustomEvent('retryApplyTag', {detail: '${key}'}))"
              >
                重试
              </button>
            </div>
          `
        })
      } else if (tag.detailPageUrl) {
        // 如果没有剧集列表URL，直接显示单个视频
        tagsTabContent.value = `
          <div class="space-y-4">
            <div class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2 text-center">
              ${tag.seriesName || '未知剧集'}
            </div>
            <div class="flex justify-between items-center">
              <div class="text-sm text-gray-500 dark:text-gray-400">${tag.siteName || '未知站点'}</div>
              <div class="flex items-center gap-2">
                <button 
                  class="px-4 py-2 text-sm rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-primary-light dark:hover:border-primary-dark shadow-sm hover:shadow font-medium"
                  onclick="document.dispatchEvent(new CustomEvent('showTagDialog', {detail: {pageUrl: '', title: '${tag.seriesName}'}}))"
                >
                  ${getTagButtonContent(tag.siteName, tag.seriesName)}
                </button>
              </div>
            </div>
            <div class="m3u8-results flex flex-wrap gap-3">
              <div class="m3u8-item group relative bg-white dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm hover:shadow-md dark:shadow-gray-900/10 border border-gray-100 dark:border-gray-700 ring-2 ring-primary-light dark:ring-primary-dark active"
                   data-url="${tag.detailPageUrl}"
              >
                <div class="p-3 text-sm font-medium text-primary-light dark:text-primary-dark text-center group-hover:text-primary-light dark:group-hover:text-primary-dark line-clamp-2 break-words" title="${tag.episodeNumber || '未知集数'}">
                  ${tag.episodeNumber || '未知集数'}
                </div>
                <div class="absolute inset-0 rounded ring-1 ring-inset ring-gray-200 dark:ring-gray-700 group-hover:ring-primary-light/20 dark:group-hover:ring-primary-dark/20"></div>
                <div class="absolute inset-0 rounded bg-primary-light dark:bg-primary-dark opacity-10 group-hover:opacity-10 transition-opacity duration-200 bg-active"></div>
                <div class="absolute inset-0 rounded ring-2 ring-primary-light dark:ring-primary-dark ring-offset-2 ring-offset-white dark:ring-offset-gray-800 opacity-100 group-hover:opacity-100 transition-opacity duration-200 ring-active"></div>
              </div>
            </div>
          </div>
        `
        
        // 添加提示
        const message = document.createElement('div')
        message.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow'
        message.textContent = '已应用标签'
        document.body.appendChild(message)
        setTimeout(() => message.remove(), 2000)
      }
    }
  } catch (e) {
    console.error('应用标签失败:', e)
    
    // 显示错误提示在标签页中
    tagsTabContent.value = `
      <div class="error-message p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-100 dark:border-red-900/30">
        <p class="font-medium">应用标签失败:</p>
        <p class="mt-1">${e instanceof Error ? e.message : '未知错误'}</p>
        <p class="mt-2 text-sm">请检查网络连接或稍后重试</p>
        <button 
          class="mt-3 px-4 py-2 bg-primary-light dark:bg-primary-dark text-white rounded hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 transition-colors shadow-sm"
          onclick="document.dispatchEvent(new CustomEvent('retryApplyTag', {detail: '${key}'}))"
        >
          重试
        </button>
      </div>
    `
  }
}

// 查看标签详情
const viewTag = (key: string) => {
  try {
    const tags = JSON.parse(localStorage.getItem('video_tags') || '{}')
    const tag = tags[key]
    
    if (tag) {
      const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
      const updateDaysText = tag.updateDays?.length 
        ? tag.updateDays.map((i: number) => weekdays[i]).join('、')
        : '未设置'
      
      Swal.fire({
        title: '标签详情',
        html: `
          <div class="text-left space-y-2">
            <div class="mb-1">
              <div class="flex items-center justify-between">
                <div class="text-xs font-medium text-gray-500 dark:text-gray-400">剧集名称</div>
                <button 
                  class="px-1.5 py-0.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700 flex items-center gap-1"
                  onclick="navigator.clipboard.writeText('${tag.seriesName || ''}').then(() => { 
                    const btn = document.getElementById('copy-series-btn');
                    if (btn) {
                      btn.innerHTML = '<svg class=\\'w-4 h-4\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' d=\\'M4.5 12.75l6 6 9-13.5\\' /></svg>';
                      setTimeout(() => { btn.innerHTML = '<svg class=\\'w-4 h-4\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' d=\\'M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184\\' /></svg>'; }, 1500);
                    }
                  })"
                  id="copy-series-btn"
                ><svg class='w-4 h-4' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5'><path stroke-linecap='round' stroke-linejoin='round' d='M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184' /></svg></button>
              </div>
              <div class="mt-0.5 p-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">${tag.seriesName || '未知'}</div>
            </div>
            <div class="mb-1">
              <div class="text-xs font-medium text-gray-500 dark:text-gray-400">追更集数</div>
              <div class="mt-0.5 p-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">${tag.episodeNumber || '未知'}</div>
            </div>
            <div class="mb-1">
              <div class="text-xs font-medium text-gray-500 dark:text-gray-400">资源站点</div>
              <div class="mt-0.5 p-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">${tag.siteName || '未知'}</div>
            </div>
            <div class="mb-1">
              <div class="text-xs font-medium text-gray-500 dark:text-gray-400">更新日期</div>
              <div class="mt-0.5 p-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">${updateDaysText}</div>
            </div>
            <div class="mb-1">
              <div class="flex items-center justify-between">
                <div class="text-xs font-medium text-gray-500 dark:text-gray-400">剧集列表URL</div>
                <button 
                  class="px-1.5 py-0.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700 flex items-center gap-1"
                  onclick="navigator.clipboard.writeText('${tag.detailPageUrl || ''}').then(() => { 
                    const btn = document.getElementById('copy-detail-btn');
                    if (btn) {
                      btn.innerHTML = '<svg class=\\'w-4 h-4\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' d=\\'M4.5 12.75l6 6 9-13.5\\' /></svg>';
                      setTimeout(() => { btn.innerHTML = '<svg class=\\'w-4 h-4\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' d=\\'M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184\\' /></svg>'; }, 1500);
                    }
                  })"
                  id="copy-detail-btn"
                ><svg class='w-4 h-4' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5'><path stroke-linecap='round' stroke-linejoin='round' d='M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184' /></svg></button>
              </div>
              <div class="mt-0.5 p-1.5 text-xs rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 break-all overflow-x-auto">${tag.detailPageUrl || '未知'}</div>
            </div>
            <div class="mb-1">
              <div class="text-xs font-medium text-gray-500 dark:text-gray-400">标签备注</div>
              <div class="mt-0.5 p-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[40px] max-h-[80px] overflow-y-auto">${tag.note || '无备注'}</div>
            </div>
            <div class="mb-1">
              <div class="text-xs font-medium text-gray-500 dark:text-gray-400">保存时间</div>
              <div class="mt-0.5 p-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">${new Date(tag.timestamp).toLocaleString()}</div>
            </div>
          </div>
        `,
        confirmButtonText: '关闭',
        confirmButtonColor: '#3B82F6',
        background: isDark.value ? '#1F2937' : '#FFFFFF',
        color: isDark.value ? '#FFFFFF' : '#000000',
        width: '450px',
        showClass: {
          backdrop: 'swal2-noanimation',
          popup: 'swal2-noanimation'
        },
        hideClass: {
          popup: ''
        },
        // 合并所有自定义类设置并添加额外的样式
        ...setupSwalButtonStyles(),
        customClass: {
          ...setupSwalButtonStyles().customClass,
          title: 'text-base',
          htmlContainer: 'text-sm'
        },
        didClose: () => {
          // 重新显示标签列表
          showTagsListDialog()
        }
      })
    }
  } catch (e) {
    console.error('查看标签详情失败:', e)
  }
}

// 删除标签
const deleteTag = (key: string) => {
  try {
    Swal.fire({
      title: '确认删除',
      text: '确定要删除这个标签吗？此操作不可撤销。',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonColor: '#EF4444',
      cancelButtonColor: '#6B7280',
      background: isDark.value ? '#1F2937' : '#FFFFFF',
      color: isDark.value ? '#FFFFFF' : '#000000',
      showClass: {
        backdrop: 'swal2-noanimation',
        popup: 'swal2-noanimation'
      },
      hideClass: {
        popup: ''
      },
      ...setupSwalButtonStyles()
    }).then((result) => {
      if (result.isConfirmed) {
        const tags = JSON.parse(localStorage.getItem('video_tags') || '{}')
        if (tags[key]) {
          delete tags[key]
          localStorage.setItem('video_tags', JSON.stringify(tags))
        }
      }

      showTagsListDialog()
    })
  } catch (e) {
    console.error('删除标签失败:', e)
  }
}

// 处理应用标签事件
const handleApplyTag = (event: CustomEvent) => {
  const key = event.detail
  if (key) {
    applyTag(key)
  }
}

// 处理查看标签事件
const handleViewTag = (event: CustomEvent) => {
  const key = event.detail
  if (key) {
    viewTag(key)
  }
}

// 处理删除标签事件
const handleDeleteTag = (event: CustomEvent) => {
  const key = event.detail
  if (key) {
    deleteTag(key)
  }
}

// 添加一个新方法用于在搜索时切换标签
const switchToFirstNonTagTab = () => {
  // 如果当前是标签页 或者 IPTV源，切换到第一个非标签页
  if (showTagsTab.value || isIPTVSource.value[activeTab.value]) {
    showTagsTab.value = false
    activeTab.value = 0
  }
}

// 添加自动激活剧集方法，根据资源站点备注自动找到对应标签页
const updateAutoActiveEpisode = (url: string, siteName: string, isTagTab: boolean) => {
  if (!url || !siteName) return
  
  const theSiteName = showTagsTab.value ? 'tag_' + siteName : siteName

  // 设置为当前活跃的剧集URL
  activeEpisodeUrls.value[theSiteName] = url
  
  // 处理流程标记，用于跟踪是否找到并激活了元素
  let isElementFound = false

  // 如果isTagTab为true，先在标签页中查找
  if (isTagTab) {
    // 切换到标签页
    showTagsTab.value = true
    
    // 等待DOM更新后在标签页中查找
    nextTick(() => {
      // 在标签页中查找所有剧集按钮
      const tagTabItems = document.querySelectorAll('.search-results-container .m3u8-item')
      
      // 清除所有激活状态
      tagTabItems.forEach(item => {
        item.classList.remove('active')
        item.classList.remove('ring-2', 'ring-primary-light', 'ring-primary-dark')
        
        const rings = item.querySelectorAll('.ring-active')
        rings.forEach(ring => {
          ring.classList.remove('opacity-100')
          ring.classList.add('opacity-0')
        })
        
        const bg = item.querySelector('.bg-active')
        if (bg) {
          bg.classList.remove('opacity-10')
          bg.classList.add('opacity-0')
        }
        
        const textElement = item.querySelector('.text-primary-light, .text-primary-dark')
        if (textElement) {
          textElement.classList.remove('text-primary-light', 'text-primary-dark')
          textElement.classList.add('text-gray-700', 'dark:text-gray-200')
        }
      })
      
      // 查找匹配URL的项目
      const matchingItem = Array.from(tagTabItems).find(item => 
        item.getAttribute('data-url') === url
      )
      
      // 如果在标签页中找到匹配项
      if (matchingItem) {
        isElementFound = true
        
        // 添加active类
        matchingItem.classList.add('active')
        
        // 添加蓝色边框
        matchingItem.classList.add('ring-2', 'ring-primary-light', 'dark:ring-primary-dark')
        
        // 添加活动状态的样式
        const rings = matchingItem.querySelectorAll('.ring-active')
        rings.forEach(ring => {
          ring.classList.remove('opacity-0')
          ring.classList.add('opacity-100')
        })
        
        const bg = matchingItem.querySelector('.bg-active')
        if (bg) {
          bg.classList.remove('opacity-0')
          bg.classList.add('opacity-10')
        }
        
        // 更新文本颜色
        const textElement = matchingItem.querySelector('.text-gray-700, .dark\\:text-gray-200')
        if (textElement) {
          textElement.classList.remove('text-gray-700', 'dark:text-gray-200')
          textElement.classList.add('text-primary-light', 'dark:text-primary-dark')
        }
        
        // 将按钮滚动到可见区域
        setTimeout(() => {
          const container = matchingItem.closest('.search-results-container')
          if (container) {
            const containerRect = container.getBoundingClientRect()
            const itemRect = matchingItem.getBoundingClientRect()
            
            // 计算相对于容器的偏移量
            const relativeTop = itemRect.top - containerRect.top
            const scrollOffset = relativeTop - (containerRect.height / 2) + (itemRect.height / 2)
            
            container.scrollBy({
              top: scrollOffset,
              behavior: 'smooth'
            })
          }
        }, 100)
      }
      
      // 如果在标签页中没有找到匹配项，则切换到资源站点查找
      if (!isElementFound) {
        // 回到资源站点标签页查找
        findInResourceSites();
      }
    })
  } else {
    // 直接在资源站点中查找
    findInResourceSites();
  }
  
  // 在资源站点中查找的函数
  function findInResourceSites() {
    // 首先找到对应资源站点的标签页索引
    let targetTabIndex = -1
    
    // 查找匹配的站点标签 - 只在激活的sites中查找
    const activeSites = props.sites.filter(s => s.active)

    for (let i = 0; i < activeSites.length; i++) {
      if (activeSites[i].remark === siteName) {
        targetTabIndex = i
        break
      }
    }
    
    // 如果找到匹配的标签，切换到该标签
    if (targetTabIndex !== -1) {
      activeTab.value = targetTabIndex
      showTagsTab.value = false
    }
    
    // 等待DOM更新后再查找元素
    nextTick(() => {
      // 获取目标标签页中的所有剧集按钮
      let m3u8Items: NodeListOf<Element>
      const activeTabContainer = document.querySelector(`[v-show="activeTab === ${activeTab.value}"]`)
      
      if (activeTabContainer) {
        m3u8Items = activeTabContainer.querySelectorAll('.m3u8-item')
      } else {
        m3u8Items = document.querySelectorAll('.search-results-container .m3u8-item')
      }
      
      // 移除所有剧集的active类和激活状态样式
      m3u8Items.forEach(item => {
        // 移除active类
        item.classList.remove('active')
        
        // 移除ring-2和ring-primary相关类（蓝色边框）
        item.classList.remove('ring-2', 'ring-primary-light', 'ring-primary-dark')
        
        // 移除活动状态的样式
        const rings = item.querySelectorAll('.ring-active')
        rings.forEach(ring => {
          ring.classList.remove('opacity-100')
          ring.classList.add('opacity-0')
        })
        
        const bg = item.querySelector('.bg-active')
        if (bg) {
          bg.classList.remove('opacity-10')
          bg.classList.add('opacity-0')
        }
        
        // 恢复文本颜色
        const textElement = item.querySelector('.text-primary-light, .text-primary-dark')
        if (textElement) {
          textElement.classList.remove('text-primary-light', 'text-primary-dark')
          textElement.classList.add('text-gray-700', 'dark:text-gray-200')
        }
      })
      
      // 查找URL匹配的项目
      const matchingItem = Array.from(m3u8Items).find(item => 
        item.getAttribute('data-url') === url
      )
      
      // 为找到的项目添加active类和样式
      if (matchingItem) {
        // 添加active类
        matchingItem.classList.add('active')
        
        // 添加蓝色边框
        matchingItem.classList.add('ring-2', 'ring-primary-light', 'dark:ring-primary-dark')
        
        // 添加活动状态的样式
        const rings = matchingItem.querySelectorAll('.ring-active')
        rings.forEach(ring => {
          ring.classList.remove('opacity-0')
          ring.classList.add('opacity-100')
        })
        
        const bg = matchingItem.querySelector('.bg-active')
        if (bg) {
          bg.classList.remove('opacity-0')
          bg.classList.add('opacity-10')
        }
        
        // 更新文本颜色
        const textElement = matchingItem.querySelector('.text-gray-700, .dark\\:text-gray-200')
        if (textElement) {
          textElement.classList.remove('text-gray-700', 'dark:text-gray-200')
          textElement.classList.add('text-primary-light', 'dark:text-primary-dark')
        }
        
        // 将按钮滚动到可见区域
        setTimeout(() => {
          const container = matchingItem.closest('.search-results-container')
          if (container) {
            const containerRect = container.getBoundingClientRect()
            const itemRect = matchingItem.getBoundingClientRect()
            
            // 计算相对于容器的偏移量
            const relativeTop = itemRect.top - containerRect.top
            const scrollOffset = relativeTop - (containerRect.height / 2) + (itemRect.height / 2)
            
            container.scrollBy({
              top: scrollOffset,
              behavior: 'smooth'
            })
          }
        }, 100)
      }
    })
  }
}

// 暴露搜索方法和标签列表方法给父组件
defineExpose({
  performSearch,
  showTagsListDialog,
  switchToFirstNonTagTab,
  updateAutoActiveEpisode
})

// 处理右键菜单显示
const handleContextMenu = (event: MouseEvent) => {
  // 阻止默认右键菜单
  event.preventDefault()

  // 获取被点击的剧集元素
  const target = event.target as HTMLElement
  const clickedItem = target.closest('.m3u8-item') as HTMLElement
  
  if (clickedItem) {
    // 获取剧集信息
    const url = clickedItem.getAttribute('data-url') || ''

    const vodId = clickedItem.getAttribute('data-vod-id') || ''

    const vodUrl = clickedItem.getAttribute('data-vod-url') || ''

    // 获取剧集标题文本
    const titleElement = clickedItem.querySelector('.text-center, .text-primary-light, .text-primary-dark, [class*="text-primary"], [class*="text-center"]')
    const title = titleElement?.textContent?.trim() || ''
    
    // 设置右键菜单位置和内容
    contextMenu.value = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      episodeUrl: url,
      episodeTitle: title,
      episodeIndex: title,
      vodId: vodId,
      vodUrl: vodUrl
    }
    
    // 添加一次性事件监听器，点击其他区域关闭菜单
    setTimeout(() => {
      document.addEventListener('click', closeContextMenu, { once: true })
    }, 0)
  }
}

// 关闭右键菜单
const closeContextMenu = () => {
  contextMenu.value.visible = false
}

// 处理"保存为标签"选项点击
const handleSaveAsTag = () => {
  // 关闭右键菜单
  closeContextMenu()
  
  // 获取当前资源站点
  let currentSite = '';

  // 获取剧集名称
  let seriesName = ''

  // 获取剧集列表URL
  let detailPageUrl = ''

  if (showTagsTab.value && currentTagInfo.value?.siteName) {
    // 如果是标签页模式，直接使用当前视频信息中保存的站点备注
    currentSite = currentTagInfo.value.siteName;

    // 如果是标签页模式，直接使用当前标签信息中保存的剧集名称
    seriesName = currentTagInfo.value?.seriesName || ''

    // 如果是标签页模式，直接使用当前标签信息中保存的剧集列表URL
    detailPageUrl = currentTagInfo.value?.detailPageUrl || ''

  } else {
    // 否则使用正常的逻辑
    currentSite = props.sites.filter(s => s.active)[activeTab.value]?.remark || '';
    seriesName = savedKeyword.value || props.keyword || ''

    // 对于IPTV源，将detailPageUrl设置为实际播放URL，而不是IPTV源URL
    if (isIPTVSource.value[activeTab.value]) {
      detailPageUrl = contextMenu.value.episodeUrl || ''
    } else {
      detailPageUrl = currentVideoInfo.value.detailPageUrl || ''
    }
  }
  
  // 获取剧集集数
  let episodeNumber = contextMenu.value.episodeIndex || ''
  
  // 获取当前标签信息
  const tagInfo = getTagInfo(currentSite, seriesName)
  
  // 使用已有的更新日期，如果没有则默认为空数组
  const updateDays = tagInfo?.updateDays || []
  
  // 使用已有的备注，如果没有则默认为空字符串
  const note = tagInfo?.note || ''

  detailPageUrl = tagInfo?.detailPageUrl || detailPageUrl

  const the_detail_page_url_type = detectVideoType(detailPageUrl) || ''

  if ((the_detail_page_url_type === 'm3u8str' || (the_detail_page_url_type === 'html' && detailPageUrl.includes('$'))) && contextMenu.value.vodId) {
    detailPageUrl = contextMenu.value.vodUrl.replace('?ac=videolist&wd=', '?ac=detail&ids=' + contextMenu.value.vodId)
  }
  
  // 对于IPTV源，确保剧集名称始终为"IPTV"
  if (!showTagsTab.value && isIPTVSource.value[activeTab.value]) {
    seriesName = "IPTV"
  }
  
  // 直接保存标签，不显示弹窗
  saveTag(currentSite, seriesName, episodeNumber, detailPageUrl, note, updateDays, props.videoPlayer)
  
  // 更新当前标签页的信息和按钮样式
  if (showTagsTab.value) {
    // 更新当前标签信息
    currentTagInfo.value = {
      note,
      seriesName,
      episodeNumber,
      siteName: currentSite,
      detailPageUrl,
      updateDays,
      timestamp: new Date().toISOString()
    }
    
    // 如果在标签页中，更新标签页内容中的标签按钮
    if (tagsTabContent.value) {
      const $ = load(tagsTabContent.value)
      const $tagButton = $('button[onclick*="showTagDialog"]')
      if ($tagButton.length) {
        $tagButton.html(getTagButtonContent(currentSite, seriesName))
        tagsTabContent.value = $.html()
      }
    }
  } else {
    // 如果在搜索结果页中，更新当前标签页的按钮样式
    if (searchResults.value[activeTab.value]) {
      const $ = load(searchResults.value[activeTab.value])
      const $tagButton = $('button[onclick*="showTagDialog"]')
      if ($tagButton.length) {
        $tagButton.html(getTagButtonContent(currentSite, seriesName))
        searchResults.value[activeTab.value] = $.html()
      }
    }
  }
  
  // 显示成功提示
  const message = document.createElement('div')
  message.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow z-[9999]'
  message.textContent = '标签保存成功'
  document.body.appendChild(message)
  setTimeout(() => message.remove(), 2000)
}

// 检测视频格式
const detectVideoType = (url: string): string => {
  const extension = url.split('?')[0].split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'm3u8':
      if (url.includes('$http') && url.includes('.m3u8')) {
        return 'm3u8str'
      }
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
      return 'html'
    case 'com':
      return 'html'
    case 'cn':
      return 'html'
    default:
      // 如果链接包含特定关键字
      if (url.includes('?ac=videolist&wd=') || url.includes('?ac=detail&ids=')) {
        return 'jsonApi'
      }
      if (url.includes('$http') && url.includes('.m3u8')) {
        return 'm3u8str'
      }
      if (url.includes('.m3u8')) {
        return 'm3u8'
      }
      if (url.includes('.html') || url.includes('.com') || url.includes('.cn')) {
        return 'html'
      }

      return 'auto'
  }
}

// 添加事件监听
onMounted(() => {  
  // 添加事件监听
  document.addEventListener('toggleSort', toggleSort)
  document.addEventListener('goBack', handleGoBack)
  document.addEventListener('showTagDialog', handleShowTagDialog as EventListener)
  document.addEventListener('applyTag', handleApplyTag as EventListener)
  document.addEventListener('viewTag', handleViewTag as EventListener)
  document.addEventListener('deleteTag', handleDeleteTag as EventListener)
  document.addEventListener('retrySearch', handleRetrySearch as EventListener)
  document.addEventListener('retryApplyTag', handleRetryApplyTag as EventListener)
  document.addEventListener('retryParseIPTV', handleRetryParseIPTV as EventListener)
  document.addEventListener('searchChannel', handleSearchChannel as EventListener)
  
  // 添加鼠标右键事件委托
  document.addEventListener('click', (e) => {
    // 如果点击的不是右键菜单内部元素，则关闭菜单
    if (contextMenu.value.visible) {
      const target = e.target as HTMLElement
      if (!target.closest('.context-menu')) {
        closeContextMenu()
      }
    }
  })
  
  // 检查并解析 IPTV 源
  props.sites.filter(s => s.active).forEach((site, index) => {
    if (isIPTVSourceUrl(site.url)) {
      isIPTVSource.value[index] = true
      parseIPTVSource(site, index)
      
      // 在首页访问时自动设置已搜索状态
      hasSearched.value = true
    } else {
      isIPTVSource.value[index] = false
    }
  })
  
  // 添加全局滚动监听函数
  setTimeout(() => {
    const containers = document.querySelectorAll('.search-results-container')
    containers.forEach(container => {
      container.addEventListener('scroll', handleScroll)
    })
  }, 500)
  
  // 初始检查滚动位置
  checkActiveTabScrollPosition()
})

// 移除事件监听
onUnmounted(() => {
  document.removeEventListener('toggleSort', toggleSort)
  document.removeEventListener('goBack', handleGoBack)
  document.removeEventListener('showTagDialog', handleShowTagDialog as EventListener)
  document.removeEventListener('applyTag', handleApplyTag as EventListener)
  document.removeEventListener('viewTag', handleViewTag as EventListener)
  document.removeEventListener('deleteTag', handleDeleteTag as EventListener)
  document.removeEventListener('retrySearch', handleRetrySearch as EventListener)
  document.removeEventListener('retryApplyTag', handleRetryApplyTag as EventListener)
  document.removeEventListener('retryParseIPTV', handleRetryParseIPTV as EventListener)
  document.removeEventListener('searchChannel', handleSearchChannel as EventListener)
  
  // 移除全局滚动监听函数
  const containers = document.querySelectorAll('.search-results-container')
  containers.forEach(container => {
    container.removeEventListener('scroll', handleScroll)
  })
})

// 处理重试搜索事件
const handleRetrySearch = (event: CustomEvent) => {
  const index = event.detail
  if (typeof index === 'number') {
    const site = props.sites.filter(s => s.active)[index]
    if (site) {
      // 使用该标签页保存的原始搜索关键词
      if (tabOriginalKeywords.value[index]) {
        savedKeyword.value = tabOriginalKeywords.value[index]
      }
      // 只重新搜索当前站点
      isLoading.value[index] = true
      searchSite(site, index)
    }
  }
}

// 处理重试应用标签事件
const handleRetryApplyTag = (event: CustomEvent) => {
  const key = event.detail
  if (key) {
    applyTag(key)
  }
}

// 处理频道搜索事件
const handleSearchChannel = (event: CustomEvent) => {
  const keyword = event.detail
  if (typeof keyword === 'string') {
    channelSearchKeyword.value = keyword
    scrollToChannel(keyword)
  }
}

// 添加IPTV频道搜索状态
const channelSearchKeyword = ref('')
const scrollToChannel = (title: string) => {
  if (!title) return
  
  // 使用nextTick确保DOM更新后再滚动
  nextTick(() => {
    // 如果当前是IPTV源，则使用IPTV源的频道搜索
    if (isIPTVSource.value[activeTab.value]) {
      // 获取当前IPTV tab的所有频道
      // 获取当前活动标签页的容器
      const activeContainer = document.querySelector(`.search-results-container[data-tab-index="${activeTab.value}"]`)
      if (!activeContainer) return

      const channelElements = activeContainer.querySelectorAll('.iptv-item')
      // 查找匹配标题的频道
      for (let i = 0; i < channelElements.length; i++) {
      const element = channelElements[i] as HTMLElement
      const channelTitle = element.querySelector('div[title]')?.getAttribute('title')
      if (channelTitle && channelTitle.toLowerCase().includes(title.toLowerCase())) {
        // 滚动到匹配的频道
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // 添加一个临时高亮效果
        element.classList.add('ring-2', 'ring-primary-light', 'dark:ring-primary-dark')
        setTimeout(() => {
          element.classList.remove('ring-2', 'ring-primary-light', 'dark:ring-primary-dark')
          }, 2000)
          break
        }
      }
    }
  })
}

// 添加返回顶部按钮状态
const showBackToTop = ref(false)

// 监听滚动事件，控制返回顶部按钮的显示和隐藏
const handleScroll = (event: Event) => {
  // 获取滚动的容器元素
  const container = event.target as HTMLElement
  if (container) {
    // 当滚动超过100px时显示按钮
    showBackToTop.value = container.scrollTop > 100
  }
}

// 检查当前活动标签页的滚动位置
const checkActiveTabScrollPosition = () => {
  nextTick(() => {
    let container: HTMLElement | null = null
    
    if (showTagsTab.value) {
      container = document.querySelector('.search-results-container[data-tab-index="tags"]')
    } else {
      container = document.querySelector(`.search-results-container[data-tab-index="${activeTab.value}"]`)
    }
    
    if (container) {
      showBackToTop.value = container.scrollTop > 100
    } else {
      showBackToTop.value = false
    }
  })
}

// 切换到标签页
const handleShowTags = () => {
  showTagsTab.value = true
  activeTab.value = -1
  // 直接触发事件
  emit('update:isCurrentTagTab', true)
}

// 切换到非标签页
const handleHideTags = (tabIndex: number) => {
  showTagsTab.value = false
  activeTab.value = tabIndex
  // 检查切换到的tab是否在显示剧集列表
  isShowingEpisodes.value = tabEpisodesState.value[tabIndex] || false
  // 直接触发事件
  emit('update:isCurrentTagTab', false)
}

// 监听标签页切换
watch([activeTab, showTagsTab], () => {
  checkActiveTabScrollPosition()

  let siteRemark = ''

  if (showTagsTab.value) {
    siteRemark = currentTagInfo.value?.siteName ? 'tag_' + currentTagInfo.value?.siteName : ''
  } else {
    siteRemark = props.sites.filter(s => s.active)[activeTab.value]?.remark || ''
  }

  // 查看当前标签页是否存在activeEpisodeUrls中，如果有即恢复active样式
  changeTabActiveBtn(activeTab.value, activeEpisodeUrls.value[siteRemark])
})

// 返回顶部方法
const scrollToTop = () => {
  // 查找当前激活的搜索结果容器
  let container: HTMLElement | null = null
  
  if (showTagsTab.value) {
    // 在标签页内
    container = document.querySelector('.search-results-container')
  } else {
    // 在其他标签页，获取当前激活的标签页容器
    const activeContainer = document.querySelector(`.search-results-container[data-tab-index="${activeTab.value}"]`)
    if (activeContainer) {
      container = activeContainer as HTMLElement
    } else {
      // 备用方法：遍历所有容器找到可见的那个
      const containers = document.querySelectorAll('.search-results-container')
      containers.forEach(el => {
        const parent = el.parentElement
        if (parent && parent.parentElement && 
            (parent.parentElement.style.display !== 'none' || 
             window.getComputedStyle(parent.parentElement).display !== 'none')) {
          container = el as HTMLElement
        }
      })
    }
  }
  
  if (container) {
    container.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }
}

// 监听 sites 变化，当站点配置发生变化时重置状态
watch(() => props.sites, (newSites, oldSites) => {
  // 只有当sites数组的长度或内容发生实质变化时才重置
  if (!oldSites || newSites.length !== oldSites.length || 
      JSON.stringify(newSites.map(s => s.remark)) !== JSON.stringify(oldSites.map(s => s.remark))) {
    
    // 重置标签页状态
    activeTab.value = 0
    showTagsTab.value = false
    
    // 清空搜索结果和加载状态
    isLoading.value = {}
    searchResults.value = {}
    isProxySearching.value = {}
    iptvTabContents.value = {}
    isIPTVSource.value = {}
    
    // 重新检测和解析IPTV源
    newSites.filter(s => s.active).forEach((site, index) => {
      if (isIPTVSourceUrl(site.url)) {
        isIPTVSource.value[index] = true
        parseIPTVSource(site, index)

        // 在首页访问时自动设置已搜索状态
        hasSearched.value = true
      } else {
        isIPTVSource.value[index] = false
      }
    })
  }
}, { deep: true })
</script>

<template>
  <div class="w-full">
    <!-- 标签页 -->
    <div class="border-b border-gray-200 dark:border-gray-700">
      <nav class="-mb-px flex space-x-4 overflow-x-auto" aria-label="Tabs">
        <!-- 标签页放在第一位 -->
        <button
          @click="handleShowTags"
          :class="[
            showTagsTab
              ? 'border-primary-light dark:border-primary-dark text-primary-light dark:text-primary-dark'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600',
            'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm'
          ]"
        >
          标签
        </button>
        <button
          v-for="(site, index) in sites.filter(s => s.active)"
          :key="index"
          @click="handleHideTags(index)"
          :class="[
            activeTab === index && !showTagsTab
              ? 'border-primary-light dark:border-primary-dark text-primary-light dark:text-primary-dark'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600',
            'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm'
          ]"
        >
          {{ site.remark }}
        </button>
      </nav>
    </div>

    <!-- 搜索结果 -->
    <div class="mt-4">
      <template v-if="hasSearched">
        <!-- 标签页内容 -->
        <div v-if="showTagsTab" class="space-y-4">
          <div 
            ref="searchResultsContainer"
            class="search-results-container"
            data-tab-index="tags"
            @click="handleContainerClick"
            @contextmenu="handleContextMenu"
            @scroll="handleScroll"
          >
            <div v-if="tagsTabContent" v-html="tagsTabContent"></div>
            <div v-else class="text-center py-8 text-gray-500 dark:text-gray-400">
              暂无标签内容，请在标签列表应用标签
            </div>
          </div>
        </div>
        <!-- 原有的搜索结果内容 -->
        <div v-else>
          <div v-for="(site, index) in sites.filter(s => s.active)" 
               :key="index"
               v-show="activeTab === index" 
               class="space-y-4"
          >
            <div 
              ref="searchResultsContainer"
              class="search-results-container"
              :data-tab-index="index"
              @click="handleContainerClick"
              @contextmenu="handleContextMenu"
              @scroll="handleScroll"
            >
              <!-- 加载状态 -->
              <div 
                v-if="isLoading[index]"
                class="flex flex-col items-center justify-center py-8 space-y-4"
              >
                <div class="w-8 h-8 border-4 border-primary-light dark:border-primary-dark border-t-transparent rounded-full animate-spin"></div>
                <div class="text-primary-light dark:text-primary-dark">
                  <template v-if="isProxySearching[index]">
                    代理搜索进行中...
                  </template>
                  <template v-else>
                    进行中...
                  </template>
                </div>
              </div>
              <!-- IPTV 源内容 -->
              <div v-else-if="isIPTVSource[index]" v-html="iptvTabContents[index]"></div>
              <!-- 搜索结果 -->
              <div v-else>
                <div v-if="searchResults[index]" v-html="searchResults[index]"></div>
                <div v-else class="text-center py-8 text-gray-500 dark:text-gray-400">
                  未找到搜索结果
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      
      <!-- 未搜索时的提示 -->
      <div v-if="!hasSearched" class="text-center py-8 text-gray-500 dark:text-gray-400">
        请输入关键词进行搜索
      </div>
    </div>
    
    <!-- 添加独立的返回顶部按钮 -->
    <div 
      v-show="showBackToTop"
      class="back-to-top-btn fixed bottom-6 right-6 w-9 h-9 rounded-full bg-primary-light dark:bg-primary-dark text-white shadow flex items-center justify-center cursor-pointer hover:opacity-90 transition-all z-[9999] transform hover:scale-110"
      @click="scrollToTop"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" />
      </svg>
    </div>
    
    <!-- 右键菜单 -->
    <Teleport to="body">
      <div 
        v-if="contextMenu.visible" 
        class="context-menu fixed z-[9999] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow rounded"
        :style="{
          left: `${contextMenu.x}px`,
          top: `${contextMenu.y}px`,
        }"
      >
        <div 
          class="tag-save-btn px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 hover:text-primary-light dark:hover:text-gray-200 transition-colors rounded relative"
          @click="handleSaveAsTag"
        >
          <div class="flex items-center gap-2">
            <BookmarkIcon class="w-5 h-5" />
            <span>保存为标签</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
iframe {
  background-color: white;
}

:deep(.dark) iframe {
  background-color: #1f2937;
}

.search-results-container {
  @apply p-2 h-[calc(100vh-200px)] overflow-y-auto relative;
}

/* 添加返回顶部按钮样式 */
.back-to-top-btn {
  opacity: 0.9;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.search-results-container :deep(.search-results) {
  @apply space-y-2;
}

.search-results-container :deep(.result-item:hover) {
  @apply transform scale-[1.01];
}

.search-results-container :deep(.no-results) {
  @apply text-center py-8 text-gray-500 dark:text-gray-400;
}

.search-results-container :deep(.error-message) {
  @apply text-center;
}

/* 右键菜单样式 */
.context-menu {
  min-width: 160px;
  animation: fadeIn 0.1s ease-out;
  transform-origin: top left;
}

.tag-save-btn {
  position: relative;
  transition: all 0.1s ease;
  border-radius: 0.25rem;
}

.tag-save-btn::before {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  border-radius: 0.25rem;
  border: 0 solid #5b99fc;
  transition: all 0.1s ease;
  pointer-events: none;
}

.tag-save-btn:hover::before {
  border-width: 2px;
}

/* 移除之前的悬停样式 */
.tag-save-btn:hover {
  z-index: 1;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 修改SweetAlert2按钮的聚焦样式 */
:deep(.swal2-confirm:focus),
:deep(.swal2-cancel:focus),
:deep(.swal2-deny:focus),
:deep(.swal2-button:focus) {
  box-shadow: none !important;
  outline: none !important;
  border: none !important;
}

/* 全局覆盖SweetAlert2按钮样式 */
:global(.swal2-actions button:focus) {
  box-shadow: none !important;
  outline: none !important;
  border-color: transparent !important;
}

/* 使用v-deep替代方案 */
:deep(.swal2-popup .swal2-actions button:focus-visible) {
  box-shadow: none !important;
  outline: none !important;
  border: none !important;
}

/* 使用更高优先级的选择器 */
:deep(.swal2-container) .swal2-popup .swal2-actions button:focus {
  box-shadow: none !important;
  outline: none !important;
  border: none !important;
}

/* 添加全局样式覆盖SweetAlert2默认样式 */
:global(.swal2-actions button:focus),
:global(.swal2-actions button:focus-visible) {
  outline: 0 !important;
  box-shadow: none !important;
  border-color: transparent !important;
}

:global(.swal2-button-no-focus:focus),
:global(.swal2-button-no-focus:focus-visible) {
  outline: 0 !important;
  box-shadow: none !important;
  border-color: transparent !important;
}
</style> 
