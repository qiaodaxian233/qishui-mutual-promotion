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
  const { verifyScreenshot } = require('../services/local-verify');
  const pool2 = require('../config/db');
  const [[compInfo]] = await pool2.query(
    `SELECT t.task_type, s.song_name FROM task_completions c
     JOIN tasks t ON t.id = c.task_id
     JOIN songs s ON s.id = t.song_id
     WHERE c.id = ?`, [id]
  );
  const taskType = compInfo?.task_type || 'like';
  const songName = compInfo?.song_name || '';

  // 本地 OCR + 像素分析(不需要 API Key,超时5秒自动跳过)
  let localResult = { ok: true, passed: null, skipped: true, reason: '跳过' };
  try {
    const localPromise = verifyScreenshot(screenshotInfo.relativePath, { songName, taskType });
    const timeoutPromise = new Promise(resolve =>
      setTimeout(() => resolve({ ok: true, passed: null, skipped: true, reason: '本地分析超时,跳过' }), 10000)
    );
    localResult = await Promise.race([localPromise, timeoutPromise]);
    console.log(`[submit] 本地验证: passed=${localResult.passed}, reason=${localResult.reason}`);
  } catch (err) {
    console.warn('[submit] 本地验证异常:', err.message);
  }

  // Claude API 分析(如果有 Key)
  const aiResult = await analyzeScreenshot(screenshotInfo.relativePath, taskType);

  // 截图验证失败(本地或AI) → 走重试逻辑
  const verifyFailed = (localResult.ok && localResult.passed === false) ||
                       (aiResult.ok && aiResult.passed === false);
  const failReason = (localResult.passed === false ? localResult.reason : '') ||
                     (aiResult.passed === false ? aiResult.reason : '');

  if (verifyFailed) {
    // 统计已尝试次数(已存的 proof 数量)
    const MAX_RETRIES = 3;
    const [[proofCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM task_proofs WHERE completion_id = ?`, [id]
    );

    // 保存本次失败的截图(计入尝试次数)
    try {
      await pool.query(
        `INSERT INTO task_proofs (completion_id, file_path, file_sha256, file_size_kb, mime_type)
         VALUES (?, ?, ?, 0, 'image/webp')`,
        [id, screenshotInfo.relativePath, screenshotInfo.hash || '']
      );
    } catch (proofErr) {
      console.error('[submit] 截图存证失败:', proofErr.message);
    }

    const retryNum = proofCount.cnt + 1;

    if (retryNum >= MAX_RETRIES) {
      // 3 次用完 → 设为 auto_rejected,允许申请人工审核
      await pool.query(
        `UPDATE task_completions SET status = 'auto_rejected', submitted_at = NOW() WHERE id = ? AND status IN ('claimed','auto_rejected')`,
        [id]
      );
      console.log(`[submit] 验证失败 ${retryNum}/${MAX_RETRIES} 次,进入人工审核 completion#${id}`);
      return res.status(400).json({
        ok: false,
        error: `截图验证未通过: ${failReason}`,
        retryNum,
        noRetry: true,
        canManualReview: true,
        completionId: id
      });
    }

    // 还有重试机会
    console.log(`[submit] 验证失败 ${retryNum}/${MAX_RETRIES} 次 completion#${id}: ${failReason}`);
    return res.status(400).json({
      ok: false,
      error: `截图验证未通过: ${failReason}`,
      retryNum,
      completionId: id
    });
  }

  // 验证通过(或跳过) → 继续走互动增量验证
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

/**
 * POST /api/completions/:id/request-review  用户申请人工审核
 */
router.post('/:id/request-review', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pool = require('../config/db');

  const [[comp]] = await pool.query(
    `SELECT id, user_id, status FROM task_completions WHERE id = ?`, [id]
  );
  if (!comp) return res.status(404).json({ ok: false, error: '记录不存在' });
  if (comp.user_id !== req.user.id) return res.status(403).json({ ok: false, error: '无权操作' });
  if (comp.status !== 'auto_rejected') return res.status(400).json({ ok: false, error: '当前状态不可申请人工审核' });

  await pool.query(`UPDATE task_completions SET status = 'manual_pending' WHERE id = ?`, [id]);

  const notify = require('../services/notifications');
  // 通知管理员
  const [admins] = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
  for (const admin of admins) {
    notify.send({
      userId: admin.id, type: 'system',
      title: '有新的人工审核申请',
      content: `接单 #${id} 申请人工审核`,
      refType: 'completion', refId: id
    });
  }

  res.json({ ok: true, message: '已提交人工审核申请' });
});

/**
 * POST /api/completions/:id/review  发布者审核(通过/拒绝)
 */
router.post('/:id/review', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { action } = req.body;
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ ok: false, error: '无效操作' });
  }

  const pool = require('../config/db');
  const [[comp]] = await pool.query(
    `SELECT c.id, c.user_id, c.task_id, c.status, t.reward_points, t.publisher_id
     FROM task_completions c JOIN tasks t ON t.id = c.task_id
     WHERE c.id = ?`, [id]
  );
  if (!comp) return res.status(404).json({ ok: false, error: '记录不存在' });

  // 只有发布者或管理员可以审核
  if (comp.publisher_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '只有任务发布者可以审核' });
  }

  const pointsService = require('../services/points');
  const notify = require('../services/notifications');

  if (action === 'approve') {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await pointsService.addInTx(conn, {
        userId: comp.user_id, amount: comp.reward_points,
        type: 'task_complete', refType: 'completion', refId: id,
        note: '发布者审核通过'
      });
      await conn.query(
        `UPDATE task_completions SET status = 'manual_passed', points_awarded = ?, awarded_at = NOW() WHERE id = ?`,
        [comp.reward_points, id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      return res.status(500).json({ ok: false, error: err.message });
    } finally { conn.release(); }

    notify.send({ userId: comp.user_id, type: 'points_awarded', title: '审核通过', content: `${comp.reward_points} 积分已发放`, refType: 'completion', refId: id });
    res.json({ ok: true, message: '已通过,积分已发放' });
  } else {
    await pool.query(`UPDATE task_completions SET status = 'manual_rejected' WHERE id = ?`, [id]);
    await pool.query(`UPDATE tasks SET quota_remaining = quota_remaining + 1 WHERE id = ? AND quota_remaining < quota_total`, [comp.task_id]);
    notify.send({ userId: comp.user_id, type: 'verify_failed', title: '审核未通过', content: '发布者审核未通过', refType: 'completion', refId: id });
    res.json({ ok: true, message: '已拒绝,名额已释放' });
  }
});

module.exports = router;
