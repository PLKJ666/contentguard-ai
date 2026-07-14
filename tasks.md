# tasks.md - 内容卫士 AI 审核平台 开发任务清单

> **历史任务清单说明**：本文档来自早期设计与拆解阶段，勾选状态和 JWT/WebSocket 等任务描述可能落后于当前代码。当前实现和已完成能力以源码、测试、README 及 `CLAUDE.md` 为准。

| 文档类型 | **Development Tasks (开发任务清单)** |
| --- | --- |
| **项目名称** | 内容卫士 AI 审核平台 (AI 营销内容合规审核平台) |
| **版本号** | V2.0 |
| **发布日期** | 2026-02-06 |
| **设计稿文件** | `pencil-new.pen` |
| **开发模式** | Pencil 设计稿 → 前端代码 → 后端 API 支撑 |

---

## 版本历史

| 版本 | 日期 | 作者 | 变更说明 |
| --- | --- | --- | --- |
| V1.0~V1.7 | 2026-02-02~04 | Claude | 历史版本（基于功能清单拆解） |
| **V2.0** | 2026-02-06 | Claude | **重构**：基于 pencil-new.pen 实际 UI 设计重新组织任务，按"设计稿→前端→后端"开发流程编排 |

---

## 0. 开发思路

### 0.1 核心流程

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Pencil 设计稿   │ ──▶ │   前端代码实现   │ ──▶ │  后端 API 支撑   │
│  pencil-new.pen │     │  Next.js/React  │     │    FastAPI      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **设计稿驱动**：所有页面以 pencil-new.pen 为准
2. **前端先行**：根据设计稿直接实现前端页面
3. **后端支撑**：确保前端功能所需的 API 和数据逻辑成立

### 0.2 TDD 规范

| 任务类型 | TDD 要求 | 测试工具 |
| --- | --- | --- |
| 前端组件 | 组件级 TDD | Vitest + RTL |
| 前端页面 | 快照测试 + 交互测试 | Vitest + Playwright |
| 后端 API | 契约优先 + 测试验证 | pytest + httpx |
| 后端服务 | 严格 TDD（先写测试） | pytest |

### 0.3 完成标准 (DoD)

- [ ] 代码实现
- [ ] 单元测试通过
- [ ] 覆盖率达标（后端 ≥80%，前端 ≥70%）
- [ ] 与设计稿视觉一致
- [ ] 代码 Review 通过

---

## 1. 项目架构

### 1.1 前端技术栈

```
Next.js 14 + React 18 + TypeScript + Tailwind CSS
├── 状态管理: Zustand
├── 图标: Lucide React
├── 文件上传: Uppy (Tus 协议)
├── HTTP: Axios
├── 测试: Vitest + Testing Library
└── E2E: Playwright
```

### 1.2 后端技术栈

```
FastAPI + SQLAlchemy 2.0 + PostgreSQL + Redis + Celery
├── 认证: JWT
├── AI 服务: OpenAI SDK (支持多厂商)
├── 异步任务: Celery + Redis
├── 数据库迁移: Alembic
└── 测试: pytest + pytest-asyncio
```

### 1.3 三端页面清单

#### 品牌方端 (12 页面)

| 页面 | 节点ID | 功能 |
| --- | --- | --- |
| 项目看板 | xUM9m | 项目列表与数据概览 |
| 项目详情 | D1O6f | 单项目数据分析 |
| 创建项目 | fP5rY | 新建项目表单 |
| 终审台(列表) | afJEU | 脚本/视频待终审列表 |
| 脚本终审决策台 | Sw2hw | 简单模式(文件图标) |
| 脚本终审(预览) | cp5CE | 展开脚本内容审核 |
| 视频终审决策台 | aePi5 | 视频播放+问题标记 |
| 代理商管理 | 2jnnO | 代理商列表+邀请 |
| 邀请代理商弹窗 | GyUlM | 邀请模态框 |
| 规则配置 | nhHSF | 黑白名单管理 |
| AI配置 | 4ppiJ | AI服务配置 |
| 系统设置 | 4nVj4 | 通用设置 |

