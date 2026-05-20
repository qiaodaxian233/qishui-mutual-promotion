/**
 * 截图收集路由
 * 
 * 用途:收集不同手机的汽水音乐播放页截图,用于训练进度条检测算法
 * 防重复:IP + UA 指纹 + 客户端 fingerprint,每台设备只能提交一次
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// 收集的截图存到 uploads/collect/,保留原始分辨率(训练数据)
const COLLECT_DIR = path.resolve(__dirname, '../../uploads/collect');
const FINGERPRINT_FILE = path.resolve(__dirname, '../../uploads/collect/.fingerprints.json');

if (!fs.existsSync(COLLECT_DIR)) {
  fs.mkdirSync(COLLECT_DIR, { recursive: true });
}

// 加载已有指纹
function loadFingerprints() {
  try {
    if (fs.existsSync(FINGERPRINT_FILE)) {
      return JSON.parse(fs.readFileSync(FINGERPRINT_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveFingerprints(data) {
  fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify(data, null, 2));
}

// multer 配置
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// 生成设备指纹
function makeFingerprint(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.headers['user-agent'] || '';
  const clientFp = req.body.fingerprint || '';
  // 组合 IP + UA + 客户端指纹
  const raw = `${ip}|${ua}|${clientFp}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * GET /api/collect/status
 * 检查当前设备是否已提交过
 */
router.get('/status', (req, res) => {
  const fp = makeFingerprint(req);
  const db = loadFingerprints();
  const submitted = !!db[fp];
  const totalCount = Object.keys(db).length;
  res.json({ ok: true, submitted, totalCount });
});

/**
 * POST /api/collect/upload
 * 上传截图
 */
router.post('/upload', upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: '请选择截图文件' });
    }

    // 检查指纹
    const fp = makeFingerprint(req);
    const db = loadFingerprints();
    if (db[fp]) {
      return res.status(409).json({ ok: false, error: '该设备已提交过截图,感谢参与!' });
    }

    const buffer = req.file.buffer;

    // 获取图片信息
    const meta = await sharp(buffer).metadata();
    const { width, height } = meta;

    // 基本校验:截图应该是竖屏手机截图
    if (!width || !height || height < width) {
      return res.status(400).json({ ok: false, error: '请上传手机竖屏截图' });
    }

    // 保存原始分辨率(训练数据需要)
    const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8);
    const filename = `collect_${width}x${height}_${hash}_${Date.now()}.jpg`;
    const filepath = path.join(COLLECT_DIR, filename);

    // 转为 JPEG 保存(统一格式,保留原始分辨率)
    await sharp(buffer)
      .jpeg({ quality: 95 })
      .toFile(filepath);

    // 记录指纹
    const ip = req.ip || req.connection.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    db[fp] = {
      filename,
      size: `${width}x${height}`,
      time: new Date().toISOString(),
      ip: ip.replace(/^::ffff:/, ''),
      ua: ua.slice(0, 100),
      phone: req.body.phone || ''
    };
    saveFingerprints(db);

    const totalCount = Object.keys(db).length;
    console.log(`[collect] 新截图: ${filename} (${width}×${height}) 设备#${totalCount} fp=${fp}`);

    // 自动测试截图能否通过验证
    let autoTest = { passed: null, reason: '未运行', details: {} };

    try {
      const { verifyScreenshot } = require('../services/local-verify');
      const { analyzeScreenshot } = require('../services/screenshot-ai');

      const relativePath = path.relative(path.resolve(__dirname, '..', '..'), filepath);

      const localPromise = verifyScreenshot(relativePath, { songName: '', taskType: 'like' });
      const timeoutPromise = new Promise(resolve =>
        setTimeout(() => resolve({ ok: true, passed: null, skipped: true, reason: '本地分析超时,跳过' }), 10000)
      );
      const localResult = await Promise.race([localPromise, timeoutPromise]);

      const aiResult = await analyzeScreenshot(relativePath, 'like');

      autoTest = {
        passed: localResult.passed === false || aiResult.passed === false ? false : true,
        reason: (localResult.passed === false || aiResult.passed === false)
          ? (localResult.reason || aiResult.reason || '验证不通过')
          : '验证通过',
        details: {
          local: { passed: localResult.passed, reason: localResult.reason || '' },
          ai: { passed: aiResult.passed, reason: aiResult.reason || '' }
        }
      };
    } catch (testErr) {
      console.warn('[collect] 自动测试失败:', testErr.message);
      autoTest = { passed: null, reason: '测试异常: ' + testErr.message, details: {} };
    }

    res.json({
      ok: true,
      message: '提交成功,感谢你的贡献!',
      totalCount,
      autoTest
    });
  } catch (err) {
    console.error('[collect] 上传失败:', err.message);
    res.status(500).json({ ok: false, error: '上传失败,请重试' });
  }
});

/**
 * GET /api/collect/stats
 * 管理员查看收集统计
 */
router.get('/stats', (req, res) => {
  const db = loadFingerprints();
  const entries = Object.entries(db).map(([fp, info]) => ({
    fp: fp.slice(0, 6) + '...',
    ...info
  }));

  // 按分辨率分组统计
  const sizeStats = {};
  for (const e of entries) {
    sizeStats[e.size] = (sizeStats[e.size] || 0) + 1;
  }

  res.json({
    ok: true,
    total: entries.length,
    sizeStats,
    recent: entries.slice(-10).reverse()
  });
});

module.exports = router;
