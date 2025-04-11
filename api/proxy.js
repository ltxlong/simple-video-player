import { handleProxyRequest } from '../server/proxy-handler.js'

/**
 * Vercel API路由处理函数
 * 
 * @param {Object} req - Vercel请求对象
 * @param {Object} res - Vercel响应对象
 */
export default async function handler(req, res) {
  // 适配Vercel请求格式
  const adaptedReq = {
    ...req,
    query: req.query || {},
    headers: req.headers || {}
  }
  
  // 使用共享代理处理逻辑
  return await handleProxyRequest(adaptedReq, res)
} 