#### 代理商端 (13 页面)

| 页面 | 节点ID | 功能 |
| --- | --- | --- |
| 工作台 | RX8V9 | 待办统计+快捷入口 |
| 项目详情 | C7wfV | 项目数据和达人列表 |
| 审核台(列表) | zjiCT | 脚本/视频待审列表 |
| 脚本审核决策台 | f8HX9 | 简单模式 |
| 脚本审核(预览) | Wct5R | 展开脚本+AI分析 |
| 视频审核决策台 | 2u8Bq | 视频播放+问题标记 |
| Brief配置(列表) | Nicby | 待配置/已配置列表 |
| Brief配置(待配置) | jRsW5 | 上传+配置规则 |
| Brief配置(已配置) | b06fU | 查看/编辑配置 |
| 达人管理 | 5cFMX | 达人列表+邀请 |
| 邀请达人弹窗 | ADN10 | 邀请模态框 |
| 数据报表 | An8gw | 项目数据统计 |
| 消息中心 | PfMR0 | 通知列表 |

#### 达人端 (18+ 状态页面)

| 页面 | 节点ID | 功能 |
| --- | --- | --- |
| 任务列表 | HD3eK | 当前任务卡片列表 |
| 个人中心 | BgzAd | 个人设置 |
| 消息中心 | 8XKLP | 通知列表 |
| 脚本-上传 | lVL76 | 脚本上传页 |
| 脚本-AI审核中 | kcRxj | 等待AI审核 |
| 脚本-AI结果 | cjcZZ | AI审核结果 |
| 脚本-等待代理商 | KLHcb | 等待代理商审核 |
| 脚本-代理商驳回 | flniQ | 代理商驳回页 |
| 脚本-等待品牌方 | s3sWQ | 等待品牌方终审 |
| 脚本-品牌方通过 | KspeJ | 品牌方审核通过 |
| 脚本-品牌方驳回 | NeF4L | 品牌方驳回页 |
| 视频-上传 | g1RSX | 视频上传页 |
| 视频-AI审核中 | 0Qg21 | 等待AI审核 |
| 视频-AI结果 | YLFhx | AI审核结果 |
| 视频-等待代理商 | EkFap | 等待代理商审核 |
| 视频-代理商驳回 | A5fxU | 代理商驳回页 |
| 视频-等待品牌方 | RAJsF | 等待品牌方终审 |
| 视频-通过 | duYR2 | 审核通过页 |
| 视频-品牌方驳回 | zU3Op | 品牌方驳回页 |

---

## 2. Phase 1: 基础设施 (Week 1)

### FE-001: 前端项目初始化

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **优先级** | P0 |
| **预估工时** | 1d |
| **状态** | ✅ 已完成 |

**现有代码评估：**
- ✅ Next.js 14 项目已搭建
- ✅ Tailwind CSS 已配置（含设计令牌）
- ✅ TypeScript 配置完成
- ✅ Vitest 测试框架已配置

**需要补充：**
- [ ] 确认路由结构与设计一致
- [ ] 更新 Tailwind 配色与 pencil-new.pen 一致

---

### FE-002: 基础 UI 组件库

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **优先级** | P0 |
| **预估工时** | 3d |
| **状态** | ✅ 大部分已完成 |

**现有组件：**
- ✅ Button（含变体：primary/secondary/danger/success/ghost）
- ✅ Card（CardHeader/CardContent/CardTitle）
- ✅ Input（含变体和状态）
- ✅ Modal（ConfirmModal）
- ✅ Select
- ✅ Tag（SuccessTag/WarningTag/ErrorTag/PendingTag）
- ✅ ProgressBar
- ✅ ReviewSteps

**需要补充：**
- [ ] FileUploader 组件（支持拖拽上传）
- [ ] VideoPlayer 组件（含进度条问题标记）
- [ ] Timeline 组件（审核流程进度条）
- [ ] Table 组件（列表页使用）
- [ ] Tooltip 组件
- [ ] Toast/Notification 组件

