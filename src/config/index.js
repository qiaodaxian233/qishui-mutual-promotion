/**
 * 环境变量集中加载
 * 启动时校验必填项,提前暴露配置错误
 *
 * 用绝对路径加载 .env,无论从哪个目录启动都能正确找到
 * (PM2 的 cwd 可能不是项目目录,默认 dotenv.config() 会失效)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const required = ['DB_PASSWORD', 'SMTP_USER', 'SMTP_PASS', 'IP_HASH_SALT'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`[config] 缺少必填环境变量:${missing.join(', ')}`);
  console.error(`请检查 .env 文件,参考 .env.example`);
  process.exit(1);
}

if (process.env.IP_HASH_SALT && process.env.IP_HASH_SALT.length < 16) {
  console.warn(`[config] ⚠️ IP_HASH_SALT 长度不足 16,生产环境不安全`);
}

module.exports = {
  port: parseInt(process.env.PORT || '3201', 10),
  env: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'qishui_mutual_promotion',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    fromName: process.env.SMTP_FROM_NAME || '汽水音乐互推平台'
  },

  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
    ipHashSalt: process.env.IP_HASH_SALT
  },

  business: {
    initialPoints: parseInt(process.env.INITIAL_POINTS || '100', 10),
    initialCredit: parseInt(process.env.INITIAL_CREDIT || '600', 10),
    emailCodeTtlMinutes: parseInt(process.env.EMAIL_CODE_TTL_MINUTES || '30', 10),
    emailCodeCooldownSeconds: parseInt(process.env.EMAIL_CODE_COOLDOWN_SECONDS || '60', 10)
  }
};
