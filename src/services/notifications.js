/**
 * 站内通知服务
 */
const pool = require('../config/db');

const TYPES = {
  task_claimed:      '有人接了你的任务',
  verify_passed:     '验证通过,积分将在回查后发放',
  verify_failed:     '验证未通过',
  points_awarded:    '积分已到账',
  task_expired:      '你的任务已过期',
  task_cancelled:    '你的任务已撤销',
  claim_timeout:     '接单超时,名额已释放',
  system:            '系统通知'
};

/**
 * 发送通知
 */
async function send({ userId, type, title, content, refType, refId }) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, content, ref_type, ref_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, type, title || TYPES[type] || '通知', content || '', refType || null, refId || null]
    );
  } catch (err) {
    console.error('[notify] 发送失败:', err.message);
  }
}

/**
 * 获取通知列表
 */
async function list(userId, { limit = 20, offset = 0 } = {}) {
  const [rows] = await pool.query(
    `SELECT id, type, title, content, ref_type, ref_id, is_read, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return rows;
}

/**
 * 未读数量
 */
async function unreadCount(userId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0`,
    [userId]
  );
  return row.count;
}

/**
 * 标记已读(单条或全部)
 */
async function markRead(userId, notificationId) {
  if (notificationId) {
    await pool.query(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [notificationId, userId]
    );
  } else {
    await pool.query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [userId]
    );
  }
}

module.exports = { TYPES, send, list, unreadCount, markRead };
