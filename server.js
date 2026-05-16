/**
 * ================================================================
 * AI-CMS 智能内容管理系统 - 单文件版本
 * ================================================================
 *
 * 本文件将所有后端代码合并为一个单独的 server.js 文件，
 * 包含数据库配置、模型、控制器、中间件、路由和前端页面。
 *
 * 功能列表：
 *   - 用户注册与登录（JWT 认证）
 *   - 文章管理（增删改查、分页、搜索、筛选）
 *   - 分类管理（增删改查）
 *   - AI 智能文章生成（调用 DeepSeek API）
 *   - AI 文章优化与续写
 *   - AI 标题建议生成
 *   - 标签管理
 *   - 角色权限控制（管理员/编辑者）
 *
 * 技术栈：
 *   - Express.js（Web 框架）
 *   - better-sqlite3（SQLite 数据库）
 *   - bcryptjs（密码加密）
 *   - jsonwebtoken（JWT 认证）
 *   - node-fetch（HTTP 请求，调用 DeepSeek API）
 *   - dotenv（环境变量管理）
 *
 * 使用方法：
 *   1. 复制 .env.example 为 .env 并填写配置
 *   2. npm install
 *   3. node server.js
 *
 * ================================================================
 */

// 加载环境变量（必须在最前面引入）
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const Database = require('better-sqlite3');

// ==================== 数据库配置 ====================

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'database.sqlite');

// 自动创建 data 目录
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// 创建/打开 SQLite 数据库
const db = new Database(DB_PATH);

// 启用 WAL 模式提升性能
db.pragma('journal_mode = WAL');

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'editor',
    avatar TEXT DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT DEFAULT '',
    content TEXT NOT NULL,
    coverImage TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    category INTEGER,
    tags TEXT DEFAULT '[]',
    author INTEGER NOT NULL,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    isAIGenerated INTEGER DEFAULT 0,
    aiPrompt TEXT DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category) REFERENCES categories(id),
    FOREIGN KEY (author) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    color TEXT DEFAULT '#6366f1',
    sortOrder INTEGER DEFAULT 0,
    isSystem INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log(`SQLite 数据库已连接: ${DB_PATH}`);

// ==================== 模型层 ====================

// ---------- 用户模型 ----------
const User = {
  findByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    const user = stmt.get(email);
    if (user) {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    }
    return null;
  },

  findByEmailWithPassword(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email) || null;
  },

  findByUsernameWithPassword(username) {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username) || null;
  },

  findById(id) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(id);
    if (user) {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    }
    return null;
  },

  findByUsernameOrEmail(username, email) {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?');
    return stmt.get(username, email) || null;
  },

  async create({ username, email, password, role = 'editor' }) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const stmt = db.prepare(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(username, email, hashedPassword, role);

    return this.findById(result.lastInsertRowid);
  },

  comparePassword(enteredPassword, hashedPassword) {
    return bcrypt.compare(enteredPassword, hashedPassword);
  },

  getSignedJwtToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
  },
};

// ---------- 文章模型 ----------
const Article = {
  findAll({ page = 1, pageSize = 10, status, category, tag, keyword, author } = {}) {
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('a.status = ?');
      params.push(status);
    }

    if (category) {
      conditions.push('a.category = ?');
      params.push(category);
    }

    if (tag) {
      conditions.push('a.tags LIKE ?');
      params.push(`%"${tag}"%`);
    }

    if (author) {
      conditions.push('a.author = ?');
      params.push(author);
    }

    if (keyword) {
      conditions.push('(a.title LIKE ? OR a.content LIKE ? OR a.summary LIKE ?)');
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM articles a ${whereClause}`);
    const { total } = countStmt.get(...params);

    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);
    const offset = (pageNum - 1) * pageSizeNum;

    const queryStmt = db.prepare(`
      SELECT a.*,
        c.id as categoryId, c.name as categoryName, c.color as categoryColor,
        u.id as authorId, u.username as authorName, u.avatar as authorAvatar
      FROM articles a
      LEFT JOIN categories c ON a.category = c.id
      LEFT JOIN users u ON a.author = u.id
      ${whereClause}
      ORDER BY a.createdAt DESC
      LIMIT ? OFFSET ?
    `);

    const rows = queryStmt.all(...params, pageSizeNum, offset);
    const articles = rows.map((row) => this._formatArticle(row));

    return {
      articles,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    };
  },

  findById(id) {
    const stmt = db.prepare(`
      SELECT a.*,
        c.id as categoryId, c.name as categoryName, c.color as categoryColor, c.description as categoryDescription,
        u.id as authorId, u.username as authorName, u.avatar as authorAvatar
      FROM articles a
      LEFT JOIN categories c ON a.category = c.id
      LEFT JOIN users u ON a.author = u.id
      WHERE a.id = ?
    `);
    const row = stmt.get(id);
    return row ? this._formatArticle(row) : null;
  },

  findByAuthor(authorId) {
    const stmt = db.prepare(`
      SELECT a.*,
        c.id as categoryId, c.name as categoryName, c.color as categoryColor,
        u.id as authorId, u.username as authorName, u.avatar as authorAvatar
      FROM articles a
      LEFT JOIN categories c ON a.category = c.id
      LEFT JOIN users u ON a.author = u.id
      WHERE a.author = ?
      ORDER BY a.createdAt DESC
    `);
    const rows = stmt.all(authorId);
    return rows.map((row) => this._formatArticle(row));
  },

  create({ title, summary = '', content, coverImage = '', category = null, tags = [], status = 'draft', author, isAIGenerated = false, aiPrompt = '' }) {
    const stmt = db.prepare(`
      INSERT INTO articles (title, summary, content, coverImage, status, category, tags, author, isAIGenerated, aiPrompt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title,
      summary,
      content,
      coverImage,
      status,
      category,
      JSON.stringify(tags),
      author,
      isAIGenerated ? 1 : 0,
      aiPrompt
    );

    return this.findById(result.lastInsertRowid);
  },

  update(id, updateData) {
    const fields = [];
    const values = [];

    const allowedFields = ['title', 'summary', 'content', 'coverImage', 'status', 'category', 'tags', 'isAIGenerated', 'aiPrompt'];

    for (const key of allowedFields) {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'tags' ? JSON.stringify(updateData[key]) : updateData[key]);
      }
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updatedAt = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = db.prepare(`UPDATE articles SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.findById(id);
  },

  delete(id) {
    const stmt = db.prepare('DELETE FROM articles WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  },

  incrementViews(id) {
    const stmt = db.prepare('UPDATE articles SET views = views + 1 WHERE id = ?');
    stmt.run(id);
  },

  count(conditions = {}) {
    const whereClauses = [];
    const params = [];

    if (conditions.category) {
      whereClauses.push('category = ?');
      params.push(conditions.category);
    }

    if (conditions.author) {
      whereClauses.push('author = ?');
      params.push(conditions.author);
    }

    if (conditions.status) {
      whereClauses.push('status = ?');
      params.push(conditions.status);
    }

    const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM articles ${whereClause}`);
    const { count } = stmt.get(...params);
    return count;
  },

  getAllTags() {
    const stmt = db.prepare("SELECT tags FROM articles WHERE tags != '[]'");
    const rows = stmt.all();

    const tagSet = new Set();
    for (const row of rows) {
      try {
        const tags = JSON.parse(row.tags);
        if (Array.isArray(tags)) {
          tags.forEach((tag) => {
            if (tag && tag.trim()) {
              tagSet.add(tag.trim());
            }
          });
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    return Array.from(tagSet).sort();
  },

  _formatArticle(row) {
    let tags = [];
    try {
      tags = JSON.parse(row.tags);
    } catch (e) {
      tags = [];
    }

    return {
      _id: row.id,
      id: row.id,
      title: row.title,
      summary: row.summary,
      content: row.content,
      coverImage: row.coverImage,
      status: row.status,
      category: row.categoryId ? {
        _id: row.categoryId,
        id: row.categoryId,
        name: row.categoryName,
        color: row.categoryColor,
        description: row.categoryDescription || '',
      } : null,
      tags,
      author: {
        _id: row.authorId,
        id: row.authorId,
        username: row.authorName,
        avatar: row.authorAvatar,
      },
      views: row.views,
      likes: row.likes,
      isAIGenerated: !!row.isAIGenerated,
      aiPrompt: row.aiPrompt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
};

// ---------- 分类模型 ----------
const Category = {
  findAll() {
    const stmt = db.prepare('SELECT * FROM categories ORDER BY sortOrder ASC, createdAt DESC');
    const rows = stmt.all();
    return rows.map((row) => this._formatCategory(row));
  },

  findById(id) {
    const stmt = db.prepare('SELECT * FROM categories WHERE id = ?');
    const row = stmt.get(id);
    return row ? this._formatCategory(row) : null;
  },

  findByName(name) {
    const stmt = db.prepare('SELECT * FROM categories WHERE name = ?');
    const row = stmt.get(name);
    return row ? this._formatCategory(row) : null;
  },

  create({ name, description = '', icon = '', color = '#6366f1', sortOrder = 0, isSystem = false }) {
    const stmt = db.prepare(
      'INSERT INTO categories (name, description, icon, color, sortOrder, isSystem) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(name, description, icon, color, sortOrder, isSystem ? 1 : 0);
    return this.findById(result.lastInsertRowid);
  },

  update(id, updateData) {
    const fields = [];
    const values = [];

    const allowedFields = ['name', 'description', 'icon', 'color', 'sortOrder', 'isSystem'];

    for (const key of allowedFields) {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'isSystem' ? (updateData[key] ? 1 : 0) : updateData[key]);
      }
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updatedAt = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.findById(id);
  },

  delete(id) {
    const stmt = db.prepare('DELETE FROM categories WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  },

  _formatCategory(row) {
    return {
      _id: row.id,
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      color: row.color,
      sortOrder: row.sortOrder,
      isSystem: !!row.isSystem,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
};

// ==================== 中间件 ====================

/**
 * JWT 认证中间件 - 验证请求头中的 Token
 */
const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: '未提供认证令牌，请先登录',
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = User.findById(decoded.id);

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: '用户不存在',
        });
      }
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: '认证令牌无效或已过期',
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 角色权限检查中间件（工厂函数）
 * @param {...string} roles - 允许访问的角色列表
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `角色 ${req.user.role} 无权执行此操作`,
      });
    }
    next();
  };
};

