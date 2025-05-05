import type { Config, PublicConfig } from '../types/index.js'
import { getConfig, updateConfig } from './config-handler.js'
import bcrypt from 'bcryptjs'

/**
 * 生成JWT令牌
 * @param isAdmin 是否为管理员
 * @param request 请求对象
 * @returns JWT令牌
 */
function generateToken(isAdmin: boolean, request: Request): string {
  // 简单实现，实际项目中应使用完整的JWT库
  const payload = {
    isAdmin,
    timestamp: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24小时后过期
    ip: request.headers.get('cf-connecting-ip') || '未知IP'
  }
  
  // 在实际项目中，使用jwt库如jsonwebtoken进行完整实现
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

interface CloudflareEnv {
  SQL_DSN?: string
  LOGIN_JWT_SECRET_KEY?: string
  VIDEO_CONFIG?: any
  VIDEO_CONFIG_ID?: any
  PG_CONNECTION_STRING?: string
  ADMIN_PASSWORD?: string
}

// 处理配置相关的API请求
export async function handleConfigRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json'
  }

  // 处理OPTIONS请求（预检请求）
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // 判断是否为前台首页请求
    const isHomeRequest = request.url.includes('/api/home/config')

    if (request.method === 'GET') {
      const config = await getConfig(env)
      
      // 如果是前台请求，移除敏感字段
      if (isHomeRequest) {
        // 使用解构赋值移除loginPassword字段
        const { loginPassword, ...publicConfig } = config
        return new Response(JSON.stringify(publicConfig), { headers: corsHeaders })
      }
        
      // 管理后台返回完整配置
      return new Response(JSON.stringify(config), { headers: corsHeaders })
    } else if (request.method === 'POST') {
      // 前台不应该允许POST请求修改配置
      if (isHomeRequest) {
        return new Response(JSON.stringify({ error: '操作不允许' }), { 
          status: 403,
          headers: corsHeaders 
        })
      }
      
      const config = await request.json()

      const result = await updateConfig(config, env)
      
      if (result.success) {
        return new Response(JSON.stringify({ message: result.message }), { headers: corsHeaders })
      } else {
        return new Response(JSON.stringify({ error: result.message }), { 
          status: 500,
          headers: corsHeaders 
        })
      }
    }

    return new Response('Method not allowed', { 
      status: 405,
      headers: corsHeaders 
    })
  } catch (error) {
    console.error('处理请求失败:', error)
    return new Response(JSON.stringify({ 
      error: '处理请求失败', 
      details: error instanceof Error ? error.message : String(error)
    }), { 
      status: 500,
      headers: corsHeaders 
    })
  }
}

// 获取公开配置（不包含密码）
export async function getPublicConfig(env?: CloudflareEnv): Promise<PublicConfig> {
  const config = await getConfig(env)
  const { loginPassword, ...publicConfig } = config
  return publicConfig
}

/**
 * 验证登录密码
 * @param password 用户输入的密码
 * @param env Cloudflare环境对象
 * @returns 密码是否有效
 */
export async function verifyPassword(password: string, env?: any): Promise<boolean> {
  try {

    // 从数据库获取配置
    const config = await getConfig(env);
    
    // 检查是否启用了登录
    if (!config.enableLogin) {
      return false;
    }
    
    // 验证密码
    if (config.loginPassword === password) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('验证密码失败:', error);
    return false;
  }
}

// 加密密码
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 10)
}

// 更新配置时加密密码
export async function updateConfigWithHash(config: Config, env?: CloudflareEnv) {
  if (config.loginPassword) {
    config.loginPassword = await hashPassword(config.loginPassword)
  }
  return await updateConfig(config, env)
}

/**
 * 处理验证请求
 */
export async function handleAuthRequest(request: Request, env: any): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json'
  };

  // 处理OPTIONS请求（预检请求）
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { password, isAdmin } = await request.json();
    
    let isValid = false;
    if (isAdmin) {
      // 管理员验证
      isValid = password === (env.ADMIN_PASSWORD || '123456');
    } else {
      // 普通用户验证
      isValid = await verifyPassword(password, env);
    }
    
    if (isValid) {
      // 生成JWT令牌
      const token = generateToken(isAdmin, request);
      
      return new Response(JSON.stringify({ 
        success: true,
        token 
      }), {
        status: 200,
        headers: corsHeaders
      });
    } else {
      return new Response(JSON.stringify({ error: '密码错误' }), {
        status: 401,
        headers: corsHeaders
      });
    }
  } catch (error) {
    console.error('验证失败:', error);
    return new Response(JSON.stringify({ 
      error: '验证失败',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
