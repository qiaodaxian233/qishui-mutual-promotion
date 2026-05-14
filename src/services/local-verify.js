/**
 * 本地截图验证(无需 API Key)
 *
 * 1. OCR 提取截图文字,验证歌名是否匹配
 * 2. 像素分析:检测红心区域是否有红色(点赞验证)
 * 3. 进度条分析:检测播放进度是否过半
 */
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// 缓存 worker 避免重复初始化
let worker = null;

async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('chi_sim+eng');
  }
  return worker;
}

/**
 * 验证截图
 * @param {string} imagePath - 图片路径
 * @param {Object} opts
 *   - songName: 歌名(用于匹配)
 *   - taskType: like/listen/comment/share
 * @returns {Object} { ok, passed, reason, details }
 */
async function verifyScreenshot(imagePath, { songName, taskType }) {
  const fullPath = imagePath.startsWith('/')
    ? path.join('/www/wwwroot/qishui-mutual-promotion', imagePath)
    : path.join(__dirname, '../..', imagePath);

  if (!fs.existsSync(fullPath)) {
    return { ok: true, passed: null, reason: '截图文件不存在', skipped: true };
  }

  const results = { songMatch: null, heartRed: null, progressPast50: null };

  try {
    // 1. OCR 提取文字
    const ocrText = await extractText(fullPath);
    results.ocrText = ocrText;

    // 验证歌名
    if (songName) {
      const cleanSong = songName.replace(/[（）()【】\[\]]/g, '').trim();
      // 歌名可能是中文/英文,模糊匹配
      const songMatch = ocrText.includes(cleanSong) ||
                        ocrText.includes(songName) ||
                        fuzzyMatch(ocrText, cleanSong);
      results.songMatch = songMatch;
    }

    // 2. 根据任务类型做像素分析
    if (taskType === 'like') {
      results.heartRed = await detectRedHeart(fullPath);
    }

    if (taskType === 'listen') {
      results.progressPast50 = await detectProgress(fullPath);
    }

    // 综合判断
    let passed = true;
    const reasons = [];

    // 歌名不匹配 → 警告(不直接拒绝,OCR 可能识别不准)
    if (results.songMatch === false) {
      reasons.push(`截图中未找到歌名「${songName}」`);
    }

    // 红心未点亮 → 拒绝
    if (taskType === 'like' && results.heartRed === false) {
      passed = false;
      reasons.push('未检测到已点赞(红心未点亮)');
    }

    // 进度条未过半 → 拒绝
    if (taskType === 'listen' && results.progressPast50 === false) {
      passed = false;
      reasons.push('播放进度未过半');
    }

    return {
      ok: true,
      passed,
      reason: reasons.join('; ') || '验证通过',
      details: results
    };
  } catch (err) {
    console.error('[local-verify] 分析失败:', err.message);
    return { ok: true, passed: null, reason: '本地分析失败: ' + err.message, skipped: true };
  }
}

/**
 * OCR 提取文字
 */
async function extractText(imagePath) {
  try {
    const w = await getWorker();
    const { data: { text } } = await w.recognize(imagePath);
    return text || '';
  } catch (err) {
    console.warn('[local-verify] OCR 失败:', err.message);
    return '';
  }
}

/**
 * 检测红心是否点亮
 * 原理:汽水音乐的红心在底部偏左,点亮后是红色/粉色
 * 扫描图片下方 1/4 区域的左侧 1/3,统计红色像素占比
 */
async function detectRedHeart(imagePath) {
  try {
    const img = sharp(imagePath);
    const meta = await img.metadata();
    const w = meta.width;
    const h = meta.height;

    // 裁剪底部 25% 左侧 40% 区域(红心通常在这里)
    const cropTop = Math.floor(h * 0.75);
    const cropHeight = h - cropTop;
    const cropWidth = Math.floor(w * 0.4);

    const { data, info } = await img
      .extract({ left: 0, top: cropTop, width: cropWidth, height: cropHeight })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 统计红色像素(R > 180, G < 100, B < 100)
    let redPixels = 0;
    const totalPixels = info.width * info.height;
    const channels = info.channels;

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 180 && g < 100 && b < 100) {
        redPixels++;
      }
      // 粉红色也算(点赞的颜色可能偏粉)
      if (r > 200 && g < 130 && b < 150 && r > g * 1.5) {
        redPixels++;
      }
    }

    const ratio = redPixels / totalPixels;
    console.log(`[local-verify] 红心检测: ${redPixels}/${totalPixels} = ${(ratio * 100).toFixed(2)}%`);

    // 红色像素占比 > 0.5% 认为红心已点亮
    return ratio > 0.005;
  } catch (err) {
    console.warn('[local-verify] 红心检测失败:', err.message);
    return null;
  }
}

/**
 * 检测播放进度是否过半
 * 原理:进度条在底部,是一条细线,已播放部分有颜色
 * 扫描底部 10% 区域,找到最长的水平彩色线段
 */
async function detectProgress(imagePath) {
  try {
    const img = sharp(imagePath);
    const meta = await img.metadata();
    const w = meta.width;
    const h = meta.height;

    // 裁剪底部 15% 区域
    const cropTop = Math.floor(h * 0.85);
    const cropHeight = h - cropTop;

    const { data, info } = await img
      .extract({ left: 0, top: cropTop, width: w, height: cropHeight })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const scanWidth = info.width;

    // 逐行扫描,找到像素颜色变化最明显的那一行(进度条)
    let bestProgress = 0;

    for (let y = 0; y < info.height; y++) {
      let coloredPixels = 0;
      for (let x = 0; x < scanWidth; x++) {
        const idx = (y * scanWidth + x) * channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // 非灰色像素(进度条的已播放部分通常有颜色)
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max > 0 ? (max - min) / max : 0;
        const brightness = max / 255;

        if (saturation > 0.2 && brightness > 0.3) {
          coloredPixels++;
        }
      }
      const progress = coloredPixels / scanWidth;
      if (progress > bestProgress) {
        bestProgress = progress;
      }
    }

    console.log(`[local-verify] 进度检测: ${(bestProgress * 100).toFixed(1)}%`);

    // 进度 > 45% 算过半(留点容差)
    return bestProgress > 0.45;
  } catch (err) {
    console.warn('[local-verify] 进度检测失败:', err.message);
    return null;
  }
}

/**
 * 模糊匹配(OCR 可能有错字)
 */
function fuzzyMatch(text, target) {
  if (!target || target.length < 2) return false;
  // 至少 60% 的字符匹配
  let matchCount = 0;
  for (const char of target) {
    if (text.includes(char)) matchCount++;
  }
  return matchCount / target.length >= 0.6;
}

module.exports = { verifyScreenshot };
