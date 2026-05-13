/**
 * 任务相关路由
 *
 * POST   /api/tasks/preview         预览解析(不扣积分,只解析文案 + 抓页)
 * POST   /api/tasks                 发布任务(扣积分)
 * GET    /api/tasks                 任务广场列表
 * GET    /api/tasks/:id             任务详情
 * GET    /api/tasks/mine            我发布的任务列表
 * POST   /api/tasks/:id/cancel      撤销任务
 * POST   /api/tasks/:id/claim       接单(需 deviceFp 反作弊)
 * GET    /api/tasks/config          任务类型配置(供前端展示)
 */
const express = require('express');
const router = express.Router();

const tasksService = require('../services/tasks');
const completionsService = require('../services/completions');
const parser = require('../services/qishui-parser');
const { requireAuth, optionalAuth } = require('../middlewares/auth');
const { generalLimiter, strictLimiter } = require('../middlewares/rate-limit');
const { getClientIp, getUserAgent, getDeviceFp } = require('../utils/request');
const { sha256WithSalt } = require('../utils/crypto');

/**
 * 任务类型配置
 */
router.get('/config', (req, res) => {
  res.json({
    ok: true,
    taskTypes: tasksService.TASK_TYPES,
    platformFeeRate: tasksService.PLATFORM_FEE_RATE
  });
});

/**
 * 预览解析
 * body: { shareText }
 */
router.post('/preview', requireAuth, strictLimiter, async (req, res) => {
  const { shareText } = req.body || {};
  if (typeof shareText !== 'string' || shareText.length === 0) {
    return res.status(400).json({ ok: false, error: '请提供分享文案' });
  }
  if (shareText.length > 2000) {
    return res.status(400).json({ ok: false, error: '分享文案过长' });
  }

  const result = await parser.parseShareLink(shareText);
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.error, stage: result.stage });
  }

  res.json({
    ok: true,
    song: {
      name: result.meta.songName,
      artist: result.meta.artistName,
      cover: result.meta.coverUrl,
      duration: result.meta.durationSec,
      qishuiSongId: result.meta.qishuiSongId,
      songIdFallback: result.meta.songIdFallback
    },
    interactions: result.interactions,
    shareLink: result.parsed.shareLink,
    shareCode: result.parsed.shareCode,
    warnings: result.nameWarning ? [result.nameWarning] : []
  });
});

/**
 * 发布任务
 * body: { shareText, taskType, reward, quota, minListenSec?, commentRule? }
 */
router.post('/', requireAuth, strictLimiter, async (req, res) => {
  const { shareText, taskType, reward, quota, minListenSec, commentRule } = req.body || {};

  if (typeof shareText !== 'string' || shareText.length === 0) {
    return res.status(400).json({ ok: false, error: '请提供分享文案' });
  }

  // 预估成本,提前提示积分不足(纯校验,不操作)
  if (Number.isInteger(reward) && Number.isInteger(quota)) {
    const cost = tasksService.calculateCost(reward, quota);
    if (req.user.points < cost.total) {
      return res.status(400).json({
        ok: false,
        error: `积分不足,本次发布需要 ${cost.total} 积分,你当前 ${req.user.points}`,
        cost
      });
    }
  }

  const result = await tasksService.publishTask({
    publisherId: req.user.id,
    shareText,
    taskType,
    reward: Number(reward),
    quota: Number(quota),
    minListenSec: minListenSec != null ? Number(minListenSec) : undefined,
    commentRule
  });

  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

/**
 * 任务广场列表(公开,登录可选用于个性化)
 */
router.get('/', optionalAuth, async (req, res) => {
  const taskType = req.query.type || null;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

  const tasks = await tasksService.listTasks({ taskType, limit, offset });
  res.json({ ok: true, tasks, limit, offset });
});

/**
 * 我发布的任务
 */
router.get('/mine', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

  const tasks = await tasksService.listMyTasks(req.user.id, { limit, offset });
  res.json({ ok: true, tasks, limit, offset });
});

/**
 * 任务详情
 */
router.get('/:id', optionalAuth, async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ ok: false, error: '任务 ID 不正确' });
  }
  const task = await tasksService.getTaskById(taskId);
  if (!task) {
    return res.status(404).json({ ok: false, error: '任务不存在' });
  }
  res.json({ ok: true, task });
});

/**
 * 撤销任务
 */
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ ok: false, error: '任务 ID 不正确' });
  }
  const result = await tasksService.cancelTask(req.user.id, taskId);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

/**
 * 接单
 * body: { deviceFp }   (前端用 FingerprintJS 算)
 *       也可以放在 X-Device-Fp header 里
 */
router.post('/:id/claim', requireAuth, strictLimiter, async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ ok: false, error: '任务 ID 不正确' });
  }

  const ip = getClientIp(req);
  const ipHash = sha256WithSalt(ip);
  const deviceFp = getDeviceFp(req);
  const userAgent = getUserAgent(req);

  if (!deviceFp) {
    return res.status(400).json({
      ok: false,
      error: '缺少设备指纹,请确保前端正确传入 deviceFp(或 X-Device-Fp 头)'
    });
  }

  const result = await completionsService.claimTask({
    userId: req.user.id,
    taskId,
    ipHash,
    deviceFp,
    userAgent
  });

  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

module.exports = router;
