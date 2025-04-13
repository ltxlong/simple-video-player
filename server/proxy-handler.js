// 添加可选的Cloudflare sockets导入
let connect;
try {
  const cloudflare = require('cloudflare:sockets');
  connect = cloudflare?.connect;
} catch (e) {
  // 不在Cloudflare环境中，忽略错误
  console.log('不在Cloudflare环境中，TCP代理将使用Node.js net模块');
}

// 导入Node.js的net模块，用于非Cloudflare环境
let net;
try {
  net = require('net');
} catch (e) {
  // 在Cloudflare环境中可能没有net模块
  console.log('不能导入net模块，可能在Cloudflare环境中');
}

/**
 * 判断一个字符串是否为IPv4地址
 * @param {string} str - 要检查的字符串
 * @returns {boolean} - 是否为IPv4地址
 */
function isIPv4(str) {
  // IPv4正则表达式
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipv4Regex.test(str);
}

/**
 * 判断一个字符串是否为IPv6地址
 * @param {string} str - 要检查的字符串
 * @returns {boolean} - 是否为IPv6地址
 */
function isIPv6(str) {
  let new_str = str.replace(/\[|\]/g, "");
  const ipv6Regex =
    /^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$/;
  return ipv6Regex.test(new_str);
}

/**
 * 判断一个字符串是否为IP地址(IPv4或IPv6)
 * @param {string} str - 要检查的字符串
 * @returns {boolean} - 是否为IP地址
 */
function isIP(str) {
  // 判断是IPv4还是IPv6
  if (str.includes("[") && str.includes("]")) {
    return isIPv6(str);
  } else {
    return isIPv4(str);
  }
}

/**
 * 使用fetch API从远程服务器获取响应，支持连接和下载分离超时控制
 * @param {Request} request - 请求对象
 * @param {number} connectionTimeout - 连接超时时间(毫秒)
 * @param {number} downloadTimeout - 下载超时时间(毫秒)
 * @param {number} retryCount - 重试次数
 * @returns {Promise<Response>} - 响应对象
 */
