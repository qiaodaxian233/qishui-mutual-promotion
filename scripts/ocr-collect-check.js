#!/usr/bin/env node
/**
 * OCR 审核 uploads/collect/ 下的截图,识别非汽水音乐播放页的垃圾提交
 *
 * 复用项目已有依赖: tesseract.js + sharp (无需 dnf/pip 装任何系统包)
 *
 * 用法:
 *   node scripts/ocr-collect-check.js                 # 全量审核
 *   node scripts/ocr-collect-check.js --recent 7      # 只看最近 N 天
 *   node scripts/ocr-collect-check.js --threshold 5   # 自定义可疑阈值 (默认 4)
 *
 * 输出:
 *   uploads/collect/_audit.csv          完整结果 (Excel 打开)
 *   uploads/collect/_suspicious.txt     可疑文件列表 (评分低于阈值)
 *   uploads/collect/_ocr_cache/*.txt    每张图的 OCR 全文 (二次跑跳过)
 */
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const COLLECT_DIR = path.join(ROOT, 'uploads/collect');
const FP_FILE = path.join(COLLECT_DIR, '.fingerprints.json');
const CACHE_DIR = path.join(COLLECT_DIR, '_ocr_cache');
const CSV_FILE = path.join(COLLECT_DIR, '_audit.csv');
const SUS_FILE = path.join(COLLECT_DIR, '_suspicious.txt');
const TESSDATA_PATH = path.join(ROOT, 'tessdata');

// 参数解析
const args = process.argv.slice(2);
let threshold = 4;
let recentDays = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--threshold') threshold = parseInt(args[++i]);
  if (args[i] === '--recent')    recentDays = parseInt(args[++i]) || 7;
}

if (!fs.existsSync(COLLECT_DIR)) {
  console.error(`❌ ${COLLECT_DIR} 不存在`);
  process.exit(1);
}
if (!fs.existsSync(TESSDATA_PATH)) {
  console.warn(`⚠️  ${TESSDATA_PATH} 不存在, tesseract.js 会自动从网络下载语言包`);
}
fs.mkdirSync(CACHE_DIR, { recursive: true });

// 评分规则:
// 时间戳 mm:ss              +3   (强信号: 当前时间 / 总时长)
// "汽水音乐" 字样            +3   (直接证据)
// 播放页关键词              +2/个 (歌词/评论/下一首/分享/收藏...)
// 有中文字符                +1   (基本盘)
// 有可识别文字 (>10 字符)   +1   (不是空白/纯图)
const KEYWORDS = ['歌词', '评论', '下一首', '上一首', '分享', '收藏',
                  '单曲循环', '列表循环', '随机播放', '正在播放', '播放队列'];

function scoreText(txt) {
  let score = 0;
  const flags = [];

  if (/\b\d{1,2}:\d{2}\b/.test(txt))         { score += 3; flags.push('TIME'); }
  if (/汽水音乐/.test(txt))                  { score += 3; flags.push('LOGO'); }
  for (const kw of KEYWORDS) {
    if (txt.includes(kw)) { score += 2; flags.push(`KW:${kw}`); }
  }
  if (/[\u4e00-\u9fff]/.test(txt))           { score += 1; flags.push('CN'); }
  if (txt.replace(/\s/g, '').length > 10)    { score += 1; flags.push('HAS_TEXT'); }

  return { score, flags: flags.join(',') };
}

// 加载指纹元数据
function loadFingerprints() {
  if (!fs.existsSync(FP_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(FP_FILE, 'utf-8'));
    const byFilename = {};
    for (const [fp, info] of Object.entries(raw)) {
      if (info && info.filename) byFilename[info.filename] = { fp, ...info };
    }
    return byFilename;
  } catch (e) {
    console.warn('⚠️  指纹文件解析失败:', e.message);
    return {};
  }
}

// 对单张图做 OCR (预处理: 灰度 + 锐化, 提升识别率)
async function extractText(imagePath) {
  try {
    const buf = await sharp(imagePath)
      .greyscale()
      .normalise()
      .sharpen({ sigma: 1.2 })
      .png()
      .toBuffer();
    const { data: { text } } = await worker.recognize(buf);
    return (text || '').replace(/\s+/g, ' ').trim();
  } catch (err) {
    console.warn(`  ⚠️  OCR 失败 ${path.basename(imagePath)}: ${err.message}`);
    return '';
  }
}

