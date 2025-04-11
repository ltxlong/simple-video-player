export interface ResourceSite {
    url: string;
    className?: string;
    remark: string;
    active: boolean;
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
}