// ==================== 控制器 ====================

// ---------- 认证控制器 ----------

/**
 * 用户注册
 * POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || username.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: '用户名至少3个字符',
      });
    }

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: '请输入有效的邮箱地址',
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: '密码至少6个字符',
      });
    }

    const existingUser = User.findByUsernameOrEmail(username, email);

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.username === username ? '用户名已存在' : '邮箱已被注册',
      });
    }

    const user = await User.create({
      username,
      email,
      password,
    });

    const token = User.getSignedJwtToken(user.id);

    res.status(201).json({
      success: true,
      message: '注册成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
        },
      },
    });
  } catch (error) {
    console.error('注册失败:', error.message);

    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({
        success: false,
        message: '用户名或邮箱已存在',
      });
    }

    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 用户登录
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: '请输入邮箱和密码',
      });
    }

    const user = User.findByEmailWithPassword(email);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误',
      });
    }

    const isMatch = await User.comparePassword(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误',
      });
    }

    const token = User.getSignedJwtToken(user.id);

    res.status(200).json({
      success: true,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
        },
      },
    });
  } catch (error) {
    console.error('登录失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 获取当前登录用户信息
 * GET /api/auth/me
 */
const getMe = async (req, res) => {
  try {
    const user = User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('获取用户信息失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

// ---------- 文章控制器 ----------

/**
 * 获取文章列表（支持分页、筛选、搜索）
 * GET /api/articles
 */
const getArticles = async (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 10,
      status,
      category,
      tag,
      keyword,
      author,
    } = req.query;

    const result = Article.findAll({
      page,
      pageSize,
      status,
      category,
      tag,
      keyword,
      author,
    });

    res.status(200).json({
      success: true,
      data: {
        articles: result.articles,
        pagination: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
        },
      },
    });
  } catch (error) {
    console.error('获取文章列表失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 获取单篇文章详情
 * GET /api/articles/:id
 */
const getArticle = async (req, res) => {
  try {
    const article = Article.findById(req.params.id);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: '文章不存在',
      });
    }

    Article.incrementViews(article.id);

    res.status(200).json({
      success: true,
      data: article,
    });
  } catch (error) {
    console.error('获取文章详情失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 创建文章
 * POST /api/articles
 */
const createArticle = async (req, res) => {
  try {
    const { title, summary, content, coverImage, category, tags, status } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: '请输入文章标题',
      });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: '请输入文章内容',
      });
    }

    const article = Article.create({
      title,
      summary,
      content,
      coverImage,
      category,
      tags: tags || [],
      status: status || 'draft',
      author: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: '文章创建成功',
      data: article,
    });
  } catch (error) {
    console.error('创建文章失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 更新文章
 * PUT /api/articles/:id
 */
const updateArticle = async (req, res) => {
  try {
    const { title, summary, content, coverImage, category, tags, status } = req.body;

    const article = Article.findById(req.params.id);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: '文章不存在',
      });
    }

    if (article.author.id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '无权编辑此文章',
      });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (summary !== undefined) updateData.summary = summary;
    if (content !== undefined) updateData.content = content;
    if (coverImage !== undefined) updateData.coverImage = coverImage;
    if (category !== undefined) updateData.category = category;
    if (tags !== undefined) updateData.tags = tags;
    if (status !== undefined) updateData.status = status;

    const updatedArticle = Article.update(req.params.id, updateData);

    res.status(200).json({
      success: true,
      message: '文章更新成功',
      data: updatedArticle,
    });
  } catch (error) {
    console.error('更新文章失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 删除文章
 * DELETE /api/articles/:id
 */
const deleteArticle = async (req, res) => {
  try {
    const article = Article.findById(req.params.id);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: '文章不存在',
      });
    }

    if (article.author.id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '无权删除此文章',
      });
    }

    Article.delete(req.params.id);

    res.status(200).json({
      success: true,
      message: '文章删除成功',
    });
  } catch (error) {
    console.error('删除文章失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 获取所有标签
 * GET /api/articles/tags/all
 */
const getAllTags = async (req, res) => {
  try {
    const tags = Article.getAllTags();

    res.status(200).json({
      success: true,
      data: tags,
    });
  } catch (error) {
    console.error('获取标签列表失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

// ---------- 分类控制器 ----------

/**
 * 获取所有分类
 * GET /api/articles/categories
 */
const getCategories = async (req, res) => {
  try {
    const categories = Category.findAll();

    const categoriesWithCount = categories.map((cat) => {
      const count = Article.count({ category: cat.id });
      return {
        ...cat,
        articleCount: count,
      };
    });

    res.status(200).json({
      success: true,
      data: categoriesWithCount,
    });
  } catch (error) {
    console.error('获取分类列表失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 创建分类
 * POST /api/articles/categories
 */
const createCategory = async (req, res) => {
  try {
    const { name, description, icon, color, sortOrder } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: '请输入分类名称',
      });
    }

    const existingCategory = Category.findByName(name);
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: '分类名称已存在',
      });
    }

    const category = Category.create({
      name,
      description,
      icon,
      color,
      sortOrder,
    });

    res.status(201).json({
      success: true,
      message: '分类创建成功',
      data: category,
    });
  } catch (error) {
    console.error('创建分类失败:', error.message);

    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({
        success: false,
        message: '分类名称已存在',
      });
    }

    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 更新分类
 * PUT /api/articles/categories/:id
 */
const updateCategory = async (req, res) => {
  try {
    const { name, description, icon, color, sortOrder } = req.body;

    let category = Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: '分类不存在',
      });
    }

    if (name && name !== category.name) {
      const existingCategory = Category.findByName(name);
      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: '分类名称已存在',
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    category = Category.update(req.params.id, updateData);

    res.status(200).json({
      success: true,
      message: '分类更新成功',
      data: category,
    });
  } catch (error) {
    console.error('更新分类失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

/**
 * 删除分类
 * DELETE /api/articles/categories/:id
 */
const deleteCategory = async (req, res) => {
  try {
    const category = Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: '分类不存在',
      });
    }

    if (category.isSystem) {
      return res.status(400).json({
        success: false,
        message: '系统内置分类不可删除',
      });
    }

    const articleCount = Article.count({ category: category.id });
    if (articleCount > 0) {
      return res.status(400).json({
        success: false,
        message: `该分类下还有 ${articleCount} 篇文章，请先移动或删除这些文章`,
      });
    }

    Category.delete(req.params.id);

    res.status(200).json({
      success: true,
      message: '分类删除成功',
    });
  } catch (error) {
    console.error('删除分类失败:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
    });
  }
};

// ---------- AI 控制器 ----------

// DeepSeek API 配置
const DEEPSEEK_API_URL =
  process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/**
 * AI 生成文章
 * POST /api/ai/generate
 */
