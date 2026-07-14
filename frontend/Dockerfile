# syntax=docker/dockerfile:1.7
# ===========================
# ContentGuard AI - Frontend Dockerfile
# 多阶段构建，基于 node:20-alpine
# ===========================

# Optional registry prefix can be supplied by a private CI environment.
ARG REGISTRY=
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY_FALLBACK=https://registry.npmjs.org

# ---------- Stage 1: 安装依赖 ----------
FROM ${REGISTRY}node:20-alpine AS deps

ARG NPM_REGISTRY
ARG NPM_REGISTRY_FALLBACK

WORKDIR /app

# 中国镜像源加速
RUN npm config set registry "$NPM_REGISTRY" \
    && npm config set fetch-retries 2 \
    && npm config set fetch-retry-factor 2 \
    && npm config set fetch-retry-mintimeout 10000 \
    && npm config set fetch-retry-maxtimeout 30000 \
    && npm config set fetch-timeout 120000

# 复制依赖描述文件
COPY package.json package-lock.json ./

# 安装生产依赖
RUN --mount=type=cache,target=/root/.npm \
    sh -ec 'npm ci --ignore-scripts --prefer-offline --no-audit --progress=false || { \
      echo "Primary npm registry failed, retrying with fallback registry..."; \
      npm config set registry "$NPM_REGISTRY_FALLBACK"; \
      npm ci --ignore-scripts --prefer-online --no-audit --progress=false; \
    }'

# ---------- Stage 2: 构建应用 ----------
FROM ${REGISTRY}node:20-alpine AS builder

WORKDIR /app

# 从 deps 阶段复制 node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 构建时环境变量（NEXT_PUBLIC_ 前缀的变量在构建时注入）
ARG NEXT_PUBLIC_API_BASE_URL=
ARG NEXT_PUBLIC_BASE_URL=http://localhost:3000
ARG API_REWRITE_TARGET=http://backend:8000

# Logto 认证（edge runtime 需要构建时注入）
ARG LOGTO_ENDPOINT=
ARG LOGTO_APP_ID=
ARG LOGTO_APP_SECRET=
ARG LOGTO_COOKIE_SECRET=
ARG LOGTO_API_RESOURCE=

ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV API_REWRITE_TARGET=$API_REWRITE_TARGET
ENV LOGTO_ENDPOINT=$LOGTO_ENDPOINT
ENV LOGTO_APP_ID=$LOGTO_APP_ID
ENV LOGTO_APP_SECRET=$LOGTO_APP_SECRET
ENV LOGTO_COOKIE_SECRET=$LOGTO_COOKIE_SECRET
ENV LOGTO_API_RESOURCE=$LOGTO_API_RESOURCE

# 启用 standalone 输出模式并构建
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build \
    && mkdir -p public/data \
    && cp data/changelog.json public/data/changelog.json

# ---------- Stage 3: 运行时镜像 ----------
FROM ${REGISTRY}node:20-alpine AS runner

ARG NEXT_PUBLIC_API_BASE_URL=
ARG NEXT_PUBLIC_BASE_URL=http://localhost:3000
ARG API_REWRITE_TARGET=http://backend:8000
ARG LOGTO_ENDPOINT=
ARG LOGTO_APP_ID=
ARG LOGTO_APP_SECRET=
ARG LOGTO_COOKIE_SECRET=
ARG LOGTO_API_RESOURCE=

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV API_REWRITE_TARGET=$API_REWRITE_TARGET
ENV LOGTO_ENDPOINT=$LOGTO_ENDPOINT
ENV LOGTO_APP_ID=$LOGTO_APP_ID
ENV LOGTO_APP_SECRET=$LOGTO_APP_SECRET
ENV LOGTO_COOKIE_SECRET=$LOGTO_COOKIE_SECRET
ENV LOGTO_API_RESOURCE=$LOGTO_API_RESOURCE

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# 从 builder 阶段复制 standalone 产物
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