---

### FE-003: 布局和导航组件

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **优先级** | P0 |
| **预估工时** | 2d |
| **状态** | ⚠️ 需要更新 |

**现有组件：**
- ✅ DesktopLayout
- ✅ MobileLayout
- ✅ ResponsiveLayout
- ✅ Sidebar（需更新导航项）
- ✅ BottomNav
- ✅ StatusBar

**需要更新：**
- [ ] Sidebar 组件更新导航项配置（品牌方7项、代理商6项）
- [ ] 添加侧边栏高亮状态逻辑
- [ ] 添加页面标题组件

---

### BE-001: 后端项目初始化

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 1d |
| **状态** | ✅ 已完成 |

**现有代码评估：**
- ✅ FastAPI 项目已搭建
- ✅ 数据库连接配置（PostgreSQL）
- ✅ Redis 配置
- ✅ Celery 配置
- ✅ Docker Compose 配置
- ✅ 健康检查接口 `/api/v1/health`

---

### BE-002: 数据库模型

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 2d |
| **状态** | ⚠️ 需要扩展 |

**现有模型：**
- ✅ Tenant（租户）
- ✅ ReviewTask（AI审核任务）
- ✅ ManualTask（人工审核任务）
- ✅ Rule（规则）
- ✅ AIConfig（AI配置）
- ✅ RiskException（风控特例）

**需要新增：**
- [ ] User 模型（用户信息、角色）
- [ ] Brand 模型（品牌方）
- [ ] Agency 模型（代理商）
- [ ] Creator 模型（达人）
- [ ] Project 模型（项目）
- [ ] Brief 模型（Brief文档）
- [ ] BlacklistWord 模型（黑名单词）
- [ ] WhitelistWord 模型（白名单词）
- [ ] Message 模型（消息通知）

---

### BE-003: 认证系统

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 2d |
| **状态** | 🔴 待开发 |

**需要实现：**
- [ ] JWT 认证中间件
- [ ] 登录接口 `POST /api/v1/auth/login`
- [ ] 注册接口 `POST /api/v1/auth/register`
- [ ] 当前用户接口 `GET /api/v1/auth/me`
- [ ] 角色权限校验（brand/agency/creator）
- [ ] 刷新 Token 接口

**前端配套：**
- [ ] AuthContext 更新
- [ ] AuthGuard 组件更新
- [ ] 登录页面实现

---

## 3. Phase 2: 品牌方端 (Week 2-3)

### 3.1 项目看板模块

#### FE-B01: 项目看板页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | xUM9m |
| **路由** | `/brand` |
| **优先级** | P0 |
| **预估工时** | 2d |

**页面元素：**
- [ ] 页面标题 + 搜索框 + 筛选器
- [ ] 项目卡片列表（项目名、状态、脚本数/视频数）
- [ ] 点击卡片 → 项目详情页
- [ ] 「+ 创建项目」按钮

**后端依赖：**
- `GET /api/v1/projects` 项目列表

---

#### FE-B02: 项目详情页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | D1O6f |
| **路由** | `/brand/projects/[id]` |
| **优先级** | P1 |
| **预估工时** | 2d |

**页面元素：**
- [ ] 项目基本信息
- [ ] 数据统计卡片（审核数、通过率等）
- [ ] 达人任务列表

**后端依赖：**
- `GET /api/v1/projects/:id` 项目详情
- `GET /api/v1/projects/:id/stats` 项目统计

---

#### FE-B03: 创建项目页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | fP5rY |
| **路由** | `/brand/projects/create` |
| **优先级** | P0 |
| **预估工时** | 2d |

**页面元素：**
- [ ] 项目名称输入框
- [ ] 截止日期选择器
- [ ] Brief 文件上传（拖拽区）
- [ ] 代理商选择（卡片多选）
- [ ] 创建按钮

