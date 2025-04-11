import { handleProxyRequest } from '../../server/proxy-handler.js'

/**
 * CloudFlare Worker处理函数
 * 
 * @param {Object} context - CloudFlare Worker上下文
 */
export async function onRequest(context) {
  const { request } = context
  const url = new URL(request.url)
  
  // 将CF请求格式适配为共享处理逻辑能理解的格式
  const adaptedReq = {
    url: url,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(request.headers),
    method: request.method
  }
  
  // 直接使用serverless模式
  return await handleProxyRequest(adaptedReq, null, true)
} 