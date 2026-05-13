/**
 * 限流中间件
 * 用 express-rate-limit,基于 IP + 路径
 */
const rateLimit = require('express-rate-limit');
const { getClientIp } = require('../utils/request');

/**
 * 通用限流:每 IP 每分钟 60 次
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: { ok: false, error: '请求过于频繁,请稍后再试' }
});

/**
 * 严格限流:验证码相关接口,每 IP 每分钟 5 次
 */
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: { ok: false, error: '请求过于频繁,请稍后再试' }
});

/**
 * 登录限流:每 IP 每 15 分钟 10 次,防撞库
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: { ok: false, error: '登录尝试过于频繁,请 15 分钟后再试' }
});

module.exports = { generalLimiter, strictLimiter, loginLimiter };