**后端依赖：**
- `POST /api/v1/projects` 创建项目
- `GET /api/v1/agencies` 代理商列表
- `POST /api/v1/upload/brief` 文件上传

---

### 3.2 终审台模块

#### FE-B04: 终审台列表页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | afJEU |
| **路由** | `/brand/review` |
| **优先级** | P0 |
| **预估工时** | 2d |

**页面元素：**
- [ ] 脚本待审列表（左侧）
- [ ] 视频待审列表（右侧）
- [ ] 任务卡片（达人名、项目名、状态标签）
- [ ] 点击任务 → 进入审核决策台

**后端依赖：**
- `GET /api/v1/brand/review/scripts` 脚本待审列表
- `GET /api/v1/brand/review/videos` 视频待审列表

---

#### FE-B05: 脚本终审决策台

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | Sw2hw (简单模式), cp5CE (预览模式) |
| **路由** | `/brand/review/script/[id]` |
| **优先级** | P0 |
| **预估工时** | 3d |

**页面元素：**
- [ ] 审核流程进度条
- [ ] 脚本预览区（简单模式：文件图标；预览模式：展开内容）
- [ ] 代理商初审意见
- [ ] AI 分析结果（违规用词、合规检查）
- [ ] 决策按钮（通过/驳回）

**后端依赖：**
- `GET /api/v1/brand/review/scripts/:id` 脚本详情
- `POST /api/v1/brand/review/scripts/:id/approve` 通过
- `POST /api/v1/brand/review/scripts/:id/reject` 驳回

---

#### FE-B06: 视频终审决策台

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | aePi5 |
| **路由** | `/brand/review/video/[id]` |
| **优先级** | P0 |
| **预估工时** | 3d |

**页面元素：**
- [ ] 审核流程进度条
- [ ] 视频播放器（居中播放按钮）
- [ ] 智能进度条（问题标记点：红色=硬性问题，橙色=舆情提示）
- [ ] 图例说明
- [ ] 代理商初审意见
- [ ] AI 分析结果
- [ ] 决策按钮（通过/驳回）

**后端依赖：**
- `GET /api/v1/brand/review/videos/:id` 视频详情
- `POST /api/v1/brand/review/videos/:id/approve` 通过
- `POST /api/v1/brand/review/videos/:id/reject` 驳回

---

### 3.3 管理模块

#### FE-B07: 代理商管理页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | 2jnnO, GyUlM |
| **路由** | `/brand/agencies` |
| **优先级** | P1 |
| **预估工时** | 2d |

**页面元素：**
- [ ] 代理商列表（卡片或表格）
- [ ] 「+ 邀请代理商」按钮
- [ ] 邀请弹窗（搜索代理商ID、发送邀请）

**后端依赖：**
- `GET /api/v1/brand/agencies` 代理商列表
- `POST /api/v1/brand/agencies/invite` 发送邀请
- `GET /api/v1/agencies/search?id=xxx` 搜索代理商

---

#### FE-B08: 规则配置页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | nhHSF |
| **路由** | `/brand/rules` |
| **优先级** | P0 |
| **预估工时** | 2d |

**页面元素：**
- [ ] Tab 切换（黑名单/白名单）
- [ ] 词条列表（表格形式）
- [ ] 添加词条按钮 + 弹窗
- [ ] 删除词条功能
- [ ] 批量导入/导出

**后端依赖：**
- `GET /api/v1/rules/blacklist` 黑名单列表
- `POST /api/v1/rules/blacklist` 添加黑名单词
- `DELETE /api/v1/rules/blacklist/:id` 删除
- `GET /api/v1/rules/whitelist` 白名单列表
- `POST /api/v1/rules/whitelist` 添加白名单词
- `DELETE /api/v1/rules/whitelist/:id` 删除

---

#### FE-B09: AI 配置页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | 4ppiJ |
| **路由** | `/brand/ai-config` |
| **优先级** | P0 |
| **预估工时** | 2d |
| **状态** | ✅ 已实现 |

