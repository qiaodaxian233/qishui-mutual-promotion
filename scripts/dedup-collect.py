#!/usr/bin/env python3
"""
检测 uploads/collect/ 下的重复/近似重复图片

场景:同一张图被不同设备指纹提交多次(比如群里互相转发同一张截图刷参与数)
原理:计算每张图的感知哈希 (pHash), 汉明距离 <= 5 视为同图

用法:
  python3 scripts/dedup-collect.py              # 默认阈值 5
  python3 scripts/dedup-collect.py --threshold 3 # 更严格(只抓几乎完全相同的)

依赖: pip install Pillow imagehash --break-system-packages
"""
import os, sys, json, argparse
from pathlib import Path
from collections import defaultdict

try:
    from PIL import Image
    import imagehash
except ImportError:
    print("❌ 缺依赖, 执行: pip install Pillow imagehash --break-system-packages")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
COLLECT = ROOT / "uploads" / "collect"
FP_FILE = COLLECT / ".fingerprints.json"

ap = argparse.ArgumentParser()
ap.add_argument("--threshold", type=int, default=5,
                help="汉明距离阈值 (0=完全相同, 5=允许细微变化, 10=较宽松)")
args = ap.parse_args()

# 加载元数据
meta = {}
if FP_FILE.exists():
    for fp, info in json.loads(FP_FILE.read_text()).items():
        if "filename" in info:
            meta[info["filename"]] = {**info, "fp": fp}

# 算所有 pHash
hashes = []
imgs = sorted(COLLECT.glob("collect_*.jpg"))
print(f"扫描 {len(imgs)} 张图片...")

for i, p in enumerate(imgs, 1):
    try:
        h = imagehash.phash(Image.open(p))
        hashes.append((p.name, h))
    except Exception as e:
        print(f"  ⚠️  {p.name}: {e}")
    if i % 50 == 0:
        print(f"  已算 {i}/{len(imgs)}")

# 两两比较找重复组
groups = []
used = set()
for i, (name_a, h_a) in enumerate(hashes):
    if name_a in used: continue
    group = [name_a]
    for name_b, h_b in hashes[i+1:]:
        if name_b in used: continue
        if h_a - h_b <= args.threshold:
            group.append(name_b)
            used.add(name_b)
    if len(group) > 1:
        used.add(name_a)
        groups.append(group)

# 输出
out_file = COLLECT / "_duplicates.txt"
with out_file.open("w") as f:
    f.write(f"# 重复图片组 (汉明距离 <= {args.threshold})\n")
    f.write(f"# 同一组内的图片视为同一张, 建议每组保留 1 张, 其余删除\n\n")
    for i, group in enumerate(groups, 1):
        f.write(f"=== 组 {i} (共 {len(group)} 张) ===\n")
        for name in group:
            m = meta.get(name, {})
            f.write(f"  {name}\n")
            f.write(f"    phone={m.get('phone','?')}  ip={m.get('ip','?')}  "
                    f"time={m.get('time','?')}  fp={m.get('fp','?')[:8]}\n")
        f.write("\n")

print(f"\n✅ 完成")
print(f"   重复组数: {len(groups)}")
print(f"   涉及图片: {sum(len(g) for g in groups)} 张")
print(f"   可删除:   {sum(len(g)-1 for g in groups)} 张 (每组保留1张)")
print(f"   详情:     {out_file}")

# 同时给出"不同 IP 提交同一张图"的高危名单
high_risk = []
for group in groups:
    ips = {meta.get(n, {}).get("ip", "?") for n in group}
    if len(ips) > 1:
        high_risk.append((group, ips))
if high_risk:
    print(f"\n🚨 高危: {len(high_risk)} 组重复图来自不同 IP (疑似群发刷量):")
    for group, ips in high_risk[:5]:
        print(f"   {len(group)} 张图 / {len(ips)} 个 IP : {group[0]}")
