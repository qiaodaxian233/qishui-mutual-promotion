/**
 * 每日签到（连续签到阶梯递增版）
 *
 * POST /api/checkin         签到（每天一次，连续天数越多积分越多）
 * GET  /api/checkin/status  今日签到状态 + 连续天数 + 7 天奖励表
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middlewares/auth');
const pointsService = require('../services/points');
const notify = require('../services/notifications');

// 7 天为一个周期，第 7 天周满奖励，之后循环回 1
// 调整这里就能改奖励配置
const STREAK_REWARDS = [5, 7, 9, 12, 15, 20, 30];

function rewardForStreak(streak) {
  // streak 从 1 开始；第 8 天又回到 1，第 14 天再次拿 15
  const idx = ((streak - 1) % STREAK_REWARDS.length + STREAK_REWARDS.length) % STREAK_REWARDS.length;
  return STREAK_REWARDS[idx];
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
 * 计算"截止昨天"的连续签到天数（不含今天）
 * 用于判断：如果今天签到，连续天数会是多少
 */
async function getStreakBeforeToday(userId) {
  // 取最近 40 天内的签到日期（够长到不会漏算实际的连续段）
  const [rows] = await pool.query(
    `SELECT DATE(created_at) AS d FROM points_log
     WHERE user_id = ? AND type = 'daily_checkin'
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 40 DAY)
       AND DATE(created_at) < CURDATE()
     GROUP BY DATE(created_at)
     ORDER BY d DESC`,
    [userId]
  );

  if (rows.length === 0) return 0;

  // 从"昨天"开始往前走，遇到断签停
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 1); // 昨天

  for (const r of rows) {
    const d = new Date(r.d);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === cursor.getTime()) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break; // 出现断签，停止
    }
  }

  return streak;
}

/**
 * POST /api/checkin  签到
 */
router.post('/', requireAuth, async (req, res) => {
  const existing = await hasCheckedInToday(req.user.id);
  if (existing) {
    const prevStreak = await getStreakBeforeToday(req.user.id);
    return res.json({
      ok: false,
      error: '今天已经签到过了',
      todayReward: existing.delta,
      streak: prevStreak + 1,
      alreadyDone: true
    });
  }

  const prevStreak = await getStreakBeforeToday(req.user.id);
  const newStreak = prevStreak + 1;
  const reward = rewardForStreak(newStreak);
  const isWeekBonus = newStreak % 7 === 0;

  await pointsService.add({
    userId: req.user.id,
    amount: reward,
    type: 'daily_checkin',
    note: `每日签到 连续第 ${newStreak} 天 +${reward}`
  });

  notify.send({
    userId: req.user.id,
    type: 'system',
    title: isWeekBonus ? '🎉 周满签到奖励' : '签到成功',
    content: isWeekBonus
      ? `连续签到 ${newStreak} 天，获得周满奖励 ${reward} 积分！`
      : `连续签到第 ${newStreak} 天，获得 ${reward} 积分。明天继续！`
  });

  res.json({
    ok: true,
    reward,
    streak: newStreak,
    nextReward: rewardForStreak(newStreak + 1),
    isWeekBonus,
    message: isWeekBonus
      ? `🎉 周满奖励！连续 ${newStreak} 天，+${reward} 积分`
      : `🎉 签到成功！连续 ${newStreak} 天，+${reward} 积分`
  });
});

/**
 * GET /api/checkin/status  今日签到状态
 */
router.get('/status', requireAuth, async (req, res) => {
  const existing = await hasCheckedInToday(req.user.id);
  const prevStreak = await getStreakBeforeToday(req.user.id);

  const currentStreak = existing ? prevStreak + 1 : prevStreak;
  // 今天如果还没签，可以获得多少积分
  const todayPreview = existing ? null : rewardForStreak(prevStreak + 1);

  res.json({
    ok: true,
    checkedIn: !!existing,
    todayReward: existing?.delta || 0,
    streak: currentStreak,           // 已经包含今天（如果签了）
    todayPreview,                    // 今天还没签时，签到能拿多少
    weekRewards: STREAK_REWARDS      // 前端可以画 7 天奖励表
  });
});

module.exports = router;
