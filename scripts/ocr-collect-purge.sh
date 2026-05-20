#!/bin/bash
# 根据 _suspicious.txt 删除可疑截图,删之前自动打包备份
#
# 用法:
#   bash scripts/ocr-collect-purge.sh           # 交互确认每张
#   bash scripts/ocr-collect-purge.sh --yes     # 跳过确认 (谨慎!)
#
# 安全保障:
#   1) 删除前打 tar 包备份到 uploads/collect/_trash/<日期>.tar.gz
#   2) 同时从 .fingerprints.json 中移除对应记录 (释放该设备的提交资格)

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COLLECT_DIR="$ROOT/uploads/collect"
FP_FILE="$COLLECT_DIR/.fingerprints.json"
SUS="$COLLECT_DIR/_suspicious.txt"
TRASH="$COLLECT_DIR/_trash"

AUTO_YES=false
[ "$1" = "--yes" ] && AUTO_YES=true

[ -f "$SUS" ] || { echo "❌ 先跑 ocr-collect-check.sh 生成可疑列表"; exit 1; }
command -v jq >/dev/null || { echo "❌ 需要 jq: sudo apt install -y jq"; exit 1; }

mkdir -p "$TRASH"
STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP="$TRASH/purge_${STAMP}.tar.gz"

# 收集要删的文件名
mapfile -t FILES < <(awk -F'  ' '/^\[/ {print $2}' "$SUS" | awk '{print $1}' | grep -v '^$')

if [ ${#FILES[@]} -eq 0 ]; then
  echo "✅ 可疑列表为空, 无需清理"
  exit 0
fi

echo "准备删除 ${#FILES[@]} 张图, 备份到: $BACKUP"
echo ""
head -10 "$SUS"
[ ${#FILES[@]} -gt 10 ] && echo "  ... 还有 $((${#FILES[@]}-10)) 张"
echo ""

if ! $AUTO_YES; then
  read -p "确认删除? (yes/no): " ans
  [ "$ans" = "yes" ] || { echo "已取消"; exit 0; }
fi

# 1) 打包备份
echo "→ 备份中..."
cd "$COLLECT_DIR"
tar -czf "$BACKUP" "${FILES[@]}" 2>/dev/null || true
echo "  ✓ $(du -h "$BACKUP" | cut -f1)  $BACKUP"

# 2) 删图
echo "→ 删除文件..."
deleted=0
for f in "${FILES[@]}"; do
  if [ -f "$COLLECT_DIR/$f" ]; then
    rm "$COLLECT_DIR/$f"
    deleted=$((deleted+1))
  fi
done
echo "  ✓ 删除 $deleted 张"

# 3) 清理 .fingerprints.json
if [ -f "$FP_FILE" ]; then
  echo "→ 清理指纹记录..."
  TMP=$(mktemp)
  # 构造一个 filename 列表给 jq
  FILES_JSON=$(printf '%s\n' "${FILES[@]}" | jq -R . | jq -s .)
  jq --argjson kill "$FILES_JSON" \
    'with_entries(select(.value.filename as $f | $kill | index($f) | not))' \
    "$FP_FILE" > "$TMP"
  before=$(jq 'length' "$FP_FILE")
  after=$(jq 'length' "$TMP")
  mv "$TMP" "$FP_FILE"
  echo "  ✓ 指纹记录: $before → $after (-$((before-after)))"
fi

# 4) 移走旧的可疑列表
mv "$SUS" "$TRASH/suspicious_${STAMP}.txt"
echo ""
echo "✅ 清理完成. 回滚命令:"
echo "   cd $COLLECT_DIR && tar -xzf $BACKUP"
