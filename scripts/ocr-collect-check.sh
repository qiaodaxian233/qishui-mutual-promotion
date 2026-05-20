#!/bin/bash
# OCR 审核 uploads/collect/ 下的截图,识别非汽水音乐播放页的垃圾提交
#
# 用法:
#   bash scripts/ocr-collect-check.sh              # 全量审核
#   bash scripts/ocr-collect-check.sh --recent     # 只看最近 7 天
#   bash scripts/ocr-collect-check.sh --threshold 5   # 自定义可疑阈值
#
# 输出:
#   uploads/collect/_audit.csv          完整结果 (Excel 打开)
#   uploads/collect/_suspicious.txt     可疑文件列表 (评分低于阈值)
#   uploads/collect/_ocr_cache/*.txt    每张图的 OCR 全文 (缓存,二次跑跳过)

set -e

# --- 配置 ---
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COLLECT_DIR="$ROOT/uploads/collect"
FP_FILE="$COLLECT_DIR/.fingerprints.json"
CACHE_DIR="$COLLECT_DIR/_ocr_cache"
CSV="$COLLECT_DIR/_audit.csv"
SUS="$COLLECT_DIR/_suspicious.txt"

THRESHOLD=4
RECENT_DAYS=0  # 0 = 全量
while [ $# -gt 0 ]; do
  case "$1" in
    --recent)    RECENT_DAYS=7; shift ;;
    --threshold) THRESHOLD=$2; shift 2 ;;
    *) shift ;;
  esac
done

# --- 依赖检查 ---
command -v tesseract >/dev/null || {
  echo "❌ tesseract 未安装, 执行: sudo apt install -y tesseract-ocr tesseract-ocr-chi-sim"
  exit 1
}
tesseract --list-langs 2>/dev/null | grep -q chi_sim || {
  echo "❌ 缺少中文语言包, 执行: sudo apt install -y tesseract-ocr-chi-sim"
  exit 1
}
command -v jq >/dev/null || {
  echo "❌ jq 未安装, 执行: sudo apt install -y jq"
  exit 1
}

[ -d "$COLLECT_DIR" ] || { echo "❌ $COLLECT_DIR 不存在"; exit 1; }
mkdir -p "$CACHE_DIR"

# --- 加载指纹元数据到关联数组 ---
# 把 filename -> "phone|ip|ua|time" 的映射存到临时文件方便后面查
META_TSV=$(mktemp)
if [ -f "$FP_FILE" ]; then
  jq -r 'to_entries[] | .value | [.filename, (.phone // ""), (.ip // ""), (.ua // "" | .[0:50]), (.time // "")] | @tsv' \
    "$FP_FILE" > "$META_TSV"
fi

lookup_meta() {
  awk -F'\t' -v name="$1" '$1==name {print; exit}' "$META_TSV"
}

# --- 评分逻辑 ---
# 真实的汽水音乐播放页应该有:
#   时间戳 mm:ss              +3 (强信号: 当前时间/总时长)
#   "汽水音乐" 四个字          +3
#   播放页关键词 (歌词/评论/下一首/分享/收藏/单曲循环/列表循环) 每命中 +2
#   有中文字符                 +1
#   有任意可识别文字           +1
# 阈值默认 4: 低于这个判可疑

