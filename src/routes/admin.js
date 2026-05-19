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

// ============================================================
// 数据统计面板
// ============================================================

/**
 * GET /api/admin/stats  总览统计
 */
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  const [[users]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(status='active') AS active,
       SUM(status='frozen') AS frozen,
       SUM(status='banned') AS banned,
       SUM(DATE(created_at) = CURDATE()) AS today_new
     FROM users`
  );

  const [[tasks]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(status='active') AS active,
       SUM(status='completed') AS completed,
       SUM(status='expired') AS expired,
       SUM(status='cancelled') AS cancelled,
       SUM(is_welfare=1) AS welfare,
       SUM(DATE(created_at) = CURDATE()) AS today_new
     FROM tasks`
  );

  const [[completions]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(status='claimed') AS claimed,
       SUM(status='auto_passed') AS auto_passed,
       SUM(status='auto_rejected') AS auto_rejected,
       SUM(status='manual_passed') AS manual_passed,
       SUM(status='recheck_failed') AS recheck_failed,
       SUM(status='timeout') AS timeout,
       SUM(DATE(claimed_at) = CURDATE()) AS today_new
     FROM task_completions`
  );

  const [[points]] = await pool.query(
    `SELECT
       SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS total_earned,
       SUM(CASE WHEN delta < 0 THEN ABS(delta) ELSE 0 END) AS total_spent,
       SUM(CASE WHEN DATE(created_at) = CURDATE() AND delta > 0 THEN delta ELSE 0 END) AS today_earned,
       SUM(CASE WHEN DATE(created_at) = CURDATE() AND delta < 0 THEN ABS(delta) ELSE 0 END) AS today_spent
     FROM points_log`
  );

  // 最近 7 天每日接单数
  const [dailyCompletions] = await pool.query(
    `SELECT DATE(claimed_at) AS date, COUNT(*) AS count
     FROM task_completions
     WHERE claimed_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     GROUP BY DATE(claimed_at)
     ORDER BY date`
  );

  // 最近 7 天每日注册数
  const [dailyRegistrations] = await pool.query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS count
     FROM users
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     GROUP BY DATE(created_at)
     ORDER BY date`
  );

  res.json({
    ok: true,
    users,
    tasks,
    completions,
    points,
    charts: { dailyCompletions, dailyRegistrations }
  });
});

// ============================================================
// 用户管理
// ============================================================

/**
 * GET /api/admin/users  用户列表
 */
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const search = req.query.search || '';

  let where = '1=1';
  const params = [];
  if (search) {
    where = '(u.email LIKE ? OR u.nickname LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  params.push(limit, offset);

  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.nickname, u.points, u.credit_score,
            u.role, u.status, u.created_at,
            (SELECT COUNT(*) FROM tasks WHERE publisher_id = u.id) AS task_count,
            (SELECT COUNT(*) FROM task_completions WHERE user_id = u.id) AS completion_count
     FROM users u
     WHERE ${where}
     ORDER BY u.id DESC
     LIMIT ? OFFSET ?`,
    params
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM users u WHERE ${where}`,
    search ? [`%${search}%`, `%${search}%`] : []
  );

  res.json({ ok: true, users: rows, total });
});

/**
 * POST /api/admin/users/:id/role  设置用户角色
 */
router.post('/users/:id/role', requireAuth, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ ok: false, error: '角色无效' });
  }
  await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
  res.json({ ok: true });
});

/**
 * POST /api/admin/users/:id/status  设置用户状态(冻结/解冻/封禁)
 */
router.post('/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { status, reason } = req.body;
  if (!['active', 'frozen', 'banned'].includes(status)) {
    return res.status(400).json({ ok: false, error: '状态无效' });
  }
  await pool.query(
    'UPDATE users SET status = ?, banned_reason = ? WHERE id = ?',
    [status, reason || null, req.params.id]
  );
  res.json({ ok: true });
});

/**
 * POST /api/admin/users/:id/points  调整积分
 */
router.post('/users/:id/points', requireAuth, requireAdmin, async (req, res) => {
  const { delta, note } = req.body;
  if (!delta || typeof delta !== 'number') {
    return res.status(400).json({ ok: false, error: '积分变动值无效' });
  }
  const pointsService = require('../services/points');
  if (delta > 0) {
    await pointsService.add({
      userId: parseInt(req.params.id),
      amount: delta,
      type: 'admin_adjust',
      note: note || '管理员调整'
    });
  } else {
    await pointsService.deduct({
      userId: parseInt(req.params.id),
      amount: Math.abs(delta),
      type: 'admin_adjust',
      note: note || '管理员调整'
    });
  }
  res.json({ ok: true });
});

// ============================================================
// 任务管理
// ============================================================

/**
 * GET /api/admin/tasks  全部任务列表
 */
