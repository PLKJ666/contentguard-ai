#!/bin/bash
# 开发环境快速启动脚本

set -e

echo "=== ContentGuard AI - development environment ==="

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "错误: Docker 未运行，请先启动 Docker"
    exit 1
fi

# 启动基础服务 (PostgreSQL + Redis)
echo "启动 PostgreSQL 和 Redis..."
docker-compose up -d postgres redis

# 等待服务就绪
echo "等待服务就绪..."
sleep 5

# 运行数据库迁移
echo "运行数据库迁移..."
alembic upgrade head

# 填充种子数据
echo "填充种子数据..."
python3 -m scripts.seed

echo ""
echo "=== 基础服务已启动 ==="
echo "PostgreSQL: localhost:5432"
echo "Redis:      localhost:6379"
echo ""
echo "启动后端服务:"
echo "  uvicorn app.main:app --reload"
echo ""
echo "启动 Celery Worker:"
echo "  celery -A app.celery_app worker -l info -Q default,review"
echo "  celery -A app.celery_app worker -l info -Q xhs_batch --concurrency=4"
echo ""
echo "启动 Celery Beat (可选):"
echo "  celery -A app.celery_app beat -l info"
