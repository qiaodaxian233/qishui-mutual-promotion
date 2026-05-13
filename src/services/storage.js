/**
 * 文件存储抽象层
 *
 * 当前实现:本地磁盘(data/uploads/<yyyy>/<mm>/<dd>/<random>.<ext>)
 * 未来切换 OSS:只需替换 save/getPath/delete 三个方法的实现
 *
 * 文件命名:不用原文件名,用 sha256[0:16] + 随机串,防止猜测和文件名注入
 */
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, '..', '..', 'data', 'uploads');

/**
 * 确保目录存在
 */
async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * 生成今天的存储相对路径(不含文件名)
 * 例:2026/05/13
 */
function todayPath() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/**
 * 保存 buffer 到存储
 * @param {Buffer} buffer
 * @param {string} ext - 扩展名(不带点),如 'webp'
 * @returns {Promise<{ path, size }>}
 */
async function save(buffer, ext = 'webp') {
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const rand = crypto.randomBytes(4).toString('hex');
  const fileName = `${sha.slice(0, 16)}_${rand}.${ext}`;

  const relDir = todayPath();
  const absDir = path.join(STORAGE_ROOT, relDir);
  await ensureDir(absDir);

  const absPath = path.join(absDir, fileName);
  await fs.writeFile(absPath, buffer);

  // 返回相对路径,方便切换 OSS 时不依赖绝对路径
  const relPath = `${relDir}/${fileName}`;
  return { path: relPath, size: buffer.length };
}

/**
 * 读取文件
 */
async function read(relPath) {
  const absPath = path.join(STORAGE_ROOT, relPath);
  return fs.readFile(absPath);
}

/**
 * 删除文件
 */
async function remove(relPath) {
  if (!relPath) return;
  const absPath = path.join(STORAGE_ROOT, relPath);
  try {
    await fs.unlink(absPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * 获取绝对路径(供 Express 静态文件中间件使用)
 */
function getAbsPath(relPath) {
  return path.join(STORAGE_ROOT, relPath);
}

module.exports = { save, read, remove, getAbsPath, STORAGE_ROOT };
