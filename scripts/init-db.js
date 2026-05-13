/**
 * 一键初始化数据库
 * 用法:node scripts/init-db.js
 * 会执行 db/schema.sql 里的全部 CREATE TABLE
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const password = process.env.DB_PASSWORD;
  if (!password) {
    console.error('❌ 缺少 DB_PASSWORD 环境变量,请检查 .env');
    process.exit(1);
  }

  // 先连不带 database 的连接,创建库
  const adminConn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password,
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  const sqlPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  try {
    console.log('📦 正在执行 db/schema.sql...');
    await adminConn.query(sql);
    console.log('✅ 数据库初始化完成');
  } catch (err) {
    console.error('❌ 执行失败:', err.message);
    process.exit(1);
  } finally {
    await adminConn.end();
  }
})();
