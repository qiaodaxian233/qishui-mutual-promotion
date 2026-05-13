/**
 * 积分相关路由
 *
 * GET  /api/points/balance        当前余额
 * GET  /api/points/history        积分流水
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middlewares/auth');

/**
 * 当前积分余额
 */
router.get('/balance', requireAuth, (req, res) => {
  res.json({
    ok: true,
    points: req.user.points,
    creditScore: req.user.credit_score
  });
});

/**
 * 积分流水(分页)
 */
router.get('/history', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

  const [rows] = await pool.query(
    `SELECT id, delta, balance_after, type, ref_type, ref_id, note, created_at
     FROM points_log
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [req.user.id, limit, offset]
  );

  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS total FROM points_log WHERE user_id = ?`,
    [req.user.id]
  );

  res.json({
    ok: true,
    items: rows,
    total: count.total,
    limit,
    offset
  });
});

module.exports = router;
