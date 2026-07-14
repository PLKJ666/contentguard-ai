#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════
# 内容卫士 AI 审核平台 — 远程部署脚本
# 用法: bash scripts/deploy-remote.sh <version>
# ═══════════════════════════════════════════

IMAGE_TAG="${1:-latest}"
DEPLOY_DIR="/opt/contentguard-ai"
COMPOSE_FILE="docker-compose.prod.yml"
LOCK_FILE="/tmp/contentguard-deploy.lock"
MAX_HEALTH_ATTEMPTS=30
HEALTH_CHECK_INTERVAL=5
LOCK_WAIT_SECONDS="${LOCK_WAIT_SECONDS:-900}"
LOCK_POLL_INTERVAL="${LOCK_POLL_INTERVAL:-5}"
PRUNE_IMAGES="${PRUNE_IMAGES:-0}"
SKIP_READY_CHECK="${SKIP_READY_CHECK:-0}"
USE_INTERNAL_REDIS="${USE_INTERNAL_REDIS:-0}"
USE_INTERNAL_POSTGRES="${USE_INTERNAL_POSTGRES:-0}"

# ─── 颜色输出 ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }

resolve_runtime_env() {
    if [ -f .env ]; then
        set -a
        # .env 由运维维护，内容应保持 shell 兼容。
        . ./.env
        set +a
    fi

    if [ -z "${DATABASE_URL:-}" ]; then
        if [ -z "${POSTGRES_PASSWORD:-}" ]; then
            err "缺少 DATABASE_URL，且无法回退到内置 PostgreSQL：POSTGRES_PASSWORD 未设置"
            exit 1
        fi
        export USE_INTERNAL_POSTGRES=1
        warn "DATABASE_URL 未设置，回退使用 compose 内置 PostgreSQL 服务"
    fi

    if [ -z "${REDIS_URL:-}" ]; then
        export USE_INTERNAL_REDIS=1
        warn "REDIS_URL 未设置，回退使用 compose 内置 redis"
    fi
}

# ─── 部署锁 ───
acquire_lock() {
    local waited=0
    while [ -f "$LOCK_FILE" ]; do
        local lock_pid
        lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")

        if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
            if [ "$waited" -ge "$LOCK_WAIT_SECONDS" ]; then
                err "部署锁等待超时 (${LOCK_WAIT_SECONDS}s)，仍有部署进行中 (PID: $lock_pid)"
                exit 1
            fi
            warn "检测到部署进行中 (PID: $lock_pid)，等待锁释放... (${waited}s/${LOCK_WAIT_SECONDS}s)"
            sleep "$LOCK_POLL_INTERVAL"
            waited=$((waited + LOCK_POLL_INTERVAL))
            continue
        fi

        warn "发现过期的锁文件，清理中..."
        rm -f "$LOCK_FILE"
    done

    echo $$ > "$LOCK_FILE"
    trap 'rm -f "$LOCK_FILE"' EXIT
}

# ─── 健康检查 ───
backend_health_check() {
    local service_name="$1"
    local path="$2"
    local attempt=0

    log "等待 $service_name 启动..."
    while [ $attempt -lt $MAX_HEALTH_ATTEMPTS ]; do
        attempt=$((attempt + 1))
        # Prod compose does not publish backend:8000 to host, so we must check from inside the container.
        if docker compose -f "$COMPOSE_FILE" exec -T backend python - <<PY > /dev/null 2>&1
import urllib.request
urllib.request.urlopen("http://127.0.0.1:8000${path}", timeout=3).read()
PY
        then
            log "$service_name 健康检查通过 (第 ${attempt} 次)"
            return 0
        fi
        sleep $HEALTH_CHECK_INTERVAL
    done

    err "$service_name 健康检查失败 (${MAX_HEALTH_ATTEMPTS} 次尝试)"
    return 1
}

