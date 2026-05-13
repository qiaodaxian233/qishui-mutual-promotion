/**
 * 应用入口
 * 启动 Express 服务,挂载路由和中间件
 */
const express = require('express');
const config = require('./config');
const pool = require('./config/db');
const mailer = require('./services/mailer');
const { generalLimiter } = require('./middlewares/rate-limit');

const app = express();

// 信任反向代理(宝塔通常会前置 nginx)
app.set('trust proxy', 1);

// body parser
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// 全局通用限流
app.use(generalLimiter);

// 请求日志(简易版)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// 健康检查
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, db: rows[0].ok === 1, time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'DB unavailable' });
  }
});

// 业务路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/completions', require('./routes/completions'));
app.use('/api/points', require('./routes/points'));

// ============================================================
// 前端静态文件托管
//
// 前端构建产物在 public/ 目录(frontend 构建时输出)
// - /assets/*  CSS/JS/图片等静态资源(浏览器缓存 1 年)
// - 其它路径(/, /login, /register 等)→ 返回 index.html(SPA fallback)
//
// 注意:必须在 /api/* 路由之后,在 404 处理之前
// ============================================================
const path = require('path');
const fs = require('fs');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (fs.existsSync(PUBLIC_DIR)) {
  // 静态资源(CSS/JS/图片)长缓存
  app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), {
    maxAge: '1y',
    immutable: true
  }));

  // 根目录的其它静态文件(favicon、图标等)短缓存
  app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));

  // SPA fallback:所有 GET 非 /api 路径都返回 index.html
  // 这样前端深层路由(如 /tasks/123)刷新页面也能正常加载
  app.get(/^(?!\/api\/).*$/, (req, res, next) => {
    // 只处理 GET 请求,且接受 HTML
    if (req.method !== 'GET') return next();
    if (!req.accepts('html')) return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
} else {
  console.warn(`[server] ⚠️ public/ 目录不存在,前端未构建。运行 cd frontend && npm install && npm run build`);
}

// 404(只到这里的都是非 GET 或非 HTML 的 API 错误路径)
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not Found' });
});

// 错误处理(兜底)
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

// 启动
app.listen(config.port, async () => {
  console.log(`====================================`);
  console.log(`  汽水音乐互推平台 v0.5.1`);
  console.log(`  端口:${config.port}`);
  console.log(`  环境:${config.env}`);
  console.log(`====================================`);

  // 异步验证 SMTP(不阻塞启动)
  mailer.verifyConnection().catch(() => {});

  // 启动定时回查任务
  require('./services/scheduler').startScheduler();
});
