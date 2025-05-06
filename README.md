# 简单视频播放器

一个基于 Vue 3 + TypeScript + Tailwind CSS + ... 的视频播放器项目，支持在线播放视频、搜索、过滤广告等功能。

毫无技术含量，只是简单的组合，cursor搭建~

# 本工具仅供学习使用，请勿用于非法用途！


## 功能特点

- 支持响应式设计，适配电脑、手机和平板
- 支持日间/夜间模式切换
- 支持剧集搜索（注意：频繁搜索会报错）
- 支持切片广告过滤（内置）（每个资源站点可以单独配置过滤规则）
- 支持标签系统（标签数据保存在浏览器localStorage）（快速添加：剧集按钮的右键菜单）
- 支持自定义背景
- 支持用户登录（密码的配置是在管理后台）
- 支持管理后台（密码的配置是在环境变量）
- 支持解析（需要配置解析API）
- 支持IPTV链接解析
- 支持播放m3u8采集视频（需要配置采集站点和抓取规则，或者直接配置maccms JSON API）
- 支持自动连播
- 支持豆瓣热门
- 支持进度条自动记录（需要先保存标签，在更新标签或者暂停的时候更新进度条）
- 支持前端配置（会覆盖后端的配置）（首页左上角）
- 支持健康过滤（按照分类名称过滤）
- 支持代理请求

## 技术栈

- Vue 3
- TypeScript
- Tailwind CSS
- Vite
- DPlayer
- Vue Router
- Pinia
- VueUse
- Sweetalert2
- Jina
- ...

## 部署

### 本地部署

1. 安装依赖：
```bash
npm install
```

2. 配置环境变量：
复制 `.env.example` 到 `.env` 并填写相应的配置（云部署的时候不需要.env文件）：
```bash
# 数据库连接字符串
# 默认使用JSON文件存储，不需要数据库配置；想要配置也行，支持 SQL_DSN 和 PG_CONNECTION_STRING
#SQL_DSN='your_mysql_connection_string'
```

3. 启动开发服务器：
```bash
npm run dev:local
```

### Cloudflare Pages 部署

1. fork项目

2. 部署到cloudflare pages
```bash
# 构建命令
npm run build
# 构建目录
dist
```

3. 配置环境变量
#### 基础变量
ADMIN_PASSWORD（管理后台密码）

LOGIN_JWT_SECRET_KEY（任意随机字符串，用于加密jwt，jwt用于保持登录状态，时间为24小时）

#### 数据库变量配置一个就行了，二选一

#### 数据库-pgsql url（比如 supabase的）
##### 格式：postgresql://postgres:...
PG_CONNECTION_STRING

#### 数据库-KV
支持KV，命名空间为VIDEO_CONFIG，但试过了，只能在wrangler.toml配置绑定，为了避免泄漏隐私，可以将github本项目设置为private，再在wrangler.toml配置cloudflare的KV命名空间ID即可

#### 数据库-SQL-DSN
不支持，cloudflare不支持没办法

小结-部署cf需要配置基础变量和数据库变量，比较推荐使用的数据库是：pgsql url（比如：supabase）（变量为PG_CONNECTION_STRING）

### Vercel 部署

1. fork项目

2. 部署到vercel（部署后，用deno反代一下就行，或者使用自定义域名）
```bash
# 直接使用默认命令就行
# 构建命令
npm run build
# 构建目录
dist
# 安装依赖
npm install
```

3. 配置环境变量
#### 基础变量
ADMIN_PASSWORD（管理后台密码）

LOGIN_JWT_SECRET_KEY（任意随机字符串，用于加密jwt，jwt用于保持登录状态，时间为24小时）

#### 数据库变量配置一个就行了，二选一

#### 数据库-pgsql url（比如 supabase的、neon的）
##### 格式：postgresql://postgres:...
###### 如果是 supabase的，那么这个链接是 Transaction pooler 的
PG_CONNECTION_STRING

#### 数据库-SQL-DSN（比如 aiven的）
##### 格式：`username:password@tcp(hostname:port)/database`  
SQL_DSN

小结-部署vercel需要配置基础变量和数据库变量

### VPS 部署
```
注意：需要在 .env 添加 VITE_VPS_ENDPOINT_FLAG=true
```

## 管理后台配置

在管理页面 (`/admin`) 中可以配置以下内容：

- 资源站点（包含导入/导出、添加/删除/修改）
- 解析API
- 背景图片
- 首页登录密码
- 首页名称
- 公告

```
注意-管理后台修改配置后的保存：点击页面底部的 “保存配置” 按钮才能够真的保存
```

## 许可证

MIT 

# 免责声明

本程序仅供内部学习和交流使用，没有内置任何数据，请在遵守当地法律的前提下使用本站程序，对用户在使用过程中的自行维护的信息内容本站不负任何责任！

This program is for internal learning and communication use only, there is no built-in data, please comply with local laws under the premise of using the site program, the user in the process of self-maintenance of the information content of this site is not responsible!

