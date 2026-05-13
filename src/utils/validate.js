/**
 * 输入校验工具
 */

// 邮箱格式正则(标准版,不解析所有 RFC 边界情况,够用)
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * 校验邮箱格式
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  if (email.length > 254) return false;
  return EMAIL_RE.test(email);
}

/**
 * 校验密码强度
 * 规则:8-64 位,至少含一个字母 + 一个数字
 */
function isValidPassword(pwd) {
  if (typeof pwd !== 'string') return false;
  if (pwd.length < 8 || pwd.length > 64) return false;
  if (!/[A-Za-z]/.test(pwd)) return false;
  if (!/[0-9]/.test(pwd)) return false;
  return true;
}

/**
 * 校验昵称
 * 规则:1-20 字符,允许中文、英文、数字、下划线
 */
function isValidNickname(nick) {
  if (typeof nick !== 'string') return false;
  const trimmed = nick.trim();
  if (trimmed.length < 1 || trimmed.length > 20) return false;
  return /^[\u4e00-\u9fa5A-Za-z0-9_]+$/.test(trimmed);
}

/**
 * 校验 6 位数字验证码
 */
function isValidCode(code) {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

/**
 * 提取邮箱域名(小写)
 */
function extractDomain(email) {
  if (!isValidEmail(email)) return null;
  return email.split('@')[1].toLowerCase();
}

module.exports = {
  isValidEmail,
  isValidPassword,
  isValidNickname,
  isValidCode,
  extractDomain
};
