/**
 * 信用分服务
 *
 * 规则:
 * - 初始 600 分
 * - 按时完成任务:+5
 * - 回查通过(积分发放):+3
 * - 回查失败(互动撤回):-20
 * - 接单超时:-10
 * - 发布任务被正常完成:+2
 * - 信用分 < 400 时限制接单
 * - 信用分 < 200 时冻结账号
 */
const pool = require('../config/db');

const CREDIT_MIN = 0;
const CREDIT_MAX = 999;
const CLAIM_BLOCK_THRESHOLD = 400;  // 低于此分数不能接单

/**
 * 调整信用分
 */
async function adjust(userId, delta, reason, refType, refId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 获取当前分数
    const [[user]] = await conn.query(
      'SELECT credit_score FROM users WHERE id = ? FOR UPDATE',
      [userId]
    );
    if (!user) {
      await conn.rollback();
      return;
    }

    const oldScore = user.credit_score;
    let newScore = oldScore + delta;
    newScore = Math.max(CREDIT_MIN, Math.min(CREDIT_MAX, newScore));

    // 更新
    await conn.query(
      'UPDATE users SET credit_score = ? WHERE id = ?',
      [newScore, userId]
    );

    // 记日志
    await conn.query(
      `INSERT INTO credit_log (user_id, delta, score_after, reason, ref_type, ref_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, delta, newScore, reason, refType || null, refId || null]
    );

    // 信用过低冻结账号
    if (newScore < 200 && oldScore >= 200) {
      await conn.query(
        "UPDATE users SET status = 'frozen', banned_reason = '信用分过低自动冻结' WHERE id = ?",
        [userId]
      );
    }

    await conn.commit();
    return { oldScore, newScore, delta };
  } catch (err) {
    await conn.rollback();
    console.error('[credit] 调整失败:', err.message);
  } finally {
    conn.release();
  }
}

/**
 * 检查是否允许接单
 */
async function canClaim(userId) {
  const [[row]] = await pool.query(
    'SELECT credit_score FROM users WHERE id = ?',
    [userId]
  );
  if (!row) return { ok: false, error: '用户不存在' };
  if (row.credit_score < CLAIM_BLOCK_THRESHOLD) {
    return { ok: false, error: `信用分(${row.credit_score})过低,需 ${CLAIM_BLOCK_THRESHOLD} 以上才能接单` };
  }
  return { ok: true };
}

/**
 * 获取信用分日志
 */
async function getLog(userId, { limit = 20, offset = 0 } = {}) {
  const [rows] = await pool.query(
    `SELECT id, delta, score_after, reason, ref_type, ref_id, created_at
     FROM credit_log
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return rows;
}

module.exports = {
  adjust,
  canClaim,
  getLog,
  CLAIM_BLOCK_THRESHOLD
};