**现有实现评估：**
- ✅ AI 提供商选择
- ✅ 三类模型配置（LLM/Vision/ASR）
- ✅ 连接配置（Base URL/API Key）
- ✅ 生成参数配置
- ✅ 测试连接功能
- ✅ 配置继承说明

**需要验证：**
- [ ] 与后端 API 对接
- [ ] 测试连接功能真实调用

---

#### FE-B10: 系统设置页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | 4nVj4 |
| **路由** | `/brand/settings` |
| **优先级** | P2 |
| **预估工时** | 1d |

**页面元素：**
- [ ] 通知设置
- [ ] 账户安全
- [ ] 数据导出

---

### 3.4 品牌方后端 API

#### BE-B01: 项目管理 API

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 3d |

**接口清单：**

```
POST   /api/v1/projects              # 创建项目
GET    /api/v1/projects              # 项目列表（支持分页、筛选）
GET    /api/v1/projects/:id          # 项目详情
PUT    /api/v1/projects/:id          # 更新项目
DELETE /api/v1/projects/:id          # 删除项目
GET    /api/v1/projects/:id/stats    # 项目统计数据
```

---

#### BE-B02: 品牌方终审 API

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 3d |

**接口清单：**

```
GET    /api/v1/brand/review/scripts           # 待终审脚本列表
GET    /api/v1/brand/review/scripts/:id       # 脚本详情
POST   /api/v1/brand/review/scripts/:id/approve  # 通过脚本
POST   /api/v1/brand/review/scripts/:id/reject   # 驳回脚本

GET    /api/v1/brand/review/videos            # 待终审视频列表
GET    /api/v1/brand/review/videos/:id        # 视频详情
POST   /api/v1/brand/review/videos/:id/approve   # 通过视频
POST   /api/v1/brand/review/videos/:id/reject    # 驳回视频
```

---

#### BE-B03: 规则管理 API

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 2d |

**接口清单：**

```
# 黑名单
GET    /api/v1/rules/blacklist               # 列表
POST   /api/v1/rules/blacklist               # 添加
DELETE /api/v1/rules/blacklist/:id           # 删除
POST   /api/v1/rules/blacklist/import        # 批量导入
GET    /api/v1/rules/blacklist/export        # 导出

# 白名单
GET    /api/v1/rules/whitelist               # 列表
POST   /api/v1/rules/whitelist               # 添加
DELETE /api/v1/rules/whitelist/:id           # 删除
POST   /api/v1/rules/whitelist/import        # 批量导入
GET    /api/v1/rules/whitelist/export        # 导出
```

---

## 4. Phase 3: 代理商端 (Week 4-5)

### 4.1 工作台与项目

#### FE-A01: 工作台页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | RX8V9 |
| **路由** | `/agency` |
| **优先级** | P0 |
| **预估工时** | 2d |

**页面元素：**
- [ ] 我的项目卡片列表
- [ ] 紧急待办列表（品牌新任务/脚本审核/视频审核/申诉仲裁）
- [ ] 统计卡片

---

#### FE-A02: 项目详情页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | C7wfV |
| **路由** | `/agency/projects/[id]` |
| **优先级** | P1 |
| **预估工时** | 2d |

---

### 4.2 审核台模块

#### FE-A03: 审核台列表页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | zjiCT |
| **路由** | `/agency/review` |
| **优先级** | P0 |
| **预估工时** | 2d |

---

#### FE-A04: 脚本审核决策台

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | f8HX9 (简单), Wct5R (预览) |
| **路由** | `/agency/review/script/[id]` |
| **优先级** | P0 |
| **预估工时** | 3d |
| **状态** | ⚠️ 部分实现 |

**现有代码评估：**
- ✅ ReviewSteps 组件已实现
- ⚠️ 页面路由已存在但需要更新

**需要实现：**
- [ ] 脚本内容展示区（开场白、产品介绍、使用演示、结尾引导）
- [ ] AI 分析结果区（违规用词、合规检查）
- [ ] 决策按钮（通过/驳回/强制通过）

