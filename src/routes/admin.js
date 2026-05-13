/**
 * 管理后台路由
 *
 * POST  /api/admin/welfare/batch   批量发布福利任务
 * GET   /api/admin/welfare         查看福利任务列表
 *
 * 鉴权:requireAuth + requireAdmin(检查 users.role = 'admin')
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middlewares/auth');
const tasksService = require('../services/tasks');

/**
 * 管理员权限中间件
 */
async function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: '未登录' });
  }
  const [[row]] = await pool.query(
    `SELECT role FROM users WHERE id = ?`,
    [req.user.id]
  );
  if (!row || row.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '需要管理员权限' });
  }
  next();
}

/**
 * 批量发布福利任务
 *
 * Body: {
 *   tasks: [
 *     { shareText: "...", taskType: "like", reward: 5, quota: 50 },
 *     { shareText: "...", taskType: "listen", reward: 3, quota: 30, minListenSec: 30 },
 *     ...
 *   ]
 * }
 */
router.post('/welfare/batch', requireAuth, requireAdmin, async (req, res) => {
  const { tasks } = req.body;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ ok: false, error: '请提供至少一个任务' });
  }
  if (tasks.length > 20) {
    return res.status(400).json({ ok: false, error: '单次最多发布 20 个任务' });
  }

  const results = [];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    try {
      const result = await tasksService.publishWelfareTask({
        publisherId: req.user.id,
        shareText: t.shareText,
        taskType: t.taskType || 'like',
        reward: t.reward || 5,
        quota: t.quota || 50,
        minListenSec: t.minListenSec
      });
      results.push({
        index: i,
        shareText: t.shareText?.slice(0, 50) + '...',
        ...result
      });
    } catch (err) {
      results.push({
        index: i,
        shareText: t.shareText?.slice(0, 50) + '...',
        ok: false,
        error: err.message
      });
    }
  }

  const success = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  res.json({
    ok: true,
    message: `批量发布完成:成功 ${success},失败 ${failed}`,
    total: tasks.length,
    success,
    failed,
    results
  });
});

/**
 * 查看福利任务列表
 */
router.get('/welfare', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

  const [rows] = await pool.query(
    `SELECT t.id, t.task_type, t.reward_points, t.quota_total, t.quota_remaining,
            t.status, t.created_at, t.expires_at,
            s.song_name, s.artist_name, s.cover_url
     FROM tasks t
     JOIN songs s ON s.id = t.song_id
     WHERE t.is_welfare = 1
     ORDER BY t.id DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  res.json({ ok: true, tasks: rows });
});

module.exports = router;
