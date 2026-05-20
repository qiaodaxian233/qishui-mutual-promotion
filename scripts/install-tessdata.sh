#!/bin/bash
# 下载 tesseract 训练数据(本项目用 chi_sim + eng)
#
# 用法:
#   bash scripts/install-tessdata.sh
#
# 说明:
#   - tessdata/ 在 .gitignore 里(模型文件 ~50MB,不适合入 git)
#   - 部署到新服务器时必须跑一次
#   - 已存在则跳过(幂等)

set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)/tessdata"
mkdir -p "$DIR"

# Tesseract 5.x 兼容 best 版本(精度高,体积大);如果想要 fast 版本改 url
# 国内服务器可能连 GitHub 慢,可以改用 jsdelivr 镜像
BASE="https://github.com/tesseract-ocr/tessdata/raw/main"
# BASE="https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata@main"  # 备用镜像

LANGS="chi_sim eng"

for lang in $LANGS; do
  FILE="$DIR/$lang.traineddata"
  if [ -f "$FILE" ] && [ -s "$FILE" ]; then
    echo "✓ $lang.traineddata 已存在,跳过"
    continue
  fi
  echo "↓ 下载 $lang.traineddata ..."
  curl -fL -o "$FILE" "$BASE/$lang.traineddata"
  echo "  $(du -h "$FILE" | cut -f1) → $FILE"
done

echo ""
echo "✓ 完成。重启服务即可生效:pm2 restart qishui-mutual-promotion"
