/**
 * 注册 + 登录 + token 校验
 *
 * token 方案:
 * - 登录成功后生成 64 字符随机串
 * - 暂时用内存 Map 存(单进程足够)
 * - 后续切 Redis / 数据库表
 *
 * 注:与用户 truth-dare-wheel 的"密码当 token"不同,
 * 因为这里用户量会更大,且要支持多设备同时在线
 */
const pool = require('../config/db');
const config = require('../config');
const {
  hashPassword,
  verifyPassword,
  sha256WithSalt,
  generateToken
} = require('../utils/crypto');
const { extractDomain } = require('../utils/validate');

// token 存数据库,重启不丢
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 天

// 定期清理过期 session(每小时)
setInterval(async () => {
  try {
    await pool.query(`DELETE FROM user_sessions WHERE expires_at < NOW()`);
  } catch {}
}, 60 * 60 * 1000);

/**
 * 检查邮箱域名是否在临时邮箱黑名单
 */
async function isDisposableEmail(email) {
  const domain = extractDomain(email);
  if (!domain) return true; // 格式不对的也判作不合法
  const [rows] = await pool.query(
    `SELECT 1 FROM disposable_domains WHERE domain = ? LIMIT 1`,
    [domain]
  );
  return rows.length > 0;
}

/**
 * 检查邮箱是否已注册
 */
async function isEmailRegistered(email) {
  const [rows] = await pool.query(
    `SELECT id FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
  return rows.length > 0;
}

/**
 * 注册新用户(需先通过邮箱验证)
 * @returns {Object} { ok, userId?, error? }
 */
async function register({ email, password, nickname, ip, userAgent }) {
  // 双保险:再查一次邮箱是否被占
  if (await isEmailRegistered(email)) {
    return { ok: false, error: '邮箱已被注册' };
  }

  const passwordHash = await hashPassword(password);
  const registerIpHash = ip ? sha256WithSalt(ip) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 创建用户
    const [result] = await conn.query(
      `INSERT INTO users
         (email, password_hash, nickname, email_verified, email_verified_at,
          points, credit_score, register_ip, register_ua)
       VALUES (?, ?, ?, 1, NOW(), ?, ?, ?, ?)`,
      [
        email,
        passwordHash,
        nickname,
        config.business.initialPoints,
        config.business.initialCredit,
        registerIpHash,
        userAgent || null
      ]
    );
    const userId = result.insertId;

    // 记一条积分流水(注册赠送)
    await conn.query(
      `INSERT INTO points_log
         (user_id, delta, balance_after, type, note)
       VALUES (?, ?, ?, 'register_bonus', '新用户注册赠送')`,
      [userId, config.business.initialPoints, config.business.initialPoints]
    );

    await conn.commit();
    return { ok: true, userId };
  } catch (err) {
    await conn.rollback();
    // 唯一索引冲突
    if (err.code === 'ER_DUP_ENTRY') {
      return { ok: false, error: '邮箱已被注册' };
    }
    console.error('[auth] 注册失败:', err);
    return { ok: false, error: '注册失败,请稍后重试' };
  } finally {
    conn.release();
  }
}

/**
 * 登录
 * @returns {Object} { ok, token?, user?, error? }
 */
async function login({ email, password, ip }) {
  const [rows] = await pool.query(
    `SELECT id, email, password_hash, nickname, avatar_url,
            points, credit_score, status
       FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
  if (rows.length === 0) {
    // 故意不区分"用户不存在"和"密码错误",防止账号枚举
    return { ok: false, error: '邮箱或密码错误' };
  }
  const user = rows[0];

  if (user.status === 'banned') {
    return { ok: false, error: '账号已封禁' };
  }
  if (user.status === 'frozen') {
    return { ok: false, error: '账号已冻结,请联系客服' };
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    return { ok: false, error: '邮箱或密码错误' };
  }

  // 生成 token 存数据库
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    `INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
    [token, user.id, expiresAt]
  );

  // 更新最后登录
  const lastLoginIpHash = ip ? sha256WithSalt(ip) : null;
  await pool.query(
    `UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?`,
    [lastLoginIpHash, user.id]
  );

  return {
    ok: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatarUrl: user.avatar_url,
      points: user.points,
      creditScore: user.credit_score
    }
  };
}

/**
 * 校验 token,返回 userId 或 null
 */
async function getUserIdByToken(token) {
  if (!token) return null;
  try {
    const [[row]] = await pool.query(
      `SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > NOW() LIMIT 1`,
      [token]
    );
    return row ? row.user_id : null;
  } catch {
    return null;
  }
}

/**
 * 登出
 */
async function logout(token) {
  if (token) {
    try { await pool.query(`DELETE FROM user_sessions WHERE token = ?`, [token]); } catch {}
  }
}

/**
 * 根据 userId 查最新用户信息(用于鉴权中间件附加 req.user)
 */
async function getUserById(userId) {
  const [rows] = await pool.query(
    `SELECT id, email, nickname, avatar_url, points, credit_score, status, role
       FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  isDisposableEmail,
  isEmailRegistered,
  register,
  login,
  logout,
  getUserIdByToken,
  getUserById
};
