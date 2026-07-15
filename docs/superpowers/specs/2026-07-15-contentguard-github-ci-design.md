# ContentGuard AI GitHub Actions CI 设计

## Goal

为公开作品集仓库增加稳定、可复现且不依赖生产凭据的 GitHub Actions 质量门禁，在 push 和 Pull Request 时验证前端完整质量检查、后端编译/锁文件和稳定测试集合。

## Confirmed Direction

采用快速公开 CI：

- 前端和后端作为两个独立 job 并行执行。
- 前端执行 `npm ci`、lint、TypeScript、Vitest 和生产构建。
- 后端执行 `uv sync --extra dev --frozen`、Python 编译、`uv lock --check` 和 `pytest -m "not slow and not integration and not e2e"`。
- 提供 `workflow_dispatch` 手动触发入口。
- 不执行 Docker 镜像推送、生产部署或通知 Webhook。
- 不在 workflow 中放置真实 Secrets；测试环境变量只使用明确的测试占位值。

## Why Integration Tests Are Separate

当前完整后端测试中有 2 个真实 Celery worker 用例在全量顺序下出现环境敏感超时，但隔离运行通过。它们依赖真实 Redis/Docker 和 worker 生命周期，不应直接作为第一版公开 PR 门禁。

本阶段把 `integration` 和 `e2e` 排除在快速 CI 外，避免把已知环境敏感问题伪装成稳定门禁。后续 Celery 稳定性修复完成后，再增加独立的手动集成 workflow 或扩展 job。

## Workflow Boundaries

文件：`.github/workflows/ci.yml`

触发：

- push 到 `main`
- 针对 `main` 的 pull request
- 手动 `workflow_dispatch`

安全默认值：

- `permissions: contents: read`
- job 级超时，避免 runner 无限占用
- concurrency 按 workflow/ref 分组，并取消同一分支的旧运行
- 测试变量仅使用 `ci-test-secret`、SQLite 和本地 Redis URL

## Frontend Job

运行环境：Ubuntu latest、Node.js 20。

命令顺序：

```text
npm ci
npm run lint
npx tsc --noEmit
npm test -- --run
npm run build
```

使用 `frontend/package-lock.json` 做 npm 缓存键。lint 现有 5 个 `no-img-element` 警告允许通过，但任何 ESLint 错误、类型错误、测试失败或构建失败都必须阻断 job。

## Backend Job

运行环境：Ubuntu latest、Python 3.12、uv。

测试环境变量：

```text
ENVIRONMENT=test
SECRET_KEY=ci-test-secret
DATABASE_URL=sqlite+aiosqlite:///./test.db
REDIS_URL=redis://127.0.0.1:6379/0
USE_CELERY=false
```

命令顺序：

```text
uv sync --extra dev --frozen
uv lock --check
uv run python -m compileall -q app tests
uv run pytest -m "not slow and not integration and not e2e" -q
```

不启动真实 PostgreSQL、Redis 或 Celery worker；测试 fixtures 已使用 SQLite 和 mock/隔离依赖覆盖稳定测试范围。

## Out Of Scope

- 不复制 Drone 的私有 registry、SSH 部署、生产通知和 tag 发布流程。
- 不在公开 workflow 中读取 Logto、AI、TOS、数据库或部署 Secrets。
- 不修改现有测试以掩盖 Celery 超时。
- 不把集成测试永久删除或降低为无断言测试。

## Acceptance Criteria

1. `.github/workflows/ci.yml` 存在且 YAML 结构可解析。
2. workflow 只使用公开 action 和测试占位值，不包含私有域名、Token 或部署命令。
3. 前端 job 覆盖 lint、类型检查、完整 Vitest 和 production build。
4. 后端 job 覆盖 uv 锁文件、编译和稳定测试集合。
5. `actionlint`（若本机可用）或等效 YAML/字符串扫描通过。
6. 本地复跑 workflow 中的前后端命令，结果与 CI 预期一致。
7. CI 设计和已知集成测试边界记录在 `ECC_AUDIT_REPORT.md`。
