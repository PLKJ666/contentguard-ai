#!/bin/bash
# 一键打标 + 更新 changelog + 推送
# 用法: npm run release -- <tag>  或  bash scripts/release.sh <tag>
# 示例: npm run release -- v1.2.0

set -e

TAG="$1"

if [ -z "$TAG" ]; then
  echo "❌ 请提供标签名，例如: npm run release -- v1.2.0"
  exit 1
fi

# 确保在项目根目录（frontend/）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "📌 创建标签 $TAG ..."
git tag "$TAG"

echo "📝 生成 changelog ..."
node scripts/generate-changelog.js

echo "📦 提交 changelog 更新 ..."
git add data/changelog.json
git commit -m "fix: 更新 changelog.json" || echo "ℹ️  changelog 无变化，跳过提交"

# 标签需要指向最新 commit（包含 changelog 更新）
echo "🔄 重新绑定标签到最新提交 ..."
git tag -d "$TAG"
git tag "$TAG"

echo "🚀 推送到远程仓库 ..."
git push origin main
git push origin "$TAG"

echo "✅ 发布完成: $TAG"
