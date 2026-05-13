/**
 * 积分服务:扣款、加款、流水
 *
 * 设计要点:
 * - 所有积分变动必须事务化(同时改 users.points 和 points_log)
 * - balance_after 冗余存储,便于审计 + 客服查账
 * - users.points 是缓存,真实余额来源是流水 SUM
 */
const pool = require('../config/db');

/**
 * 在已开事务的连接上扣减积分
 * @param {Connection} conn - 已 beginTransaction 的连接
 * @param {Object} params - { userId, amount(正数), type, refType?, refId?, note? }
 * @returns {Object} { ok, balance?, error? }
 */
async function deductInTx(conn, { userId, amount, type, refType, refId, note }) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: '扣减数额非法' };
  }

  // SELECT FOR UPDATE 锁行,防并发超扣
  const [rows] = await conn.query(
    `SELECT points FROM users WHERE id = ? FOR UPDATE`,
    [userId]
  );
  if (rows.length === 0) return { ok: false, error: '用户不存在' };

  const current = rows[0].points;
  if (current < amount) {
    return { ok: false, error: '积分不足', balance: current };
  }
  const after = current - amount;

  await conn.query(
    `UPDATE users SET points = ? WHERE id = ?`,
    [after, userId]
  );

  await conn.query(
    `INSERT INTO points_log (user_id, delta, balance_after, type, ref_type, ref_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, -amount, after, type, refType || null, refId || null, note || null]
  );

  return { ok: true, balance: after };
}

/**
 * 在已开事务的连接上增加积分
 */
async function addInTx(conn, { userId, amount, type, refType, refId, note }) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: '加款数额非法' };
  }

  const [rows] = await conn.query(
    `SELECT points FROM users WHERE id = ? FOR UPDATE`,
    [userId]
  );
  if (rows.length === 0) return { ok: false, error: '用户不存在' };

  const after = rows[0].points + amount;

  await conn.query(
    `UPDATE users SET points = ? WHERE id = ?`,
    [after, userId]
  );

  await conn.query(
    `INSERT INTO points_log (user_id, delta, balance_after, type, ref_type, ref_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, amount, after, type, refType || null, refId || null, note || null]
  );

  return { ok: true, balance: after };
}

/**
 * 独立扣减(自带事务,适合单步操作)
 */
async function deduct(params) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await deductInTx(conn, params);
    if (!result.ok) {
      await conn.rollback();
      return result;
    }
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function add(params) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await addInTx(conn, params);
    if (!result.ok) {
      await conn.rollback();
      return result;
    }
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { deductInTx, addInTx, deduct, add };
