export interface ResourceSite {
  url: string
  searchResultClass?: string
  remark: string
  active: boolean
  isPost?: boolean
  postData?: string
  adFilter: {
    status: boolean
    item: string
    regularExpression: string
  }
}

export interface PublicConfig {
  resourceSites: ResourceSite[]
  parseApi: string
  backgroundImage: string
  enableLogin: boolean
  announcement: string
  customTitle?: string | 'false' | false
  enableHealthFilter: boolean
  proxyVideoUrl: string
  proxyLiveUrl: string
  enableHotMovies?: boolean
  hotMoviesProxyUrl?: string
  hotTvDefaultTag?: string
  hotMovieDefaultTag?: string
  autoPlayNext?: boolean
}

export interface Config extends PublicConfig {
  loginPassword: string
} 
