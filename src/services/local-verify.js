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
const TESSDATA_PATH = path.join(__dirname, '../../tessdata');

async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('chi_sim+eng', 1, {
      langPath: TESSDATA_PATH,
      gzip: false
    });
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

    // 所有任务都检测进度条(防秒赞秒评)
    results.progressPast50 = await detectProgress(fullPath);

    // 综合判断
    let passed = true;
    const reasons = [];

    // 歌名不匹配 → 直接拒绝
    if (results.songMatch === false) {
      passed = false;
      reasons.push(`歌名不匹配,请上传「${songName}」的截图`);
    }

    // 红心未点亮 → 拒绝(点赞任务)
    if (taskType === 'like' && results.heartRed === false) {
      passed = false;
      reasons.push('未检测到已点赞(红心未点亮)');
    }

    // 进度条未过半 → 拒绝(所有任务都查)
    if (results.progressPast50 === false) {
      passed = false;
      reasons.push('播放进度未过半,请先听完再截图');
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
 * 原理:找到进度条上的白色小圆点,它的水平位置就是播放进度
 * 进度条区域在底部 10-18% 处(避开底部控制按钮)
 */
async function detectProgress(imagePath) {
  try {
    const img = sharp(imagePath);
    const meta = await img.metadata();
    const w = meta.width;
    const h = meta.height;

    // 裁剪进度条区域:从底部 18% 到底部 8%
    const cropTop = Math.floor(h * 0.82);
    const cropBottom = Math.floor(h * 0.92);
    const cropHeight = cropBottom - cropTop;

    if (cropHeight <= 0) return null;

    const { data, info } = await img
      .extract({ left: 0, top: cropTop, width: w, height: cropHeight })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const scanWidth = info.width;
    const scanHeight = info.height;

    // 方法1:找白色/亮色圆点(进度指示器)
    // 逐像素找最亮的连续区域
    let brightestX = 0;
    let brightestScore = 0;

    for (let y = 0; y < scanHeight; y++) {
      for (let x = 10; x < scanWidth - 10; x++) {
        const idx = (y * scanWidth + x) * channels;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const brightness = (r + g + b) / 3;

        // 白色/浅色像素(进度条圆点通常是白色的)
        if (brightness > 200 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30) {
          // 检查周围也是亮色的(圆点不是单个像素)
          let neighbors = 0;
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= scanWidth) continue;
            const nIdx = (y * scanWidth + nx) * channels;
            const nb = (data[nIdx] + data[nIdx + 1] + data[nIdx + 2]) / 3;
            if (nb > 180) neighbors++;
          }
          if (neighbors >= 3 && brightness > brightestScore) {
            brightestScore = brightness;
            brightestX = x;
          }
        }
      }
    }

    // 方法2:找左右亮度差(已播放部分vs未播放部分)
    let leftBright = 0, rightBright = 0, leftCount = 0, rightCount = 0;
    const midX = Math.floor(scanWidth / 2);

    for (let y = 0; y < scanHeight; y++) {
      for (let x = 10; x < scanWidth - 10; x++) {
        const idx = (y * scanWidth + x) * channels;
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (x < midX) { leftBright += brightness; leftCount++; }
        else { rightBright += brightness; rightCount++; }
      }
    }

    const leftAvg = leftCount > 0 ? leftBright / leftCount : 0;
    const rightAvg = rightCount > 0 ? rightBright / rightCount : 0;

    // 综合判断
    let progress = 0;

    if (brightestScore > 200) {
      // 用圆点位置算进度
      progress = brightestX / scanWidth;
      console.log(`[local-verify] 进度检测(圆点法): 圆点在 x=${brightestX}/${scanWidth} = ${(progress * 100).toFixed(1)}%`);
    } else {
      // 圆点没找到,用亮度差判断
      // 如果左边比右边亮很多,说明已播放过半
      if (leftAvg > rightAvg * 1.1) {
        progress = 0.6;
      } else {
        progress = 0.3;
      }
      console.log(`[local-verify] 进度检测(亮度法): 左=${leftAvg.toFixed(0)} 右=${rightAvg.toFixed(0)} → ${(progress * 100).toFixed(1)}%`);
    }

    return progress > 0.45;
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
