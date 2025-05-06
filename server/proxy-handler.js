/**
 * 过滤掉Cloudflare和Vercel相关的HTTP头
 * @param {Headers|Object} headers - 原始头信息
 * @returns {Headers} - 过滤后的头信息
 */
function filterPlatformHeaders(headers) {
  const filteredHeaders = new Headers();
  
  // 处理Headers对象
  if (headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      // 跳过Cloudflare和Vercel相关头
      if (key.toLowerCase().startsWith('cf-') || 
          key.toLowerCase().startsWith('x-vercel-') ||
          key.toLowerCase().startsWith('x-forwarded-') ||
          (key.toLowerCase() === 'server' && (value.includes('cloudflare') || value.includes('vercel')))
      ) {
        console.log(`过滤平台头: ${key}`);
        continue;
      }
      filteredHeaders.set(key, value);
    }
  } 
  // 处理普通对象
  else if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      // 跳过Cloudflare和Vercel相关头
      if (key.toLowerCase().startsWith('cf-') || 
          key.toLowerCase().startsWith('x-vercel-') ||
          key.toLowerCase().startsWith('x-forwarded-') ||
          (key.toLowerCase() === 'server' && (value.includes('cloudflare') || value.includes('vercel')))
      ) {
        console.log(`过滤平台头: ${key}`);
        continue;
      }
      filteredHeaders.set(key, value);
    }
  }
  
  return filteredHeaders;
}

/**
 * 处理代理请求的核心逻辑
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @returns {Promise} - 处理结果的Promise
 */
export async function handleProxyRequest(req, res, isServerless = false) {
  // 防止未捕获的Promise rejection导致程序崩溃
  process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise rejection:', reason);
  });
  
  try {
    // 获取查询参数
    const videoUrl = req.query?.url || req.url?.searchParams?.get('url');
    
    if (!videoUrl) {
      return isServerless 
        ? new Response(JSON.stringify({ error: '缺少视频URL参数' }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          })
        : res.status(400).json({ error: '缺少视频URL参数' });
    }

    // 处理URL
    let processedUrl = videoUrl;
    
    // 处理特殊URL格式
    if (processedUrl.includes('_the_proxy_ts_url_')) {
      const tpProxyUrl_split_arr = processedUrl.split('_the_proxy_ts_url_');
      const tsProxyUrl_0 = tpProxyUrl_split_arr[0];
      const tsProxyUrl_1 = tpProxyUrl_split_arr[1];
      processedUrl = tsProxyUrl_0 + '?ts=' + tsProxyUrl_1;
    }
    
    try {   
      // 未配置代理URL，使用原始逻辑
      const targetUrl = new URL(processedUrl); 
      
      // 对于域名，继续使用HTTP代理
      const headers = {
        'User-Agent': req.headers?.['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': targetUrl.origin,
        'Origin': targetUrl.origin,
      };
      if (req.headers?.range) {
        headers['Range'] = req.headers.range;
      }
      const proxyRequest = new Request(targetUrl.toString(), {
        method: 'GET',
        headers: new Headers(headers),
        redirect: 'follow'
      });
      
      // 添加其他有用的请求头
      const headersToForward = [
        'if-none-match', 'if-modified-since', 'cookie', 'authorization'
      ];
      
      headersToForward.forEach(header => {
        if (req.headers?.[header]) {
          proxyRequest.headers.set(header, req.headers[header]);
        }
      });
      
      // 执行fetch请求
      console.log('使用fetch API处理请求:', targetUrl.toString());
      const proxyResponse = await fetch(proxyRequest);
      
      // Serverless环境处理
      if (isServerless) {
        // 确保CORS头存在
        const headers = filterPlatformHeaders(proxyResponse.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Headers', '*');
        
        return new Response(proxyResponse.body, {
          status: proxyResponse.status,
          statusText: proxyResponse.statusText,
          headers: headers
        });
      }
      
      // Express环境处理
      try {
        // 复制响应头
        const filteredHeaders = filterPlatformHeaders(proxyResponse.headers);
        for (const [key, value] of filteredHeaders.entries()) {
          res.setHeader(key, value);
        }
        
        // 确保CORS头存在
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        
        // 设置状态码
        res.statusCode = proxyResponse.status;
        
        // 获取响应体并发送
        const responseBody = await proxyResponse.arrayBuffer();
        res.end(Buffer.from(responseBody));
      } catch (error) {
        console.error('发送响应时出错:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: `发送响应时出错: ${error.message}` });
        }
      }
      
      return;
    } catch (error) {
      console.error('代理请求过程中出错:', error);
      if (isServerless) {
        return new Response(JSON.stringify({ error: `代理请求过程中出错: ${error.message}` }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      } else if (!res.headersSent) {
        res.status(500).json({ error: `代理请求过程中出错: ${error.message}` });
      }
      return;
    }
  } catch (error) {
    console.error('代理处理错误:', error);
    
    if (isServerless) {
      return new Response(JSON.stringify({ error: `代理处理失败: ${error.message}` }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    } else if (!res.headersSent) {
      res.status(500).json({ error: `代理处理失败: ${error.message}` });
    }
    return;
  }
} 
