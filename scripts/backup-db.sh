#!/bin/bash
# 数据库每日备份脚本
# 用法: 宝塔 → 计划任务 → Shell脚本 → 每天执行
# 或 crontab: 0 3 * * * /www/wwwroot/qishui-mutual-promotion/scripts/backup-db.sh

BACKUP_DIR="/www/wwwroot/qishui-mutual-promotion/backups"
KEEP_DAYS=7
DATE=$(date +%Y%m%d_%H%M%S)

# 从 .env 读数据库配置
ENV_FILE="/www/wwwroot/qishui-mutual-promotion/.env"
DB_HOST=$(grep "^DB_HOST=" "$ENV_FILE" | cut -d'=' -f2)
DB_USER=$(grep "^DB_USER=" "$ENV_FILE" | cut -d'=' -f2)
DB_PASS=$(grep "^DB_PASS=" "$ENV_FILE" | cut -d'=' -f2)
DB_NAME=$(grep "^DB_NAME=" "$ENV_FILE" | cut -d'=' -f2)

# 默认值
DB_HOST=${DB_HOST:-localhost}
DB_USER=${DB_USER:-root}
DB_NAME=${DB_NAME:-qishui}

mkdir -p "$BACKUP_DIR"

# 备份
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz"
mysqldump -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" --single-transaction --quick | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  echo "[backup] 成功: $BACKUP_FILE ($SIZE)"
else
  echo "[backup] 失败!"
  exit 1
fi

# 清理旧备份
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$KEEP_DAYS -delete
echo "[backup] 已清理 ${KEEP_DAYS} 天前的旧备份"
