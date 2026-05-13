/**
 * 加密相关工具
 * - bcrypt 密码哈希
 * - SHA256 哈希(用于 IP/文件指纹)
 * - 简单的随机 token 生成
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config');

/**
 * bcrypt 哈希密码
 */
async function hashPassword(plain) {
  return bcrypt.hash(plain, config.security.bcryptRounds);
}

/**
 * 校验密码
 */
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

/**
 * SHA256(salt + raw)
 * 用于 IP 哈希存储,避免泄漏原始 IP
 */
function sha256WithSalt(raw) {
  return crypto
    .createHash('sha256')
    .update(config.security.ipHashSalt + String(raw))
    .digest('hex');
}

/**
 * 文件 SHA256(用于截图查重)
 */
function sha256OfBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 生成 6 位数字验证码
 */
function generateEmailCode() {
  // 0~999999,不足 6 位前导补 0
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

/**
 * 生成随机 token(用作登录 token)
 * 64 位 hex 字符串
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  sha256WithSalt,
  sha256OfBuffer,
  generateEmailCode,
  generateToken
};
