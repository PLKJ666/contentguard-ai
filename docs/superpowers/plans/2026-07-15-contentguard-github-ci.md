# ContentGuard AI GitHub Actions CI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 添加一个不依赖生产 Secrets 的 GitHub Actions 质量门禁，在 main push、Pull Request 和手动触发时并行验证前端完整检查与后端稳定测试集合。

**Architecture:** `.github/workflows/ci.yml` 只负责质量验证，不复制 Drone 的镜像推送、SSH 部署或通知逻辑。前端 job 使用 Node 20 和锁文件缓存；后端 job 使用 Python 3.12、uv 和 SQLite 测试环境，主动排除当前已知的 `slow`、`integration`、`e2e` 边界。

**Tech Stack:** GitHub Actions、`actions/checkout@v4`、`actions/setup-node@v4`、`actions/setup-python@v5`、`astral-sh/setup-uv@v5`、npm、Vitest、TypeScript、pytest、uv。

---

### Task 1: 创建公开 CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 创建 workflow 目录**

Run:

~~~powershell
New-Item -ItemType Directory -Force .github/workflows | Out-Null
~~~

- [ ] **Step 2: 写入最小公开质量门禁**

The workflow must contain this structure and no deployment commands:

~~~yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  frontend:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci --no-audit --no-fund
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm test -- --run
      - run: npm run build

  backend:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: backend
    env:
      ENVIRONMENT: test
      SECRET_KEY: ci-test-secret
      DATABASE_URL: sqlite+aiosqlite:///./test.db
      REDIS_URL: redis://127.0.0.1:6379/0
      USE_CELERY: "false"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
          cache-dependency-glob: backend/uv.lock
      - run: uv sync --extra dev --frozen
      - run: uv lock --check
      - run: uv run python -m compileall -q app tests
      - run: uv run pytest -m "not slow and not integration and not e2e" -q
~~~

The workflow must not contain `docker push`, `ssh`, registry URLs, webhook URLs, Logto secrets, AI keys, TOS keys, or production hostnames.

- [ ] **Step 3: Perform static workflow safety scan**

Run:

~~~powershell
rg -n -i "docker push|ssh|registry\\.example|webhook|LOGTO_APP_SECRET|AI_API_KEY|TOS_SECRET|BEGIN .*PRIVATE KEY|sk-[A-Za-z0-9]{16,}" .github/workflows/ci.yml
~~~

Expected: no matches。

### Task 2: Validate workflow syntax and action boundaries

**Files:**
- Test: `.github/workflows/ci.yml`

- [ ] **Step 1: Check actionlint availability**

Run:

~~~powershell
if (Get-Command actionlint -ErrorAction SilentlyContinue) { actionlint .github/workflows/ci.yml } else { 'actionlint unavailable' }
~~~

If actionlint is unavailable, use the repository's available YAML parser and validate that the workflow has `name`, `on`, `permissions`, `concurrency`, and both `frontend`/`backend` jobs.

- [ ] **Step 2: Validate required commands and exclusions**

Run:

~~~powershell
rg -n "npm ci|npm run lint|tsc --noEmit|npm test -- --run|npm run build|uv sync --extra dev --frozen|uv lock --check|compileall|pytest -m|not integration|not e2e|workflow_dispatch" .github/workflows/ci.yml
~~~

Expected: every required command appears in the intended job, and the backend test expression excludes `slow`, `integration`, and `e2e`。

### Task 3: Re-run workflow commands locally

**Files:**
- No source changes.

- [ ] **Step 1: Re-run frontend job commands**

Run from `frontend`:

~~~powershell
npm ci --no-audit --no-fund
npm run lint
npx tsc --noEmit
npm test -- --run
npm run build
~~~

Expected: all commands exit 0; the known 5 `no-img-element` warnings may remain.

- [ ] **Step 2: Re-run backend stable job commands**

Run from `backend` with the workflow environment:

~~~powershell
$env:ENVIRONMENT='test'
$env:SECRET_KEY='ci-test-secret'
$env:DATABASE_URL='sqlite+aiosqlite:///./test.db'
$env:REDIS_URL='redis://127.0.0.1:6379/0'
$env:USE_CELERY='false'
uv sync --extra dev --frozen
uv lock --check
uv run python -m compileall -q app tests
uv run pytest -m "not slow and not integration and not e2e" -q
~~~

Expected: compilation, lock check and stable pytest collection pass without requiring PostgreSQL, Redis or Celery services.

### Task 4: Document the CI boundary

**Files:**
- Modify: `README.md`
- Modify: `ECC_AUDIT_REPORT.md`

- [ ] **Step 1: Add public CI description to README**

Add one validation bullet stating that GitHub Actions runs frontend full checks and backend stable tests, and that real Celery integration tests remain a separate manual boundary until their environment-sensitive timeout is resolved.

- [ ] **Step 2: Add workflow evidence to the audit report**

Record the workflow path, triggers, no-secret design, local command reproduction, and explicit exclusion of `slow/integration/e2e`.

### Task 5: Review, commit and push

**Files:**
- Review: `.github/workflows/ci.yml`, `README.md`, `ECC_AUDIT_REPORT.md`

- [ ] **Step 1: Review diff and secrets**

Run:

~~~powershell
git diff --check
git diff --stat
git grep -n -I -i -E "private|internal\\.example|192\\.168\\.|sk-[A-Za-z0-9]{16,}|BEGIN .*PRIVATE KEY" -- .github README.md ECC_AUDIT_REPORT.md
~~~

Expected: no whitespace errors or real secret matches; only the planned CI/docs files are changed.

- [ ] **Step 2: Commit in Chinese**

~~~powershell
git add .github/workflows/ci.yml README.md ECC_AUDIT_REPORT.md
git commit -m "添加 GitHub Actions 持续集成"
~~~

- [ ] **Step 3: Push and verify**

~~~powershell
git push origin main
git status --short --branch
git ls-remote origin refs/heads/main
~~~

Expected: push succeeds, local `main` tracks the same remote commit, and the worktree is clean.
