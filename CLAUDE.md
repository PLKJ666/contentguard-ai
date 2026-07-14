# CLAUDE.md - ContentGuard AI

本文件是项目协作说明。项目是 `ContentGuard AI`（内容卫士 AI 审核平台）的个人作品集版本，保留内容合规审核的核心业务模型与异步处理流程，公开仓库不包含生产凭据或私有部署信息。

## 常用命令

### 前端

```bash
cd frontend && npm run dev
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd frontend && npm test -- --run
cd frontend && npm run build
```

### 后端

```bash
cd backend && uvicorn app.main:app --reload
cd backend && pytest
cd backend && pytest -m "not slow"
cd backend && alembic upgrade head
cd backend && alembic heads
```

### Docker Compose

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

运行完整服务前，先根据 `.env.example` 和 `backend/.env.example` 创建本地配置。真实 Logto、AI、TOS、SMTP 和数据库凭据只能通过本地环境或 CI/CD Secret 注入。

## 项目结构

```text
contentguard-ai/
├── frontend/          Next.js 14 + TypeScript + TailwindCSS
├── backend/           FastAPI + SQLAlchemy 2.0 + PostgreSQL
├── docs/              产品、部署、测试和作品集说明
├── featuredoc/        功能设计与历史评估文档
└── scripts/            本地开发、备份和部署脚本
```

### 前端结构

```text
frontend/
├── app/               App Router 页面与服务端路由
├── components/        UI、布局和导航组件
├── contexts/          AuthContext、SSEContext 等上下文
├── hooks/             上传与交互 Hooks
├── lib/               API 客户端、状态映射和工具函数
└── types/             与后端 schema 对齐的 TypeScript 类型
```

### 后端结构

```text
backend/app/
├── main.py            FastAPI 应用入口，API 前缀为 /api/v1
├── api/               认证、项目、Brief、任务、审核、上传和导出路由
├── models/            SQLAlchemy ORM 模型
├── schemas/           Pydantic 请求与响应模型
├── services/          认证、AI、文件和业务服务
├── tasks/             Celery 异步任务
└── utils/             加密、解析和通用工具
```

## 架构约定

### 认证与多租户

- 用户认证由 Logto 承担；后端在 API 边界验证 Logto JWT 的签名、签发者和受众。
- 新用户先完成 onboarding，再根据角色创建品牌方、代理商、达人或运营空间。
- 运营角色必须配置 `OPERATOR_ACCESS_CODE`；配置为空时，运营 onboarding 会 fail closed。
- 品牌方作为主要租户边界，项目、Brief、任务和审核数据按授权组织隔离。
- 前端使用 `contentguard_*` 作为主题、租户和用户状态的本地存储前缀。

### 核心业务流程

```text
Project -> Brief -> Task

脚本上传 -> 脚本 AI 审核 -> 代理商审核 -> 品牌终审
         -> 视频上传 -> 视频 AI 审核 -> 代理商审核 -> 品牌终审 -> 完成
```

`TaskStage` 是状态机的唯一业务状态来源。申诉、强制通过、人工决策、通知和审计日志必须沿用既有状态转换与权限约束。

### AI 与异步处理

- AI 配置通过 `AI_PROVIDER`、`AI_API_KEY` 和 `AI_API_BASE_URL` 提供，默认示例地址使用 `https://ai.example.com/v1`。
- AI 请求和结构化审核结果由后端服务统一处理；不要在前端复制审核规则或 Prompt。
- Celery/Redis 用于耗时审核、XHS 批处理和重试；开发环境可以通过 `USE_CELERY=false` 使用 asyncio 回退。
- SSE 端点为 `/api/v1/sse/events`，前端通过 `SSEContext` 接收任务和批处理进度。

### 文件存储

- 生产文件使用 TOS 兼容的对象存储签名上传，前端上传 Hook 负责提交文件并回调后端。
- `LOCAL_FILE_STORAGE_ENABLED` 仅用于本地开发或测试，不应被当作生产文件授权方案。
- 文件访问必须经过已有的任务、组织和对象授权检查；不要把凭据放进 URL 或提交到仓库。

## 设计和实现要求

- 保留 API 路径、响应契约、数据库表、Alembic revision、任务阶段和 AI Prompt 的现有语义。
- 变更认证、存储或队列时，先同步后端 schema、前端类型、测试和文档。
- `backend/app/utils/crypto.py` 中的固定加密盐是历史兼容值，不能为了名称清理而修改；否则已有加密 AI 配置可能无法解密。
- 使用 Conventional Commits：`feat:`、`fix:`、`perf:`、`docs:`、`chore:`。
- `.pen` 设计文件不作为运行时依赖；公开文档不应依赖私有设计工具或内部链接。

## CI/CD

`.drone.yml` 是可选的 CI/CD 模板，默认只使用外部 Secret 注入的仓库、Logto、镜像仓库和部署参数。个人作品集的本地开发不需要 Drone、远程主机或通知服务。

发布标签沿用：

```text
v{major}.{minor}.{MMDD}.{build}
```

正式发布前至少执行：

```bash
cd backend && python -m compileall -q app tests && uv lock --check
cd frontend && npm run lint && npx tsc --noEmit && npm test -- --run && npm run build
```

## 当前范围

- 已实现：Logto onboarding、品牌/代理商/达人协作、Project/Brief/Task、脚本与视频两阶段审核、申诉、强制通过、SSE、Celery/Redis、XHS 批量改写与导出。
- 需要外部服务才能完整运行：Logto、PostgreSQL、Redis、TOS 和兼容 OpenAI API 的 AI 服务。
- 生产凭据、真实域名、通知 Webhook、镜像仓库和部署服务器配置被刻意留在仓库外。
- `featuredoc/` 中部分文档保留了历史规划背景；涉及当前行为时以代码、测试和 README 为准。

## 修改前检查

1. 先定位对应的 API、service、model、schema、前端页面和测试。
2. 确认改动不改变任务阶段、权限边界、响应字段、迁移链或加密兼容性。
3. 运行触及模块的最小测试，再运行前后端类型检查、构建和公开信息扫描。
4. 文档中的域名、账号、路径、Webhook 和密钥一律使用占位符；不要复制生产配置。
