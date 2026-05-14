/**
 * 图片上传 & 压缩工具
 *
 * - multer 接收上传
 * - sharp 压缩为 720px 宽 WebP(~40-80KB)
 * - 存到 uploads/screenshots/
 */
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads/screenshots');
const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10MB 原图上限
const TARGET_WIDTH = 720;
const WEBP_QUALITY = 75;

// 确保目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// multer 配置:先存内存,再由 sharp 压缩后写盘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 JPG/PNG/WebP/HEIC 格式的图片'));
    }
  }
});

/**
 * 压缩并保存图片
 * @param {Buffer} buffer - 原始图片 buffer
 * @param {string} prefix - 文件名前缀(如 completion_123)
 * @returns {Object} { filename, filepath, size, hash }
 */
async function compressAndSave(buffer, prefix) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  // 尝试 sharp 压缩,失败则直接保存原图
  let filename, filepath, fileSize;
  try {
    filename = `${prefix}_${Date.now()}.webp`;
    filepath = path.join(UPLOAD_DIR, filename);
    const info = await sharp(buffer)
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(filepath);
    fileSize = info.size;
  } catch (sharpErr) {
    console.warn('[image] sharp 压缩失败,保存原图:', sharpErr.message);
    // 降级:直接保存原始文件
    filename = `${prefix}_${Date.now()}.jpg`;
    filepath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filepath, buffer);
    fileSize = buffer.length;
  }

  return {
    filename,
    filepath,
    relativePath: `/uploads/screenshots/${filename}`,
    size: fileSize,
    hash
  };
}

/**
 * 删除截图文件
 */
function deleteScreenshot(filename) {
  const filepath = path.join(UPLOAD_DIR, filename);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch {}
}

module.exports = {
  upload,
  compressAndSave,
  deleteScreenshot,
  UPLOAD_DIR
};
