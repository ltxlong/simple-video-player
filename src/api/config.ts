import type { Config } from '../types'

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

/**
 * 获取首页配置信息
 */
export async function getHomeConfig(): Promise<Config> {
  try {

    const token = sessionStorage.getItem('token')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }

    // 如果有token就带上
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch('/api/home/config', {
      method: 'GET',
      headers
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('获取首页配置失败')
      
      // 如果是401错误
      if (response.status === 401 || response.status === 403) {
        // 如果有token但验证失败，清除token
        if (token) {
          sessionStorage.removeItem('token')
        }
        
        // 返回需要登录的配置
        const config = { ...defaultConfig, enableLogin: true }
        return config
      }
      
      throw new Error('获取首页配置失败')
    }

    const data = await response.json()
    
    return data
  } catch (error) {
    console.error('获取首页配置失败')
    // 对于其他错误，返回默认配置
    return defaultConfig
  }
}

/**
 * Base64 编码
 */
function encodeBase64(str: string): string {
  return btoa(encodeURIComponent(str))
}

/**
 * Base64 三次解码
 */
function decodeBase64(str: string): string {
  try {
    let decoded = str
    for (let i = 0; i < 3; i++) {
      decoded = atob(decoded)
    }
    return decoded
  } catch (e) {
    console.error('失败')
    return str
  }
}

/**
 * 获取管理后台配置信息
 */
export async function getAdminConfig(): Promise<Config> {
  try {

    const token = sessionStorage.getItem('adminToken')
    if (!token) {
      throw new Error('未登录！')
    }

    const response = await fetch('/api/admin/config', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('获取管理配置失败')
      // 如果是401、403错误
      if (response.status === 401 || response.status === 403) {
        // 如果有token但验证失败，清除token
        if (token) {
          sessionStorage.removeItem('adminToken')
        }
      }

      throw new Error('获取管理配置失败')
    }

    const data = await response.json()

    return data
  } catch (error) {
    console.error('获取管理配置失败')
    return defaultConfig
  }
}

// 导出加密解密函数供其他组件使用
export { encodeBase64, decodeBase64 }