async function fetchWithTimeout(request, connectionTimeout = 5000, downloadTimeout = 30000, retryCount = 2) {
  const url = new URL(request.url);
  
  // 判断是否是直播流相关资源
  const isStreamResource = url.pathname.endsWith('.m3u8') || 
                          url.pathname.endsWith('.m3u') || 
                          url.pathname.endsWith('.ts') ||
                          url.pathname.includes('?ts=');

  // 对于m3u8文件可以用更短的下载超时，但对于连接超时我们需要更长的时间
  let effectiveConnectionTimeout = connectionTimeout;
  let effectiveDownloadTimeout = downloadTimeout;
  
  if (isStreamResource) {
    if (url.pathname.endsWith('.m3u8') || url.pathname.endsWith('.m3u')) {
      // 索引文件通常较小，可以用更短的下载超时，但连接超时保持较长
      effectiveDownloadTimeout = 10000;
    } else if (url.pathname.endsWith('.ts') || url.pathname.includes('?ts=')) {
      // TS文件可能较大，保持较长的下载超时
      effectiveDownloadTimeout = 30000;
    }
  }
  
  let lastError = null;
  // 重试循环
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      console.log(`第${attempt}次重试请求: ${url.toString()}`);
      // 每次重试增加连接超时时间
      effectiveConnectionTimeout = effectiveConnectionTimeout * 1.5;
    }
    
    // 创建两个AbortController
    const connectionController = new AbortController();
    const downloadController = new AbortController();
    
    // 设置连接超时
    const connectionTimeoutId = setTimeout(() => {
      console.log(`连接超时(${effectiveConnectionTimeout}ms): ${url.toString()}`);
      connectionController.abort();
    }, effectiveConnectionTimeout);
    
    try {
      // 开始fetch请求，使用连接controller
      console.log(`发起请求: ${url.toString()}, 连接超时: ${effectiveConnectionTimeout}ms, 下载超时: ${effectiveDownloadTimeout}ms`);
      const fetchPromise = fetch(request, {
        signal: connectionController.signal
      });
      
      // 等待响应（连接成功）
      const response = await fetchPromise;
      
      // 连接成功后，清除连接超时
      clearTimeout(connectionTimeoutId);
      console.log(`连接成功: ${url.toString()}`);
      
      // 如果是m3u8文件，确保设置正确的头部并直接读取内容
      if (response.headers.get('content-type')?.includes('application/vnd.apple.mpegurl') ||
          url.pathname.endsWith('.m3u8') || url.pathname.endsWith('.m3u')) {
        
        // 设置下载超时
        const downloadTimeoutId = setTimeout(() => {
          console.log(`下载超时(${effectiveDownloadTimeout}ms): ${url.toString()}`);
          downloadController.abort();
        }, effectiveDownloadTimeout);
        
        try {
          // 使用克隆的响应避免重复读取
          const responseClone = response.clone();
          const content = await responseClone.text();
          
          // 清除下载超时
          clearTimeout(downloadTimeoutId);
          
          // 设置新的头部
          const newHeaders = new Headers(response.headers);
          newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          newHeaders.set('Pragma', 'no-cache');
          newHeaders.set('Expires', '0');
          newHeaders.set('Access-Control-Allow-Origin', '*');
          newHeaders.set('Access-Control-Allow-Headers', '*');
          
          return new Response(content, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
          });
        } catch (error) {
          clearTimeout(downloadTimeoutId);
          if (error.name === 'AbortError') {
            throw new Error('下载超时');
          }
          throw error;
        }
      }
      
      // 处理其他类型的响应
      // 设置下载超时
      const downloadTimeoutId = setTimeout(() => {
        console.log(`下载超时(${effectiveDownloadTimeout}ms): ${url.toString()}`);
        downloadController.abort();
      }, effectiveDownloadTimeout);
      
      try {
        // 读取响应体
        const reader = response.body.getReader();
        const chunks = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        
        // 清除下载超时
        clearTimeout(downloadTimeoutId);
        
        // 重建响应体
        const bodyData = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          bodyData.set(chunk, offset);
          offset += chunk.length;
        }
        
        // 返回新的响应
        return new Response(bodyData, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
        
      } catch (error) {
        clearTimeout(downloadTimeoutId);
        if (error.name === 'AbortError') {
          throw new Error('下载超时');
        }
        throw error;
      }
    } catch (error) {
      clearTimeout(connectionTimeoutId);
      console.error(`fetch错误 (尝试 ${attempt+1}/${retryCount+1})`, error);
      
      // 保存最后一次错误
      lastError = error;
      
      // 如果不是最后一次尝试，则继续下一次循环
      if (attempt < retryCount) {
        continue;
      }
      
      // 最后一次尝试失败，返回错误响应
      if (error.name === 'AbortError' || error.message === '连接超时') {
        return new Response('连接超时', { 
          status: 504,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } else if (error.message === '下载超时') {
        return new Response('下载超时', { 
          status: 504,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      return new Response(`请求失败: ${error.message}`, { 
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
  
  // 这里应该永远不会到达，因为循环中已经处理了所有情况
  return new Response(`所有重试均失败`, { 
    status: 500,
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

/**
 * 查找HTTP响应中头部和正文之间的双CRLF分隔符位置
 * @param {Uint8Array} data - 要搜索的数据
 * @returns {number} - 分隔符的索引位置，未找到则返回-1
 */
function indexOfDoubleCRLF(data) {
  if (data.length < 4) {
    return -1;
  }
  for (let i = 0; i < data.length - 3; i++) {
    if (
      data[i] === 13 &&
      data[i + 1] === 10 &&
      data[i + 2] === 13 &&
      data[i + 3] === 10
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * 从TCP socket构建HTTP响应
 * @param {Object} tcpSocket - Cloudflare TCP socket对象
 * @param {number} timeout - 超时时间(毫秒)
 * @returns {Promise<Response>} - HTTP响应对象
 */
async function constructHttpResponse(tcpSocket, timeout = 30000) {
  const reader = tcpSocket.readable.getReader();
  let remainingData = new Uint8Array(0);
  
  try {
    // 设置超时
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reader.releaseLock();
        tcpSocket.close();
        reject(new Error('TCP响应超时'));
      }, timeout);
    });
    
    // 读取响应数据
    while (true) {
      const readPromise = reader.read();
      const result = await Promise.race([readPromise, timeoutPromise]);
      const { value, done } = result;
      
      if (value) {
        const newData = new Uint8Array(remainingData.length + value.length);
        newData.set(remainingData);
        newData.set(value, remainingData.length);
        remainingData = newData;
      }
      
      const index = indexOfDoubleCRLF(remainingData);
      if (index !== -1) {
        reader.releaseLock();
        clearTimeout(timeoutId);
        
        const headerBytes = remainingData.subarray(0, index);
        const bodyBytes = remainingData.subarray(index + 4);

        const header = new TextDecoder().decode(headerBytes);
        const [statusLine, ...headers] = header.split("\r\n");
        const [httpVersion, statusCode, ...tmpStatusText] = statusLine.split(" ");
        let statusText = tmpStatusText.join(" ");

        // 构造响应头
        let responseHeaders = {};
        headers.forEach((header) => {
          if (header.includes(": ")) {
            const [name, value] = header.split(": ", 2);
            responseHeaders[name.toLowerCase()] = value;
          }
        });

        console.log("响应状态码:", statusCode);
        
        // 处理206部分内容响应
        const status = parseInt(statusCode) || 200;
        const isPartialContent = status === 206;
        
        if (isPartialContent) {
          console.log("检测到206部分内容响应");
          // 确保Content-Range头存在
          if (responseHeaders["content-range"]) {
            console.log("Content-Range:", responseHeaders["content-range"]);
          }
        }
        
        // 构建响应对象
        const responseInit = {
          status: status,
          statusText: statusText || "OK",
          headers: new Headers(responseHeaders)
        };
        
        // 确保CORS头存在
        responseInit.headers.set('Access-Control-Allow-Origin', '*');
        responseInit.headers.set('Access-Control-Allow-Headers', '*');

        // 创建适当的流
        let stream;
        
        // 对于部分内容响应，确保使用正确的流类型
        if (isPartialContent && responseHeaders["content-range"]) {
          // 从Content-Range头解析大小 (例如: "bytes 0-1023/10485760")
          const match = responseHeaders["content-range"].match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/);
          if (match) {
            const start = parseInt(match[1]);
            const end = parseInt(match[2]);
            const size = match[3] === '*' ? null : parseInt(match[3]);
            const contentLength = end - start + 1;
            
            console.log(`部分内容范围: ${start}-${end}/${size || '未知'}, 长度: ${contentLength}字节`);
            
            if (typeof FixedLengthStream !== 'undefined') {
              stream = new FixedLengthStream(contentLength);
            } else {
              stream = new TransformStream();
            }
          } else {
            // 无法解析Content-Range，回退到TransformStream
            stream = new TransformStream();
          }
        } 
        // 使用Content-Length
        else if (responseHeaders["content-length"]) {
          const contentLength = parseInt(responseHeaders["content-length"]);
          console.log(`内容长度: ${contentLength}字节`);
          
          if (typeof FixedLengthStream !== 'undefined') {
            stream = new FixedLengthStream(contentLength);
          } else {
            stream = new TransformStream();
          }
        } 
        // 没有明确的长度信息，使用普通TransformStream
        else {
          stream = new TransformStream();
        }
        
        const readable = stream.readable;
        const writable = stream.writable;

        // 规避CF问题，延迟1ms执行
        setTimeout(() => {
          const writer = writable.getWriter();
          writer.write(bodyBytes).then(() => {
            writer.releaseLock();
            tcpSocket.readable.pipeTo(writable).catch(err => {
              console.error("管道错误:", err);
              tcpSocket.close();
            });
          }).catch(err => {
            console.error("写入错误:", err);
            writer.releaseLock();
            tcpSocket.close();
          });
        }, 1);

        return new Response(readable, responseInit);
      }
      
      if (done) {
        clearTimeout(timeoutId);
        tcpSocket.close();
        break;
      }
    }

    console.log("响应完成，但未找到响应头！");
    return new Response("未能正确解析TCP响应", { 
      status: 502,
      headers: { 
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      }
    });
  } catch (error) {
    console.error("构建响应时出错:", error);
    try {
      tcpSocket.close();
    } catch (e) {
      // 忽略关闭错误
    }
    
    return new Response(`构建响应时出错: ${error.message}`, { 
      status: 502,
      headers: { 
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      }
    });
  }
}

/**
 * 处理TCP代理请求
 * @param {string} host - 目标主机名或IP
 * @param {number} port - 目标端口
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @param {boolean} isServerless - 是否为Serverless环境
 * @returns {Promise} - 处理结果的Promise
 */
async function handleTCPProxy(host, port, req, res, isServerless = false) {
  console.log(`使用TCP代理连接到 ${host}:${port}`);
  
  try {
    // 检查是否在Cloudflare环境
    if (connect) {
      // 使用Cloudflare的connect函数
      console.log('使用Cloudflare Socket API进行TCP代理');
      
      try {
        const socket = connect(`${host}:${port}`);
        
        // 准备请求数据
        const method = req.method || 'GET';
        const path = req.url?.pathname + (req.url?.search || '') || req.path || '/';
        const requestHeaders = [];
        
        // 添加请求头
        for (const [name, value] of Object.entries(req.headers || {})) {
          if (name.toLowerCase() !== 'host') { // 避免发送原始host
            requestHeaders.push(`${name}: ${value}`);
          }
        }
        requestHeaders.push(`Host: ${host}`);
        
        // 构建HTTP请求
        const httpRequest = `${method} ${path} HTTP/1.1\r\n${requestHeaders.join('\r\n')}\r\n\r\n`;
        
        // 发送请求
        const writer = socket.writable.getWriter();
        await writer.write(new TextEncoder().encode(httpRequest));
        writer.releaseLock();
        
        // 使用新的响应构建函数
        const response = await constructHttpResponse(socket, 30000);
        
        // 返回响应
        if (isServerless) {
          return response;
        } else {
          // Express环境
          const responseData = await response.arrayBuffer();
          
          // 设置状态码和头部
          res.statusCode = response.status;
          for (const [key, value] of response.headers.entries()) {
            res.setHeader(key, value);
          }
          
          // 发送响应体
          res.end(Buffer.from(responseData));
          return;
        }
      } catch (error) {
        console.error('Cloudflare TCP代理错误:', error);
        if (isServerless) {
          return new Response(`Cloudflare TCP代理错误: ${error.message}`, { 
            status: 502,
            headers: { 
              'Content-Type': 'text/plain',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': '*'
            }
          });
        } else {
          res.status(502).json({ error: `Cloudflare TCP代理错误: ${error.message}` });
          return;
        }
      }
    } else if (net) {
      // 使用Node.js net模块
      console.log('使用Node.js net模块进行TCP代理');
      
      if (isServerless) {
        return new Response(JSON.stringify({ error: '此环境不支持Node.js net模块的TCP代理' }), { 
          status: 501,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Promise((resolve, reject) => {
        const client = net.connect(port, host, () => {
          console.log('TCP连接建立成功');
          
          // 准备请求数据
          const method = req.method || 'GET';
          const path = req.url || req.path || '/';
          const requestHeaders = [];
          
          // 添加请求头
          for (const [name, value] of Object.entries(req.headers || {})) {
            if (name !== 'host') { // 避免发送原始host
              requestHeaders.push(`${name}: ${value}`);
            }
          }
          requestHeaders.push(`Host: ${host}`);
          
          // 构建HTTP请求
          const httpRequest = `${method} ${path} HTTP/1.1\r\n${requestHeaders.join('\r\n')}\r\n\r\n`;
          
          // 发送请求
          client.write(httpRequest);
          
          // 响应数据
          let responseData = Buffer.alloc(0);
          
          client.on('data', (chunk) => {
            responseData = Buffer.concat([responseData, chunk]);
          });
          
          client.on('end', () => {
            console.log('TCP连接关闭');
            
            try {
              // 解析HTTP响应
              const responseText = responseData.toString();
              const [responseHead, ...bodyParts] = responseText.split('\r\n\r\n');
              const responseBody = bodyParts.join('\r\n\r\n');
              
              const [statusLine, ...headerLines] = responseHead.split('\r\n');
              const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d+) (.*)/);
              
              const status = statusMatch ? parseInt(statusMatch[1]) : 200;
              
              // 解析头部
              const responseHeaders = new Headers();
              for (const line of headerLines) {
                const [name, ...valueParts] = line.split(':');
                if (name && valueParts.length > 0) {
                  const value = valueParts.join(':').trim();
                  responseHeaders.append(name, value);
                }
              }
              
              // 确保CORS头存在
              responseHeaders.set('Access-Control-Allow-Origin', '*');
              responseHeaders.set('Access-Control-Allow-Headers', '*');
              
              // 设置响应头
              for (const [key, value] of responseHeaders.entries()) {
                res.setHeader(key, value);
              }
              
              res.statusCode = status;
              res.end(responseBody);
              resolve();
            } catch (error) {
              console.error('解析TCP响应时出错:', error);
              res.status(500).json({ error: `解析TCP响应时出错: ${error.message}` });
              resolve();
            }
          });
          
          client.on('error', (err) => {
            console.error('TCP连接错误:', err);
            res.status(500).json({ error: `TCP连接错误: ${err.message}` });
            resolve();
          });
        });
        
        client.on('error', (err) => {
          console.error('建立TCP连接时出错:', err);
          res.status(500).json({ error: `建立TCP连接时出错: ${err.message}` });
          resolve();
        });
      });
    } else {
      // 没有可用的TCP代理实现
      console.error('没有可用的TCP代理实现');
      if (isServerless) {
        return new Response(JSON.stringify({ error: '此环境不支持TCP代理' }), { 
          status: 501,
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        res.status(501).json({ error: '此环境不支持TCP代理' });
      }
    }
  } catch (error) {
    console.error('TCP代理处理错误:', error);
    
    if (isServerless) {
      return new Response(JSON.stringify({ error: `TCP代理处理失败: ${error.message}` }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      res.status(500).json({ error: `TCP代理处理失败: ${error.message}` });
    }
  }
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
    processedUrl = processedUrl.replace(/(?:\?|&)(live=true|live%3Dtrue)$/, '');
    
    if (processedUrl.includes('_the_proxy_ts_url_')) {
      const tpProxyUrl_split_arr = processedUrl.split('_the_proxy_ts_url_');
      const tsProxyUrl_0 = tpProxyUrl_split_arr[0];
      const tsProxyUrl_1 = tpProxyUrl_split_arr[1];
      processedUrl = tsProxyUrl_0 + '?ts=' + tsProxyUrl_1;
    }
    
    try {
      const targetUrl = new URL(processedUrl);
      const hostname = targetUrl.hostname;
      const port = targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80);
      
      // 检查是否是IP地址
      if (isIP(hostname)) {
        console.log(`检测到IP地址: ${hostname}，使用TCP代理`);
        return await handleTCPProxy(hostname, port, req, res, isServerless);
      }
      
      // 对于域名，继续使用HTTP代理
      const proxyRequest = new Request(targetUrl.toString(), {
        method: 'GET',
        headers: new Headers({
          'User-Agent': req.headers?.['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Range': req.headers?.range || '',
          'Referer': targetUrl.origin,
          'Origin': targetUrl.origin,
        }),
        redirect: 'manual' // 手动处理重定向
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
      const proxyResponse = await fetchWithTimeout(proxyRequest);
      
      // Serverless环境处理
      if (isServerless) {
        // 确保CORS头存在
        const headers = new Headers(proxyResponse.headers);
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
        for (const [key, value] of proxyResponse.headers.entries()) {
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
