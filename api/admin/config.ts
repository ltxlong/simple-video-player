import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { Config } from '../../src/types'
import mysql from 'mysql2/promise'
import { withDatabase } from '../../src/utils/db.js'
import jwt from 'jsonwebtoken'
import postgres from 'postgres'

// 默认配置
const defaultConfig: Config = {
  resourceSites: process.env.RESOURCE_SITES ? JSON.parse(process.env.RESOURCE_SITES) : [],
  parseApi: process.env.PARSE_API || '',
  backgroundImage: process.env.BACKGROUND_IMAGE || '',
  enableLogin: process.env.ENABLE_LOGIN === 'true',
  loginPassword: process.env.LOGIN_PASSWORD || '',
  announcement: process.env.ANNOUNCEMENT || '',
  customTitle: process.env.CUSTOM_TITLE || '',
  enableHealthFilter: process.env.ENABLE_HEALTH_FILTER === 'true'
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  // 处理 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  // 验证管理员身份
  const token = req.headers.authorization?.replace('Bearer ', '')
  
  if (!token) {
    return res.status(401).json({ error: '未授权访问' })
  }
  
  const decoded = verifyToken(token)
  if (!decoded || !decoded.isAdmin) {
    return res.status(403).json({ error: '需要管理员权限' })
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGetConfig(res)
      case 'POST':
        return await handleUpdateConfig(req, res)
      default:
        res.status(405).json({ error: 'Method Not Allowed' })
    }
  } catch (error) {
    console.error('请求处理失败:', error)
    res.status(500).json({ error: '服务器错误' })
  }
}

/**
 * 获取配置
 */
async function handleGetConfig(res: VercelResponse) {
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
            console.log('成功从MySQL数据库获取配置')
          } else {
            console.log('MySQL数据库中无配置记录，创建默认配置')
            await mysqlConn.query('INSERT INTO configs (config) VALUES (?)', [JSON.stringify(defaultConfig)])
          }
        } else {
          // PostgreSQL查询
          const pgConn = connection as ReturnType<typeof postgres>
          const result = await pgConn`SELECT config FROM configs ORDER BY id DESC LIMIT 1`
          if (result.length > 0) {
            // 确保正确解析PostgreSQL返回的配置数据
            const pgConfig = result[0].config
            config = typeof pgConfig === 'string' ? JSON.parse(pgConfig) : pgConfig
            console.log('成功从PostgreSQL数据库获取配置')
          } else {
            console.log('PostgreSQL数据库中无配置记录，创建默认配置')
            await pgConn`INSERT INTO configs (config) VALUES (${JSON.stringify(defaultConfig)})`
          }
        }
      })
    } catch (error) {
      console.error('数据库操作失败:', error)
      // 使用默认配置
      console.log('使用默认配置（数据库操作失败）')
    }

    res.status(200).json(config)
  } catch (error) {
    console.error('获取配置失败:', error)
    res.status(500).json({ 
      error: '获取配置失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
}

/**
 * 更新配置
 */
async function handleUpdateConfig(req: VercelRequest, res: VercelResponse) {
  try {
    const config: Config = req.body

    try {
      // withDatabase会自动选择使用SQL_DSN或PG_CONNECTION_STRING
      await withDatabase(async (connection, dbType) => {
        if (dbType === 'mysql') {
          // MySQL查询
          const mysqlConn = connection as mysql.PoolConnection
          
          // 先检查是否存在记录
          const [rows] = await mysqlConn.query('SELECT id FROM configs LIMIT 1') as [mysql.RowDataPacket[], mysql.FieldPacket[]]
          
          if (rows.length > 0) {
            // 如果存在记录，执行更新
            await mysqlConn.query('UPDATE configs SET config = ? WHERE id = ?', [
              JSON.stringify(config),
              rows[0].id
            ])
            console.log('配置成功更新到MySQL数据库')
          } else {
            // 如果不存在记录，执行插入
            await mysqlConn.query('INSERT INTO configs (config) VALUES (?)', [
              JSON.stringify(config)
            ])
            console.log('配置成功插入到MySQL数据库')
          }
        } else {
          // PostgreSQL查询
          const pgConn = connection as ReturnType<typeof postgres>
          
          // 检查是否存在记录
          const existingRows = await pgConn`SELECT id FROM configs LIMIT 1`
          
          if (existingRows.length > 0) {
            // 如果存在记录，执行更新
            await pgConn`UPDATE configs SET config = ${JSON.stringify(config)}::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = ${existingRows[0].id}`
            console.log('配置成功更新到PostgreSQL数据库')
          } else {
            // 如果不存在记录，执行插入
            await pgConn`INSERT INTO configs (config) VALUES (${JSON.stringify(config)}::jsonb)`
            console.log('配置成功插入到PostgreSQL数据库')
          }
        }
      })
      res.status(200).json({ message: '更新成功' })
    } catch (error) {
      console.error('保存到数据库失败:', error)
      res.status(500).json({ 
        error: '更新配置失败',
        message: error instanceof Error ? error.message : '数据库操作失败'
      })
    }
  } catch (error) {
    console.error('更新配置失败:', error)
    res.status(500).json({ error: '更新配置失败' })
  }
}