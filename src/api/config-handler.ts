import type { Config } from '../types/index.js'
import { db, initDatabaseFromEnv } from '../db/index.js'

// 默认配置
export const defaultConfig: Config = {
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
 * 获取配置
 * @param cloudflareEnv Cloudflare环境对象
 * @returns 配置对象
 */
export async function getConfig(cloudflareEnv?: any): Promise<Config> {
  try {
    // 初始化数据库（如果尚未初始化）
    await initDatabaseFromEnv(cloudflareEnv);
    
    // 尝试从数据库获取配置
    const config = await db.get<Config>('config');
    
    // 如果没有找到配置，则使用默认配置
    if (!config) {
      console.log('未找到配置，使用默认配置');
      return defaultConfig;
    }
    
    return config;
  } catch (error) {
    console.error('获取配置失败:', error);
    return defaultConfig;
  }
}

/**
 * 更新配置
 * @param config 新的配置对象
 * @param cloudflareEnv Cloudflare环境对象
 * @returns 更新结果
 */
export async function updateConfig(
  config: Config, 
  cloudflareEnv?: any
): Promise<{ success: boolean; message: string }> {
  try {
    // 初始化数据库（如果尚未初始化）
    await initDatabaseFromEnv(cloudflareEnv);
    
    // 保存配置到数据库
    const success = await db.set<Config>('config', config);
    
    if (success) {
      return { success: true, message: '配置更新成功~~' };
    } else {
      return { success: false, message: '无法保存配置到数据库' };
    }
  } catch (error) {
    console.error('更新配置失败:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '更新配置失败'
    };
  }
}