router.get('/tasks', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const status = req.query.status || '';

  let where = '1=1';
  const params = [];
  if (status) {
    where = 't.status = ?';
    params.push(status);
  }
  params.push(limit, offset);

  const [rows] = await pool.query(
    `SELECT t.id, t.task_type, t.reward_points, t.quota_total, t.quota_remaining,
            t.status, t.is_welfare, t.created_at, t.expires_at,
            s.song_name, s.artist_name,
            u.nickname AS publisher_nickname
     FROM tasks t
     JOIN songs s ON s.id = t.song_id
     JOIN users u ON u.id = t.publisher_id
     WHERE ${where}
     ORDER BY t.id DESC
     LIMIT ? OFFSET ?`,
    params
  );

  res.json({ ok: true, tasks: rows });
});

// ============================================================
// 接单管理
// ============================================================

/**
 * GET /api/admin/completions  全部接单列表
 */
router.get('/completions', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const status = req.query.status || '';

  let where = '1=1';
  const params = [];
  if (status) {
    where = 'c.status = ?';
    params.push(status);
  }
  params.push(limit, offset);

  const [rows] = await pool.query(
    `SELECT c.id, c.task_id, c.user_id, c.status, c.points_awarded,
            c.claimed_at, c.submitted_at, c.awarded_at,
            s.song_name, u.nickname AS claimer_nickname,
            t.task_type, t.reward_points,
            (SELECT file_path FROM task_proofs WHERE completion_id = c.id ORDER BY id DESC LIMIT 1) AS screenshot
     FROM task_completions c
     JOIN tasks t ON t.id = c.task_id
     JOIN songs s ON s.id = t.song_id
     JOIN users u ON u.id = c.user_id
     WHERE ${where}
     ORDER BY c.id DESC
     LIMIT ? OFFSET ?`,
    params
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM task_completions c WHERE ${where}`,
    status ? [status] : []
  );

  res.json({ ok: true, completions: rows, total });
});

/**
 * POST /api/admin/completions/:id/review  人工审核(通过/拒绝)
 */
router.post('/completions/:id/review', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { action, reason } = req.body; // action: 'approve' | 'reject'

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ ok: false, error: '无效操作' });
  }

  const [[comp]] = await pool.query(
    `SELECT c.id, c.user_id, c.task_id, c.status, t.reward_points
     FROM task_completions c JOIN tasks t ON t.id = c.task_id
     WHERE c.id = ?`, [id]
  );
  if (!comp) return res.status(404).json({ ok: false, error: '记录不存在' });

  const pointsService = require('../services/points');
  const notify = require('../services/notifications');

  if (action === 'approve') {
    // 人工通过:发放积分
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await pointsService.addInTx(conn, {
        userId: comp.user_id,
        amount: comp.reward_points,
        type: 'task_complete',
        refType: 'completion',
        refId: id,
        note: `人工审核通过`
      });
      await conn.query(
        `UPDATE task_completions SET status = 'manual_passed', points_awarded = ?, awarded_at = NOW() WHERE id = ?`,
        [comp.reward_points, id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      return res.status(500).json({ ok: false, error: err.message });
    } finally {
      conn.release();
    }

    notify.send({
      userId: comp.user_id, type: 'points_awarded',
      title: '审核通过', content: `人工审核通过,${comp.reward_points} 积分已发放`,
      refType: 'completion', refId: id
    });
    res.json({ ok: true, message: '已通过,积分已发放' });

  } else {
    // 人工拒绝
    await pool.query(
      `UPDATE task_completions SET status = 'manual_rejected' WHERE id = ?`, [id]
    );
    // 释放名额
    await pool.query(
      `UPDATE tasks SET quota_remaining = quota_remaining + 1 WHERE id = ? AND quota_remaining < quota_total`,
      [comp.task_id]
    );
    notify.send({
      userId: comp.user_id, type: 'verify_failed',
      title: '审核未通过', content: reason || '人工审核未通过',
      refType: 'completion', refId: id
    });
    res.json({ ok: true, message: '已拒绝,名额已释放' });
  }
});

/**
 * POST /api/admin/users/batch-points  全员发放积分
 */
router.post('/users/batch-points', requireAuth, requireAdmin, async (req, res) => {
  const { delta, note } = req.body;
  if (!delta || typeof delta !== 'number' || delta <= 0) {
    return res.status(400).json({ ok: false, error: '请输入正整数积分' });
  }
  if (delta > 10000) {
    return res.status(400).json({ ok: false, error: '单次最多发放 10000 积分' });
  }

  const [users] = await pool.query(`SELECT id FROM users WHERE status = 'active'`);

  let count = 0;
  const pointsService = require('../services/points');
  const notify = require('../services/notifications');

  for (const u of users) {
    try {
      await pointsService.add({
        userId: u.id,
        amount: delta,
        type: 'admin_adjust',
        note: note || '平台福利'
      });
      notify.send({
        userId: u.id,
        type: 'system',
        title: '积分到账',
        content: `管理员给全员发放了 ${delta} 积分:${note || '平台福利'}`
      });
      count++;
    } catch {}
  }

  res.json({ ok: true, message: `已给 ${count} 名用户各发放 ${delta} 积分` });
});

module.exports = router;
