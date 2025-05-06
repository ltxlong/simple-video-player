import { handleConfigRequest } from '../../../src/api/server.js'

export const onRequest = async ({ request, env }) => {
  // 设置 CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json'
  }

  try {
    return await handleConfigRequest(request, env)
  } catch (error) {
    console.error('配置请求处理失败:', error)
    return new Response(JSON.stringify({ 
      error: '服务器错误',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: corsHeaders
    })
  }
} 
