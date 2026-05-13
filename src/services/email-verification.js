/**
 * 邮箱验证码业务逻辑
 * - 生成、存库、防刷
 * - 校验、过期处理
 */
const pool = require('../config/db');
const config = require('../config');
const { generateEmailCode } = require('../utils/crypto');
const mailer = require('./mailer');

/**
 * 发送验证码
 * @returns {Object} { ok, error?, cooldownRemaining? }
 */
async function sendCode({ email, purpose, ip }) {
  // 1. 防刷:同邮箱 60 秒内只能发一次
  const cooldown = config.business.emailCodeCooldownSeconds;
  const [recent] = await pool.query(
    `SELECT created_at FROM email_verifications
     WHERE email = ? AND purpose = ?
       AND created_at > DATE_SUB(NOW(), INTERVAL ? SECOND)
     ORDER BY created_at DESC LIMIT 1`,
    [email, purpose, cooldown]
  );
  if (recent.length > 0) {
    const elapsed = Math.floor((Date.now() - new Date(recent[0].created_at).getTime()) / 1000);
    const remaining = cooldown - elapsed;
    return {
      ok: false,
      error: `请求过于频繁,请 ${remaining} 秒后再试`,
      cooldownRemaining: remaining
    };
  }

  // 2. 生成验证码,入库
  const code = generateEmailCode();
  const ttlMinutes = config.business.emailCodeTtlMinutes;
  await pool.query(
    `INSERT INTO email_verifications (email, code, purpose, expires_at, ip)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
    [email, code, purpose, ttlMinutes, ip || null]
  );

  // 3. 发邮件
  const mailResult = await mailer.sendVerificationCode(email, code, purpose);
  if (!mailResult.ok) {
    return { ok: false, error: '邮件发送失败,请稍后重试' };
  }

  return { ok: true };
}

/**
 * 校验验证码(并标记为已用)
 * @returns {Object} { ok, error? }
 */
async function verifyCode({ email, code, purpose }) {
  // 找到最近一条未用的验证码
  const [rows] = await pool.query(
    `SELECT id, expires_at, used_at FROM email_verifications
     WHERE email = ? AND code = ? AND purpose = ?
     ORDER BY created_at DESC LIMIT 1`,
    [email, code, purpose]
  );

  if (rows.length === 0) {
    return { ok: false, error: '验证码错误' };
  }

  const record = rows[0];
  if (record.used_at) {
    return { ok: false, error: '验证码已被使用' };
  }
  if (new Date(record.expires_at) < new Date()) {
    return { ok: false, error: '验证码已过期' };
  }

  // 标记为已用
  await pool.query(
    `UPDATE email_verifications SET used_at = NOW() WHERE id = ?`,
    [record.id]
  );

  return { ok: true };
}

module.exports = { sendCode, verifyCode };
