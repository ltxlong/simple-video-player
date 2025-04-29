import { load } from 'cheerio'
import type { ExecutionContext } from '@cloudflare/workers-types'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      // 处理 CORS
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        })
      }

      // 只接受 POST 请求
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 })
      }

      const body = await request.json()
      const { url, className, searchInputClassName, keyword } = body

      if (!url || !keyword) {
        return new Response('Missing required parameters', { status: 400 })
      }
      
      // 获取目标网页
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
      }

      const html = await response.text()
      const $ = load(html)

      // 如果提供了搜索输入框的类名，尝试找到搜索表单
      if (searchInputClassName) {
        const searchInput = $(searchInputClassName)
        if (searchInput.length) {
          const form = searchInput.closest('form')
          if (form.length) {
            const formAction = form.attr('action')
            if (formAction) {
              // 构建完整的搜索 URL
              const searchUrl = new URL(formAction, url)
              // 获取所有表单字段
              const formData = new FormData()
              form.find('input[name]').each((_, el) => {
                const input = $(el)
                const name = input.attr('name')
                const value = input.val()
                if (name && value) {
                  formData.append(name, value.toString())
                }
              })
              // 添加搜索关键词
              formData.append(searchInput.attr('name') || 'keyword', keyword)

              // 发送搜索请求
              const searchResponse = await fetch(searchUrl.toString(), {
                method: 'POST',
                body: formData,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
              })

              if (!searchResponse.ok) {
                throw new Error(`Search request failed: ${searchResponse.statusText}`)
              }

              const searchHtml = await searchResponse.text()
              const $search = load(searchHtml)

              // 如果提供了结果类名，只返回匹配的元素
              if (className) {
                return new Response($search(className).toString(), {
                  headers: {
                    'Content-Type': 'text/html;charset=UTF-8',
                    'Access-Control-Allow-Origin': '*',
                  }
                })
              }

              // 否则返回整个页面
              return new Response(searchHtml, {
                headers: {
                  'Content-Type': 'text/html;charset=UTF-8',
                  'Access-Control-Allow-Origin': '*',
                }
              })
            }
          }
        }
      }

      // 如果没有找到搜索表单或没有提供搜索输入框类名
      // 返回原始页面中指定类名的内容
      if (className) {
        return new Response($(className).toString(), {
          headers: {
            'Content-Type': 'text/html;charset=UTF-8',
            'Access-Control-Allow-Origin': '*',
          }
        })
      }

      // 如果没有提供类名，返回整个页面
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
          'Access-Control-Allow-Origin': '*',
        }
      })

    } catch (error) {
      console.error('Search error:', error)
      return new Response(`Error: ${error.message}`, { status: 500 })
    }
  }
} 
