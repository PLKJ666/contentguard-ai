# ContentGuard AI CI/CD 模板

本文档说明仓库中 `.drone.yml` 的公开模板用途。它描述构建、检查和可选部署的流程，不绑定任何公司、私有网络、镜像仓库或生产服务器。个人作品集只需要本地 Docker Compose 或 GitHub 上的常规 CI；Drone 部署步骤可以完全关闭。

## 流程概览

```text
tag push
   -> tag 格式检查
   -> 后端镜像构建与推送
   -> 前端镜像构建与推送
   -> 可选的 SSH 部署
   -> 可选的通用 Webhook 通知
```

业务代码、API 路径、数据库模型和 Celery 任务不依赖此流水线。CI 只负责验证和交付构建产物。

## 推荐的检查阶段

在构建镜像前执行以下检查：

```bash
# backend/
python -m compileall -q app tests
uv lock --check
uv run --extra dev pytest -m "not slow" --tb=short -q

# frontend/
npm ci
npm run lint
npx tsc --noEmit
npm test -- --run
npm run build
```

实际 CI 可以拆成并行的后端和前端任务。慢测试、需要 PostgreSQL/Redis 的集成测试应由对应服务容器提供依赖，并在日志中记录测试结果。

## 镜像命名

使用 CI Secret 提供镜像仓库前缀，公开仓库只展示格式：

```text
<registry-host>/contentguard-backend:<tag>
<registry-host>/contentguard-frontend:<tag>
```

不建议把真实 registry、用户名、密码或镜像 digest 写进 `.drone.yml`、Dockerfile 或文档。生产构建应固定基础镜像和依赖版本，并在发布记录中保存 digest。

## Drone Secret 约定

`.drone.yml` 使用以下 Secret 名称。Secret 的值由部署平台管理，不进入 Git：

| Secret | 用途 | 是否本地开发需要 |
| --- | --- | --- |
| `backend_repo` | 后端镜像完整地址 | 否 |
| `frontend_repo` | 前端镜像完整地址 | 否 |
| `registry_prefix` | Docker 基础镜像前缀，可为空 | 否 |
| `public_base_url` | 前端公开访问地址 | 否 |
| `logto_endpoint` | Logto Endpoint | 否 |
| `logto_app_id` | Logto 应用 ID | 否 |
| `logto_app_secret` | Logto 应用 Secret | 否 |
| `logto_cookie_secret` | Next.js 会话 Cookie Secret | 否 |
| `logto_api_resource` | 后端 API Resource | 否 |
| `deploy_host` | 可选部署主机 | 否 |
| `deploy_user` | 可选部署用户 | 否 |
| `deploy_ssh_key` | 可选部署 SSH 私钥 | 否 |
| `notification_webhook` | 可选通用通知地址 | 否 |

在 CI 中应先校验必需 Secret 非空，再把它们作为环境变量或 Docker build args 传递。任何错误日志都不能打印 Secret 内容。

## 本地构建

不依赖 CI 也可以验证镜像：

```bash
docker build --target deps -t contentguard-backend-deps ./backend
docker build -t contentguard-backend:local ./backend
docker build --target deps -t contentguard-frontend-deps ./frontend
docker build -t contentguard-frontend:local ./frontend
```

运行完整本地环境：

```bash
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

本地配置中的 Logto、AI、TOS 和 SMTP 字段可以保持空值，直到对应功能需要真实服务。不要使用生产 Secret 进行本地调试。

## 可选部署阶段

部署模板假定目标主机已经准备好 Docker、Compose、Git 和环境文件。部署目录、主机、用户和 SSH 端口都必须从 Secret 或平台配置注入；公开示例只使用占位符：

```bash
export DEPLOY_DIR=/opt/contentguard-ai
export DEPLOY_HOST=<deploy-host>
export DEPLOY_USER=<deploy-user>

ssh "${DEPLOY_USER}@${DEPLOY_HOST}" "cd '${DEPLOY_DIR}' && git pull --ff-only origin main"
ssh "${DEPLOY_USER}@${DEPLOY_HOST}" "cd '${DEPLOY_DIR}' && bash scripts/deploy-remote.sh <tag>"
```

目标主机上的 `.env` 和 `backend/.env` 应由 Secret 管理工具写入，不能通过 Git 同步。`scripts/deploy-remote.sh` 只负责拉取代码、拉取镜像、迁移和 Compose 更新；具体权限和备份策略由部署环境负责。

## 发布与回滚

仓库使用以下标签格式：

```text
v{major}.{minor}.{MMDD}.{build}
```

推荐发布步骤：

1. 在合并请求中通过前后端检查和依赖锁定检查。
2. 创建版本标签并构建不可变镜像。
3. 记录前端、后端和基础镜像 digest。
4. 在目标环境执行数据库迁移和健康检查。
5. 若检查失败，使用上一个已验证的镜像 tag 或 digest 回滚，不直接修改线上容器。

健康检查示例：

```bash
curl -fsS http://<host>/health
docker compose ps
docker compose logs --tail=100 backend
```

## 安全边界

- `.env`、`backend/.env`、SSH 私钥、Logto Secret、TOS 密钥、AI API Key 和 Webhook 不得提交。
- CI 日志不得输出带凭据的 URL、完整环境变量或 Docker 配置。
- 生产 CORS 只允许实际前端 origin；Cookie Secret 和 `SECRET_KEY` 必须使用随机值。
- `OPERATOR_ACCESS_CODE` 必须显式配置；空配置会拒绝运营角色 onboarding。
- 依赖升级应同时更新 lock 文件并运行后端、前端测试。
- 公开作品集部署只展示流程和占位符，不展示真实主机、内网拓扑或第三方账号。
