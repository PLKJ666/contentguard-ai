#!/bin/bash
# ===========================
# PostgreSQL 每日备份脚本
# 备份到本地 + 上传到火山引擎 TOS
# ===========================
# 配合 crontab 使用：
# 0 3 * * * /path/to/backup.sh >> /var/log/contentguard-backup.log 2>&1

set -euo pipefail

# ---- 配置 ----
BACKUP_DIR="${BACKUP_DIR:-/var/backups/contentguard}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-contentguard-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-contentguard}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"

# TOS 备份桶（需要先安装 tosutil 并配置好凭证）
TOS_BACKUP_BUCKET="${TOS_BACKUP_BUCKET:-}"
TOS_BACKUP_PREFIX="${TOS_BACKUP_PREFIX:-backups/postgres}"

# ---- 执行 ----
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="contentguard_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] 开始备份数据库 ${POSTGRES_DB}..."

# 1. pg_dump 导出并压缩
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "[$(date)] 本地备份完成: ${BACKUP_DIR}/${FILENAME}"

# 2. 上传到 TOS（如果配置了备份桶）
if [ -n "$TOS_BACKUP_BUCKET" ]; then
    if command -v tosutil &> /dev/null; then
        tosutil cp "${BACKUP_DIR}/${FILENAME}" "tos://${TOS_BACKUP_BUCKET}/${TOS_BACKUP_PREFIX}/${FILENAME}"
        echo "[$(date)] 已上传到 TOS: ${TOS_BACKUP_BUCKET}/${TOS_BACKUP_PREFIX}/${FILENAME}"
    else
        echo "[$(date)] 警告: tosutil 未安装，跳过 TOS 上传"
    fi
fi

# 3. 清理过期的本地备份
find "$BACKUP_DIR" -name "contentguard_*.sql.gz" -mtime +"$RETAIN_DAYS" -delete
echo "[$(date)] 已清理 ${RETAIN_DAYS} 天前的本地备份"

echo "[$(date)] 备份完成"
