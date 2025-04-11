import http from 'http'
import https from 'https'

/**
 * 处理代理请求的核心逻辑
 * @param {Object} req - 请求对象 (可以是Express或适配的请求)
 * @param {Object} res - 响应对象 (可以是Express或适配的响应)
 * @returns {Promise} - 处理结果的Promise
 */
export async function handleProxyRequest(req, res, isServerless = false) {
  try {
    // 获取查询参数
    const videoUrl = req.query?.url || req.url?.searchParams?.get('url')
    const customReferer = req.query?.referer || req.url?.searchParams?.get('referer')
    
    if (!videoUrl) {
      return isServerless 
        ? new Response(JSON.stringify({ error: '缺少视频URL参数' }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          })
        : res.status(400).json({ error: '缺少视频URL参数' })
    }

    // 处理URL
    let processedUrl = videoUrl
    
    // 如果 videoUrl结尾是 ?live=true 或 &live%3Dtrue 则去掉
    processedUrl = processedUrl.replace(/(?:\?|&)(live=true|live%3Dtrue)$/, '')
    
    if (processedUrl.includes('_the_proxy_ts_url_')) {
      const tpProxyUrl_split_arr = processedUrl.split('_the_proxy_ts_url_')
      const tsProxyUrl_0 = tpProxyUrl_split_arr[0]
      const tsProxyUrl_1 = tpProxyUrl_split_arr[1]
      processedUrl = tsProxyUrl_0 + '?ts=' + tsProxyUrl_1
    }
    
    // 解析视频URL
    const targetUrl = new URL(processedUrl)
    
    // 根据请求判断是否来自移动设备
    const userAgent = req.headers?.['user-agent'] || ''
    const isMobile = /mobile|android|iphone|ipad/i.test(userAgent)

    // 选择合适的默认UA
    const defaultUA = isMobile 
      ? 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'

    // 创建请求配置
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': req.headers?.['user-agent'] || defaultUA,
        'Range': req.headers?.range || '',
        'Referer': customReferer || targetUrl.origin,
        'Origin': targetUrl.origin,
        'Host': targetUrl.host,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
      },
      timeout: 0,
      keepAlive: true,
      keepAliveMsecs: 1000,
    }
    
    // 复制可能有用的请求头
    const headersToForward = [
      'if-none-match', 'if-modified-since', 'cookie', 'authorization'
    ]
    
    headersToForward.forEach(header => {
      if (req.headers?.[header]) {
        options.headers[header] = req.headers[header]
      }
    })
    
    // 始终优先使用自定义Referer
    if (customReferer) {
      options.headers['Referer'] = customReferer
      
      // 从Referer中提取Origin
      try {
        const refererUrl = new URL(customReferer)
        options.headers['Origin'] = `${refererUrl.protocol}//${refererUrl.host}`
      } catch (e) {
        // 如果解析失败，使用默认Origin
        console.warn('无法从Referer解析Origin:', e)
      }
    }
    
    // Serverless环境处理
    if (isServerless) {
      return await fetchWithProxy(targetUrl, options, customReferer)
    }
    
    // Express环境处理
    return await new Promise((resolve, reject) => {
      // 选择http或https模块
      const requestLib = targetUrl.protocol === 'https:' ? https : http
      
      // 发起代理请求
      const proxyReq = requestLib.request(options, (proxyRes) => {
        if (proxyRes.socket) {
          proxyRes.socket.setNoDelay(true)
        }
        
        // 复制响应头
        Object.entries(proxyRes.headers).forEach(([key, value]) => {
          if (value) {
            res.setHeader(key, value)
          }
        })
        
        // 设置CORS头
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Headers', '*')
        
        // 设置状态码
        res.statusCode = proxyRes.statusCode || 200
        
        // 收集所有响应数据
        let chunks = []
        
        proxyRes.on('data', (chunk) => {
          chunks.push(chunk)
        })
        
        proxyRes.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks)
            res.end(buffer)
            resolve()
          } catch (error) {
            console.error('处理响应数据时出错:', error)
            if (!res.headersSent) {
              res.status(500).json({ error: `处理响应失败: ${error.message}` })
            }
            reject(error)
          }
        })
      })
      
      // 错误处理
      proxyReq.on('error', (error) => {
        console.error('代理请求错误:', error)
        if (!res.headersSent) {
          res.status(500).json({ error: `代理请求失败: ${error.message}` })
        }
        reject(error)
      })
      
      // 超时处理 - 如果timeout为0，则不设置超时
      if (options.timeout > 0) {
        proxyReq.setTimeout(options.timeout, () => {
          proxyReq.destroy()
          if (!res.headersSent) {
            res.status(504).json({ error: '代理请求超时' })
          }
          reject(new Error('代理请求超时'))
        })
      }
      
      // 结束请求
      proxyReq.end()
    })
  } catch (error) {
    console.error('代理处理错误:', error)
    return isServerless
      ? new Response(JSON.stringify({ error: `代理处理失败: ${error.message}` }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      : res.status(500).json({ error: `代理处理失败: ${error.message}` })
  }
}

/**
 * 使用fetch API处理代理请求 (用于Serverless环境)
 */
async function fetchWithProxy(targetUrl, options, customReferer) {
  const headers = new Headers(options.headers)
  
  // 确保自定义Referer被正确设置
  if (customReferer) {
    headers.set('Referer', customReferer)
    
    try {
      const refererUrl = new URL(customReferer)
      headers.set('Origin', `${refererUrl.protocol}//${refererUrl.host}`)
    } catch (e) {
      console.warn('无法从Referer解析Origin:', e)
    }
  }
  
  // 执行fetch请求
  const response = await fetch(targetUrl.toString(), {
    method: 'GET',
    headers,
    redirect: 'follow'
  })
  
  // 创建响应头
  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('Access-Control-Allow-Origin', '*')
  responseHeaders.set('Access-Control-Allow-Headers', '*')
  
  // 读取响应数据
  const data = await response.arrayBuffer()
  
  // 返回响应
  return new Response(data, {
    status: response.status,
    headers: responseHeaders
  })
} 