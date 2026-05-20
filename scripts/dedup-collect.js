#!/usr/bin/env node
/**
 * 检测 uploads/collect/ 下的重复/近似重复图片
 *
 * 复用项目已有的 sharp 依赖, 用 dHash (difference hash) 算图片指纹
 * 同一张图被不同设备指纹提交 = 群发刷量, 重点抓
 *
 * 用法:
 *   node scripts/dedup-collect.js                  # 默认阈值 5
 *   node scripts/dedup-collect.js --threshold 3    # 更严 (只抓几乎完全相同)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const COLLECT_DIR = path.join(ROOT, 'uploads/collect');
const FP_FILE = path.join(COLLECT_DIR, '.fingerprints.json');
const OUT_FILE = path.join(COLLECT_DIR, '_duplicates.txt');

const args = process.argv.slice(2);
let threshold = 5;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--threshold') threshold = parseInt(args[++i]);
}

// dHash: 9x8 灰度图, 横向相邻像素比较 → 64-bit 哈希
// 对裁剪/缩放/亮度变化健壮, 计算极快
async function dHash(imagePath) {
  const { data } = await sharp(imagePath)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 64 bit, 用两个 BigInt 拼也行, 这里用字符串便于汉明距离对齐
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left  = data[y * 9 + x];
      const right = data[y * 9 + x + 1];
      bits += (left < right) ? '1' : '0';
    }
  }
  return bits;
}

function hammingDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function loadMeta() {
  if (!fs.existsSync(FP_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(FP_FILE, 'utf-8'));
    const byFilename = {};
    for (const [fp, info] of Object.entries(raw)) {
      if (info && info.filename) byFilename[info.filename] = { fp, ...info };
    }
    return byFilename;
  } catch { return {}; }
}

(async () => {
  if (!fs.existsSync(COLLECT_DIR)) {
    console.error(`❌ ${COLLECT_DIR} 不存在`);
    process.exit(1);
  }

  const files = fs.readdirSync(COLLECT_DIR)
    .filter(f => f.startsWith('collect_') && f.endsWith('.jpg'))
    .sort();

  console.log(`扫描 ${files.length} 张图片, 计算 dHash...`);
  const hashes = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const h = await dHash(path.join(COLLECT_DIR, files[i]));
      hashes.push({ name: files[i], hash: h });
    } catch (e) {
      console.warn(`  ⚠️  ${files[i]}: ${e.message}`);
    }
    if ((i + 1) % 50 === 0) {
      process.stdout.write(`  已算 ${i + 1}/${files.length}\r`);
    }
  }
  console.log('');

  // 两两比较找重复组
  console.log(`找近似重复 (汉明距离 <= ${threshold})...`);
  const groups = [];
  const used = new Set();
  for (let i = 0; i < hashes.length; i++) {
    if (used.has(hashes[i].name)) continue;
    const group = [hashes[i].name];
    for (let j = i + 1; j < hashes.length; j++) {
      if (used.has(hashes[j].name)) continue;
      if (hammingDistance(hashes[i].hash, hashes[j].hash) <= threshold) {
        group.push(hashes[j].name);
        used.add(hashes[j].name);
      }
    }
    if (group.length > 1) {
      used.add(hashes[i].name);
      groups.push(group);
    }
  }

  // 写报告
  const meta = loadMeta();
  let out = `# 重复图片组 (汉明距离 <= ${threshold})\n`;
  out += `# 同组视为同一张, 建议每组保留 1 张, 其余删除\n\n`;
  groups.forEach((group, idx) => {
    out += `=== 组 ${idx + 1} (共 ${group.length} 张) ===\n`;
    for (const name of group) {
      const m = meta[name] || {};
      out += `  ${name}\n`;
      out += `    phone=${m.phone || '?'}  ip=${m.ip || '?'}  time=${m.time || '?'}  fp=${(m.fp || '?').slice(0, 8)}\n`;
    }
    out += '\n';
  });
  fs.writeFileSync(OUT_FILE, out);

  // 高危: 不同 IP 提交同一张图
  const highRisk = groups.filter(group => {
    const ips = new Set(group.map(n => (meta[n] || {}).ip || '?'));
    return ips.size > 1;
  });

  console.log('');
  console.log('==========================================');
  console.log('  扫描完成');
  console.log('==========================================');
  console.log(`  重复组数: ${groups.length}`);
  console.log(`  涉及图片: ${groups.reduce((s, g) => s + g.length, 0)} 张`);
  console.log(`  可删除:   ${groups.reduce((s, g) => s + g.length - 1, 0)} 张 (每组保留 1 张)`);
  console.log(`  📄 详情:   ${OUT_FILE}`);
  if (highRisk.length > 0) {
    console.log('');
    console.log(`🚨 高危: ${highRisk.length} 组重复图来自不同 IP (疑似群发刷量):`);
    for (const g of highRisk.slice(0, 5)) {
      const ips = new Set(g.map(n => (meta[n] || {}).ip || '?'));
      console.log(`   ${g.length} 张 / ${ips.size} 个 IP : ${g[0]}`);
    }
  }
})().catch(err => {
  console.error('❌ 出错:', err);
  process.exit(1);
});
