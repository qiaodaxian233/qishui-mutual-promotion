/**
 * 从开源仓库导入临时邮箱黑名单
 * 来源:https://github.com/disposable-email-domains/disposable-email-domains
 * 用法:node scripts/import-disposable-domains.js
 *
 * 建议每月跑一次保持名单最新
 */
require('dotenv').config();
const https = require('https');
const mysql = require('mysql2/promise');

const SOURCE_URL = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  console.log('📥 拉取临时邮箱列表...');
  let text;
  try {
    text = await fetchText(SOURCE_URL);
  } catch (err) {
    console.error('❌ 拉取失败:', err.message);
    console.error('请检查网络,或手动下载文件后导入');
    process.exit(1);
  }

  const domains = text.split('\n')
    .map(line => line.trim().toLowerCase())
    .filter(line => line && !line.startsWith('#'));

  console.log(`📊 共获取 ${domains.length} 个域名`);

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'qishui_mutual_promotion',
    charset: 'utf8mb4'
  });

  try {
    // 分批插入,每批 1000 个
    const batchSize = 1000;
    let inserted = 0;
    for (let i = 0; i < domains.length; i += batchSize) {
      const batch = domains.slice(i, i + batchSize);
      const values = batch.map(d => [d, 'github']);
      await pool.query(
        `INSERT IGNORE INTO disposable_domains (domain, source) VALUES ?`,
        [values]
      );
      inserted += batch.length;
      process.stdout.write(`\r导入进度:${inserted} / ${domains.length}`);
    }
    console.log(`\n✅ 导入完成`);

    const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM disposable_domains`);
    console.log(`📦 黑名单总数(含已有):${rows[0].total}`);
  } catch (err) {
    console.error('❌ 导入失败:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
