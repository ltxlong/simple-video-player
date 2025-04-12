import net from 'net'
import tls from 'tls'

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
 * 查找HTTP头部结束位置（双CRLF）
 * @param {Uint8Array} data - 要检查的数据
 * @returns {number} - 双CRLF的索引位置，如果未找到则返回-1
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
 * 代理化URL，用于处理重定向和HLS流
 * @param {string} url - 要处理的URL
 * @returns {string} - 处理后的URL
 */
function proxify(url) {
  // 如果是完整URL
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // 返回代理URL格式
    return `/api/proxy?url=${url}`;
  }
  
  // 相对URL暂时返回原样
  return url;
}

/**
 * 使用TCP连接从远程服务器获取响应
 * @param {Request} request - 请求对象
 * @returns {Promise<Response>} - 响应对象
 */
async function fetchOverTcp(request) {
  const url = new URL(request.url);
  const req = new Request(url, request);
  let port = parseInt(url.port);
  
  if (!port) {
    port = url.protocol === "https:" ? 443 : 80;
  }

  // 对于标准端口和非IP地址，可以使用普通fetch
  if (
    ((url.protocol === "https:" && port === 443) ||
     (url.protocol === "http:" && port === 80)) &&
    !isIP(url.hostname)
  ) {
    console.log('使用原生fetch');
    return await fetch(req);
  }

  return new Promise((resolve, reject) => {
    try {
      // 创建 TCP 连接
      let socket = null;
      
      if (url.protocol === "https:") {
        socket = tls.connect({
          host: url.hostname,
          port: port,
          rejectUnauthorized: false
        });
      } else {
        socket = net.connect({
          host: url.hostname,
          port: port
        });
      }

      socket.on('error', (err) => {
        console.error('TCP连接错误:', err);
        socket.destroy();
        reject(new Response(`TCP连接错误: ${err.message}`, { status: 500 }));
      });

      socket.on('connect', () => {
        // 构造请求头部
        let headersString = "";
        
        for (const [name, value] of req.headers) {
          if (
            name === "connection" ||
            name === "host" ||
            name === "accept-encoding"
          ) {
            continue;
          }
          headersString += `${name}: ${value}\r\n`;
        }
        
        headersString += `connection: close\r\n`;
        headersString += `accept-encoding: identity\r\n`;

        let fullpath = url.pathname;

        // 如果有查询参数，添加到路径
        if (url.search) {
          fullpath += url.search.replace(/%3F/g, "?");
        }

        // 发送HTTP请求
        const requestString = `${req.method} ${fullpath} HTTP/1.0\r\nHost: ${url.hostname}:${port}\r\n${headersString}\r\n`;
        socket.write(requestString);
      });

      // 处理响应
      let responseData = Buffer.alloc(0);
      
      socket.on('data', (chunk) => {
        // 拼接响应数据
        const newData = Buffer.alloc(responseData.length + chunk.length);
        newData.set(new Uint8Array(responseData), 0);
        newData.set(new Uint8Array(chunk), responseData.length);
        responseData = newData;

        // 查找头部结束位置
        const headerEndIndex = indexOfDoubleCRLF(responseData);
        
        if (headerEndIndex !== -1) {
          // 已找到头部结束位置，可以解析响应
          const headerBytes = responseData.subarray(0, headerEndIndex);
          const bodyBytes = responseData.subarray(headerEndIndex + 4);

          // 解析头部
          const headerText = new TextDecoder().decode(headerBytes);
          const [statusLine, ...headerLines] = headerText.split("\r\n");
          const [httpVersion, statusCode, ...statusTextParts] = statusLine.split(" ");
          const statusText = statusTextParts.join(" ");

          // 构造响应头
          const headers = new Headers();
          
          headerLines.forEach((line) => {
            if (line.trim() === '') return;
            
            const separatorIndex = line.indexOf(': ');
            if (separatorIndex > 0) {
              const name = line.substring(0, separatorIndex).trim();
              const value = line.substring(separatorIndex + 2).trim();
              
              // 过滤掉一些特定的头
              if (!name.toLowerCase().startsWith('cf-') && 
                  !name.toLowerCase().startsWith('x-vercel-') && 
                  !name.toLowerCase().startsWith('cloudflare-')) {
                headers.set(name, value);
              }
            }
          });

          // 添加CORS头
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('Access-Control-Allow-Headers', '*');

          // 对于重定向响应，修改Location头
          const status = parseInt(statusCode, 10);
          if ([301, 302, 303, 307, 308].includes(status) && headers.has('location')) {
            const locationUrl = new URL(headers.get('location'), url);
            headers.set('location', proxify(locationUrl.href));
          }

          // 对于HLS内容，代理化URL
          if (headers.get('content-type') === 'application/vnd.apple.mpegurl') {
            const bodyText = new TextDecoder().decode(bodyBytes);
            const proxifiedBody = proxify(bodyText);
            
            // 移除socket监听器
            socket.removeAllListeners();
            socket.destroy();
            
            resolve(new Response(proxifiedBody, {
              status,
              statusText,
              headers
            }));
            
            return;
          }

          // 创建响应
          const response = new Response(
            new Blob([bodyBytes]), 
            {
              status,
              statusText,
              headers
            }
          );

          // 移除socket监听器
          socket.removeAllListeners();
          socket.destroy();
          
          resolve(response);
        }
      });

      socket.on('end', () => {
        if (responseData.length === 0) {
          // 没有接收到任何数据
          resolve(new Response('未接收到任何响应数据', { status: 502 }));
        }
      });

      // 设置超时
      socket.setTimeout(10000, () => {
        socket.destroy();
        reject(new Response('连接超时', { status: 504 }));
      });
    } catch (error) {
      console.error('fetchOverTcp异常:', error);
      reject(new Response(`TCP代理错误: ${error.message}`, { status: 500 }));
    }
  });
}

/**
 * 处理代理请求的核心逻辑
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @returns {Promise} - 处理结果的Promise
 */
export async function handleProxyRequest(req, res, isServerless = false) {
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
    
    // 使用TCP代理进行请求
    const targetUrl = new URL(processedUrl);
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
    
    // 执行TCP代理请求
    const proxyResponse = await fetchOverTcp(proxyRequest);
    
    // Serverless环境处理
    if (isServerless) {
      return proxyResponse;
    }
    
    // Express环境处理
    // 复制响应头
    for (const [key, value] of proxyResponse.headers.entries()) {
      res.setHeader(key, value);
    }
    
    // 设置状态码
    res.statusCode = proxyResponse.status;
    
    // 获取响应体并发送
    const responseBody = await proxyResponse.arrayBuffer();
    res.end(Buffer.from(responseBody));
    
    return;
  } catch (error) {
    console.error('代理处理错误:', error);
    
    return isServerless
      ? new Response(JSON.stringify({ error: `代理处理失败: ${error.message}` }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      : res.status(500).json({ error: `代理处理失败: ${error.message}` });
  }
} 
