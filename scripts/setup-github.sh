#!/bin/bash
#
# GitHub 仓库配置脚本
# 用于配置分支保护规则和其他 GitHub 设置
#
# 使用方法: ./scripts/setup-github.sh
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "========================================"
echo "  ContentGuard AI - GitHub setup"
echo "========================================"
echo ""

# 1. 检查 GitHub CLI 是否安装
log_info "检查 GitHub CLI..."
if ! command -v gh &> /dev/null; then
    log_error "GitHub CLI (gh) 未安装"
    echo ""
    echo "请先安装 GitHub CLI:"
    echo "  macOS:   brew install gh"
    echo "  Ubuntu:  sudo apt install gh"
    echo "  Windows: winget install GitHub.cli"
    echo ""
    echo "安装后运行: gh auth login"
    exit 1
fi
log_success "GitHub CLI 已安装: $(gh --version | head -n1)"

# 2. 检查是否已登录
log_info "检查 GitHub 登录状态..."
if ! gh auth status &> /dev/null; then
    log_error "未登录 GitHub"
    echo ""
    echo "请运行以下命令登录:"
    echo "  gh auth login"
    echo ""
    exit 1
fi
log_success "已登录 GitHub"

# 3. 检查是否在 git 仓库中
log_info "检查 Git 仓库..."
if ! git rev-parse --is-inside-work-tree &> /dev/null; then
    log_error "当前目录不是 Git 仓库"
    exit 1
fi

# 4. 获取远程仓库信息
log_info "获取远程仓库信息..."
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$REMOTE_URL" ]; then
    log_error "未找到远程仓库 (origin)"
    echo ""
    echo "请先添加远程仓库:"
    echo "  git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
    echo ""
    exit 1
fi

# 解析 owner/repo
if [[ "$REMOTE_URL" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
    OWNER="${BASH_REMATCH[1]}"
    REPO="${BASH_REMATCH[2]}"
else
    log_error "无法解析 GitHub 仓库地址: $REMOTE_URL"
    exit 1
fi
log_success "仓库: $OWNER/$REPO"

# 5. 检查仓库是否存在于 GitHub
log_info "验证远程仓库..."
if ! gh repo view "$OWNER/$REPO" &> /dev/null; then
    log_warn "远程仓库不存在或无权限访问"
    echo ""
    read -p "是否创建远程仓库? (y/n): " CREATE_REPO
    if [ "$CREATE_REPO" = "y" ]; then
        log_info "创建远程仓库..."
        gh repo create "$OWNER/$REPO" --private --source=. --push
        log_success "远程仓库已创建"
    else
        log_error "请先在 GitHub 上创建仓库"
        exit 1
    fi
fi

# 6. 获取默认分支
log_info "获取默认分支..."
DEFAULT_BRANCH=$(gh repo view "$OWNER/$REPO" --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || echo "main")
log_info "默认分支: $DEFAULT_BRANCH"

# 7. 配置分支保护规则
echo ""
log_info "配置分支保护规则..."

# 构建 JSON payload
PROTECTION_PAYLOAD=$(cat <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Frontend Tests / Unit & Integration Tests",
      "Backend Tests / Unit & Integration Tests"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
)

# 应用分支保护规则
if gh api "repos/$OWNER/$REPO/branches/$DEFAULT_BRANCH/protection" \
    --method PUT \
    --input - <<< "$PROTECTION_PAYLOAD" &> /dev/null; then
    log_success "分支保护规则已配置"
else
    log_warn "分支保护规则配置失败（可能需要 GitHub Pro/Team 计划）"
    echo ""
    echo "对于免费版 GitHub，请手动在 Web UI 配置:"
    echo "  1. 进入 https://github.com/$OWNER/$REPO/settings/branches"
    echo "  2. 点击 'Add branch protection rule'"
    echo "  3. Branch name pattern: $DEFAULT_BRANCH"
    echo "  4. 勾选 'Require a pull request before merging'"
    echo "  5. 勾选 'Require status checks to pass before merging'"
    echo ""
fi

# 8. 验证配置
echo ""
log_info "验证分支保护配置..."
PROTECTION_STATUS=$(gh api "repos/$OWNER/$REPO/branches/$DEFAULT_BRANCH/protection" 2>/dev/null || echo "none")
if [ "$PROTECTION_STATUS" != "none" ]; then
    log_success "分支保护规则已生效"
    echo ""
    echo "当前保护规则:"
    gh api "repos/$OWNER/$REPO/branches/$DEFAULT_BRANCH/protection" --jq '{
      "必需状态检查": .required_status_checks.contexts,
      "必需PR审批数": .required_pull_request_reviews.required_approving_review_count,
      "管理员强制执行": .enforce_admins.enabled
    }' 2>/dev/null || echo "  (无法获取详情)"
else
    log_warn "未检测到分支保护规则"
fi

# 9. 配置仓库设置
echo ""
log_info "配置仓库设置..."

# 启用自动删除合并后的分支
gh api "repos/$OWNER/$REPO" \
    --method PATCH \
    --field delete_branch_on_merge=true \
    &> /dev/null && log_success "启用: 合并后自动删除分支" || log_warn "无法配置自动删除分支"

# 禁用 wiki（如果不需要）
gh api "repos/$OWNER/$REPO" \
    --method PATCH \
    --field has_wiki=false \
    &> /dev/null && log_success "禁用: Wiki" || true

# 10. 完成
echo ""
echo "========================================"
echo "  配置完成!"
echo "========================================"
echo ""
echo "后续步骤:"
echo "  1. 确保 CI 工作流文件已提交 (.github/workflows/)"
echo "  2. 创建第一个 PR 验证 CI 是否正常运行"
echo "  3. 验证分支保护规则是否阻止直接 push 到 $DEFAULT_BRANCH"
echo ""
echo "验证命令:"
echo "  gh pr status                    # 查看 PR 状态"
echo "  gh run list                     # 查看 CI 运行记录"
echo "  gh api repos/$OWNER/$REPO/branches/$DEFAULT_BRANCH/protection  # 查看保护规则"
echo ""
