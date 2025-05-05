import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { Config } from '../../src/types'
import mysql from 'mysql2/promise'
import { withDatabase } from '../../src/utils/db.js'
import jwt from 'jsonwebtoken'
import postgres from 'postgres'

// 默认配置
const defaultConfig: Config = {
  resourceSites: [],
  parseApi: '',
  backgroundImage: '',
  enableLogin: false,
  loginPassword: '',
  announcement: '',
  customTitle: '',
  enableHealthFilter: true,
  proxyVideoUrl: '',
  proxyLiveUrl: '',
  enableHotMovies: false,
  hotMoviesProxyUrl: '',
  hotTvDefaultTag: '',
  hotMovieDefaultTag: '',
  autoPlayNext: false
}

// 验证JWT令牌
function verifyToken(token: string): any {
  try {
    const decoded = jwt.verify(token, process.env.LOGIN_JWT_SECRET_KEY || 'fallback_secret_key')
    return decoded
  } catch (error) {
    console.error('Token验证失败:', error)
    return null
  }
}

// 处理请求
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  // 处理 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    let config: Config = defaultConfig

    try {
      // withDatabase会自动选择使用SQL_DSN或PG_CONNECTION_STRING
      await withDatabase(async (connection, dbType) => {
        if (dbType === 'mysql') {
          // MySQL查询
          const mysqlConn = connection as mysql.PoolConnection
          const [rows] = await mysqlConn.query('SELECT config FROM configs ORDER BY id DESC LIMIT 1') as [mysql.RowDataPacket[], mysql.FieldPacket[]]
          if (Array.isArray(rows) && rows.length > 0) {
            const row = rows[0]
            config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config
          }
        } else {
          // PostgreSQL查询
          const pgConn = connection as ReturnType<typeof postgres>
          const result = await pgConn`SELECT config FROM configs ORDER BY id DESC LIMIT 1`
          if (result.length > 0) {
            // 确保正确解析PostgreSQL返回的配置数据
            const pgConfig = result[0].config
            config = typeof pgConfig === 'string' ? JSON.parse(pgConfig) : pgConfig
          }
        }
      })
    } catch (error) {
      console.error('数据库查询失败:', error)
      // 失败时使用默认配置
    }

    if (!config.enableLogin) {
      // 移除敏感信息
      const { loginPassword, ...publicConfig } = config
      return res.status(200).json(publicConfig)
    }

    // 获取请求头中的 token
    const token = req.headers.authorization?.replace('Bearer ', '')
    
    if (!token) {
      return res.status(401).json({ error: '未授权访问' })
    }

    // 验证令牌
    const decoded = verifyToken(token)
    if (!decoded) {
      return res.status(401).json({ error: '无效的令牌' })
    }

    // 移除敏感信息
    const { loginPassword, ...publicConfig } = config
    res.status(200).json(publicConfig)
  } catch (error) {
    console.error('获取配置失败:', error)
    res.status(500).json({ error: '服务器错误' })
  }
} 
