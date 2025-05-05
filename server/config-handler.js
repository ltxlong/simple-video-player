import { withConnection, readJsonConfig, writeJsonConfig } from './db.js'
import postgres from 'postgres'

// 默认配置
export const defaultConfig = {
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

/**
 * Base64 三次编码
 */
function encodeBase64(str) {
  let encoded = str
  for (let i = 0; i < 3; i++) {
    encoded = Buffer.from(encoded).toString('base64')
  }
  return encoded
}

/**
 * Base64 三次解码
 */
function decodeBase64(str) {
  try {
    let decoded = str
    for (let i = 0; i < 3; i++) {
      decoded = Buffer.from(decoded, 'base64').toString()
    }
    return decoded
  } catch (e) {
    console.error('Base64解码失败:', e)
    return ''
  }
}

/**
 * 确定使用的数据库类型和连接字符串
 * @returns {{type: 'mysql'|'postgresql'|'json', connectionString: string}|null}
 */
function getDbConnectionInfo() {
  const sqlDsn = process.env.SQL_DSN
  const pgConnectionString = process.env.PG_CONNECTION_STRING
  
  if (sqlDsn) {
    return { type: 'mysql', connectionString: sqlDsn }
  } else if (pgConnectionString) {
    return { type: 'postgresql', connectionString: pgConnectionString }
  }
  
  // 如果没有配置数据库连接信息，使用JSON文件
  return { type: 'json', connectionString: '' }
}

/**
 * 统一的数据库操作辅助函数
 * @param {function} callback 回调函数
 * @returns {Promise<any>} 回调函数的结果
 */
async function withDatabaseConnection(callback) {
  const connInfo = getDbConnectionInfo()
  
  if (connInfo.type === 'json') {
    // 使用JSON文件存储
    return await callback(null, 'json')
  } else if (connInfo.type === 'mysql') {
    // 使用MySQL连接
    // 修复：直接将回调函数传递给withConnection，而不是期望它返回connection对象
    return await withConnection(connInfo.connectionString, async (connection) => {
      return await callback(connection, 'mysql')
    })
  } else {
    // 使用PostgreSQL连接
    try {
      const sql = postgres(connInfo.connectionString, {
        max: 1,
        idle_timeout: 2,
        connect_timeout: 5,
        debug: false,  // 禁用调试输出
        onnotice: () => {}, // 忽略NOTICE消息
        types: {
          jsonb: {
            to: 1184,
            from: [3802],
            serialize: (obj) => JSON.stringify(obj),
            parse: (str) => typeof str === 'string' ? JSON.parse(str) : str
          }
        }
      })
      
      try {
        // 确保表已创建
        await sql`
          CREATE TABLE IF NOT EXISTS configs (
            id SERIAL PRIMARY KEY,
            config JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        return await callback(sql, 'postgresql')
      } finally {
        await sql.end()
      }
    } catch (error) {
      console.error('PostgreSQL操作失败:', error)
      // 降级为JSON文件
      return await callback(null, 'json')
    }
  }
}

/**
 * 获取配置 - 内部使用，不加密密码
 */
async function getConfigInternal() {
  try {
    return await withDatabaseConnection(async (connection, type) => {
      if (type === 'json') {
        // 使用JSON文件存储
        const config = await readJsonConfig()
        // 如果JSON为空，返回默认配置
        if (!config || Object.keys(config).length === 0) {
          return defaultConfig
        }
        
        // 如果有appConfig键，则使用它
        const finalConfig = config.appConfig || config
        return finalConfig
      } else if (type === 'mysql') {
        // MySQL查询
        const [rows] = await connection.query('SELECT config FROM configs ORDER BY id DESC LIMIT 1')
        if (Array.isArray(rows) && rows.length > 0) {
          const config = typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config
          return config
        }
      } else {
        // PostgreSQL查询
        const rows = await connection`SELECT config FROM configs ORDER BY id DESC LIMIT 1`
        if (rows.length > 0) {
          const config = rows[0].config
          return config
        }
      }
      return defaultConfig
    }).catch(error => {
      console.error('获取配置失败:', error)
      return defaultConfig
    })
  } catch (error) {
    console.error('获取配置失败:', error)
    return defaultConfig
  }
}

/**
 * 获取配置 - API接口使用，会对密码进行加密
 */
export async function getConfig() {
  const config = await getConfigInternal()
  
  // 创建一个副本，避免修改原始配置
  const configCopy = { ...config }
  
  // 如果有密码，在返回前进行三次Base64加密，仅用于传输
  if (configCopy.loginPassword) {
    //console.log('对密码进行三次Base64加密用于传输')
    configCopy.loginPassword = encodeBase64(configCopy.loginPassword)
  }
  
  return configCopy
}

// 更新配置
export async function updateConfig(config) {
  try {
    return await withDatabaseConnection(async (connection, type) => {
      // 创建配置的副本
      const configToUpdate = { ...config }
      
      if (type === 'json') {
        // 使用JSON文件存储
        const result = await writeJsonConfig({ appConfig: configToUpdate })
        return { 
          success: result, 
          message: result ? '配置更新成功！' : '配置更新失败！' 
        }
      } else if (type === 'mysql') {
        // MySQL操作
        // 判断配置对象是否已经是JSON字符串
        const isJsonString = (value) => {
          if (typeof value !== 'string') return false
          try {
            const parsed = JSON.parse(value)
            return typeof parsed === 'object' && parsed !== null
          } catch (e) {
            return false
          }
        }
        
        // 先检查是否存在记录
        const [rows] = await connection.query('SELECT id FROM configs LIMIT 1')
        
        if (rows.length > 0) {
          // 如果存在记录，执行更新
          // 如果configToUpdate已经是JSON字符串，则直接使用，否则进行JSON.stringify()
          const configValue = isJsonString(configToUpdate) ? configToUpdate : JSON.stringify(configToUpdate)
          
          await connection.query('UPDATE configs SET config = ? WHERE id = ?', [
            configValue,
            rows[0].id
          ])
        } else {
          // 如果不存在记录，执行插入
          // 如果configToUpdate已经是JSON字符串，则直接使用，否则进行JSON.stringify()
          const configValue = isJsonString(configToUpdate) ? configToUpdate : JSON.stringify(configToUpdate)
          
          await connection.query('INSERT INTO configs (config) VALUES (?)', [
            configValue
          ])
        }
      } else {
        // PostgreSQL操作
        // 先检查是否存在记录
        const rows = await connection`SELECT id FROM configs LIMIT 1`
        
        if (rows.length > 0) {
          // 如果存在记录，执行更新
          // 对于PostgreSQL，直接传递对象，postgres库会自动处理JSONB类型
          await connection`UPDATE configs SET config = ${configToUpdate}, updated_at = NOW() WHERE id = ${rows[0].id}`
        } else {
          // 如果不存在记录，执行插入
          // 对于PostgreSQL，直接传递对象，postgres库会自动处理JSONB类型
          await connection`INSERT INTO configs (config) VALUES (${configToUpdate})`
        }
      }
      
      return { success: true, message: '配置更新成功！' }
    }).catch(error => {
      console.error('更新配置失败:', error)
      return { success: false, message: error.message }
    })
  } catch (error) {
    console.error('更新配置失败:', error)
    return { success: false, message: error.message }
  }
}

// 获取公开配置（不包含密码）
export async function getPublicConfig() {
  const config = await getConfigInternal()
  const { loginPassword, ...publicConfig } = config
  return publicConfig
}

// 验证密码（使用明文对比）
export async function verifyPassword(password) {
  try {
    // 使用内部版本获取配置，确保获取的是未加密的原始密码
    const config = await getConfigInternal()
    
    return password === config.loginPassword
  } catch (error) {
    console.error('验证密码失败:', error)
    return false
  }
}
