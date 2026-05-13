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

// 404
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
  console.log(`  汽水音乐互推平台 v0.4.0`);
  console.log(`  端口:${config.port}`);
  console.log(`  环境:${config.env}`);
  console.log(`====================================`);

  // 异步验证 SMTP(不阻塞启动)
  mailer.verifyConnection().catch(() => {});

  // 启动定时回查任务
  require('./services/scheduler').startScheduler();
});
