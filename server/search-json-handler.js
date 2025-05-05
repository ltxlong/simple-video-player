// 搜索处理程序
export async function handleSearchJsonRequest(req, res) {
  try {
    const { url, isPost, postData } = req.body

    if (!url) {
      return res.status(400).json({ error: '缺少必要的URL参数' })
    }

    // 构建请求选项
    const requestOptions = {
      method: isPost ? 'POST' : 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }
    }

    // 如果是POST请求，添加表单数据
    if (isPost && postData) {
      requestOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded'
      
      // 构建表单数据
      const params = new URLSearchParams()
      Object.entries(postData).forEach(([key, value]) => {
        params.append(key, String(value))
      })
      requestOptions.body = params.toString()
    }

    // 发送请求
    try {

      const response = await fetch(url, requestOptions)
      
      if (!response.ok) {

        return res.status(response.status).json({ 
          error: `请求失败`,
          status: response.status,
          statusText: response.statusText
        })
      }

      // 获取响应内容
      const data = await response.json()
      
      // 否则返回完整HTML
      return res.set('Content-Type', 'application/json; charset=utf-8').send(data)
    } catch (fetchError) {
      return res.status(500).json({ 
        error: '请求外部资源失败',
        message: fetchError.message
      })
    }
  } catch (error) {
    return res.status(500).json({ 
      error: '搜索处理失败',
      message: error.message || '未知错误'
    })
  }
} 