---

#### FE-A05: 视频审核决策台

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | 2u8Bq |
| **路由** | `/agency/review/video/[id]` |
| **优先级** | P0 |
| **预估工时** | 3d |

---

### 4.3 Brief 配置模块

#### FE-A06: Brief 配置列表页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | Nicby |
| **路由** | `/agency/briefs` |
| **优先级** | P0 |
| **预估工时** | 2d |

---

#### FE-A07: Brief 配置详情页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | jRsW5 (待配置), b06fU (已配置) |
| **路由** | `/agency/briefs/[id]` |
| **优先级** | P0 |
| **预估工时** | 3d |

---

### 4.4 达人管理模块

#### FE-A08: 达人管理页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | 5cFMX, ADN10 |
| **路由** | `/agency/creators` |
| **优先级** | P1 |
| **预估工时** | 2d |

---

### 4.5 其他模块

#### FE-A09: 数据报表页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | An8gw |
| **路由** | `/agency/reports` |
| **优先级** | P1 |
| **预估工时** | 2d |

---

#### FE-A10: 消息中心页面

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | PfMR0 |
| **路由** | `/agency/messages` |
| **优先级** | P1 |
| **预估工时** | 1d |

---

### 4.6 代理商后端 API

#### BE-A01: 代理商审核 API

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 3d |

**接口清单：**

```
GET    /api/v1/agency/review/scripts           # 待审脚本列表
GET    /api/v1/agency/review/scripts/:id       # 脚本详情
POST   /api/v1/agency/review/scripts/:id/approve  # 通过
POST   /api/v1/agency/review/scripts/:id/reject   # 驳回

GET    /api/v1/agency/review/videos            # 待审视频列表
GET    /api/v1/agency/review/videos/:id        # 视频详情
POST   /api/v1/agency/review/videos/:id/approve   # 通过
POST   /api/v1/agency/review/videos/:id/reject    # 驳回
POST   /api/v1/agency/review/videos/:id/force-pass # 强制通过
```

---

#### BE-A02: Brief 配置 API

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 2d |

**接口清单：**

```
GET    /api/v1/agency/briefs                   # Brief 列表
GET    /api/v1/agency/briefs/:id               # Brief 详情
PUT    /api/v1/agency/briefs/:id               # 更新 Brief 配置
POST   /api/v1/agency/briefs/:id/parse         # AI 解析 Brief
```

---

#### BE-A03: 达人管理 API

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P1 |
| **预估工时** | 2d |

**接口清单：**

```
GET    /api/v1/agency/creators                 # 达人列表
POST   /api/v1/agency/creators/invite          # 邀请达人
GET    /api/v1/creators/search?id=xxx          # 搜索达人
POST   /api/v1/agency/tasks/assign             # 分配任务给达人
```

---

## 5. Phase 4: 达人端 (Week 6-7)

### 5.1 任务与导航

#### FE-C01: 任务列表页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | HD3eK |
| **路由** | `/creator` |
| **优先级** | P0 |
| **预估工时** | 2d |

**页面元素：**
- [ ] 侧边栏导航
- [ ] 任务卡片列表（项目名、品牌、状态、截止日期）
- [ ] 状态筛选（全部/待提交/审核中/已完成）

---

#### FE-C02: 个人中心页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | BgzAd |
| **路由** | `/creator/profile` |
| **优先级** | P2 |
| **预估工时** | 1d |

---

#### FE-C03: 消息中心页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | 8XKLP |
| **路由** | `/creator/messages` |
| **优先级** | P1 |
| **预估工时** | 1d |

---

### 5.2 脚本阶段页面

#### FE-C04: 脚本上传页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | lVL76 |
| **路由** | `/creator/task/[id]/script/upload` |
| **优先级** | P0 |
| **预估工时** | 2d |

---

