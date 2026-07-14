# syntax=docker/dockerfile:1.7
# ===========================
# ContentGuard AI - Backend Dockerfile
# 多阶段构建，基于 python:3.13-slim + uv
# ===========================

# Optional registry prefix can be supplied by a private CI environment.
ARG REGISTRY=
ARG APT_MIRROR=
ARG PYPI_INDEX_URL=

# ---------- Stage 1: 构建依赖 ----------
FROM ${REGISTRY}python:3.13-slim AS deps

ARG APT_MIRROR=
ARG PYPI_INDEX_URL=

WORKDIR /build

# 可选：按需切换 Debian APT 镜像，不传则使用官方默认源
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    fi

# 安装编译依赖
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    cp /etc/apt/sources.list.d/debian.sources /tmp/debian.sources \
    && if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && (apt-get update -o Acquire::Retries=5 || \
      (cp /tmp/debian.sources /etc/apt/sources.list.d/debian.sources && apt-get update -o Acquire::Retries=5)) \
    && apt-get install -y --no-install-recommends \
      gcc \
    && rm -rf /var/lib/apt/lists/*

# 安装 uv，可按需通过 PYPI_INDEX_URL 指定镜像
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    if [ -n "$PYPI_INDEX_URL" ]; then \
      pip install -i "$PYPI_INDEX_URL" uv || pip install uv; \
    else \
      pip install uv; \
    fi

# 复制项目文件
COPY pyproject.toml uv.lock ./

# 用 uv 从锁文件安装依赖到 /build/deps，可按需通过 PYPI_INDEX_URL 指定镜像
RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    if [ -n "$PYPI_INDEX_URL" ]; then \
      uv pip install --prefix=/build/deps --index-url "$PYPI_INDEX_URL" -r pyproject.toml || \
      uv pip install --prefix=/build/deps -r pyproject.toml; \
    else \
      uv pip install --prefix=/build/deps -r pyproject.toml; \
    fi

# ---------- Stage 2: 运行时镜像 ----------
FROM ${REGISTRY}python:3.13-slim AS runtime

ARG APT_MIRROR=

WORKDIR /app

# 可选：按需切换 Debian APT 镜像，不传则使用官方默认源
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    fi

# 安装运行时系统依赖（FFmpeg 用于视频处理）
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    cp /etc/apt/sources.list.d/debian.sources /tmp/debian.sources \
    && if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && (apt-get update -o Acquire::Retries=5 || \
      (cp /tmp/debian.sources /etc/apt/sources.list.d/debian.sources && apt-get update -o Acquire::Retries=5)) \
    && apt-get install -y --no-install-recommends \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 从 deps 阶段复制已安装的 Python 依赖
COPY --from=deps /build/deps /usr/local

# 复制应用代码
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .
COPY pyproject.toml .
COPY scripts/ ./scripts/

# 创建非 root 用户
RUN groupadd -r contentguard && useradd -r -g contentguard -d /app -s /sbin/nologin contentguard \
    && mkdir -p /tmp/videos \
    && chown -R contentguard:contentguard /app /tmp/videos

USER contentguard

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=5).read()"

ENTRYPOINT ["./scripts/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