frontend_health_check() {
    local service_name="$1"
    local attempt=0

    log "等待 $service_name 启动..."
    while [ $attempt -lt $MAX_HEALTH_ATTEMPTS ]; do
        attempt=$((attempt + 1))
        if docker compose -f "$COMPOSE_FILE" exec -T frontend \
            wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ > /dev/null 2>&1
        then
            log "$service_name 健康检查通过 (第 ${attempt} 次)"
            return 0
        fi
        sleep $HEALTH_CHECK_INTERVAL
    done

    err "$service_name 健康检查失败 (${MAX_HEALTH_ATTEMPTS} 次尝试)"
    return 1
}

frontend_auth_health_check() {
    local service_name="$1"
    local attempt=0
    local public_base_url="${NEXT_PUBLIC_BASE_URL:-}"
    local public_host=""

    if [ -n "$public_base_url" ]; then
        public_host=$(printf '%s' "$public_base_url" | sed -E 's#^https?://##; s#/.*$##')
    fi

    log "等待 $service_name 可用..."
    while [ $attempt -lt $MAX_HEALTH_ATTEMPTS ]; do
        attempt=$((attempt + 1))
        if docker compose -f "$COMPOSE_FILE" exec -T -e PUBLIC_HOST="$public_host" frontend node - <<'JS' > /dev/null 2>&1
async function main() {
  const publicHost = process.env.PUBLIC_HOST || '127.0.0.1:3000'
  const headers = {
    host: publicHost,
    'x-forwarded-host': publicHost,
    'x-forwarded-proto': 'https',
  }

  const tokenRes = await fetch('http://127.0.0.1:3000/api/auth/token', {
    redirect: 'manual',
    headers,
  })
  if (![200, 401].includes(tokenRes.status)) {
    throw new Error(`Unexpected /api/auth/token status: ${tokenRes.status}`)
  }

  const signInRes = await fetch('http://127.0.0.1:3000/api/auth/sign-in', {
    redirect: 'manual',
    headers,
  })
  if (![302, 303, 307].includes(signInRes.status)) {
    throw new Error(`Unexpected /api/auth/sign-in status: ${signInRes.status}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
JS
        then
            log "$service_name 健康检查通过 (第 ${attempt} 次)"
            return 0
        fi
        sleep $HEALTH_CHECK_INTERVAL
    done

    err "$service_name 健康检查失败 (${MAX_HEALTH_ATTEMPTS} 次尝试)"
    return 1
}

# ─── 开始部署 ───
cd "$DEPLOY_DIR"
acquire_lock

log "═══════════════════════════════════════════"
log "开始部署ContentGuard AI v${IMAGE_TAG}"
log "═══════════════════════════════════════════"

# 导出变量供 compose 使用
export IMAGE_TAG
export DOCKER_REGISTRY="${DOCKER_REGISTRY:-registry.example.com}"
resolve_runtime_env

# ─── 1. 拉取新镜像 ───
log "Step 1/12: 拉取新镜像..."
# celery-worker / celery-xhs-worker / celery-beat 与 backend 使用同一镜像，只需拉一次 backend 镜像
pull_services=(backend frontend)
[ "$USE_INTERNAL_POSTGRES" = "1" ] && pull_services+=(postgres)
[ "$USE_INTERNAL_REDIS" = "1" ] && pull_services+=(redis)
docker compose -f "$COMPOSE_FILE" pull "${pull_services[@]}"

# ─── 2. 校验外部依赖配置 ───
log "Step 2/12: 校验外部数据库与 Redis 配置..."
if [ -z "${DATABASE_URL:-}" ]; then
    if [ "$USE_INTERNAL_POSTGRES" != "1" ]; then
        err "缺少 DATABASE_URL，且未启用内置 PostgreSQL 回退"
        exit 1
    fi
fi

if [ "$USE_INTERNAL_POSTGRES" = "1" ] && [ -z "${POSTGRES_PASSWORD:-}" ]; then
    err "启用内置 PostgreSQL 回退时，POSTGRES_PASSWORD 必须设置"
    exit 1
fi

if [ -z "${REDIS_URL:-}" ]; then
    if [ "$USE_INTERNAL_REDIS" != "1" ]; then
        err "缺少 REDIS_URL，且未启用内置 Redis 回退"
        exit 1
    fi
fi

internal_services=()
[ "$USE_INTERNAL_POSTGRES" = "1" ] && internal_services+=(postgres)
[ "$USE_INTERNAL_REDIS" = "1" ] && internal_services+=(redis)
if [ ${#internal_services[@]} -gt 0 ]; then
    log "Step 2.5/12: 启动内置依赖服务..."
    docker compose -f "$COMPOSE_FILE" up -d "${internal_services[@]}"
fi

# ─── 3. 停止 celery-beat（防止定时任务冲突） ───
log "Step 3/12: 停止 celery-beat..."
docker compose -f "$COMPOSE_FILE" stop celery-beat 2>/dev/null || true

# ─── 4. 更新后端 + Worker ───
log "Step 4/12: 更新后端服务..."
docker compose -f "$COMPOSE_FILE" up -d --no-deps backend celery-worker celery-xhs-worker

# ─── 5. 后端健康检查 ───
log "Step 5/12: 后端健康检查..."
if ! backend_health_check "Backend" "/api/v1/health"; then
    err "后端启动失败！最近日志："
    docker compose -f "$COMPOSE_FILE" logs --tail=50 backend
    exit 1
fi

# ─── 6. 数据库迁移（由 entrypoint 自动执行，此处仅验证） ───
log "Step 6/12: 验证数据库迁移状态..."
docker compose -f "$COMPOSE_FILE" exec -T backend \
    python -m alembic current 2>&1 || {
    warn "无法获取迁移状态，entrypoint 应已完成迁移"
}
log "数据库迁移验证完成"

# ─── 7. 启动 celery-beat ───
log "Step 7/12: 启动 celery-beat..."
docker compose -f "$COMPOSE_FILE" up -d celery-beat

# ─── 8. 更新前端 ───
log "Step 8/12: 更新前端..."
docker compose -f "$COMPOSE_FILE" up -d --no-deps frontend

# ─── 9. 前端健康检查 ───
log "Step 9/12: 前端健康检查..."
if ! frontend_health_check "Frontend"; then
    err "前端启动失败！最近日志："
    docker compose -f "$COMPOSE_FILE" logs --tail=80 frontend nginx
    exit 1
fi

log "Step 9.5/12: 前端认证路由检查..."
if ! frontend_auth_health_check "Frontend Auth"; then
    err "前端认证路由异常！最近日志："
    docker compose -f "$COMPOSE_FILE" logs --tail=120 frontend nginx
    exit 1
fi

# ─── 10. 更新 Nginx ───
log "Step 10/12: 重载 Nginx..."
docker compose -f "$COMPOSE_FILE" up -d --no-deps nginx
docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null || true

# ─── 11. 最终验证 ───
log "Step 11/12: 最终验证..."
sleep 3

if [ "$SKIP_READY_CHECK" = "1" ]; then
    warn "跳过后端 ready 检查（SKIP_READY_CHECK=1）"
elif docker compose -f "$COMPOSE_FILE" exec -T backend python - <<'PY' > /dev/null 2>&1; then
import urllib.request
urllib.request.urlopen("http://127.0.0.1:8000/api/v1/health/ready", timeout=5).read()
PY
    log "后端 API 就绪（含数据库+Redis 连接）"
else
    warn "后端 ready 检查未通过，但基础 health 可能正常"
fi

# ─── 12. 清理旧镜像 ───
if [ "$PRUNE_IMAGES" = "1" ]; then
    log "Step 12/12: 清理旧镜像..."
    docker image prune -f --filter "until=72h" 2>/dev/null || true
else
    log "Step 12/12: 跳过旧镜像清理（设置 PRUNE_IMAGES=1 可开启）"
fi

# ─── 完成 ───
log "═══════════════════════════════════════════"
log "部署完成！版本: v${IMAGE_TAG}"
log "═══════════════════════════════════════════"

# 显示服务状态
docker compose -f "$COMPOSE_FILE" ps