const generateArticle = async (req, res) => {
  try {
    const { topic, style, length, language, category, tags } = req.body;

    if (!topic || !topic.trim()) {
      return res.status(400).json({
        success: false,
        message: '请输入文章主题',
      });
    }

    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'DeepSeek API Key 未配置，请在 .env 文件中设置 DEEPSEEK_API_KEY',
      });
    }

    const systemPrompt = `你是一位专业的内容创作者和写作助手。你需要根据用户提供的主题，创作高质量的文章。
要求：
1. 文章结构清晰，包含标题、摘要和正文
2. 内容原创、有价值、逻辑严密
3. 适当使用小标题分段
4. 使用 Markdown 格式输出
5. 输出格式要求：
   - 第一行为文章标题（以 # 开头）
   - 标题后空一行写摘要（以 > 开头）
   - 摘要后空一行写正文内容`;

    let userPrompt = `请写一篇关于"${topic}"的文章。`;
    if (style) {
      userPrompt += `\n写作风格：${style}`;
    }
    if (length) {
      const lengthMap = {
        '短篇': '300-500字',
        '中篇': '800-1200字',
        '长篇': '1500-2500字',
      };
      userPrompt += `\n文章长度：${lengthMap[length] || length}`;
    }
    if (language) {
      userPrompt += `\n语言：${language}`;
    }

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DeepSeek API 错误:', response.status, errorData);
      return res.status(response.status).json({
        success: false,
        message: `AI 服务调用失败: ${errorData.error?.message || '未知错误'}`,
      });
    }

    const data = await response.json();
    const generatedContent = data.choices?.[0]?.message?.content;

    if (!generatedContent) {
      return res.status(500).json({
        success: false,
        message: 'AI 未能生成有效内容，请重试',
      });
    }

    const lines = generatedContent.split('\n');
    let title = '';
    let summary = '';
    let contentLines = [];
    let hasFoundTitle = false;
    let hasFoundSummary = false;

    for (const line of lines) {
      if (!hasFoundTitle && line.startsWith('# ')) {
        title = line.replace(/^#+\s*/, '').trim();
        hasFoundTitle = true;
      } else if (!hasFoundSummary && line.startsWith('> ')) {
        summary += line.replace(/^>\s*/, '').trim();
        hasFoundSummary = true;
      } else if (hasFoundTitle && line.trim() !== '') {
        contentLines.push(line);
      } else if (hasFoundTitle) {
        contentLines.push(line);
      }
    }

    if (!title) {
      title = topic;
    }

    const content = contentLines.join('\n').trim();

    const article = Article.create({
      title,
      summary,
      content,
      category: category || null,
      tags: tags || [],
      status: 'draft',
      author: req.user.id,
      isAIGenerated: true,
      aiPrompt: topic,
    });

    res.status(200).json({
      success: true,
      message: 'AI 文章生成成功，已保存为草稿',
      data: article,
    });
  } catch (error) {
    console.error('AI 生成文章失败:', error.message);
    res.status(500).json({
      success: false,
      message: `AI 生成失败: ${error.message}`,
    });
  }
};

/**
 * AI 续写/优化文章
 * POST /api/ai/improve
 */
const improveArticle = async (req, res) => {
  try {
    const { content, instruction } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: '请输入文章内容',
      });
    }

    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'DeepSeek API Key 未配置',
      });
    }

    const systemPrompt = `你是一位专业的文章编辑和优化助手。你需要根据用户的指令对文章进行优化。
要求：
1. 保持文章原有的核心意思和结构
2. 使用 Markdown 格式输出
3. 直接输出优化后的内容，不要添加额外说明`;

    const userPrompt = `请对以下文章进行优化。优化要求：${instruction || '润色语言，使文章更加流畅专业'}\n\n原始文章：\n${content}`;

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DeepSeek API 错误:', response.status, errorData);
      return res.status(response.status).json({
        success: false,
        message: `AI 服务调用失败: ${errorData.error?.message || '未知错误'}`,
      });
    }

    const data = await response.json();
    const improvedContent = data.choices?.[0]?.message?.content;

    if (!improvedContent) {
      return res.status(500).json({
        success: false,
        message: 'AI 未能优化内容，请重试',
      });
    }

    res.status(200).json({
      success: true,
      message: '文章优化成功',
      data: {
        content: improvedContent,
      },
    });
  } catch (error) {
    console.error('AI 优化文章失败:', error.message);
    res.status(500).json({
      success: false,
      message: `AI 优化失败: ${error.message}`,
    });
  }
};

/**
 * AI 生成文章标题建议
 * POST /api/ai/titles
 */
const generateTitles = async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: '请输入文章内容',
      });
    }

    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'DeepSeek API Key 未配置',
      });
    }

    const prompt = `根据以下文章内容，生成5个吸引人的文章标题建议。每个标题占一行，不要编号，不要添加其他说明。\n\n文章内容：\n${content.substring(0, 1000)}`;

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        success: false,
        message: `AI 服务调用失败: ${errorData.error?.message || '未知错误'}`,
      });
    }

    const data = await response.json();
    const titlesText = data.choices?.[0]?.message?.content || '';

    const titles = titlesText
      .split('\n')
      .map((t) => t.replace(/^[\d.\s、-]+/, '').trim())
      .filter((t) => t.length > 0);

    res.status(200).json({
      success: true,
      data: titles,
    });
  } catch (error) {
    console.error('AI 生成标题失败:', error.message);
    res.status(500).json({
      success: false,
      message: `AI 生成标题失败: ${error.message}`,
    });
  }
};

// ==================== 前端页面（嵌入 HTML） ====================

