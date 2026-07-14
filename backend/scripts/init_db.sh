#!/bin/bash
# 数据库初始化脚本
# 运行 Alembic 迁移 + 填充种子数据

set -e

echo "=== 数据库初始化 ==="

echo "1. 运行 Alembic 迁移..."
alembic upgrade head

echo "2. 填充种子数据..."
python -m scripts.seed

echo "=== 数据库初始化完成 ==="
