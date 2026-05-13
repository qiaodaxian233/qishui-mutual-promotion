/**
 * 限流中间件
 * 用 express-rate-limit,基于 IP + 路径
 */
const rateLimit = require('express-rate-limit');
const { getClientIp } = require('../utils/request');

/**
 * 通用限流:每 IP 每分钟 200 次(SPA 每页加载会发多个请求)
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: { ok: false, error: '请求过于频繁,请稍后再试' }
});

/**
 * 严格限流:敏感操作,每 IP 每分钟 15 次
 */
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
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
