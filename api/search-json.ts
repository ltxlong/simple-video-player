import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // 设置CORS头
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  // 处理OPTIONS请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // 只接受POST请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { url, isPost, postData, className } = req.body

    if (!url) {
      return res.status(400).json({ error: '缺少必要的URL参数' })
    }

    // 构建请求选项
    const requestOptions: RequestInit = {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    }

    // 如果是POST请求
    if (isPost && postData) {
      requestOptions.method = 'POST'
      requestOptions.headers = {
        ...requestOptions.headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
      
      // 将JSON对象转换为URL编码的表单数据
      const params = new URLSearchParams()
      Object.entries(postData).forEach(([key, value]) => {
        params.append(key, String(value))
      })
      requestOptions.body = params.toString()
    }

    // 发送请求
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
    
    return res.status(200).send(data)
    
  } catch (error) {
    console.error('搜索错误:', error)
    return res.status(500).json({ 
      error: '搜索处理失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
} 