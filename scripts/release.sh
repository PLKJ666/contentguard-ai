#!/usr/bin/env bash
# ─── release.sh ───
# 自动生成符合规范的 git tag 并推送, 触发 Drone CI 部署
#
# Tag 格式: v{major}.{minor}.{MMDD}.{build}
#   major.minor — 语义版本号
#   MMDD        — 当天日期 (月日)
#   build       — 当天构建序号, 自动递增
#
# 用法:
#   bash scripts/release.sh           # 使用默认版本号
#   bash scripts/release.sh 1.2       # 指定 major.minor
set -euo pipefail

# 版本号 (可通过参数覆盖)
VERSION="${1:-1.1}"

# 当天日期
MMDD=$(date +%m%d)

# 计算当天的下一个 build 序号
PREFIX="v${VERSION}.${MMDD}."
LAST_BUILD=$(git tag -l "${PREFIX}*" | sed "s|${PREFIX}||" | sort -n | tail -1)
BUILD=$(( ${LAST_BUILD:-0} + 1 ))

TAG="${PREFIX}${BUILD}"

echo "=== ContentGuard AI Release ==="
echo "版本号:  ${VERSION}"
echo "日期:    ${MMDD}"
echo "构建号:  ${BUILD}"
echo "Tag:     ${TAG}"
echo ""

# 确认
read -rp "确认创建并推送 tag ${TAG}? [y/N] " confirm
if [[ "$confirm" != [yY] ]]; then
  echo "已取消"
  exit 0
fi

# 先创建临时 tag 让 changelog 能按 tag 分组；后续如有 commit，会把 tag 重新绑定到最新提交。
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "Tag ${TAG} 已存在，请检查后重试"
  exit 1
fi
git tag "${TAG}"

# 生成 changelog (如果脚本存在)
CHANGELOG_SCRIPT="frontend/scripts/generate-changelog.js"
if [ -f "$CHANGELOG_SCRIPT" ]; then
  echo "生成更新日志..."
  node "$CHANGELOG_SCRIPT" || true
  if git diff --quiet frontend/data/changelog.json 2>/dev/null; then
    echo "changelog 无变化"
  else
    git add frontend/data/changelog.json
    # 不要写“更新 changelog”这种低信息量 commit；该 commit 仅用于发布产物准备。
    git commit -m "chore(release): prepare ${TAG}"

    # 标签需要指向最新 commit（包含 changelog 更新），但 changelog commit 会被生成器过滤，不影响对外展示。
    git tag -d "${TAG}" >/dev/null
    git tag "${TAG}"
  fi
fi

# 用注释 tag 替换轻量 tag（保持 release 信息）
git tag -d "${TAG}" >/dev/null
git tag -a "${TAG}" -m "Release ${TAG}"

# 推送分支与 tag
git push
git push origin "$TAG"
echo ""
echo "Tag ${TAG} 已推送, Drone CI 将自动构建部署"
