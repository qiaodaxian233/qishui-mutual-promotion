/**
 * MySQL 连接池
 * 用 mysql2/promise,所有调用走 async/await
 */
const mysql = require('mysql2/promise');
const config = require('./index');

const pool = mysql.createPool(config.db);

// 启动时测一下连接
(async () => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT VERSION() AS version');
    console.log(`[db] 连接成功,MySQL 版本:${rows[0].version}`);
    conn.release();
  } catch (err) {
    console.error('[db] 连接失败:', err.message);
    console.error('请检查 DB_HOST / DB_USER / DB_PASSWORD / DB_NAME');
    process.exit(1);
  }
})();

module.exports = pool;
