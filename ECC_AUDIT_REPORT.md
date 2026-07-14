# ContentGuard AI 作品集脱敏审计记录

## 审计范围

本记录用于说明个人作品集公开版的处理边界。检查范围包括应用标识、前端展示、配置模板、Docker/Compose、CI/CD、部署文档、测试 fixtures 和公开链接。目标是让仓库能够以 `PLKJ666/contentguard-ai` 的独立身份展示，同时保留可验证的核心工程能力。

## 保留的核心能力

- `Project -> Brief -> Task` 业务模型和现有 API 路径、响应契约
- 脚本与视频两阶段 AI 审核、代理商审核和品牌终审
- 申诉、强制通过、人工决策、审计日志和 SSE 通知
- Logto 认证、角色 onboarding 和多租户授权边界
- PostgreSQL、SQLAlchemy、Alembic、Redis、Celery 和 TOS 文件流程
- XHS 批量项目、批次、重试、安全改写、人工决策和导出流程
- 前后端测试、Docker 构建和可选 CI/CD 流程

没有为了改名而重命名数据库表、Alembic revision、任务状态、路由、Prompt 或队列标识。

## 已完成的公开化处理

- 应用、包、容器、队列和存储前缀统一为 `ContentGuard AI` / `contentguard`
- 前端元数据、侧栏、帮助页、更新日志和本地存储前缀改为公开版标识
- 私有域名、局域网地址、部署路径、镜像仓库和通知配置改为占位符或外部 Secret
- `.env.example`、Docker Compose、Drone 模板和部署脚本不再包含生产凭据
- 运营角色开通码默认为空；空配置会拒绝 onboarding，避免公开环境意外开放运营角色
- 公开文档改为 GitHub 作品集语境，并明确外部 Logto、AI、TOS、数据库和 Redis 依赖
- 历史 TDD 文档已标记为评估基线，避免把早期“未实现”描述误读为当前状态

## 有意保留的兼容性例外

`backend/app/utils/crypto.py` 中的固定加密盐值是现有加密 AI 配置的兼容要求。它不是公开凭据，且不能仅为名称清理而修改；改动会导致既有密文无法解密。部署时仍必须通过 `SECRET_KEY` 提供新的应用主密钥。

## 公开仓库不应包含

- Logto App Secret、Cookie Secret、AI API Key、TOS 密钥、SMTP 密码和 SSH 私钥
- 真实生产域名、局域网 IP、内部 Git/Registry 地址和通知 Webhook
- 生产数据库备份、用户数据、上传文件或可复用的运营开通码

## 发布前复核

```text
[ ] 扫描公开文件中的旧标识、私有域名、内网地址和长令牌
[ ] 检查 .env、backend/.env 和备份文件未被纳入发布内容
[ ] 确认数据库模型、迁移链、API 契约和任务状态没有非必要变化
[ ] 运行后端编译、锁文件检查和目标测试
[ ] 运行前端 lint、类型检查、测试和生产构建
[ ] 使用占位配置执行 Docker Compose 配置校验
[ ] 在发布说明中注明 Logto、AI、TOS、PostgreSQL 和 Redis 是外部依赖
```

## 本次验证证据

| 检查 | 结果 |
| --- | --- |
| `python -m compileall -q app tests` | 通过 |
| `uv lock --check` | 通过，锁定 93 个包；根包名为 `contentguard-backend` |
| 后端目标测试 | 142/142 通过，包含运营开通码为空时的 fail-closed 回归测试 |
| 后端完整测试（`-m "not slow"`） | 518 通过、2 跳过、2 个真实 Celery worker 超时 |
| `tests/test_export_api.py` | 25/25 通过 |
| `tests/test_xhs_celery_integration.py` 隔离运行 | 2/2 通过；全量运行时存在顺序/环境敏感超时 |
| 前端身份相关测试 | 45/45 通过 |
| `npm run lint` | 通过，保留 5 个既有 `no-img-element` 警告 |
| `npx tsc --noEmit` | 通过 |
| `npm run build` | 通过 |
| 前端完整 Vitest | 仍有 33 个既有 UI/状态契约失败，未发现脱敏相关失败 |
| Compose 配置校验 | YAML 解析通过；完整 Compose 需先创建本地 `.env` 和 `backend/.env` |

前端完整测试的失败集中在既有的 `taskStageMapper`、Tag/Card/Modal 样式契约和 AI 配置页面断言；这些失败与本次身份、配置模板、文档和运营开通码改动无关，未在本次脱敏任务中扩大修改范围。

## 结论

当前仓库定位为 `ContentGuard AI` 的个人作品集项目。身份层、公开配置和运维文档已与原始组织环境区分；内容合规审核的核心实现和数据流保持不变。该记录不是生产安全认证，也不替代部署环境的密钥轮换、权限审查、依赖审计和备份演练。