score_text() {
  local txt="$1" score=0 flags=""
  # 时间戳 (00:00 ~ 99:59)
  if echo "$txt" | grep -qE '\b[0-9]{1,2}:[0-9]{2}\b'; then
    score=$((score+3)); flags="${flags}TIME,"
  fi
  # 汽水音乐 wordmark
  if echo "$txt" | grep -q '汽水音乐'; then
    score=$((score+3)); flags="${flags}LOGO,"
  fi
  # 播放页关键词
  for kw in 歌词 评论 下一首 上一首 分享 收藏 单曲循环 列表循环 随机播放 正在播放 播放队列; do
    if echo "$txt" | grep -q "$kw"; then
      score=$((score+2)); flags="${flags}KW:${kw},"
    fi
  done
  # 中文字符 (UTF-8 中文范围简单判断)
  if echo "$txt" | grep -qP '[\x{4e00}-\x{9fff}]' 2>/dev/null; then
    score=$((score+1)); flags="${flags}CN,"
  fi
  # 有任意非空白文字
  if [ "$(echo "$txt" | tr -d '[:space:]' | wc -c)" -gt 10 ]; then
    score=$((score+1)); flags="${flags}HAS_TEXT,"
  fi
  echo "$score|${flags%,}"
}

# --- 主循环 ---
echo "文件名,手机型号,IP,提交时间,分辨率,评分,命中标签,文本前80字,UA片段" > "$CSV"
> "$SUS"

total=0; suspicious=0; cached=0; ocred=0

find_args=("$COLLECT_DIR" -maxdepth 1 -type f -name "collect_*.jpg")
[ "$RECENT_DAYS" -gt 0 ] && find_args+=(-mtime "-$RECENT_DAYS")

while IFS= read -r img; do
  [ -f "$img" ] || continue
  total=$((total+1))
  name=$(basename "$img")
  cache_file="$CACHE_DIR/${name%.jpg}.txt"

  if [ -f "$cache_file" ]; then
    txt=$(cat "$cache_file")
    cached=$((cached+1))
  else
    txt=$(tesseract "$img" - -l chi_sim+eng 2>/dev/null | tr -s '[:space:]' ' ')
    echo "$txt" > "$cache_file"
    ocred=$((ocred+1))
  fi

  # 从文件名解析分辨率: collect_1080x2400_xxxxxxxx_1234567890.jpg
  resolution=$(echo "$name" | grep -oE '_[0-9]+x[0-9]+_' | tr -d '_' | head -1)

  # 元数据
  meta=$(lookup_meta "$name")
  phone=$(echo "$meta"   | cut -f2)
  ip=$(echo "$meta"      | cut -f3)
  ua=$(echo "$meta"      | cut -f4)
  uptime=$(echo "$meta"  | cut -f5)

  # 评分
  result=$(score_text "$txt")
  score=$(echo "$result" | cut -d'|' -f1)
  flags=$(echo "$result" | cut -d'|' -f2)

  preview=$(echo "$txt" | head -c 80 | sed 's/"/'\''/g')

  echo "\"$name\",\"$phone\",\"$ip\",\"$uptime\",\"$resolution\",$score,\"$flags\",\"$preview\",\"$ua\"" >> "$CSV"

  if [ "$score" -lt "$THRESHOLD" ]; then
    suspicious=$((suspicious+1))
    echo "[$score] $name  phone=$phone ip=$ip  >> $preview" >> "$SUS"
  fi

  if [ $((total % 20)) -eq 0 ]; then
    echo "  ...已处理 $total 张 (OCR $ocred, 缓存 $cached)"
  fi
done < <(find "${find_args[@]}")

rm -f "$META_TSV"

# --- 汇总 ---
echo ""
echo "=========================================="
echo "  审核完成"
echo "=========================================="
echo "  总计:     $total 张"
echo "  本次 OCR: $ocred 张  (缓存复用 $cached 张)"
echo "  可疑:     $suspicious 张  (评分 < $THRESHOLD)"
echo ""
echo "  📊 完整报告: $CSV"
echo "  🚩 可疑列表: $SUS"
echo ""
if [ "$suspicious" -gt 0 ]; then
  echo "可疑样本预览 (前 10 条):"
  head -10 "$SUS" | sed 's/^/  /'
  echo ""
  echo "下一步建议:"
  echo "  1) 人工抽查可疑图: nano $SUS"
  echo "  2) 确认是垃圾后批量删: bash scripts/ocr-collect-purge.sh"
fi
