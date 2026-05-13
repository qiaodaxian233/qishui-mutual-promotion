/**
 * 鉴权中间件
 * 从 Authorization: Bearer <token> 头取 token,校验后挂 req.user
 */
const auth = require('../services/auth');

/**
 * 必须登录
 */
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  const userId = await auth.getUserIdByToken(token);

  if (!userId) {
    return res.status(401).json({ ok: false, error: '未登录或登录已过期' });
  }

  const user = await auth.getUserById(userId);
  if (!user) {
    return res.status(401).json({ ok: false, error: '用户不存在' });
  }
  if (user.status === 'banned' || user.status === 'frozen') {
    return res.status(403).json({ ok: false, error: '账号状态异常' });
  }

  req.user = user;
  req.token = token;
  next();
}

/**
 * 可选登录(有 token 就解析,没 token 也放行)
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  const userId = await auth.getUserIdByToken(token);
  if (userId) {
    const user = await auth.getUserById(userId);
    if (user && user.status === 'active') {
      req.user = user;
      req.token = token;
    }
  }
  next();
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return req.headers['x-auth-token'] || '';
}

module.exports = { requireAuth, optionalAuth };
