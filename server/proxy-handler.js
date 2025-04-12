import http from 'http'
import https from 'https'

/**
 * 判断一个字符串是否为IPv4地址
 * @param {string} str - 要检查的字符串
 * @returns {boolean} - 是否为IPv4地址
 */
function isIPv4(str) {
  // IPv4地址的正则表达式
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (!ipv4Pattern.test(str)) {
    return false;
  }
  
  // 检查每个数字是否在有效范围内
  const parts = str.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * 判断一个字符串是否为IPv6地址
 * @param {string} str - 要检查的字符串
 * @returns {boolean} - 是否为IPv6地址
 */
function isIPv6(str) {
  // 简单检查，IPv6地址含有冒号但不含有点
  return str.includes(':') && !str.includes('.');
}

/**
 * 处理代理请求的核心逻辑
 * @param {Object} req - 请求对象 (可以是Express或适配的请求)
 * @param {Object} res - 响应对象 (可以是Express或适配的响应)
 * @returns {Promise} - 处理结果的Promise
 */
export async function handleProxyRequest(req, res, isServerless = false) {
  // 在一开始就标记是否已经响应，避免多次响应
  let hasResponded = false;
  
  try {
    // 获取查询参数
    const videoUrl = req.query?.url || req.url?.searchParams?.get('url')
    const customReferer = req.query?.referer || req.url?.searchParams?.get('referer')
    
    if (!videoUrl) {
      hasResponded = true;
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
    
    // 判断目标主机是IPv4还是IPv6，设置对应的family参数
    if (isIPv4(targetUrl.hostname)) {
      options.family = 4;
    } else if (isIPv6(targetUrl.hostname)) {
      options.family = 6;
    } else {
      // 对于域名，不设置family，让系统自动选择
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
      hasResponded = true;
      return await fetchWithProxy(targetUrl, options, customReferer)
    }
    
    // Express环境处理
    return await new Promise((resolve, reject) => {
      // 选择http或https模块
      const requestLib = targetUrl.protocol === 'https:' ? https : http
      
      // 发起代理请求
      const proxyReq = requestLib.request(options, (proxyRes) => {
        try {
          if (proxyRes.socket) {
            proxyRes.socket.setNoDelay(true);
            // 禁用Nagle算法，提高实时性能
            proxyRes.socket.setKeepAlive(true, 60000); // 设置更长的保活时间
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

          // 删除Content-Length头，避免与Transfer-Encoding冲突
          if (res.hasHeader('Content-Length')) {
            res.removeHeader('Content-Length')
          }
          res.setHeader('Transfer-Encoding', 'chunked')
          res.setHeader('X-Content-Type-Options', 'nosniff')
          
          // 设置状态码
          res.statusCode = proxyRes.statusCode || 200
          
          // 对于流媒体，使用管道直接传输更高效
          proxyRes.pipe(res)
          
          proxyRes.on('end', () => {
            // 流结束后才resolve promise
            resolve()
          })
          
          proxyRes.on('error', (streamError) => {
            console.error('流传输错误:', streamError)
            // 如果头已经发送，就不能再发送错误响应
            // 只能结束响应并reject promise
            if (!res.headersSent) {
              res.status(500).json({ error: `流传输错误: ${streamError.message}` })
            }
            reject(streamError)
          })
        } catch (error) {
          console.error('处理响应时出错:', error)
          if (!res.headersSent) {
            res.status(500).json({ error: `处理响应失败: ${error.message}` })
          }
          reject(error)
        }
      })
      
      // 错误处理
      proxyReq.on('error', (error) => {
        console.error('代理请求错误:', error)
        
        // 立即销毁连接，避免等待超时
        proxyReq.destroy();
        
        // 特别处理ECONNRESET错误
        if (error.code === 'ECONNRESET') {
          console.warn('连接被重置，尝试重新发送请求')
          
          // 使用计数器和递归函数实现多次重试
          let retryCount = 0;
          const maxRetries = 1;
          
          const retryRequest = () => {
            retryCount++;
            console.log(`开始第${retryCount}次重试...`);
            
            // 延迟500ms后重试请求
            setTimeout(() => {
              const retryReq = requestLib.request(options, (retryRes) => {
                try {
                  // 与原始代码相同的响应处理逻辑
                  if (retryRes.socket) {
                    retryRes.socket.setNoDelay(true);
                    retryRes.socket.setKeepAlive(true, 60000); // 设置更长的保活时间
                  }
                  
                  Object.entries(retryRes.headers).forEach(([key, value]) => {
                    if (value) {
                      res.setHeader(key, value)
                    }
                  })
                  
                  res.setHeader('Access-Control-Allow-Origin', '*')
                  res.setHeader('Access-Control-Allow-Headers', '*')
                  
                  // 删除Content-Length头，避免与Transfer-Encoding冲突
                  if (res.hasHeader('Content-Length')) {
                    res.removeHeader('Content-Length')
                  }
                  res.setHeader('Transfer-Encoding', 'chunked')
                  res.setHeader('X-Content-Type-Options', 'nosniff')
                  res.statusCode = retryRes.statusCode || 200
                  
                  // 对于流媒体，使用管道直接传输更高效
                  retryRes.pipe(res)
                  
                  retryRes.on('end', () => {
                    // 流结束后才resolve promise
                    resolve()
                  })
                  
                  retryRes.on('error', (streamError) => {
                    console.error('重试流传输错误:', streamError)
                    // 如果头已经发送，就不能再发送错误响应
                    if (!res.headersSent) {
                      res.status(500).json({ error: `重试流传输错误: ${streamError.message}` })
                    }
                    reject(streamError)
                  })
                } catch (error) {
                  console.error('处理重试响应时出错:', error)
                  if (!res.headersSent) {
                    res.status(500).json({ error: `处理重试响应失败: ${error.message}` })
                  }
                  reject(error)
                }
              })
              
              retryReq.on('error', (retryError) => {
                console.error(`第${retryCount}次重试失败:`, retryError)
                
                // 立即销毁连接，避免等待超时
                retryReq.destroy();
                
                // 如果还有重试次数，继续重试
                if (retryCount < maxRetries && retryError.code === 'ECONNRESET') {
                  retryRequest();
                } else {
                  if (!res.headersSent) {
                    res.status(500).json({ error: `重试代理请求失败: ${retryError.message}` })
                  }
                  reject(retryError)
                }
              })
              
              // 设置超时，与主请求保持一致
              retryReq.setTimeout(30000, () => {
                retryReq.destroy()
                if (!res.headersSent) {
                  res.status(504).json({ error: '重试请求超时' })
                }
                reject(new Error('重试请求超时'))
              })
              
              retryReq.end()
            }, 500)
          };
          
          // 开始第一次重试
          retryRequest();
          
          return
        }
        
        if (!res.headersSent) {
          res.status(500).json({ error: `代理请求失败: ${error.message}` })
        }
        reject(error)
      })
      
      // 超时处理
      proxyReq.setTimeout(30000, () => {
        proxyReq.destroy()
        if (!res.headersSent) {
          res.status(504).json({ error: '代理请求超时' })
        }
        reject(new Error('代理请求超时'))
      })
      
      // 结束请求
      proxyReq.end()
    })
  } catch (error) {
    console.error('代理处理错误:', error)
    // 避免重复响应
    if (hasResponded || res.headersSent) {
      console.warn('已经发送了响应，忽略错误处理');
      return;
    }
    
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
  
  let retries = 0;
  const maxRetries = 1;
  
  while (retries <= maxRetries) {
    try {
      // 执行fetch请求
      const response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers,
        redirect: 'follow',
      });
      
      // 创建一个TransformStream来处理分块
      const transformStream = new TransformStream({
        transform(chunk, controller) {
          // 立即传递数据块，减少等待时间
          controller.enqueue(chunk);
        }
      });
      
      // 将输入流通过转换流传递到输出
      const responseBody = response.body.pipeThrough(transformStream);
      
      // 创建响应头
      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('Access-Control-Allow-Origin', '*')
      responseHeaders.set('Access-Control-Allow-Headers', '*')
      
      // 删除Content-Length头，避免与Transfer-Encoding冲突
      if (responseHeaders.has('Content-Length')) {
        responseHeaders.delete('Content-Length')
      }
      responseHeaders.set('Transfer-Encoding', 'chunked')
      responseHeaders.set('X-Content-Type-Options', 'nosniff')
      
      return new Response(responseBody, {
        status: response.status,
        headers: responseHeaders
      })
    } catch (error) {
      retries++;
      
      // 如果是最后一次重试还失败，则抛出错误
      if (retries > maxRetries) {
        console.error('Serverless代理请求失败，已重试最大次数:', error);
        throw error;
      }
      
      // 短暂延迟后重试
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
} 