/**
 * 通知路由
 *
 * GET   /api/notifications          通知列表
 * GET   /api/notifications/unread   未读数
 * POST  /api/notifications/read     标记已读(body.id 单条,不传则全部)
 */
const express = require('express');
const router = express.Router();
const notify = require('../services/notifications');
const { requireAuth } = require('../middlewares/auth');

router.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const items = await notify.list(req.user.id, { limit, offset });
  res.json({ ok: true, items });
});

router.get('/unread', requireAuth, async (req, res) => {
  const count = await notify.unreadCount(req.user.id);
  res.json({ ok: true, count });
});

router.post('/read', requireAuth, async (req, res) => {
  await notify.markRead(req.user.id, req.body.id || null);
  res.json({ ok: true });
});

module.exports = router;
