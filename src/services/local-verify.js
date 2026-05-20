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
let workerInitFailed = false;  // 一旦失败标记,避免每次请求都重试
const TESSDATA_PATH = path.join(__dirname, '../../tessdata');
const REQUIRED_LANGS = ['chi_sim', 'eng'];

function checkTessdata() {
  const missing = [];
  for (const lang of REQUIRED_LANGS) {
    const file = path.join(TESSDATA_PATH, `${lang}.traineddata`);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      missing.push(lang);
    }
  }
  return missing;
}

async function getWorker() {
  if (workerInitFailed) {
    throw new Error('OCR worker 初始化已失败,请先跑 `bash scripts/install-tessdata.sh` 安装 tessdata,然后重启服务');
  }
  if (!worker) {
    const missing = checkTessdata();
    if (missing.length > 0) {
      workerInitFailed = true;
      console.error(`[local-verify] ✗ tessdata 缺失:${missing.join(', ')}.traineddata`);
      console.error(`[local-verify] ✗ 请在项目根目录跑:bash scripts/install-tessdata.sh`);
      console.error(`[local-verify] ✗ 然后 pm2 restart qishui-mutual-promotion`);
      throw new Error(`OCR 模型缺失:${missing.join(', ')}`);
    }
    try {
      worker = await Tesseract.createWorker('chi_sim+eng', 1, {
        langPath: TESSDATA_PATH,
        gzip: false
      });
    } catch (err) {
      workerInitFailed = true;
      console.error(`[local-verify] ✗ Tesseract worker 初始化失败:`, err.message);
      throw err;
    }
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
 * 预处理:裁底部文字区(55%-85%) + 放大2倍 + 灰度 + 拉伸对比度 + 锐化
 * 汽水音乐主题色多变(蓝/紫/粉),低对比度场景下原图直识别效果差
 */
async function extractText(imagePath) {
  try {
    const img = sharp(imagePath);
    const meta = await img.metadata();

    // 1. 裁出底部文字区(歌名/作者/标签都在这一带)
    // 2. 放大 2 倍提升小字识别率
    // 3. 灰度 + normalise 把蓝底白字这种低对比度场景拉开
    // 4. 锐化让字边缘更清晰
    const buf = await img
      .extract({
        left: 0,
        top: Math.floor(meta.height * 0.55),
        width: meta.width,
        height: Math.floor(meta.height * 0.30)
      })
      .resize({ width: meta.width * 2 })
      .greyscale()
      .normalise()
      .sharpen({ sigma: 1.5 })
      .png()
      .toBuffer();

    const w = await getWorker();
    const { data: { text: textPre } } = await w.recognize(buf);

    // 兜底:如果预处理识别为空,再用原图试一次(防止偶尔裁错位置)
    if (!textPre || textPre.trim().length < 4) {
      const { data: { text: textRaw } } = await w.recognize(imagePath);
      return textRaw || '';
    }
    return textPre;
  } catch (err) {
    console.warn('[local-verify] OCR 失败:', err.message);
    return '';
  }
}

/**
 * 检测红心是否点亮
 * 原理:汽水音乐的红心在底部偏左,点亮后是红色/粉色
 * 扫描图片下方区域,统计红色/粉色像素占比
 */
async function detectRedHeart(imagePath) {
  try {
    const img = sharp(imagePath);
    const meta = await img.metadata();
    const w = meta.width;
    const h = meta.height;

    // 第一步:精确裁切红心区域
    // 红心在底部 15-30% 区域,左侧 25% 区域
    const cropTop = Math.floor(h * 0.70);
    const cropBottom = Math.floor(h * 0.88);
    const cropHeight = cropBottom - cropTop;
    const cropWidth = Math.floor(w * 0.25);

    const { data, info } = await img
      .extract({ left: 0, top: cropTop, width: cropWidth, height: cropHeight })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let redPixels = 0;
    const totalPixels = info.width * info.height;
    const channels = info.channels;

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const brightness = (r + g + b) / 3;

      // 跳过太暗的像素(背景)
      if (brightness < 50) continue;

      // 纯红
      const isRed = r > 150 && g < 120 && b < 120;
      // 粉红/玫红
      const isPink = r > 160 && g < 150 && b < 170 && r > g * 1.2;
      // 暖色调红心
      const isWarmRed = r > 170 && r - g > 30 && r - b > 20;
      // 紫色主题下的红心(B值偏高)
      const isPurpleRed = r > 150 && r > g * 1.3 && b < r && g < r * 0.8;
      // 通用:R通道明显高于G
      const isReddish = r > 140 && r - g > 40 && brightness > 60;

      if (isRed || isPink || isWarmRed || isPurpleRed || isReddish) {
        redPixels++;
      }
    }

    const ratio = redPixels / totalPixels;
    console.log(`[local-verify] 红心检测: ${redPixels}/${totalPixels} = ${(ratio * 100).toFixed(3)}%`);

    // 红色像素占比 > 0.5% 认为红心已点亮
    // 真阳: 旧窗影=4.1%  假阳: 紫色背景=0.087%
    return ratio > 0.005;
  } catch (err) {
    console.warn('[local-verify] 红心检测失败:', err.message);
    return null;
  }
}

/**
 * 检测播放进度是否过半
 * 扫描 87%-91% 横向窄带(刚好在播放按钮上方,避开干扰)
 * 找"高亮像素",用桶聚类定位圆点
 * 颜色判定:纯白(>=210) 或 浅灰白(>=180且不偏色),兼容主题色变化
 */
/**
 * 根据图片宽高比选择扫描参数
 *
 * 汽水音乐底部布局从下往上:tab栏 → 播放按钮 → 操作图标 → 进度条
 * 手机越长(ratio越大),底部UI占的百分比越小,进度条位置越靠下(百分比越高)
 *
 * 实测数据:
 *   1080×2400 (ratio 2.22, 20:9)   → 进度条 ~88-90%, 图标 ~86-87%, 播放按钮 ~91%+
 *    852×1800 (ratio 2.11, ~19:9)   → 进度条 ~89%
 *   1080×1920 (ratio 1.78, 16:9)    → 进度条 ~85-87%（底部UI占比更大,进度条被挤高）
 *
 * 圆点直径也随分辨率缩放:
 *   720w  → ~8-12px
 *   1080w → ~12-18px
 *   1440w → ~16-24px
 */
function getProgressProfile(w, h) {
  const ratio = h / w;
  const scale = w / 1080;  // 以 1080 为基准缩放

  // 圆点像素宽度范围(随分辨率缩放)
  const dotMin = Math.max(3, Math.round(3 * scale));
  const dotMax = Math.max(20, Math.round(25 * scale));

  // y 跨度范围(圆点高度,随分辨率缩放)
  const ySpanMin = Math.max(3, Math.round(4 * scale));
  const ySpanMax = Math.max(20, Math.round(30 * scale));

  if (ratio >= 2.1) {
    // 长屏手机: 20:9 / 19.5:9 (1080×2400, 1170×2532, 1080×2340 等)
    // 进度条在 87.5%-91%, 上面紧挨图标(~86-87%), 下面紧挨播放按钮(~91%+)
    return {
      profile: 'tall',
      scanTop: 0.875,
      scanBottom: 0.91,
      dotMin, dotMax, ySpanMin, ySpanMax,
    };
  } else if (ratio >= 1.9) {
    // 中等屏: 18:9 / 18.5:9 (1080×2160, 1080×2040 等)
    // 底部UI占比稍大,进度条下移到 86-89.5%
    return {
      profile: 'medium',
      scanTop: 0.86,
      scanBottom: 0.895,
      dotMin, dotMax, ySpanMin, ySpanMax,
    };
  } else {
    // 短屏: 16:9 (1080×1920, 720×1280 等)
    // 底部UI占比最大,进度条在 83.5-88%
    return {
      profile: 'short',
      scanTop: 0.835,
      scanBottom: 0.88,
      dotMin, dotMax, ySpanMin, ySpanMax,
    };
  }
}

async function detectProgress(imagePath) {
  try {
    const img = sharp(imagePath);
    const meta = await img.metadata();
    const w = meta.width;
    const h = meta.height;

    const profile = getProgressProfile(w, h);
    console.log(`[local-verify] 进度检测: ${w}×${h} ratio=${(h/w).toFixed(2)} → ${profile.profile}档 扫描${(profile.scanTop*100).toFixed(1)}%-${(profile.scanBottom*100).toFixed(1)}%`);

    const cropTop = Math.floor(h * profile.scanTop);
    const cropBottom = Math.floor(h * profile.scanBottom);
    const cropHeight = cropBottom - cropTop;
    if (cropHeight <= 2) return null;

    const { data, info } = await img
      .extract({ left: 0, top: cropTop, width: w, height: cropHeight })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const scanWidth = info.width;
    const scanHeight = info.height;

    // 亮像素判定:纯白 或 浅灰白(亮度足够+RGB接近不偏色)
    // 兼容汽水蓝/紫/粉等主题色下圆点不一定全白的情况
    const isBright = (idx) => {
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const brightness = (r + g + b) / 3;
      if (brightness >= 210) return true;
      if (brightness >= 180 && Math.max(r, g, b) - Math.min(r, g, b) < 25) return true;
      return false;
    };

    // 带 y 坐标的亮点收集
    let allDots = [];

    for (let y = 0; y < scanHeight; y++) {
      let clusters = [];
      let streak = 0;
      let clusterStart = -1;

      for (let x = 0; x < scanWidth; x++) {
        const idx = (y * scanWidth + x) * channels;
        if (isBright(idx)) {
          if (streak === 0) clusterStart = x;
          streak++;
        } else {
          // 圆点宽度范围随分辨率缩放
          if (streak >= profile.dotMin && streak < profile.dotMax) {
            clusters.push({ x: clusterStart + Math.floor(streak / 2), width: streak });
          }
          streak = 0;
        }
      }
      if (streak >= profile.dotMin && streak < profile.dotMax) {
        clusters.push({ x: clusterStart + Math.floor(streak / 2), width: streak });
      }

      // 进度条行特征:只有 1-3 个小亮簇(太多说明是文字/复杂UI)
      if (clusters.length >= 1 && clusters.length <= 3) {
        for (const c of clusters) {
          allDots.push({ x: c.x, y });
        }
      }
    }

    if (allDots.length < 3) {
      console.log(`[local-verify] 进度检测: 样本不足(${allDots.length})`);
      return null;
    }

    // 用 20px 桶按 x 聚类,同时记录每个桶的 y 范围
    const bucketSize = Math.max(15, Math.round(20 * (w / 1080)));
    const buckets = {};
    for (const dot of allDots) {
      const key = Math.floor(dot.x / bucketSize) * bucketSize;
      if (!buckets[key]) buckets[key] = { xs: [], yMin: dot.y, yMax: dot.y };
      buckets[key].xs.push(dot.x);
      if (dot.y < buckets[key].yMin) buckets[key].yMin = dot.y;
      if (dot.y > buckets[key].yMax) buckets[key].yMax = dot.y;
    }

    // 过滤:只保留 y 跨度在合理范围内的桶(进度条圆点是小圆形)
    // 图标行/播放按钮的 y 跨度远超圆点;单行噪声 y 跨度太小
    let bestBucket = null, bestCount = 0;
    for (const [key, b] of Object.entries(buckets)) {
      const ySpan = b.yMax - b.yMin;
      if (ySpan < profile.ySpanMin || ySpan > profile.ySpanMax) continue;
      if (b.xs.length > bestCount) {
        bestCount = b.xs.length;
        bestBucket = b;
      }
    }

    // y 跨度过滤全部淘汰 → 放宽 y 跨度限制再试(2-40),兜底
    if (!bestBucket) {
      console.log('[local-verify] 进度检测: 严格过滤无结果,放宽y跨度');
      for (const b of Object.values(buckets)) {
        const ySpan = b.yMax - b.yMin;
        if (ySpan < 2 || ySpan > 40) continue;
        if (b.xs.length > bestCount) {
          bestCount = b.xs.length;
          bestBucket = b;
        }
      }
    }

    if (!bestBucket) {
      console.log('[local-verify] 进度检测: 无有效聚类');
      return null;
    }

    const sorted = bestBucket.xs.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const progress = median / scanWidth;
    const ySpan = bestBucket.yMax - bestBucket.yMin;

    console.log(`[local-verify] 进度检测: 圆点 x=${median}/${scanWidth} = ${(progress * 100).toFixed(1)}%, 聚类${bestCount}票, y跨度${ySpan}px`);

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

// 预热 OCR worker(服务启动时调用,避免首次验证冷启动慢)
setTimeout(async () => {
  try {
    await getWorker();
    console.log('[local-verify] OCR worker 预热完成');
  } catch (err) {
    console.warn('[local-verify] OCR worker 预热失败:', err.message);
  }
}, 3000);
