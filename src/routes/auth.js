/**
 * 认证相关路由
 *
 * POST /api/auth/send-code        发送邮箱验证码(注册用)
 * POST /api/auth/register         注册(需先收到验证码)
 * POST /api/auth/login            登录
 * POST /api/auth/logout           登出
 * GET  /api/auth/me               获取当前用户信息
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/db');

const config = require('../config');
const auth = require('../services/auth');
const emailVerification = require('../services/email-verification');
const { getClientIp, getUserAgent } = require('../utils/request');
const { isValidEmail, isValidPassword, isValidNickname, isValidCode } = require('../utils/validate');
const { sha256WithSalt } = require('../utils/crypto');
const { requireAuth } = require('../middlewares/auth');
const { strictLimiter, loginLimiter } = require('../middlewares/rate-limit');

/**
 * 发送验证码
 * body: { email, purpose? }
 */
router.post('/send-code', strictLimiter, async (req, res) => {
  const { email, purpose = 'register' } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: '邮箱格式不正确' });
  }

  if (!['register', 'reset_password', 'change_email'].includes(purpose)) {
    return res.status(400).json({ ok: false, error: '无效的用途' });
  }

  // 注册用途:检查临时邮箱 + 已注册
  if (purpose === 'register') {
    if (await auth.isDisposableEmail(email)) {
      return res.status(400).json({
        ok: false,
        error: '不支持临时邮箱,请使用 QQ、163、Gmail 等常用邮箱'
      });
    }
    if (await auth.isEmailRegistered(email)) {
      return res.status(400).json({ ok: false, error: '邮箱已被注册' });
    }
  }

  // 重置密码用途:必须已注册
  if (purpose === 'reset_password') {
    if (!await auth.isEmailRegistered(email)) {
      // 故意返回成功,防止账号枚举
      return res.json({ ok: true, message: '若邮箱存在,验证码已发送' });
    }
  }

  const ip = getClientIp(req);
  const ipHash = ip ? sha256WithSalt(ip) : null;
  const result = await emailVerification.sendCode({ email, purpose, ip: ipHash });

  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json({ ok: true, message: '验证码已发送,请查收邮件' });
});

/**
 * 注册
 * body: { email, password, nickname, code }
 */
router.post('/register', strictLimiter, async (req, res) => {
  const { email, password, nickname, code } = req.body || {};

  // 入参校验
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: '邮箱格式不正确' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({
      ok: false,
      error: '密码需 8-64 位,且包含字母和数字'
    });
  }
  if (!isValidNickname(nickname)) {
    return res.status(400).json({
      ok: false,
      error: '昵称需 1-20 位,仅支持中文/英文/数字/下划线'
    });
  }
  if (!isValidCode(code)) {
    return res.status(400).json({ ok: false, error: '验证码格式不正确' });
  }

  // 临时邮箱再查一次(防绕过 send-code 直接调 register)
  if (await auth.isDisposableEmail(email)) {
    return res.status(400).json({ ok: false, error: '不支持临时邮箱' });
  }

  // 校验验证码
  const codeResult = await emailVerification.verifyCode({
    email, code, purpose: 'register'
  });
  if (!codeResult.ok) {
    return res.status(400).json(codeResult);
  }

  // 创建用户
  const ip = getClientIp(req);
  const ua = getUserAgent(req);
  const regResult = await auth.register({
    email, password, nickname: nickname.trim(),
    ip, userAgent: ua
  });

  if (!regResult.ok) {
    return res.status(400).json(regResult);
  }

  // 注册后自动登录
  const loginResult = await auth.login({ email, password, ip });
  res.json({
    ok: true,
    message: '注册成功',
    token: loginResult.token,
    user: loginResult.user
  });
});

/**
 * 登录
 * body: { email, password }
 */
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!isValidEmail(email) || typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ ok: false, error: '邮箱或密码错误' });
  }

  const ip = getClientIp(req);
  const result = await auth.login({ email, password, ip });

  if (!result.ok) {
    return res.status(401).json(result);
  }
  res.json(result);
});

/**
 * 登出
 */
router.post('/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  auth.logout(token);
  res.json({ ok: true });
});

/**
 * 当前用户信息
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      nickname: req.user.nickname,
      avatarUrl: req.user.avatar_url,
      points: req.user.points,
      creditScore: req.user.credit_score,
      role: req.user.role || 'user'
    }
  });
});

/**
 * 修改个人资料
 */
router.put('/profile', requireAuth, async (req, res) => {
  const { nickname } = req.body;
  if (nickname !== undefined) {
    if (!isValidNickname(nickname)) {
      return res.status(400).json({ ok: false, error: '昵称 1-20 字,支持中英文数字下划线' });
    }
    await pool.query('UPDATE users SET nickname = ? WHERE id = ?', [nickname.trim(), req.user.id]);
  }
  const [[updated]] = await pool.query('SELECT id, email, nickname, avatar_url, points, credit_score, role FROM users WHERE id = ?', [req.user.id]);
  res.json({ ok: true, user: updated });
});

/**
 * 修改密码
 */
router.put('/password', requireAuth, strictLimiter, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ ok: false, error: '请填写旧密码和新密码' });
  }
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ ok: false, error: '新密码需 8-64 位,含字母+数字' });
  }
  const bcrypt = require('bcryptjs');
  const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  const match = await bcrypt.compare(oldPassword, row.password_hash);
  if (!match) {
    return res.status(400).json({ ok: false, error: '旧密码不正确' });
  }
  const newHash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);
  res.json({ ok: true, message: '密码修改成功' });
});

module.exports = router;
