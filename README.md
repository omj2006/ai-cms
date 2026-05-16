# AI-CMS - AI内容管理系统

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat-square&logo=sqlite&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-jsonwebtoken-EA3323?style=flat-square&logo=jsonwebtokens&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

> 基于 Node.js 和 Express 构建的智能内容管理系统，集成 DeepSeek AI 实现文章自动生成、优化与续写，助力高效内容创作。

AI-CMS 是一款轻量级的单文件内容管理系统，采用 SQLite 数据库存储，无需复杂配置即可快速部署。系统集成了 AI 智能写作能力，支持文章自动生成、内容优化、标题建议等功能，同时提供完善的用户认证与权限管理。

## 在线演示

[https://ai-cms-27m1.onrender.com](https://ai-cms-27m1.onrender.com)

## 功能特性

### 用户认证
- 用户注册与登录（JWT Token 认证）
- 密码 bcrypt 加密存储
- 角色权限控制（管理员 / 编辑者）

### 文章管理
- 文章 CRUD（创建、读取、更新、删除）
- 文章分页查询
- 关键词搜索与筛选
- 按分类、标签、状态筛选
- Markdown 内容支持
- 文章浏览量与点赞统计
- AI 生成标记与提示词记录

### 分类管理
- 分类的增删改查
- 分类图标与颜色自定义
- 排序功能

### AI 智能功能
- AI 文章自动生成（基于主题提示词）
- AI 文章内容优化
- AI 文章续写
- AI 标题建议生成
- 集成 DeepSeek API

### 标签管理
- 文章标签系统
- 全局标签聚合查询

## 技术栈

| 技术 | 用途 | 版本 |
|------|------|------|
| Node.js | 运行时环境 | 18+ |
| Express.js | Web 框架 | 4.x |
| better-sqlite3 | SQLite 数据库驱动 | latest |
| bcryptjs | 密码加密 | latest |
| jsonwebtoken | JWT 认证 | latest |
| node-fetch | HTTP 请求（调用 AI API） | latest |
| dotenv | 环境变量管理 | latest |
| cors | 跨域支持 | latest |

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- npm 或 yarn

### 本地运行

```bash
# 1. 克隆项目
git clone https://github.com/omj2006/ai-cms.git
cd ai-cms

# 2. 安装依赖
npm install

# 3. 创建环境变量文件
cp .env.example .env
# 编辑 .env 文件，填写必要的配置

# 4. 启动服务
npm start
```

服务启动后，访问 `http://localhost:3000` 即可使用。

## 环境变量

| 变量名 | 说明 | 默认值 | 必填 |
|--------|------|--------|------|
| `PORT` | 服务端口 | `3000` | 否 |
| `JWT_SECRET` | JWT 签名密钥 | - | 是 |
| `JWT_EXPIRES_IN` | Token 过期时间 | `7d` | 否 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | - | 是 |
| `DEEPSEEK_API_URL` | DeepSeek API 地址 | `https://api.deepseek.com` | 否 |
| `DEEPSEEK_MODEL` | DeepSeek 模型名称 | `deepseek-chat` | 否 |
| `NODE_ENV` | 运行环境 | `development` | 否 |

## API 接口

### 认证接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 用户注册 | 否 |
| POST | `/api/auth/login` | 用户登录 | 否 |
| GET | `/api/auth/me` | 获取当前用户信息 | 是 |

### 文章接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/articles` | 获取文章列表（分页/搜索/筛选） | 否 |
| GET | `/api/articles/:id` | 获取文章详情 | 否 |
| POST | `/api/articles` | 创建文章 | 是 |
| PUT | `/api/articles/:id` | 更新文章 | 是 |
| DELETE | `/api/articles/:id` | 删除文章 | 是 |
| GET | `/api/articles/tags/all` | 获取所有标签 | 否 |

### 分类接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/articles/categories` | 获取分类列表 | 否 |
| POST | `/api/articles/categories` | 创建分类 | 管理员 |
| PUT | `/api/articles/categories/:id` | 更新分类 | 管理员 |
| DELETE | `/api/articles/categories/:id` | 删除分类 | 管理员 |

### AI 接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/ai/generate` | AI 生成文章 | 是 |
| POST | `/api/ai/improve` | AI 优化文章 | 是 |
| POST | `/api/ai/titles` | AI 生成标题建议 | 是 |

### 其他接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |

## 项目截图

![首页](https://img.shields.io/badge/截图-首页-blue)
![文章管理](https://img.shields.io/badge/截图-文章管理-green)
![AI生成](https://img.shields.io/badge/截图-AI生成-orange)

## 部署说明（Render）

本项目已部署在 [Render](https://render.com/) 平台，部署步骤如下：

1. **Fork 或上传代码** 到 GitHub 仓库
2. 登录 [Render Dashboard](https://dashboard.render.com/)
3. 点击 **New** > **Web Service**
4. 连接 GitHub 仓库 `omj2006/ai-cms`
5. 配置构建信息：
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: `Node`
6. 在 **Environment Variables** 中添加所需的环境变量（参见上方环境变量表格）
7. 选择 **Free** 或付费计划，点击 **Create Web Service**
8. 等待构建完成，即可通过 Render 提供的域名访问

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m '添加某个特性'`
4. 推送分支：`git push origin feature/your-feature`
5. 提交 Pull Request

### 开发规范

- 遵循项目现有的代码风格
- 编写清晰的提交信息
- 确保所有功能正常工作后再提交 PR

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
