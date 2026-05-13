/**
 * 接单 / 完成 / 查询接口
 *
 * POST   /api/tasks/:id/claim         领取任务(必须带 deviceFp)
 * GET    /api/completions             我接的任务列表
 * GET    /api/completions/:id         接单详情
 * POST   /api/completions/:id/submit  提交完成(触发自动验证)
 *
 * 管理用:
 * POST   /api/completions/:id/recheck 立即回查(测试/调试用,正常由定时任务触发)
 */
const express = require('express');
const router = express.Router();

const completionsService = require('../services/completions');
const { requireAuth } = require('../middlewares/auth');
const { strictLimiter } = require('../middlewares/rate-limit');
const { getClientIp, getUserAgent, getDeviceFp } = require('../utils/request');
const { sha256WithSalt } = require('../utils/crypto');
const { upload, compressAndSave } = require('../utils/image');

/**
 * 我接的任务列表
 */
router.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const items = await completionsService.listMyCompletions(req.user.id, { limit, offset });
  res.json({ ok: true, items, limit, offset });
});

/**
 * 接单详情
 */
router.get('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: '接单 ID 不正确' });
  }
  const detail = await completionsService.getCompletionDetail(id, req.user.id);
  if (!detail) return res.status(404).json({ ok: false, error: '记录不存在' });
  res.json({ ok: true, detail });
});

/**
 * 提交完成(上传截图 + 触发自动验证)
 * Content-Type: multipart/form-data
 * 字段: screenshot (file, required)
 */
router.post('/:id/submit', requireAuth, strictLimiter, upload.single('screenshot'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: '接单 ID 不正确' });
  }

  // 必须上传截图
  if (!req.file) {
    return res.status(400).json({ ok: false, error: '请上传完成截图' });
  }

  // 压缩保存
  let screenshotInfo;
  try {
    screenshotInfo = await compressAndSave(req.file.buffer, `completion_${id}`);
  } catch (err) {
    console.error('[submit] 截图压缩失败:', err.message);
    return res.status(400).json({ ok: false, error: '截图处理失败,请换一张图片重试' });
  }

  const result = await completionsService.submitCompletion({
    userId: req.user.id,
    completionId: id,
    screenshotPath: screenshotInfo.relativePath,
    screenshotHash: screenshotInfo.hash
  });
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

/**
 * 手动触发回查(测试/调试)
 * 注意:这里没鉴权限制是不是任务发布者/管理员,临时简化
 * 后续做 admin 角色后限制只允许 admin 调
 */
router.post('/:id/recheck', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: '接单 ID 不正确' });
  }
  const result = await completionsService.recheckCompletion(id);
  res.json(result);
});

// === 接单接口挂在 tasks 路由组下,而不是这里 ===
// 在 routes/tasks.js 里加 POST /:id/claim,因为路径语义上属于 tasks

module.exports = router;