const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI-CMS 内容管理系统</title>
  <style>
    /* ==================== CSS 变量与全局样式 ==================== */
    :root {
      --primary: #6366f1;
      --primary-dark: #4f46e5;
      --primary-light: #818cf8;
      --bg: #f8fafc;
      --bg-card: #ffffff;
      --text: #1e293b;
      --text-secondary: #64748b;
      --text-muted: #94a3b8;
      --border: #e2e8f0;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #3b82f6;
      --sidebar-width: 260px;
      --header-height: 64px;
      --radius: 12px;
      --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
      --shadow-lg: 0 10px 25px rgba(0,0,0,0.08), 0 4px 10px rgba(0,0,0,0.04);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    a { color: var(--primary); text-decoration: none; }
    a:hover { color: var(--primary-dark); }

    /* ==================== 登录页 ==================== */
    .login-page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
    }

    .login-card {
      background: var(--bg-card);
      border-radius: 20px;
      padding: 48px 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 25px 50px rgba(0,0,0,0.15);
    }

    .login-card .logo {
      text-align: center;
      margin-bottom: 32px;
    }

    .login-card .logo h1 {
      font-size: 28px;
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 8px;
    }

    .login-card .logo p {
      color: var(--text-secondary);
      font-size: 14px;
    }

    .login-card .logo .logo-icon {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, var(--primary), var(--primary-light));
      border-radius: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      font-size: 24px;
      color: white;
    }

    /* ==================== 表单样式 ==================== */
    .form-group {
      margin-bottom: 20px;
    }

    .form-group label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--text);
      margin-bottom: 6px;
    }

    .form-group input,
    .form-group textarea,
    .form-group select {
      width: 100%;
      padding: 10px 14px;
      border: 2px solid var(--border);
      border-radius: 10px;
      font-size: 14px;
      color: var(--text);
      background: var(--bg);
      transition: all 0.2s;
      outline: none;
      font-family: inherit;
    }

    .form-group input:focus,
    .form-group textarea:focus,
    .form-group select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }

    .form-group textarea {
      resize: vertical;
      min-height: 120px;
    }

    /* ==================== 按钮 ==================== */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 20px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
    }

    .btn-primary {
      background: var(--primary);
      color: white;
    }
    .btn-primary:hover { background: var(--primary-dark); transform: translateY(-1px); }

    .btn-success { background: var(--success); color: white; }
    .btn-success:hover { background: #059669; }

    .btn-warning { background: var(--warning); color: white; }
    .btn-warning:hover { background: #d97706; }

    .btn-danger { background: var(--danger); color: white; }
    .btn-danger:hover { background: #dc2626; }

    .btn-outline {
      background: transparent;
      border: 2px solid var(--border);
      color: var(--text-secondary);
    }
    .btn-outline:hover { border-color: var(--primary); color: var(--primary); }

    .btn-block { width: 100%; }
    .btn-sm { padding: 6px 14px; font-size: 13px; }
    .btn-lg { padding: 12px 28px; font-size: 16px; }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none !important;
    }

    /* ==================== 布局 ==================== */
    .app-layout {
      display: none;
      min-height: 100vh;
    }

    .app-layout.active { display: flex; }

    /* 侧边栏 */
    .sidebar {
      width: var(--sidebar-width);
      background: var(--bg-card);
      border-right: 1px solid var(--border);
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      z-index: 100;
      display: flex;
      flex-direction: column;
      transition: transform 0.3s;
    }

    .sidebar-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
    }

    .sidebar-header h2 {
      font-size: 20px;
      font-weight: 700;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .sidebar-header h2 .icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, var(--primary), var(--primary-light));
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 18px;
    }

    .sidebar-nav {
      flex: 1;
      padding: 16px 12px;
      overflow-y: auto;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 10px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      font-family: inherit;
    }

    .nav-item:hover {
      background: var(--bg);
      color: var(--text);
    }

    .nav-item.active {
      background: rgba(99, 102, 241, 0.1);
      color: var(--primary);
    }

    .nav-item .nav-icon {
      width: 20px;
      text-align: center;
      font-size: 16px;
    }

    .sidebar-footer {
      padding: 16px;
      border-top: 1px solid var(--border);
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px;
      border-radius: 10px;
    }

    .user-avatar {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--primary), var(--primary-light));
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 14px;
    }

    .user-details {
      flex: 1;
      min-width: 0;
    }

    .user-details .name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-details .role {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* 主内容区 */
    .main-content {
      flex: 1;
      margin-left: var(--sidebar-width);
      min-height: 100vh;
    }

    .page-header {
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
      padding: 20px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }

    .page-header h1 {
      font-size: 22px;
      font-weight: 700;
    }

    .page-body {
      padding: 24px 32px;
    }

    /* ==================== 页面视图 ==================== */
    .page-view {
      display: none;
    }

    .page-view.active {
      display: block;
    }

    /* ==================== 统计卡片 ==================== */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--bg-card);
      border-radius: var(--radius);
      padding: 24px;
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
    }

    .stat-card .stat-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      margin-bottom: 16px;
    }

    .stat-card .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 4px;
    }

    .stat-card .stat-label {
      font-size: 14px;
      color: var(--text-secondary);
    }

    /* ==================== 表格 ==================== */
    .table-container {
      background: var(--bg-card);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      overflow: hidden;
    }

    .table-toolbar {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      border-bottom: 1px solid var(--border);
    }

    .table-toolbar .search-box {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--bg);
      border: 2px solid var(--border);
      border-radius: 10px;
      padding: 0 12px;
      flex: 1;
      max-width: 320px;
    }

    .table-toolbar .search-box input {
      border: none;
      background: transparent;
      padding: 8px 0;
      outline: none;
      width: 100%;
      font-size: 14px;
      font-family: inherit;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    table th,
    table td {
      padding: 14px 20px;
      text-align: left;
      font-size: 14px;
      border-bottom: 1px solid var(--border);
    }

    table th {
      background: var(--bg);
      font-weight: 600;
      color: var(--text-secondary);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    table tr:last-child td {
      border-bottom: none;
    }

    table tr:hover td {
      background: rgba(99, 102, 241, 0.02);
    }

    .article-title-cell {
      max-width: 300px;
    }

    .article-title-cell .title {
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }

    .article-title-cell .meta {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* ==================== 状态标签 ==================== */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }

    .badge-draft {
      background: #fef3c7;
      color: #92400e;
    }

    .badge-published {
      background: #d1fae5;
      color: #065f46;
    }

    .badge-ai {
      background: #ede9fe;
      color: #5b21b6;
    }

    .tag-badge {
      display: inline-block;
      padding: 2px 8px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 12px;
      color: var(--text-secondary);
      margin: 2px;
    }

    /* ==================== 分页 ==================== */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-top: 1px solid var(--border);
    }

    .pagination .info {
      font-size: 14px;
      color: var(--text-secondary);
    }

    .pagination .pages {
      display: flex;
      gap: 4px;
    }

    .pagination .page-btn {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-card);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }

    .pagination .page-btn:hover,
    .pagination .page-btn.active {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
    }

    /* ==================== 编辑器 ==================== */
    .editor-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }

    .editor-main {
      background: var(--bg-card);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      padding: 24px;
    }

    .editor-sidebar {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .editor-sidebar .card {
      background: var(--bg-card);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      padding: 20px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .editor-actions {
      display: flex;
      gap: 12px;
      padding: 16px 0;
      border-top: 1px solid var(--border);
      margin-top: 16px;
    }

    /* ==================== AI 生成页 ==================== */
    .ai-generate-card {
      background: var(--bg-card);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      padding: 32px;
      max-width: 680px;
    }

    .ai-generate-card .ai-header {
      text-align: center;
      margin-bottom: 28px;
    }

    .ai-generate-card .ai-header .ai-icon {
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      color: white;
      margin-bottom: 16px;
    }

    .ai-generate-card .ai-header h2 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 6px;
    }

    .ai-generate-card .ai-header p {
      color: var(--text-secondary);
      font-size: 14px;
    }

    .ai-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }

    .ai-result {
      margin-top: 24px;
      padding: 20px;
      background: var(--bg);
      border-radius: 10px;
      border: 1px solid var(--border);
      display: none;
    }

    .ai-result.show { display: block; }

    .ai-result h3 {
      font-size: 16px;
      margin-bottom: 12px;
      color: var(--success);
    }

    .ai-result .result-content {
      max-height: 300px;
      overflow-y: auto;
      padding: 16px;
      background: var(--bg-card);
      border-radius: 8px;
      border: 1px solid var(--border);
      font-size: 14px;
      line-height: 1.8;
      white-space: pre-wrap;
    }

    /* ==================== 分类管理 ==================== */
    .category-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .category-card {
      background: var(--bg-card);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      padding: 20px;
      transition: all 0.2s;
    }

    .category-card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-2px);
    }

    .category-card .cat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .category-card .cat-name {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 600;
    }

    .category-card .cat-color {
      width: 12px;
      height: 12px;
      border-radius: 4px;
    }

    .category-card .cat-desc {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 12px;
    }

    .category-card .cat-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .category-card .cat-count {
      font-size: 13px;
      color: var(--text-muted);
    }

    .category-card .cat-actions {
      display: flex;
      gap: 6px;
    }

    /* ==================== 模态框 ==================== */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal-overlay.show {
      display: flex;
    }

    .modal {
      background: var(--bg-card);
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.2);
      animation: modalIn 0.2s ease;
    }

    @keyframes modalIn {
      from { opacity: 0; transform: scale(0.95) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    .modal-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-header h3 {
      font-size: 18px;
      font-weight: 600;
    }

    .modal-close {
      width: 32px;
      height: 32px;
      border: none;
      background: var(--bg);
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      color: var(--text-secondary);
      transition: all 0.2s;
    }

    .modal-close:hover {
      background: var(--danger);
      color: white;
    }

    .modal-body {
      padding: 24px;
    }

    .modal-footer {
      padding: 16px 24px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    /* ==================== Toast 通知 ==================== */
    .toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .toast {
      padding: 14px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
      animation: toastIn 0.3s ease;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 280px;
    }

    .toast-success { background: var(--success); color: white; }
    .toast-error { background: var(--danger); color: white; }
    .toast-info { background: var(--info); color: white; }

    @keyframes toastIn {
      from { opacity: 0; transform: translateX(100%); }
      to { opacity: 1; transform: translateX(0); }
    }

    /* ==================== 加载动画 ==================== */
    .loading-spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-overlay {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: var(--text-secondary);
    }

    /* ==================== 空状态 ==================== */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-muted);
    }

    .empty-state .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }

    .empty-state h3 {
      font-size: 18px;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    .empty-state p {
      font-size: 14px;
      margin-bottom: 20px;
    }

    /* ==================== 响应式 ==================== */
    @media (max-width: 1024px) {
      .editor-container {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
      }
      .sidebar.open {
        transform: translateX(0);
      }
      .main-content {
        margin-left: 0;
      }
      .page-body {
        padding: 16px;
      }
      .page-header {
        padding: 16px;
      }
      .ai-options {
        grid-template-columns: 1fr;
      }
    }

    /* 隐藏辅助类 */
    .hidden { display: none !important; }

    /* 切换开关 */
    .toggle-tabs {
      display: flex;
      background: var(--bg);
      border-radius: 10px;
      padding: 4px;
      border: 1px solid var(--border);
    }

    .toggle-tab {
      padding: 6px 16px;
      border: none;
      background: transparent;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
    }

    .toggle-tab.active {
      background: var(--bg-card);
      color: var(--primary);
      box-shadow: var(--shadow);
    }
  </style>
</head>
<body>

  <!-- ==================== 登录页 ==================== -->
  <div id="loginPage" class="login-page">
    <div class="login-card">
      <div class="logo">
        <div class="logo-icon">AI</div>
        <h1>AI-CMS</h1>
        <p>智能内容管理系统</p>
      </div>

      <!-- 登录表单 -->
      <form id="loginForm">
        <div class="form-group">
          <label for="loginEmail">邮箱地址</label>
          <input type="email" id="loginEmail" placeholder="请输入邮箱" required>
        </div>
        <div class="form-group">
          <label for="loginPassword">密码</label>
          <input type="password" id="loginPassword" placeholder="请输入密码" required>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="loginBtn">
          登录
        </button>
      </form>

      <!-- 注册表单（默认隐藏） -->
      <form id="registerForm" class="hidden">
        <div class="form-group">
          <label for="regUsername">用户名</label>
          <input type="text" id="regUsername" placeholder="请输入用户名" required minlength="3">
        </div>
        <div class="form-group">
          <label for="regEmail">邮箱地址</label>
          <input type="email" id="regEmail" placeholder="请输入邮箱" required>
        </div>
        <div class="form-group">
          <label for="regPassword">密码</label>
          <input type="password" id="regPassword" placeholder="请输入密码（至少6位）" required minlength="6">
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="regBtn">
          注册
        </button>
      </form>

      <div style="text-align: center; margin-top: 20px;">
        <span id="switchAuthText" style="font-size: 14px; color: var(--text-secondary);">
          还没有账号？<a href="#" id="switchAuthLink">立即注册</a>
        </span>
      </div>
    </div>
  </div>

  <!-- ==================== 主应用布局 ==================== -->
  <div id="appLayout" class="app-layout">
    <!-- 侧边栏 -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <h2>
          <span class="icon">AI</span>
          AI-CMS
        </h2>
      </div>

      <nav class="sidebar-nav">
        <button class="nav-item active" data-page="dashboard" onclick="navigateTo('dashboard')">
          <span class="nav-icon">&#9776;</span>
          仪表盘
        </button>
        <button class="nav-item" data-page="articles" onclick="navigateTo('articles')">
          <span class="nav-icon">&#128196;</span>
          文章管理
        </button>
        <button class="nav-item" data-page="editor" onclick="navigateTo('editor')">
          <span class="nav-icon">&#9998;</span>
          写文章
        </button>
        <button class="nav-item" data-page="ai-generate" onclick="navigateTo('ai-generate')">
          <span class="nav-icon">&#129302;</span>
          AI 生成
        </button>
        <button class="nav-item" data-page="categories" onclick="navigateTo('categories')">
          <span class="nav-icon">&#128193;</span>
          分类管理
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-avatar" id="userAvatar">U</div>
          <div class="user-details">
            <div class="name" id="userName">用户</div>
            <div class="role" id="userRole">编辑者</div>
          </div>
          <button class="btn btn-sm btn-outline" onclick="logout()" title="退出登录">&#x2190;</button>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="main-content">

      <!-- ========== 仪表盘页 ========== -->
      <div id="page-dashboard" class="page-view active">
        <div class="page-header">
          <h1>仪表盘</h1>
          <button class="btn btn-primary" onclick="navigateTo('editor')">
            &#9998; 写文章
          </button>
        </div>
        <div class="page-body">
          <div class="stats-grid" id="statsGrid">
            <div class="stat-card">
              <div class="stat-icon" style="background: #ede9fe; color: #7c3aed;">&#128196;</div>
              <div class="stat-value" id="statTotal">0</div>
              <div class="stat-label">文章总数</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background: #d1fae5; color: #059669;">&#10003;</div>
              <div class="stat-value" id="statPublished">0</div>
              <div class="stat-label">已发布</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background: #fef3c7; color: #d97706;">&#9998;</div>
              <div class="stat-value" id="statDraft">0</div>
              <div class="stat-label">草稿</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background: #e0e7ff; color: #4f46e5;">&#129302;</div>
              <div class="stat-value" id="statAI">0</div>
              <div class="stat-label">AI 生成</div>
            </div>
          </div>

          <div class="table-container">
            <div class="table-toolbar">
              <h3 style="font-size: 16px; font-weight: 600;">最近文章</h3>
              <button class="btn btn-outline btn-sm" onclick="navigateTo('articles')">查看全部</button>
            </div>
            <div id="recentArticles">
              <div class="empty-state">
                <div class="empty-icon">&#128196;</div>
                <h3>暂无文章</h3>
                <p>点击"写文章"开始创作，或使用 AI 自动生成</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== 文章列表页 ========== -->
      <div id="page-articles" class="page-view">
        <div class="page-header">
          <h1>文章管理</h1>
          <div style="display: flex; gap: 12px;">
            <button class="btn btn-outline" onclick="navigateTo('ai-generate')">&#129302; AI 生成</button>
            <button class="btn btn-primary" onclick="navigateTo('editor')">&#9998; 写文章</button>
          </div>
        </div>
        <div class="page-body">
          <div class="table-container">
            <div class="table-toolbar">
              <div class="search-box">
                <span>&#128269;</span>
                <input type="text" id="articleSearch" placeholder="搜索文章..." oninput="searchArticles()">
              </div>
              <div class="toggle-tabs">
                <button class="toggle-tab active" onclick="filterByStatus('all', this)">全部</button>
                <button class="toggle-tab" onclick="filterByStatus('published', this)">已发布</button>
                <button class="toggle-tab" onclick="filterByStatus('draft', this)">草稿</button>
              </div>
            </div>
            <div id="articlesTableBody">
              <div class="loading-overlay">加载中...</div>
            </div>
            <div class="pagination" id="articlesPagination"></div>
          </div>
        </div>
      </div>

      <!-- ========== 文章编辑页 ========== -->
      <div id="page-editor" class="page-view">
        <div class="page-header">
          <h1 id="editorTitle">写文章</h1>
          <div style="display: flex; gap: 12px;">
            <button class="btn btn-outline" onclick="navigateTo('articles')">取消</button>
          </div>
        </div>
        <div class="page-body">
          <div class="editor-container">
            <div class="editor-main">
              <div class="form-group">
                <label>文章标题</label>
                <input type="text" id="editTitle" placeholder="请输入文章标题">
              </div>
              <div class="form-group">
                <label>文章摘要</label>
                <textarea id="editSummary" placeholder="请输入文章摘要（可选）" rows="2"></textarea>
              </div>
              <div class="form-group">
                <label>文章内容（支持 Markdown）</label>
                <textarea id="editContent" placeholder="请输入文章内容..." rows="16" style="min-height: 400px;"></textarea>
              </div>
              <div class="editor-actions">
                <button class="btn btn-outline" onclick="saveArticle('draft')">&#128221; 存为草稿</button>
                <button class="btn btn-primary" onclick="saveArticle('published')">&#10003; 发布文章</button>
              </div>
            </div>
            <div class="editor-sidebar">
              <div class="card">
                <div class="card-title">&#128193; 发布设置</div>
                <div class="form-group">
                  <label>文章状态</label>
                  <select id="editStatus">
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>所属分类</label>
                  <select id="editCategory">
                    <option value="">未分类</option>
                  </select>
                </div>
              </div>
              <div class="card">
                <div class="card-title">&#127991; 标签</div>
                <div class="form-group">
                  <input type="text" id="editTags" placeholder="输入标签，用逗号分隔">
                </div>
                <div id="existingTags" style="margin-top: 8px;"></div>
              </div>
              <div class="card">
                <div class="card-title">&#129302; AI 助手</div>
                <div class="form-group">
                  <textarea id="aiImproveInstruction" placeholder="输入优化指令，如：润色语言、扩展内容..." rows="2"></textarea>
                </div>
                <button class="btn btn-outline btn-block btn-sm" onclick="aiImprove()">
                  &#10024; AI 优化内容
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== AI 生成页 ========== -->
      <div id="page-ai-generate" class="page-view">
        <div class="page-header">
          <h1>AI 内容生成</h1>
        </div>
        <div class="page-body">
          <div class="ai-generate-card">
            <div class="ai-header">
              <div class="ai-icon">&#129302;</div>
              <h2>AI 智能写作</h2>
              <p>输入主题，AI 将为您自动生成高质量文章</p>
            </div>

            <div class="form-group">
              <label>文章主题 *</label>
              <input type="text" id="aiTopic" placeholder="例如：人工智能在医疗领域的应用">
            </div>

            <div class="ai-options">
              <div class="form-group">
                <label>写作风格</label>
                <select id="aiStyle">
                  <option value="">默认（专业）</option>
                  <option value="专业">专业严谨</option>
                  <option value="轻松">轻松活泼</option>
                  <option value="幽默">幽默风趣</option>
                  <option value="学术">学术风格</option>
                  <option value="科普">科普风格</option>
                </select>
              </div>
              <div class="form-group">
                <label>文章长度</label>
                <select id="aiLength">
                  <option value="短篇">短篇（300-500字）</option>
                  <option value="中篇" selected>中篇（800-1200字）</option>
                  <option value="长篇">长篇（1500-2500字）</option>
                </select>
              </div>
              <div class="form-group">
                <label>所属分类</label>
                <select id="aiCategory">
                  <option value="">未分类</option>
                </select>
              </div>
              <div class="form-group">
                <label>标签</label>
                <input type="text" id="aiTags" placeholder="用逗号分隔多个标签">
              </div>
            </div>

            <button class="btn btn-primary btn-block btn-lg" id="aiGenerateBtn" onclick="aiGenerate()">
              &#10024; 生成文章
            </button>

            <div class="ai-result" id="aiResult">
              <h3>&#10003; 文章生成成功</h3>
              <div class="result-content" id="aiResultContent"></div>
              <div style="margin-top: 16px; display: flex; gap: 12px;">
                <button class="btn btn-primary" id="aiEditBtn" onclick="editAIArticle()">
                  &#9998; 编辑文章
                </button>
                <button class="btn btn-outline" onclick="aiGenerate()">
                  &#128260; 重新生成
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== 分类管理页 ========== -->
      <div id="page-categories" class="page-view">
        <div class="page-header">
          <h1>分类管理</h1>
          <button class="btn btn-primary" onclick="showCategoryModal()">+ 新建分类</button>
        </div>
        <div class="page-body">
          <div class="category-grid" id="categoryGrid">
            <div class="loading-overlay">加载中...</div>
          </div>
        </div>
      </div>

    </main>
  </div>

  <!-- ==================== 分类模态框 ==================== -->
  <div class="modal-overlay" id="categoryModal">
    <div class="modal">
      <div class="modal-header">
        <h3 id="categoryModalTitle">新建分类</h3>
        <button class="modal-close" onclick="closeCategoryModal()">&times;</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="editCategoryId">
        <div class="form-group">
          <label>分类名称 *</label>
          <input type="text" id="catName" placeholder="请输入分类名称">
        </div>
        <div class="form-group">
          <label>分类描述</label>
          <input type="text" id="catDesc" placeholder="请输入分类描述">
        </div>
        <div class="form-group">
          <label>分类颜色</label>
          <input type="color" id="catColor" value="#6366f1" style="height: 40px; padding: 4px;">
        </div>
        <div class="form-group">
          <label>排序权重</label>
          <input type="number" id="catSort" value="0" placeholder="数值越小越靠前">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeCategoryModal()">取消</button>
        <button class="btn btn-primary" onclick="saveCategory()">保存</button>
      </div>
    </div>
  </div>

  <!-- ==================== 删除确认模态框 ==================== -->
  <div class="modal-overlay" id="deleteModal">
    <div class="modal">
      <div class="modal-header">
        <h3>确认删除</h3>
        <button class="modal-close" onclick="closeDeleteModal()">&times;</button>
      </div>
      <div class="modal-body">
        <p id="deleteMessage">确定要删除吗？此操作不可撤销。</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeDeleteModal()">取消</button>
        <button class="btn btn-danger" id="confirmDeleteBtn">确认删除</button>
      </div>
    </div>
  </div>

  <!-- Toast 通知容器 -->
  <div class="toast-container" id="toastContainer"></div>

  <script>
    // ==================== 全局状态 ====================
    const API_BASE = '/api';
    let authToken = localStorage.getItem('ai_cms_token') || '';
    let currentUser = JSON.parse(localStorage.getItem('ai_cms_user') || 'null');
    let currentPage = 'dashboard';
    let currentFilter = 'all';
    let currentArticlePage = 1;
    let editingArticleId = null;
    let generatedArticleId = null;
    let deleteCallback = null;

    // ==================== API 请求封装 ====================
    async function api(url, options = {}) {
      const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      if (authToken) {
        headers['Authorization'] = 'Bearer ' + authToken;
      }

      const response = await fetch(API_BASE + url, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (response.status === 401 && !url.includes('/auth/login')) {
        logout();
        return data;
      }

      return data;
    }

    // ==================== Toast 通知 ====================
    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      const icons = { success: '&#10003;', error: '&#10007;', info: '&#8505;' };
      toast.innerHTML = '<span>' + (icons[type] || '') + '</span> ' + message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    // ==================== 认证相关 ====================

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> 登录中...';

      try {
        const data = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: document.getElementById('loginEmail').value,
            password: document.getElementById('loginPassword').value,
          }),
        });

        if (data.success) {
          authToken = data.data.token;
          currentUser = data.data.user;
          localStorage.setItem('ai_cms_token', authToken);
          localStorage.setItem('ai_cms_user', JSON.stringify(currentUser));
          showToast('登录成功', 'success');
          showApp();
        } else {
          showToast(data.message, 'error');
        }
      } catch (error) {
        showToast('网络错误，请重试', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '登录';
      }
    });

    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('regBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> 注册中...';

      try {
        const data = await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username: document.getElementById('regUsername').value,
            email: document.getElementById('regEmail').value,
            password: document.getElementById('regPassword').value,
          }),
        });

        if (data.success) {
          authToken = data.data.token;
          currentUser = data.data.user;
          localStorage.setItem('ai_cms_token', authToken);
          localStorage.setItem('ai_cms_user', JSON.stringify(currentUser));
          showToast('注册成功', 'success');
          showApp();
        } else {
          showToast(data.message, 'error');
        }
      } catch (error) {
        showToast('网络错误，请重试', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '注册';
      }
    });

    let isLoginMode = true;
    document.getElementById('switchAuthLink').addEventListener('click', (e) => {
      e.preventDefault();
      isLoginMode = !isLoginMode;
      document.getElementById('loginForm').classList.toggle('hidden', !isLoginMode);
      document.getElementById('registerForm').classList.toggle('hidden', isLoginMode);
      document.getElementById('switchAuthText').innerHTML = isLoginMode
        ? '还没有账号？<a href="#" id="switchAuthLink">立即注册</a>'
        : '已有账号？<a href="#" id="switchAuthLink">立即登录</a>';
      document.getElementById('switchAuthLink').addEventListener('click', arguments.callee);
    });

    function logout() {
      authToken = '';
      currentUser = null;
      localStorage.removeItem('ai_cms_token');
      localStorage.removeItem('ai_cms_user');
      document.getElementById('loginPage').style.display = 'flex';
      document.getElementById('appLayout').classList.remove('active');
      showToast('已退出登录', 'info');
    }

    function showApp() {
      document.getElementById('loginPage').style.display = 'none';
      document.getElementById('appLayout').classList.add('active');
      if (currentUser) {
        document.getElementById('userName').textContent = currentUser.username;
        document.getElementById('userRole').textContent = currentUser.role === 'admin' ? '管理员' : '编辑者';
        document.getElementById('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
      }
      loadDashboard();
    }

    // ==================== 页面导航 ====================
    function navigateTo(page, params) {
      currentPage = page;

      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
      });

      document.querySelectorAll('.page-view').forEach(view => {
        view.classList.remove('active');
      });
      document.getElementById('page-' + page).classList.add('active');

      switch (page) {
        case 'dashboard':
          loadDashboard();
          break;
        case 'articles':
          loadArticles();
          break;
        case 'editor':
          if (params && params.articleId) {
            loadArticleForEdit(params.articleId);
          } else {
            resetEditor();
          }
          loadCategoriesForSelect();
          loadTags();
          break;
        case 'ai-generate':
          loadCategoriesForSelect();
          break;
        case 'categories':
          loadCategories();
          break;
      }
    }

    // ==================== 仪表盘 ====================
    async function loadDashboard() {
      try {
        const data = await api('/articles?pageSize=5');
        if (data.success) {
          const allData = await api('/articles?pageSize=1000');
          if (allData.success) {
            const articles = allData.data.articles;
            document.getElementById('statTotal').textContent = allData.data.pagination.total;
            document.getElementById('statPublished').textContent = articles.filter(a => a.status === 'published').length;
            document.getElementById('statDraft').textContent = articles.filter(a => a.status === 'draft').length;
            document.getElementById('statAI').textContent = articles.filter(a => a.isAIGenerated).length;
          }

          const container = document.getElementById('recentArticles');
          if (data.data.articles.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128196;</div><h3>暂无文章</h3><p>点击"写文章"开始创作，或使用 AI 自动生成</p></div>';
          } else {
            container.innerHTML = '<table><thead><tr><th>标题</th><th>状态</th><th>作者</th><th>日期</th><th>操作</th></tr></thead><tbody>' +
              data.data.articles.map(a => '<tr><td class="article-title-cell"><span class="title">' + escapeHtml(a.title) + '</span><span class="meta">' + (a.isAIGenerated ? '&#129302; AI生成' : '') + '</span></td><td><span class="badge badge-' + a.status + '">' + (a.status === 'published' ? '已发布' : '草稿') + '</span></td><td>' + escapeHtml(a.author?.username || '') + '</td><td style="color: var(--text-muted); font-size: 13px;">' + formatDate(a.createdAt) + '</td><td><button class="btn btn-sm btn-outline" onclick="navigateTo(\\'editor\\', {articleId: \\'' + a._id + '\\'})">编辑</button></td></tr>').join('') +
              '</tbody></table>';
          }
        }
      } catch (error) {
        console.error('加载仪表盘失败:', error);
      }
    }

    // ==================== 文章列表 ====================
    async function loadArticles(page) {
      if (page === undefined) page = 1;
      currentArticlePage = page;
      const container = document.getElementById('articlesTableBody');
      container.innerHTML = '<div class="loading-overlay">加载中...</div>';

      try {
        let url = '/articles?page=' + page + '&pageSize=10';
        if (currentFilter !== 'all') url += '&status=' + currentFilter;

        const keyword = document.getElementById('articleSearch')?.value;
        if (keyword) url += '&keyword=' + encodeURIComponent(keyword);

        const data = await api(url);
        if (data.success) {
          const { articles, pagination } = data.data;

          if (articles.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128196;</div><h3>暂无文章</h3><p>开始创作你的第一篇文章吧</p></div>';
          } else {
            container.innerHTML = '<table><thead><tr><th>标题</th><th>分类</th><th>状态</th><th>浏览</th><th>日期</th><th>操作</th></tr></thead><tbody>' +
              articles.map(a => '<tr><td class="article-title-cell"><span class="title">' + escapeHtml(a.title) + '</span><span class="meta">' + (a.isAIGenerated ? '&#129302; AI生成' : '') + ' ' + (a.tags?.length ? a.tags.map(t => '<span class="tag-badge">' + escapeHtml(t) + '</span>').join('') : '') + '</span></td><td style="font-size: 13px;">' + (a.category ? escapeHtml(a.category.name) : '<span style="color:var(--text-muted)">未分类</span>') + '</td><td><span class="badge badge-' + a.status + '">' + (a.status === 'published' ? '已发布' : '草稿') + '</span></td><td style="color: var(--text-muted); font-size: 13px;">' + a.views + '</td><td style="color: var(--text-muted); font-size: 13px;">' + formatDate(a.createdAt) + '</td><td><div style="display: flex; gap: 6px;"><button class="btn btn-sm btn-outline" onclick="navigateTo(\\'editor\\', {articleId: \\'' + a._id + '\\'})">编辑</button><button class="btn btn-sm btn-danger" onclick="confirmDeleteArticle(\\'' + a._id + '\\', \\'' + escapeHtml(a.title).replace(/'/g, "\\\\'") + '\\')">删除</button></div></td></tr>').join('') +
              '</tbody></table>';
          }

          renderPagination(pagination);
        }
      } catch (error) {
        container.innerHTML = '<div class="empty-state"><h3>加载失败</h3><p>请检查网络连接后重试</p></div>';
      }
    }

    function renderPagination(pagination) {
      const container = document.getElementById('articlesPagination');
      if (pagination.totalPages <= 1) {
        container.innerHTML = '';
        return;
      }

      let pagesHtml = '';
      for (let i = 1; i <= pagination.totalPages; i++) {
        pagesHtml += '<button class="page-btn ' + (i === pagination.page ? 'active' : '') + '" onclick="loadArticles(' + i + ')">' + i + '</button>';
      }

      container.innerHTML = '<div class="info">共 ' + pagination.total + ' 篇文章</div><div class="pages"><button class="page-btn" onclick="loadArticles(' + (pagination.page - 1) + ')" ' + (pagination.page <= 1 ? 'disabled' : '') + '>&laquo;</button>' + pagesHtml + '<button class="page-btn" onclick="loadArticles(' + (pagination.page + 1) + ')" ' + (pagination.page >= pagination.totalPages ? 'disabled' : '') + '>&raquo;</button></div>';
    }

    let searchTimer;
    function searchArticles() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadArticles(1), 300);
    }

    function filterByStatus(status, btn) {
      currentFilter = status;
      document.querySelectorAll('.toggle-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      loadArticles(1);
    }

    // ==================== 文章编辑 ====================
    function resetEditor() {
      editingArticleId = null;
      document.getElementById('editorTitle').textContent = '写文章';
      document.getElementById('editTitle').value = '';
      document.getElementById('editSummary').value = '';
      document.getElementById('editContent').value = '';
      document.getElementById('editStatus').value = 'draft';
      document.getElementById('editCategory').value = '';
      document.getElementById('editTags').value = '';
    }

    async function loadArticleForEdit(id) {
      try {
        const data = await api('/articles/' + id);
        if (data.success) {
          editingArticleId = id;
          document.getElementById('editorTitle').textContent = '编辑文章';
          document.getElementById('editTitle').value = data.data.title;
          document.getElementById('editSummary').value = data.data.summary || '';
          document.getElementById('editContent').value = data.data.content;
          document.getElementById('editStatus').value = data.data.status;
          document.getElementById('editCategory').value = data.data.category?._id || '';
          document.getElementById('editTags').value = (data.data.tags || []).join(', ');
        }
      } catch (error) {
        showToast('加载文章失败', 'error');
      }
    }

    async function saveArticle(status) {
      const title = document.getElementById('editTitle').value.trim();
      const content = document.getElementById('editContent').value.trim();

      if (!title) { showToast('请输入文章标题', 'error'); return; }
      if (!content) { showToast('请输入文章内容', 'error'); return; }

      const articleData = {
        title,
        summary: document.getElementById('editSummary').value.trim(),
        content,
        status,
        category: document.getElementById('editCategory').value || null,
        tags: document.getElementById('editTags').value.split(',').map(t => t.trim()).filter(t => t),
      };

      try {
        let data;
        if (editingArticleId) {
          data = await api('/articles/' + editingArticleId, {
            method: 'PUT',
            body: JSON.stringify(articleData),
          });
        } else {
          data = await api('/articles', {
            method: 'POST',
            body: JSON.stringify(articleData),
          });
        }

        if (data.success) {
          showToast(editingArticleId ? '文章更新成功' : '文章创建成功', 'success');
          navigateTo('articles');
        } else {
          showToast(data.message, 'error');
        }
      } catch (error) {
        showToast('保存失败，请重试', 'error');
      }
    }

    function confirmDeleteArticle(id, title) {
      document.getElementById('deleteMessage').textContent = '确定要删除文章"' + title + '"吗？此操作不可撤销。';
      document.getElementById('deleteModal').classList.add('show');
      deleteCallback = async () => {
        try {
          const data = await api('/articles/' + id, { method: 'DELETE' });
          if (data.success) {
            showToast('文章删除成功', 'success');
            loadArticles(currentArticlePage);
          } else {
            showToast(data.message, 'error');
          }
        } catch (error) {
          showToast('删除失败', 'error');
        }
      };
      document.getElementById('confirmDeleteBtn').onclick = () => {
        if (deleteCallback) deleteCallback();
        closeDeleteModal();
      };
    }

    function closeDeleteModal() {
      document.getElementById('deleteModal').classList.remove('show');
      deleteCallback = null;
    }

    // ==================== AI 生成 ====================
    async function aiGenerate() {
      const topic = document.getElementById('aiTopic').value.trim();
      if (!topic) { showToast('请输入文章主题', 'error'); return; }

      const btn = document.getElementById('aiGenerateBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> AI 正在创作中...';

      try {
        const data = await api('/ai/generate', {
          method: 'POST',
          body: JSON.stringify({
            topic,
            style: document.getElementById('aiStyle').value,
            length: document.getElementById('aiLength').value,
            category: document.getElementById('aiCategory').value || null,
            tags: document.getElementById('aiTags').value.split(',').map(t => t.trim()).filter(t => t),
          }),
        });

        if (data.success) {
          generatedArticleId = data.data._id;
          document.getElementById('aiResultContent').textContent = data.data.content;
          document.getElementById('aiResult').classList.add('show');
          showToast('文章生成成功，已保存为草稿', 'success');
        } else {
          showToast(data.message, 'error');
        }
      } catch (error) {
        showToast('AI 生成失败，请重试', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '&#10024; 生成文章';
      }
    }

    function editAIArticle() {
      if (generatedArticleId) {
        navigateTo('editor', { articleId: generatedArticleId });
      }
    }

    async function aiImprove() {
      const content = document.getElementById('editContent').value.trim();
      const instruction = document.getElementById('aiImproveInstruction').value.trim();

      if (!content) { showToast('请先输入文章内容', 'error'); return; }

      showToast('AI 正在优化内容...', 'info');

      try {
        const data = await api('/ai/improve', {
          method: 'POST',
          body: JSON.stringify({ content, instruction }),
        });

        if (data.success) {
          document.getElementById('editContent').value = data.data.content;
          showToast('内容优化成功', 'success');
        } else {
          showToast(data.message, 'error');
        }
      } catch (error) {
        showToast('优化失败，请重试', 'error');
      }
    }

    // ==================== 分类管理 ====================
    async function loadCategories() {
      const container = document.getElementById('categoryGrid');
      container.innerHTML = '<div class="loading-overlay">加载中...</div>';

      try {
        const data = await api('/articles/categories');
        if (data.success) {
          if (data.data.length === 0) {
            container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><div class="empty-icon">&#128193;</div><h3>暂无分类</h3><p>点击"新建分类"创建第一个分类</p></div>';
          } else {
            container.innerHTML = data.data.map(cat => '<div class="category-card"><div class="cat-header"><div class="cat-name"><span class="cat-color" style="background: ' + cat.color + '"></span>' + escapeHtml(cat.name) + '</div>' + (cat.isSystem ? '<span class="badge badge-draft">系统</span>' : '') + '</div><div class="cat-desc">' + escapeHtml(cat.description || '暂无描述') + '</div><div class="cat-footer"><span class="cat-count">' + cat.articleCount + ' 篇文章</span><div class="cat-actions"><button class="btn btn-sm btn-outline" onclick="editCategory(\\'' + cat._id + '\\', \\'' + escapeHtml(cat.name).replace(/'/g, "\\\\'") + '\\', \\'' + escapeHtml(cat.description || '').replace(/'/g, "\\\\'") + '\\', \\'' + cat.color + '\\', ' + cat.sortOrder + ')">编辑</button>' + (!cat.isSystem ? '<button class="btn btn-sm btn-danger" onclick="confirmDeleteCategory(\\'' + cat._id + '\\', \\'' + escapeHtml(cat.name).replace(/'/g, "\\\\'") + '\\')">删除</button>' : '') + '</div></div></div>').join('');
          }
        }
      } catch (error) {
        container.innerHTML = '<div class="empty-state"><h3>加载失败</h3></div>';
      }
    }

    function showCategoryModal(id) {
      document.getElementById('categoryModalTitle').textContent = id ? '编辑分类' : '新建分类';
      document.getElementById('editCategoryId').value = id || '';
      if (!id) {
        document.getElementById('catName').value = '';
        document.getElementById('catDesc').value = '';
        document.getElementById('catColor').value = '#6366f1';
        document.getElementById('catSort').value = '0';
      }
      document.getElementById('categoryModal').classList.add('show');
    }

    function closeCategoryModal() {
      document.getElementById('categoryModal').classList.remove('show');
    }

    function editCategory(id, name, desc, color, sort) {
      document.getElementById('editCategoryId').value = id;
      document.getElementById('catName').value = name;
      document.getElementById('catDesc').value = desc;
      document.getElementById('catColor').value = color;
      document.getElementById('catSort').value = sort;
      showCategoryModal(id);
    }

    async function saveCategory() {
      const id = document.getElementById('editCategoryId').value;
      const name = document.getElementById('catName').value.trim();
      if (!name) { showToast('请输入分类名称', 'error'); return; }

      const body = {
        name,
        description: document.getElementById('catDesc').value.trim(),
        color: document.getElementById('catColor').value,
        sortOrder: parseInt(document.getElementById('catSort').value) || 0,
      };

      try {
        const data = id
          ? await api('/articles/categories/' + id, { method: 'PUT', body: JSON.stringify(body) })
          : await api('/articles/categories', { method: 'POST', body: JSON.stringify(body) });

        if (data.success) {
          showToast(id ? '分类更新成功' : '分类创建成功', 'success');
          closeCategoryModal();
          loadCategories();
        } else {
          showToast(data.message, 'error');
        }
      } catch (error) {
        showToast('保存失败', 'error');
      }
    }

    function confirmDeleteCategory(id, name) {
      document.getElementById('deleteMessage').textContent = '确定要删除分类"' + name + '"吗？';
      document.getElementById('deleteModal').classList.add('show');
      deleteCallback = async () => {
        try {
          const data = await api('/articles/categories/' + id, { method: 'DELETE' });
          if (data.success) {
            showToast('分类删除成功', 'success');
            loadCategories();
          } else {
            showToast(data.message, 'error');
          }
        } catch (error) {
          showToast('删除失败', 'error');
        }
      };
      document.getElementById('confirmDeleteBtn').onclick = () => {
        if (deleteCallback) deleteCallback();
        closeDeleteModal();
      };
    }

    // ==================== 公共工具函数 ====================

    async function loadCategoriesForSelect() {
      try {
        const data = await api('/articles/categories');
        if (data.success) {
          const options = '<option value="">未分类</option>' +
            data.data.map(c => '<option value="' + c._id + '">' + escapeHtml(c.name) + '</option>').join('');
          document.getElementById('editCategory').innerHTML = options;
          document.getElementById('aiCategory').innerHTML = options;
        }
      } catch (error) {
        console.error('加载分类失败:', error);
      }
    }

    async function loadTags() {
      try {
        const data = await api('/articles/tags/all');
        if (data.success && data.data.length > 0) {
          document.getElementById('existingTags').innerHTML =
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">已有标签：</div>' +
            data.data.slice(0, 20).map(t => '<span class="tag-badge" style="cursor:pointer;" onclick="addTag(\\'' + escapeHtml(t).replace(/'/g, "\\\\'") + '\\')">' + escapeHtml(t) + '</span>').join('');
        }
      } catch (error) {
        console.error('加载标签失败:', error);
      }
    }

    function addTag(tag) {
      const input = document.getElementById('editTags');
      const existing = input.value.split(',').map(t => t.trim()).filter(t => t);
      if (!existing.includes(tag)) {
        existing.push(tag);
        input.value = existing.join(', ');
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function formatDate(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // ==================== 初始化 ====================
    if (authToken && currentUser) {
      showApp();
    }
  </script>
</body>
</html>`;

// ==================== Express 应用配置 ====================

const app = express();

// CORS 跨域配置
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// 解析 JSON 请求体
app.use(express.json({ limit: '10mb' }));

// 解析 URL 编码的请求体
app.use(express.urlencoded({ extended: true }));

// 前端页面路由（直接返回嵌入的 HTML）
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(INDEX_HTML);
});

// ==================== API 路由 ====================

// 健康检查接口
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'AI-CMS 服务运行正常',
    timestamp: new Date().toISOString(),
  });
});

// ---------- 认证路由 ----------
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.get('/api/auth/me', protect, getMe);

// ---------- 文章路由 ----------
app.get('/api/articles', getArticles);
app.get('/api/articles/tags/all', getAllTags);
app.get('/api/articles/categories', getCategories);
app.post('/api/articles', protect, createArticle);
app.post('/api/articles/categories', protect, authorize('admin'), createCategory);
app.get('/api/articles/:id', getArticle);
app.put('/api/articles/:id', protect, updateArticle);
app.delete('/api/articles/:id', protect, deleteArticle);
app.put('/api/articles/categories/:id', protect, authorize('admin'), updateCategory);
app.delete('/api/articles/categories/:id', protect, authorize('admin'), deleteCategory);

// ---------- AI 路由 ----------
app.post('/api/ai/generate', protect, generateArticle);
app.post('/api/ai/improve', protect, improveArticle);
app.post('/api/ai/titles', protect, generateTitles);

// 前端路由 - 所有非 API 请求返回 index.html（支持前端路由）
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(INDEX_HTML);
});

// ==================== 全局错误处理中间件 ====================

app.use((err, req, res, next) => {
  console.error('服务器错误:', err.stack);
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
  });
});

// ==================== 启动服务器 ====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`  AI-CMS 内容管理系统已启动（单文件版）`);
  console.log(`  服务地址: http://localhost:${PORT}`);
  console.log(`  API文档: http://localhost:${PORT}/api/health`);
  console.log(`=================================`);
});

// 导出 app（用于测试）
module.exports = app;
