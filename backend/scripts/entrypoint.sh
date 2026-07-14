#!/bin/bash
# Docker 容器入口脚本
# 先初始化数据库，再启动应用

set -e

echo "=== ContentGuard AI - starting ==="

# 运行数据库迁移
echo "运行数据库迁移..."
alembic upgrade head

# 仅非生产环境填充种子数据
if [ "$ENVIRONMENT" != "production" ]; then
  echo "填充种子数据..."
  python -m scripts.seed
else
  echo "生产环境，跳过种子数据"
fi

# 启动应用
echo "启动应用..."
exec "$@"
