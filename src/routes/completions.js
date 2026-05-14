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

  // 检查截图是否被用过(同一 hash 不能重复提交)
  const pool = require('../config/db');
  const [[existingProof]] = await pool.query(
    `SELECT p.id, p.completion_id FROM task_proofs p
     WHERE p.file_sha256 = ? AND p.completion_id != ?
     LIMIT 1`,
    [screenshotInfo.hash, id]
  );
  if (existingProof) {
    return res.status(400).json({ ok: false, error: '这张截图已被使用过,请重新截图上传' });
  }

  // AI 分析截图(如果配置了 CLAUDE_API_KEY)
  const { analyzeScreenshot } = require('../services/screenshot-ai');
  const pool2 = require('../config/db');
  const [[compInfo]] = await pool2.query(
    `SELECT t.task_type FROM task_completions c JOIN tasks t ON t.id = c.task_id WHERE c.id = ?`, [id]
  );
  const taskType = compInfo?.task_type || 'like';

  const aiResult = await analyzeScreenshot(screenshotInfo.relativePath, taskType);

  if (aiResult.ok && aiResult.passed === false) {
    // AI 明确判定不通过
    return res.status(400).json({
      ok: false,
      error: `截图验证未通过: ${aiResult.reason}`,
      aiRejected: true
    });
  }

  // AI 结果存到 task_proofs 备查
  const aiNote = aiResult.skipped ? '(AI跳过)' : aiResult.passed ? '(AI通过)' : '(AI不确定)';

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
