import { defineStore } from 'pinia'

interface Config {
  resourceSites: string[]
  parseApi: string
  backgroundImage: string
  enableLogin: boolean
  loginPassword: string
  announcement: string
  customTitle: string
  enableHealthFilter: boolean
  proxyVideoUrl: string
  proxyLiveUrl: string
  enableHotMovies: boolean
  hotMoviesProxyUrl: string
  hotTvDefaultTag: string
  hotMovieDefaultTag: string
  autoPlayNext: boolean
}

export const useConfigStore = defineStore('config', {
  state: (): Config => ({
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
  }),

  actions: {
    async loadConfig() {
      try {
        // TODO: 从 Cloudflare KV 加载配置
        const config = {} as Config
        this.$patch(config)
      } catch (error) {
        console.error('加载配置失败:', error)
      }
    },

    async saveConfig() {
      try {
        // TODO: 保存配置到 Cloudflare KV
        console.log('保存配置:', this.$state)
      } catch (error) {
        console.error('保存配置失败:', error)
      }
    }
  }
}) 
