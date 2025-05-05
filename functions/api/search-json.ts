export const onRequestPost = async (context: any) => {
  const { request } = context;
  
  try {
    const body = await request.json();
    const { url, isPost, postData, className } = body;

    if (!url) {
      return new Response(JSON.stringify({ error: '缺少必要的URL参数' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
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
    };

    // 如果是POST请求
    if (isPost && postData) {
      requestOptions.method = 'POST';
      requestOptions.headers = {
        ...requestOptions.headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      };
      
      // 将JSON对象转换为URL编码的表单数据
      const params = new URLSearchParams();
      Object.entries(postData).forEach(([key, value]) => {
        params.append(key, String(value));
      });
      requestOptions.body = params.toString();
    }

    // 发送请求
    const response = await fetch(url, requestOptions);
    
    if (!response.ok) {
      return new Response(JSON.stringify({ 
        error: '请求失败',
        status: response.status,
        statusText: response.statusText
      }), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // 获取响应内容
    const data = await response.json();
    
    // 返回完整数据
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
    
  } catch (error) {
    console.error('搜索错误:', error);
    return new Response(JSON.stringify({ 
      error: '搜索处理失败',
      message: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
}; 