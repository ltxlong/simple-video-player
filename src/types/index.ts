export interface ResourceSite {
  url: string
  className?: string
  searchResultClass?: string
  remark: string
  active: boolean
  isPost?: boolean
  postData?: string
}

export interface PublicConfig {
  resourceSites: ResourceSite[]
  parseApi: string
  backgroundImage: string
  enableLogin: boolean
  announcement: string
  customTitle?: string | 'false' | false
  enableHealthFilter: boolean
}

export interface Config extends PublicConfig {
  loginPassword: string
} 