// CSV 字段转义
function csvEscape(v) {
  const s = String(v ?? '').replace(/"/g, "'").replace(/[\r\n]/g, ' ');
  return `"${s}"`;
}

let worker;

(async () => {
  // 列文件
  const allFiles = fs.readdirSync(COLLECT_DIR)
    .filter(f => f.startsWith('collect_') && f.endsWith('.jpg'));

  let files = allFiles;
  if (recentDays > 0) {
    const cutoff = Date.now() - recentDays * 86400 * 1000;
    files = files.filter(f => {
      const stat = fs.statSync(path.join(COLLECT_DIR, f));
      return stat.mtimeMs > cutoff;
    });
  }

  if (files.length === 0) {
    console.log('没有要审核的图片');
    process.exit(0);
  }

  console.log(`准备审核 ${files.length} 张图片 (阈值=${threshold}${recentDays ? `, 最近${recentDays}天` : ''})`);
  console.log(`初始化 tesseract worker...`);

  worker = await Tesseract.createWorker('chi_sim+eng', 1, {
    langPath: fs.existsSync(TESSDATA_PATH) ? TESSDATA_PATH : undefined,
    gzip: false
  });

  const meta = loadFingerprints();

  // CSV 头
  fs.writeFileSync(CSV_FILE, '文件名,手机型号,IP,提交时间,分辨率,评分,命中标签,文本前80字,UA片段\n');
  fs.writeFileSync(SUS_FILE, '');

  let total = 0, suspicious = 0, cached = 0, ocred = 0;

  for (const name of files) {
    total++;
    const imgPath = path.join(COLLECT_DIR, name);
    const cacheFile = path.join(CACHE_DIR, name.replace(/\.jpg$/, '.txt'));

    let text;
    if (fs.existsSync(cacheFile)) {
      text = fs.readFileSync(cacheFile, 'utf-8');
      cached++;
    } else {
      text = await extractText(imgPath);
      fs.writeFileSync(cacheFile, text);
      ocred++;
    }

    // 解析分辨率: collect_1080x2400_xxxxxxxx_1234567890.jpg
    const resMatch = name.match(/_(\d+x\d+)_/);
    const resolution = resMatch ? resMatch[1] : '';

    const m = meta[name] || {};
    const { score, flags } = scoreText(text);
    const preview = text.slice(0, 80);

    const row = [name, m.phone || '', m.ip || '', m.time || '',
                 resolution, score, flags, preview, (m.ua || '').slice(0, 50)];
    fs.appendFileSync(CSV_FILE, row.map(csvEscape).join(',') + '\n');

    if (score < threshold) {
      suspicious++;
      fs.appendFileSync(SUS_FILE,
        `[${score}] ${name}  phone=${m.phone || '?'} ip=${m.ip || '?'}  >> ${preview}\n`);
    }

    if (total % 10 === 0) {
      process.stdout.write(`  ...已处理 ${total}/${files.length}  (OCR ${ocred}, 缓存 ${cached})\r`);
    }
  }

  await worker.terminate();

  console.log('\n');
  console.log('==========================================');
  console.log('  审核完成');
  console.log('==========================================');
  console.log(`  总计:     ${total} 张`);
  console.log(`  本次 OCR: ${ocred} 张  (缓存复用 ${cached} 张)`);
  console.log(`  可疑:     ${suspicious} 张  (评分 < ${threshold})`);
  console.log('');
  console.log(`  📊 完整报告: ${CSV_FILE}`);
  console.log(`  🚩 可疑列表: ${SUS_FILE}`);

  if (suspicious > 0) {
    console.log('\n可疑样本预览 (前 10 条):');
    const lines = fs.readFileSync(SUS_FILE, 'utf-8').split('\n').slice(0, 10);
    for (const line of lines) if (line) console.log('  ' + line);
    console.log('\n下一步建议:');
    console.log('  1) 人工抽查可疑图: cat uploads/collect/_suspicious.txt');
    console.log('  2) 确认是垃圾后批量删: bash scripts/ocr-collect-purge.sh');
  }
})().catch(err => {
  console.error('❌ 出错:', err);
  process.exit(1);
});
