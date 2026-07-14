# ContentGuard AI 部署示例

本文档面向个人作品集和自建环境，说明如何使用 Docker Compose 启动 ContentGuard AI。所有域名、凭据、对象存储和 AI 服务地址都使用占位符；真实值必须通过环境变量或部署平台 Secret 提供。

## 1. 运行前提

- Docker Engine 24+ 和 Docker Compose v2
- 可用的 PostgreSQL 16+、Redis 7+
- 一个已配置的 Logto 应用
- 一个 TOS/S3 兼容对象存储桶（需要文件上传时）
- 一个兼容 OpenAI API 的 AI 服务（需要 AI 审核时）
- 生产环境建议使用 HTTPS、随机 `SECRET_KEY` 和独立数据库账号

本地演示可以先只启动 PostgreSQL、Redis、前端和后端，Logto、TOS、AI 和 SMTP 配置留空。需要登录、上传或 AI 审核时再补齐对应服务。

## 2. 准备环境文件

在仓库根目录执行：

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
```

Linux/macOS 等价命令：

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

根目录 `.env` 至少需要检查以下值：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://contentguard:<password>@host.docker.internal:5432/contentguard` | PostgreSQL 连接地址 |
| `REDIS_URL` | `redis://host.docker.internal:6379/0` | Redis 连接地址 |
| `NEXT_PUBLIC_BASE_URL` | `https://app.example.com` | 浏览器实际访问 origin |
| `LOGTO_ENDPOINT` | `https://auth.example.com/` | Logto Endpoint |
| `LOGTO_APP_ID` | 由 Secret 注入 | Logto 应用 ID |
| `LOGTO_APP_SECRET` | 由 Secret 注入 | Logto 应用 Secret |
| `LOGTO_COOKIE_SECRET` | 随机字符串 | Next.js 会话 Cookie Secret |
| `LOGTO_API_RESOURCE` | `https://api.example.com` | 后端 API Resource |

`host.docker.internal` 适用于 Docker Desktop 与主机服务连接。若 PostgreSQL 和 Redis 也由 Compose 管理，应改为对应 Compose service 名称。

后端 `.env` 需要至少设置：

```dotenv
APP_NAME=ContentGuard AI
ENVIRONMENT=production
DEBUG=false
CORS_ORIGINS=https://app.example.com
SECRET_KEY=
OPERATOR_ACCESS_CODE=
```

`OPERATOR_ACCESS_CODE` 为空时会拒绝运营角色 onboarding，这是预期的 fail-closed 行为。不要在公开仓库或镜像层写入真实开通码。

## 3. 配置 Logto

在 Logto 应用中登记与 `NEXT_PUBLIC_BASE_URL` 对应的地址：

```text
Redirect URI:
https://app.example.com/api/auth/callback

Post-logout redirect URI:
https://app.example.com
```

后端使用 `LOGTO_API_RESOURCE` 校验受众，并通过 `LOGTO_ENDPOINT` 获取 OIDC issuer 和 JWKS。前后端的 Endpoint、App ID 和 Resource 必须属于同一 Logto 应用配置。

## 4. 配置对象存储与 AI

后端 `.env` 中填写对象存储：

```dotenv
TOS_ACCESS_KEY_ID=
TOS_SECRET_ACCESS_KEY=
TOS_REGION=<region>
TOS_BUCKET_NAME=contentguard-files
TOS_ENDPOINT=<optional-endpoint>
TOS_CDN_DOMAIN=<optional-cdn-domain>
```

AI 配置由应用数据库中的租户配置管理。默认示例使用：

```dotenv
AI_PROVIDER=oneapi
AI_API_BASE_URL=https://ai.example.com/v1
AI_API_KEY=
```

AI API Key 会以加密形式保存。`backend/app/utils/crypto.py` 中的历史兼容盐值不能修改，否则已有加密配置可能无法解密。

## 5. 启动服务

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

检查日志：

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f nginx
```

Compose 会构建后端、前端和 Nginx 服务。后端入口脚本负责启动应用所需的初始化流程；若迁移或种子数据失败，应先查看后端日志，再重复启动。

## 6. 反向代理与 HTTPS

开发环境可以直接访问 `http://localhost`。生产环境应在 Nginx、Caddy 或云负载均衡器上终止 TLS，并将请求转发到 Compose 中的 Nginx 服务。

主机层代理需要支持：

- 至少 `500M` 请求体，以容纳视频上传
- 至少 `600s` 的上传和代理超时
- SSE 长连接的 `proxy_buffering off`
- `X-Forwarded-Proto`、`X-Forwarded-Host` 等标准转发头

仓库中的 `nginx/host-ssl-proxy.conf.example` 可作为主机层模板。部署前替换 `server_name` 和证书路径，并执行：

```bash
nginx -t
sudo systemctl reload nginx
```

## 7. 验证清单

```bash
curl -fsS http://localhost/health
docker compose ps
docker compose logs --tail=100 backend
```

浏览器验证：

- 登录跳转到 Logto，回调地址正确
- 新用户可以完成角色 onboarding
- 项目、Brief 和任务列表能正常加载
- 脚本上传后能进入 AI 审核和代理商审核阶段
- 视频上传和第二阶段审核保持原有状态流转
- SSE 能收到任务进度和通知
- 申诉、强制通过和导出权限符合角色边界

## 8. 更新与备份

更新代码并重建服务：

```bash
git pull --ff-only origin main
docker compose up -d --build
```

数据库备份示例：

```bash
docker exec contentguard-postgres pg_dump -U contentguard contentguard > backup_$(date +%Y%m%d_%H%M%S).sql
```

容器名或数据库连接方式发生变化时，以 `docker compose ps` 和实际 `DATABASE_URL` 为准。备份文件应存放在仓库外，并由独立的备份策略加密和保留。

## 9. 常见问题

### 登录回调失败

检查 `NEXT_PUBLIC_BASE_URL` 是否与浏览器实际 origin 一致，并确认 Logto 已登记 callback 和 logout URI。修改后需要重新构建前端镜像。

### 连接不上数据库或 Redis

容器内的 `localhost` 指向容器自身。使用主机服务时使用 `host.docker.internal`，使用 Compose 服务时使用 service 名称，并确认端口和防火墙规则。

### 上传返回 413 或超时

同时检查主机代理和仓库 Nginx 的 `client_max_body_size`、`client_body_timeout` 及上传相关代理超时。

### 运营角色无法注册

确认后端环境显式设置了 `OPERATOR_ACCESS_CODE`，且请求中的开通码完全匹配。空值会按设计拒绝注册。

### AI 审核没有执行

检查 AI 租户配置、AI API Key、Base URL、Redis/Celery worker 和后端日志。开发环境可以确认 `USE_CELERY=false`，生产环境则应确认 worker 已启动。

## 10. 安全检查

- [ ] 所有 Secret 使用随机值并由环境外部注入
- [ ] `.env`、`backend/.env` 和备份文件未提交
- [ ] `DEBUG=false`，生产 CORS 不使用通配符
- [ ] Logto 回调地址使用 HTTPS
- [ ] PostgreSQL、Redis、TOS 和 AI 凭据使用最小权限
- [ ] `SECRET_KEY`、`LOGTO_COOKIE_SECRET` 和运营开通码未写进 Dockerfile 或日志
- [ ] 发布前完成后端测试、前端测试、类型检查和构建