#### FE-C05: 脚本审核状态页（6个状态）

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | kcRxj, cjcZZ, KLHcb, flniQ, s3sWQ, KspeJ, NeF4L |
| **路由** | `/creator/task/[id]/script/status` |
| **优先级** | P0 |
| **预估工时** | 3d |

**状态页面：**
- [ ] AI审核中（透明思考UI）
- [ ] AI审核结果
- [ ] 等待代理商审核
- [ ] 代理商驳回（显示驳回原因）
- [ ] 等待品牌方终审
- [ ] 品牌方通过 / 品牌方驳回

---

### 5.3 视频阶段页面

#### FE-C06: 视频上传页

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | g1RSX |
| **路由** | `/creator/task/[id]/video/upload` |
| **优先级** | P0 |
| **预估工时** | 2d |

---

#### FE-C07: 视频审核状态页（8个状态）

| 属性 | 内容 |
| --- | --- |
| **类型** | 前端 |
| **设计稿** | 0Qg21, 6EX4Z, YLFhx, EkFap, A5fxU, RAJsF, duYR2, zU3Op |
| **路由** | `/creator/task/[id]/video/status` |
| **优先级** | P0 |
| **预估工时** | 3d |

---

### 5.4 达人端后端 API

#### BE-C01: 达人任务 API

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 3d |

**接口清单：**

```
GET    /api/v1/creator/tasks                   # 我的任务列表
GET    /api/v1/creator/tasks/:id               # 任务详情
POST   /api/v1/creator/tasks/:id/script        # 提交脚本
POST   /api/v1/creator/tasks/:id/video         # 提交视频
GET    /api/v1/creator/tasks/:id/status        # 任务状态
```

---

#### BE-C02: 消息通知 API

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P1 |
| **预估工时** | 2d |

**接口清单：**

```
GET    /api/v1/messages                        # 消息列表
PUT    /api/v1/messages/:id/read               # 标记已读
PUT    /api/v1/messages/read-all               # 全部已读
```

---

## 6. Phase 5: AI 审核流水线 (Week 8)

### AI-001: 脚本 AI 审核服务

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 3d |
| **状态** | ⚠️ 部分实现 |

**现有代码评估：**
- ✅ 脚本审核 API 已存在
- ✅ AI 客户端已实现
- ⚠️ 需要与新的任务流程对接

**需要实现：**
- [ ] 脚本内容解析
- [ ] 违禁词检测
- [ ] 卖点覆盖检测
- [ ] 审核结果存储

---

### AI-002: 视频 AI 审核服务

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 5d |
| **状态** | ⚠️ 部分实现 |

**现有代码评估：**
- ✅ 视频审核 API 已存在
- ✅ ASR 服务已实现
- ✅ Vision 服务已实现
- ✅ 关键帧提取已实现

**需要完善：**
- [ ] 视频下载和预处理
- [ ] ASR 转文字 + 时间戳
- [ ] 画面检测（竞品Logo、风险场景）
- [ ] 审核报告生成
- [ ] 进度实时推送（WebSocket）

---

### AI-003: AI 配置动态加载

| 属性 | 内容 |
| --- | --- |
| **类型** | 后端 |
| **优先级** | P0 |
| **预估工时** | 2d |
| **状态** | ✅ 已实现 |

**现有代码评估：**
- ✅ AI 配置模型
- ✅ AI 配置 API
- ✅ 加密存储 API Key

---

## 7. Phase 6: 联调与测试 (Week 9-10)

### TEST-001: 前端组件测试

| 属性 | 内容 |
| --- | --- |
| **类型** | 测试 |
| **优先级** | P0 |
| **预估工时** | 3d |

**测试范围：**
- [ ] 所有 UI 组件单元测试
- [ ] 布局组件测试
- [ ] 导航组件测试
- [ ] 覆盖率 ≥ 70%

---

### TEST-002: 后端 API 测试

| 属性 | 内容 |
| --- | --- |
| **类型** | 测试 |
| **优先级** | P0 |
| **预估工时** | 3d |

