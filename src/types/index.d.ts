export interface ResourceSite {
    url: string;
    searchResultClass?: string;
    remark: string;
    active: boolean;
    isPost?: boolean;
    postData?: string;
    adFilter: {
        status: boolean;
        item: string;
        regularExpression: string;
    }
}
export interface Config {
    resourceSites: ResourceSite[];
    parseApi: string;
    backgroundImage: string;
    enableLogin: boolean;
    loginPassword: string;
    announcement: string;
    customTitle: string;
    enableHealthFilter: boolean;
    proxyVideoUrl: string;
    proxyLiveUrl: string;
    enableHotMovies: boolean;
    hotMoviesProxyUrl: string;
    hotTvDefaultTag: string;
    hotMovieDefaultTag: string;
    autoPlayNext: boolean;
}
