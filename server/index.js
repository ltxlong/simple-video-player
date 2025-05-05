import express from 'express'
import cors from 'cors'
import session from 'express-session'
import { getConfig, updateConfig, getPublicConfig, verifyPassword } from './config-handler.js'
import { handleSearchRequest } from './search-handler.js'
import { handleSearchJsonRequest } from './search-json-handler.js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import jwt from 'jsonwebtoken'
import { handleProxyRequest } from './proxy-handler.js'

// 加载 .env 文件
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env') })

// JWT 密钥
const JWT_SECRET = process.env.LOGIN_JWT_SECRET_KEY || 'your_secret_key'

const app = express()
app.use(cors({
  origin: true,
  credentials: true
}))
app.use(express.json())

// 配置session
app.use(session({
  secret: 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24小时
  }
}))

// 生成设备指纹
function generateDeviceFingerprint(req) {
  const fingerprint = {
    // 浏览器信息
    userAgent: req.headers['user-agent'] || 'unknown',
    acceptLanguage: req.headers['accept-language'] || 'unknown',
    acceptEncoding: req.headers['accept-encoding'] || 'unknown',
    
    // 客户端信息
    ip: req.ip || req.connection.remoteAddress,
    platform: req.headers['sec-ch-ua-platform'] || 'unknown',
    mobile: req.headers['sec-ch-ua-mobile'] || 'unknown',
    
    // 浏览器功能支持
    secFetch: {
      site: req.headers['sec-fetch-site'] || 'unknown',
      mode: req.headers['sec-fetch-mode'] || 'unknown',
      dest: req.headers['sec-fetch-dest'] || 'unknown'
    }
  }
  
  // 生成指纹哈希
  const fingerprintStr = JSON.stringify(fingerprint)
  return Buffer.from(fingerprintStr).toString('base64')
}

// 生成 JWT token
function generateToken(isAdmin = false, req) {
  const deviceFingerprint = generateDeviceFingerprint(req)
  return jwt.sign(
    { 
      isAdmin,
      deviceFingerprint,
      // 添加其他安全信息
      iat: Date.now(),  // token生成时间
      ip: req.ip || req.connection.remoteAddress  // 登录IP
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  )
}

// 验证 JWT token
function verifyToken(token, req) {
  try {
    //console.log('开始验证token')
    const decoded = jwt.verify(token, JWT_SECRET)
    //console.log('token解码成功:', { isAdmin: decoded.isAdmin })
    
    const currentFingerprint = generateDeviceFingerprint(req)
    /*
    console.log('设备指纹对比:', {
      tokenFingerprint: decoded.deviceFingerprint,
      currentFingerprint,
      tokenIP: decoded.ip,
      currentIP: req.ip || req.connection.remoteAddress
    })*/
    
    // 验证设备指纹是否匹配
    if (decoded.deviceFingerprint !== currentFingerprint) {
      //console.log('设备指纹不匹配')
      return null
    }
    
    //console.log('token验证成功')
    return decoded
  } catch (error) {
    //console.error('Token 验证失败:', error)
    return null
  }
}

// 检查登录状态
const checkAuth = (req, res, next) => {
  //console.log('检查登录状态')
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    //console.log('未提供token')
    return res.status(401).json({ error: '未登录' })
  }

  //console.log('开始验证token')
  const decoded = verifyToken(token, req)
  if (!decoded) {
    //console.log('token验证失败')
    return res.status(401).json({ error: '登录已过期或在其他设备登录' })
  }

  // 将解码后的信息保存到请求对象中
  req.user = decoded
  //console.log('token验证成功，用户信息:', { isAdmin: decoded.isAdmin })
  next()
}

// 检查管理员权限
const checkAdmin = (req, res, next) => {
  //console.log('检查管理员权限')
  if (!req.user.isAdmin) {
    //console.log('非管理员访问')
    return res.status(403).json({ error: '需要管理员权限' })
  }
  //console.log('管理员权限验证通过')
  next()
}

// 获取公开配置（不包含密码）
app.get('/api/config', checkAuth, async (req, res) => {
  try {
    const config = await getPublicConfig()
    res.json(config)
  } catch (error) {
    //console.error('获取配置失败:', error)
    res.status(500).json({ error: '获取配置失败' })
  }
})

// 验证登录密码
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { password, isAdmin } = req.body
    //console.log('收到登录请求:', { isAdmin })  // 添加日志,不要记录密码
    
    if (!password) {
      return res.status(400).json({ error: '密码不能为空' })
    }

    let isValid = false
    if (isAdmin) {
      // 管理后台验证
      isValid = password === (process.env.ADMIN_PASSWORD || '123456')
    } else {
      // 普通用户验证，不需要传入dsn参数
      isValid = await verifyPassword(password)
    }
    
    if (isValid) {
      // 生成 JWT token，包含设备指纹
      const token = generateToken(isAdmin, req)
      /*
      console.log('登录成功,生成token:', { 
        isAdmin,
        deviceFingerprint: generateDeviceFingerprint(req)
      })*/
      
      res.json({ 
        success: true,
        token
      })
    } else {
      //console.log('密码验证失败:', { isAdmin })
      res.status(401).json({ error: '密码错误' })
    }
  } catch (error) {
    //console.error('验证失败:', error)
    res.status(500).json({ error: '验证失败' })
  }
})

// 获取完整配置（需要管理员权限）
app.get('/api/admin/config', checkAuth, checkAdmin, async (req, res) => {
  try {
    const config = await getConfig()
    res.json(config)
  } catch (error) {
    //console.error('获取配置失败:', error)
    res.status(500).json({ error: '获取配置失败' })
  }
})

// 更新配置（需要管理员权限）
app.post('/api/admin/config', checkAuth, checkAdmin, async (req, res) => {
  try {
    const result = await updateConfig(req.body)
    
    if (result.success) {
      res.json({ message: '配置更新成功~' })
    } else {
      res.status(500).json({ error: result.message })
    }
  } catch (error) {
    //console.error('更新配置失败:', error)
    res.status(500).json({ error: '更新配置失败' })
  }
})

// 获取首页配置（不需要验证）
app.get('/api/home/config', async (req, res) => {
  try {
    const config = await getPublicConfig()
    
    // 如果不需要登录，直接返回配置
    if (!config.enableLogin) {
      return res.json(config)
    }

    // 如果需要登录，检查token
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) {
      return res.status(401).json({ error: '未登录' })
    }

    const decoded = verifyToken(token, req)
    if (!decoded) {
      return res.status(401).json({ error: '登录已过期或在其他设备登录' })
    }

    res.json(config)
  } catch (error) {
    //console.error('获取配置失败:', error)
    res.status(500).json({ error: '获取配置失败' })
  }
})

// 添加搜索 API 端点
app.post('/api/search', async (req, res) => {
  await handleSearchRequest(req, res)
})

// 添加搜索 JSON API 端点
app.post('/api/search-json', async (req, res) => {
  await handleSearchJsonRequest(req, res)
})

// 视频代理路由
app.get('/api/proxy', async (req, res) => {
  await handleProxyRequest(req, res)
})

const port = process.env.API_PORT || 3001
app.listen(port, () => {
  console.log(`API 服务器运行在 http://localhost:${port}`)
})