**测试范围：**
- [ ] 所有 API 端点测试
- [ ] 权限校验测试
- [ ] 业务逻辑测试
- [ ] 覆盖率 ≥ 80%

---

### TEST-003: E2E 测试

| 属性 | 内容 |
| --- | --- |
| **类型** | 测试 |
| **优先级** | P1 |
| **预估工时** | 3d |

**测试场景：**
- [ ] 品牌方创建项目 → 分配代理商 → 终审流程
- [ ] 代理商配置 Brief → 分配达人 → 审核流程
- [ ] 达人提交脚本 → AI 审核 → 人工审核 → 提交视频 → 通过

---

### TEST-004: 前后端联调

| 属性 | 内容 |
| --- | --- |
| **类型** | 联调 |
| **优先级** | P0 |
| **预估工时** | 5d |

**联调内容：**
- [ ] 登录认证流程
- [ ] 品牌方全流程
- [ ] 代理商全流程
- [ ] 达人全流程
- [ ] AI 审核流程
- [ ] 消息通知推送

---

## 8. 任务统计

### 8.1 按阶段统计

| 阶段 | 前端任务 | 后端任务 | 测试任务 | 总计 |
| --- | --- | --- | --- | --- |
| Phase 1 基础设施 | 3 | 3 | - | 6 |
| Phase 2 品牌方端 | 10 | 3 | - | 13 |
| Phase 3 代理商端 | 10 | 3 | - | 13 |
| Phase 4 达人端 | 7 | 2 | - | 9 |
| Phase 5 AI 流水线 | - | 3 | - | 3 |
| Phase 6 联调测试 | - | - | 4 | 4 |
| **总计** | **30** | **14** | **4** | **48** |

### 8.2 按优先级统计

| 优先级 | 任务数 | 说明 |
| --- | --- | --- |
| P0 | 35 | 核心功能，MVP 必须 |
| P1 | 10 | 首版后快速迭代 |
| P2 | 3 | 中长期规划 |

### 8.3 预估总工时

| 类型 | 工时 |
| --- | --- |
| 前端开发 | ~50 人天 |
| 后端开发 | ~30 人天 |
| 测试 | ~15 人天 |
| **总计** | **~95 人天** |

---

## 9. 现有代码处理建议

### 9.1 可复用的代码

| 模块 | 代码位置 | 状态 | 建议 |
| --- | --- | --- | --- |
| 前端 UI 组件 | `/frontend/components/ui/` | ✅ 可用 | 直接使用 |
| 前端布局组件 | `/frontend/components/layout/` | ⚠️ 需更新 | 更新导航配置 |
| 后端 API 框架 | `/backend/app/` | ✅ 可用 | 直接使用 |
| 后端数据模型 | `/backend/app/models/` | ⚠️ 需扩展 | 新增用户/项目模型 |
| AI 服务 | `/backend/app/services/ai_*.py` | ✅ 可用 | 直接使用 |
| 测试配置 | `vitest.config.ts`, `conftest.py` | ✅ 可用 | 直接使用 |

### 9.2 需要重写的代码

| 模块 | 原因 | 建议 |
| --- | --- | --- |
| 前端路由结构 | 与新设计不完全匹配 | 按设计稿重新组织 |
| 任务状态管理 | 需要支持两阶段审核 | 重新设计状态机 |
| 权限系统 | 缺少完整的角色权限 | 重新实现 |

---

## 10. 下一步行动

### 立即开始 (本周)

1. **FE-003**: 更新 Sidebar 组件导航配置
2. **BE-002**: 完善数据库模型（User/Project/Brief）
3. **BE-003**: 实现认证系统

### 第二周

1. **FE-B01~FE-B06**: 品牌方端核心页面
2. **BE-B01~BE-B03**: 品牌方端 API

### 第三周

1. **FE-A01~FE-A05**: 代理商端核心页面
2. **BE-A01~BE-A02**: 代理商端 API

---

**文档维护者**: Claude
**最后更新**: 2026-02-06
