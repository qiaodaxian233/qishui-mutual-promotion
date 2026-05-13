/**
 * 每日签到
 *
 * POST /api/checkin        签到(每天一次,随机 50-1000 积分)
 * GET  /api/checkin/status  今日签到状态
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middlewares/auth');
const pointsService = require('../services/points');
const notify = require('../services/notifications');

const MIN_POINTS = 50;
const MAX_POINTS = 1000;

/**
 * 随机积分(加权:小额概率大,大额概率小)
 */
function randomReward() {
  const r = Math.random();
  if (r < 0.50) return randInt(50, 100);     // 50%: 50-100
  if (r < 0.80) return randInt(100, 300);     // 30%: 100-300
  if (r < 0.95) return randInt(300, 600);     // 15%: 300-600
  return randInt(600, 1000);                   //  5%: 600-1000
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 检查今天是否已签到
 */
async function hasCheckedInToday(userId) {
  const [[row]] = await pool.query(
    `SELECT id, delta FROM points_log
     WHERE user_id = ? AND type = 'daily_checkin' AND DATE(created_at) = CURDATE()
     LIMIT 1`,
    [userId]
  );
  return row || null;
}

/**
 * POST /api/checkin  签到
 */
router.post('/', requireAuth, async (req, res) => {
  const existing = await hasCheckedInToday(req.user.id);
  if (existing) {
    return res.json({
      ok: false,
      error: '今天已经签到过了',
      todayReward: existing.delta,
      alreadyDone: true
    });
  }

  const reward = randomReward();

  await pointsService.add({
    userId: req.user.id,
    amount: reward,
    type: 'daily_checkin',
    note: `每日签到奖励 ${reward} 积分`
  });

  notify.send({
    userId: req.user.id,
    type: 'system',
    title: '签到成功',
    content: `恭喜获得 ${reward} 积分！明天记得再来~`
  });

  // 计算连续签到天数
  const [[streakRow]] = await pool.query(
    `SELECT COUNT(DISTINCT DATE(created_at)) AS streak
     FROM points_log
     WHERE user_id = ? AND type = 'daily_checkin'
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
    [req.user.id]
  );

  res.json({
    ok: true,
    reward,
    message: `🎉 签到成功！获得 ${reward} 积分`,
    streak: streakRow?.streak || 1
  });
});

/**
 * GET /api/checkin/status  今日签到状态
 */
router.get('/status', requireAuth, async (req, res) => {
  const existing = await hasCheckedInToday(req.user.id);

  const [[streakRow]] = await pool.query(
    `SELECT COUNT(DISTINCT DATE(created_at)) AS streak
     FROM points_log
     WHERE user_id = ? AND type = 'daily_checkin'
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
    [req.user.id]
  );

  res.json({
    ok: true,
    checkedIn: !!existing,
    todayReward: existing?.delta || 0,
    streak: streakRow?.streak || 0
  });
});

module.exports = router;
