# TDD 实施评估与计划

> **历史规划说明（2026-02）**：本文档记录项目早期的 TDD 评估和测试建设计划，不是当前实现状态的完整清单。项目后来已经补齐 FastAPI、SQLAlchemy、Alembic、Logto、Celery/Redis、对象存储和 AI 审核流程；当前行为以源码、测试、README 和部署文档为准。文中的“待创建”“未实现”和覆盖率数字均属于当时的基线或计划，不应当作为现状承诺。

| 文档类型 | **TDD Implementation Assessment & Plan (测试驱动开发评估与计划)** |
| --- | --- |
| **项目名称** | 内容卫士 AI 审核平台 (AI 营销内容合规审核平台) |
| **版本号** | V2.0 |
| **发布日期** | 2026-02-03 |
| **关联文档** | tasks.md, DevelopmentPlan.md, FeatureSummary.md |

---

## 执行摘要

本文档对「内容卫士 AI 审核平台」实施 TDD（测试驱动开发）进行全面评估，包含现状诊断、可行性分析、前后端测试策略及具体实施计划。

**核心结论：**
- **TDD 可行性评分：8.2/10** — 强烈推荐实施
- **项目阶段：** 早期评估基线，后端尚未完成，前端组件库已建立
- **最佳时机：** ✅ 适合从核心状态机、权限边界和异步任务开始持续补充 TDD

---

## 目录

1. [项目现状诊断](#1-项目现状诊断)
2. [TDD 可行性分析](#2-tdd-可行性分析)
3. [前端测试策略](#3-前端测试策略)
4. [后端测试策略](#4-后端测试策略)
5. [测试分层与覆盖要求](#5-测试分层与覆盖要求)
6. [工具链配置方案](#6-工具链配置方案)
7. [CI/CD 集成方案](#7-cicd-集成方案)
8. [实施路线图](#8-实施路线图)
9. [风险与应对](#9-风险与应对)
10. [验收标准与成功指标](#10-验收标准与成功指标)

---

## 1. 项目现状诊断

### 1.1 代码库结构

```
/contentguard-ai
├── frontend/                          # 前端代码库
│   ├── components/                    # React 组件库 (12个组件)
│   │   ├── ui/                        # 基础 UI 组件 (7个)
│   │   ├── layout/                    # 布局组件 (2个)
│   │   └── navigation/                # 导航组件 (3个)
│   ├── constants/                     # 常量定义 (3个)
│   ├── styles/                        # 全局样式
│   └── [配置文件]
├── backend/                           # 当时尚未创建，现已成为后端应用目录
├── featuredoc/                        # 文档目录
└── [设计与需求文档]
```

### 1.2 技术栈现状

| 层级 | 技术栈 | 代码状态 | 测试工具状态 |
|------|--------|----------|-------------|
| **前端** | Next.js 14 + React 18 + TypeScript 5.3 | ✅ 组件库已实现 | ✅ Vitest + RTL, 100% 覆盖率 |
| **后端** | FastAPI + Celery + Redis | 评估时为基础框架 | pytest 计划 |
| **数据库** | PostgreSQL + SQLAlchemy + Alembic | 评估时待实现 | 数据库测试计划 |
| **AI 集成** | 可配置的兼容 OpenAI API | 评估时待实现 | AI 服务 mock 计划 |

### 1.3 测试基础设施现状

> ✅ **2026-02-04 更新**：前端测试环境已完整配置，所有组件测试已完成（257 个测试用例，100% 覆盖率）。

| 检查项 | 前端 | 后端 |
|--------|------|------|
| **测试依赖** | ✅ 已安装 (vitest, RTL, coverage-v8) | ✅ 已安装 (pytest, pytest-asyncio, pytest-cov) |
| **配置文件** | ✅ vitest.config.ts 已配置 | ✅ pyproject.toml 已配置 |
| **测试目录** | ✅ 与组件同目录 (*.test.tsx) | ✅ tests/ 目录 |
| **测试文件** | ✅ 12 个测试文件 (257 用例) | ✅ 1 个测试文件 (10 用例) |
| **CI/CD** | ❌ 未配置 | ❌ 未配置 |
| **可直接运行测试** | ✅ 是 (`npm test`) | ✅ 是 (`pytest tests/`) |
| **覆盖率** | ✅ 100% | ✅ 74% (基础 API) |

### 1.4 前端组件清单

| 组件 | 路径 | 复杂度 | 测试状态 | 测试数量 |
|------|------|--------|----------|----------|
| Button | ui/Button.tsx | 🟢 低 | ✅ 100% | 26 |
| Card | ui/Card.tsx | 🟢 低 | ✅ 100% | 24 |
| Input | ui/Input.tsx | 🟡 中 | ✅ 100% | 27 |
| Select | ui/Select.tsx | 🟡 中 | ✅ 100% | 20 |
| Modal | ui/Modal.tsx | 🟠 高 | ✅ 100% | 29 |
| ProgressBar | ui/ProgressBar.tsx | 🟡 中 | ✅ 100% | 36 |
| Tag | ui/Tag.tsx | 🟢 低 | ✅ 100% | 22 |
| Sidebar | navigation/Sidebar.tsx | 🟡 中 | ✅ 100% | 21 |
| BottomNav | navigation/BottomNav.tsx | 🟡 中 | ✅ 100% | 15 |
| StatusBar | navigation/StatusBar.tsx | 🟢 低 | ✅ 100% | 8 |
| DesktopLayout | layout/DesktopLayout.tsx | 🟢 低 | ✅ 100% | 14 |
| MobileLayout | layout/MobileLayout.tsx | 🟡 中 | ✅ 100% | 15 |

**前端组件测试完成度：100%** ✅ (12 组件, 257 测试用例)

---

## 2. TDD 可行性分析

### 2.1 可行性评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **工具链完整性** | 9/10 | Vitest + RTL + Coverage 完整，缺配置文件 |
| **代码可测性** | 8.5/10 | 大部分组件无外部依赖，Modal 需特殊处理 |
| **架构合理性** | 9/10 | 前后端分离清晰，组件职责单一 |
| **文档完善度** | 9/10 | 需求、设计、任务文档完整 |
| **技术债务** | 10/10 | 早期评估时后端尚未展开，当前项目应以实际测试和缺陷清单衡量 |
| **团队准备** | 7/10 | 规划完善，需建立示范代码 |

**历史总体可行性：8.2/10 — 建议持续实施 TDD**

### 2.2 有利因素

| 因素 | 说明 |
|------|------|
| ✅ **新项目优势** | 后端从零开始，可完全按 TDD 流程开发 |
| ✅ **组件无副作用** | 大部分前端组件为纯函数式，Props in → JSX out |
| ✅ **TypeScript 严格模式** | 类型安全，便于生成测试 fixtures |
| ✅ **清晰的接口定义** | 所有组件 Props 有完整类型定义 |
| ✅ **测试依赖已声明** | Vitest + RTL 已在 package.json 中（需创建配置文件后方可运行） |
| ✅ **路径别名完整** | @/components 等别名便于 import 和 mock |

### 2.3 挑战与应对

| 挑战 | 风险等级 | 应对策略 |
|------|---------|---------|
| AI 模型 API mock | 🔴 高 | 建立统一的 AI Mock 库 + 标注测试集 |
| Celery 异步任务测试 | 🔴 高 | 使用 celery.contrib.testing + eager 模式 |
| WebSocket 实时测试 | 🟡 中 | 使用 socket.io-client mock + 事件模拟 |
| pgvector 向量检索 | 🟡 中 | 使用 testcontainers 运行真实 PostgreSQL |
| Modal 副作用清理 | 🟢 低 | RTL render + act() + cleanup 验证 |

---

## 3. 前端测试策略

### 3.1 测试金字塔

```
                    ┌─────────┐
                    │   E2E   │  ← Playwright (核心用户路径)
                   /│  Tests  │\
                  / └─────────┘ \
                 /       5%      \
                /  ┌───────────┐  \
               /   │Integration│   \  ← 组件组合测试
              /    │   Tests   │    \
             /     └───────────┘     \
            /           15%           \
           /    ┌─────────────────┐    \
          /     │   Unit Tests    │     \  ← Vitest + RTL
         /      │  (Components)   │      \
        /       └─────────────────┘       \
       /               80%                 \
      └─────────────────────────────────────┘
```

### 3.2 前端测试类型

#### 3.2.1 单元测试（Unit Tests）

**目标：** 验证单个组件的渲染、props 响应、事件处理

**工具：** Vitest + React Testing Library

**覆盖范围：**
- 所有 UI 基础组件（Button, Card, Input, Select, Modal, ProgressBar, Tag）
- 所有导航组件（Sidebar, BottomNav, StatusBar）
- 所有布局组件（DesktopLayout, MobileLayout）
- 常量模块（colors, icons）

**测试模式：**
```typescript
// 基础渲染测试
it('renders with correct variant', () => {
  render(<Button variant="primary">Click</Button>);
  expect(screen.getByRole('button')).toHaveClass('bg-accent-indigo');
});

// Props 响应测试
it('shows loading state when loading prop is true', () => {
  render(<Button loading>Submit</Button>);
  expect(screen.getByRole('button')).toBeDisabled();
});

// 事件处理测试
it('calls onClick when clicked', () => {
  const handleClick = vi.fn();
  render(<Button onClick={handleClick}>Click</Button>);
  fireEvent.click(screen.getByRole('button'));
  expect(handleClick).toHaveBeenCalledTimes(1);
});
```

#### 3.2.2 组件集成测试（Integration Tests）

**目标：** 验证组件组合行为、状态传递、用户交互流程

**工具：** Vitest + RTL + MSW (Mock Service Worker)

**覆盖范围：**
- 表单组件组合（Input + Select + Button）
- 布局组件嵌套（Layout + Sidebar + Content）
- 模态框交互流程（触发 → 显示 → 关闭）
- 导航状态同步（Sidebar active state）

**测试模式：**
```typescript
// 表单提交流程
it('submits form with correct data', async () => {
  render(<ReviewForm onSubmit={mockSubmit} />);

  await userEvent.type(screen.getByLabelText('标题'), '测试视频');
  await userEvent.selectOptions(screen.getByLabelText('类型'), 'video');
  await userEvent.click(screen.getByRole('button', { name: '提交' }));

  expect(mockSubmit).toHaveBeenCalledWith({
    title: '测试视频',
    type: 'video'
  });
});
```

#### 3.2.3 E2E 测试（End-to-End Tests）

**目标：** 验证完整用户路径、跨页面交互、真实 API 集成

**工具：** Playwright

**覆盖范围：**
- 用户登录 → 任务列表 → 任务详情 → 上传脚本 → AI预审 → 代理商/品牌复核 → 上传视频 → 查看审核结果
- 代理商审核流程（待审核列表 → 审核详情 → 通过/拒绝 → 驳回回到脚本上传）
- 品牌方终审流程（终审列表 → 审核 → 通过/驳回 → 驳回回到脚本上传）
- Brief 上传与解析流程
- AI 配置修改流程

**测试模式：**
```typescript
// 脚本上传到审核完成的完整流程
test('creator uploads script and receives review result', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name="email"]', 'creator@test.com');
  await page.fill('[name="password"]', 'password123');
  await page.click('button[type="submit"]');

  await page.goto('/tasks');
  await page.click('a:has-text("查看详情")');
  await page.setInputFiles('input[type="file"]', 'fixtures/test-script.docx');
  await page.click('button:has-text("提交脚本")');

  // 等待脚本 AI 预审完成（WebSocket 推送）
  await expect(page.locator('.review-status')).toHaveText('AI预审完成', { timeout: 60000 });

  // 验证审核报告
  await page.click('button:has-text("查看报告")');
  await expect(page.locator('.report-summary')).toBeVisible();
});
```

### 3.3 前端测试自动化方案

#### 3.3.1 测试文件组织

```
frontend/
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx          # 组件同级测试文件
│   │   ├── Card.tsx
│   │   ├── Card.test.tsx
│   │   └── ...
│   └── __tests__/                   # 集成测试目录
│       ├── forms.integration.test.tsx
│       └── navigation.integration.test.tsx
├── e2e/                             # E2E 测试目录
│   ├── auth.spec.ts
│   ├── upload.spec.ts
│   └── review.spec.ts
├── __mocks__/                       # Mock 文件目录
│   ├── api.ts
│   ├── socket.ts
│   └── uppy.ts
└── vitest.config.ts
```

#### 3.3.2 自动化执行策略

| 触发时机 | 执行测试 | 超时限制 | 阻断条件 |
|---------|---------|---------|---------|
| 文件保存 | 相关单元测试 | 10s | 无 |
| git commit | 全部单元测试 | 2min | 失败则阻止提交 |
| PR 创建 | 单元 + 集成测试 | 5min | 失败则阻止合并 |
| PR 合并到 main | 全部测试 + E2E | 15min | 失败则回滚 |
| 每日定时 | E2E 全量回归 | 30min | 报告告警 |

### 3.4 特殊组件测试策略

#### 3.4.1 Modal 组件（副作用处理）

```typescript
import { render, screen, fireEvent, act } from '@testing-library/react';

describe('Modal', () => {
  afterEach(() => {
    // 验证副作用清理
    expect(document.body.style.overflow).toBe('');
  });

  it('locks body scroll when open', () => {
    render(<Modal isOpen={true} onClose={vi.fn()}>Content</Modal>);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on ESC key press', async () => {
    const onClose = vi.fn();
    render(<Modal isOpen={true} onClose={onClose}>Content</Modal>);

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('removes event listeners on unmount', () => {
    const { unmount } = render(<Modal isOpen={true} onClose={vi.fn()}>Content</Modal>);
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
```

#### 3.4.2 forwardRef 组件（Input, Select）

```typescript
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';

describe('Input with ref', () => {
  it('forwards ref to input element', () => {
    const TestComponent = () => {
      const inputRef = useRef<HTMLInputElement>(null);
      return (
        <>
          <Input ref={inputRef} placeholder="test" />
          <button onClick={() => inputRef.current?.focus()}>Focus</button>
        </>
      );
    };

    render(<TestComponent />);
    fireEvent.click(screen.getByText('Focus'));
    expect(screen.getByPlaceholderText('test')).toHaveFocus();
  });
});
```

#### 3.4.3 ProgressBar（数学计算验证）

```typescript
describe('ProgressBar', () => {
  it('calculates width percentage correctly', () => {
    const { container } = render(<ProgressBar value={75} max={100} />);
    const progressFill = container.querySelector('.progress-fill');
    expect(progressFill).toHaveStyle({ width: '75%' });
  });

  it('handles edge cases', () => {
    // 0%
    const { rerender, container } = render(<ProgressBar value={0} max={100} />);
    expect(container.querySelector('.progress-fill')).toHaveStyle({ width: '0%' });

    // 100%
    rerender(<ProgressBar value={100} max={100} />);
    expect(container.querySelector('.progress-fill')).toHaveStyle({ width: '100%' });

    // 超过 100%（应该限制在 100%）
    rerender(<ProgressBar value={150} max={100} />);
    expect(container.querySelector('.progress-fill')).toHaveStyle({ width: '100%' });
  });
});
```

---

## 4. 后端测试策略

### 4.1 测试金字塔

```
                    ┌─────────┐
                    │   E2E   │  ← API 全流程测试
                   /│  Tests  │\
                  / └─────────┘ \
                 /       5%      \
                /  ┌───────────┐  \
               /   │Integration│   \  ← 数据库 + 外部服务
              /    │   Tests   │    \
             /     └───────────┘     \
            /           20%           \
           /    ┌─────────────────┐    \
          /     │   Unit Tests    │     \  ← 业务逻辑
         /      │                 │      \
        /       └─────────────────┘       \
       /               75%                 \
      └─────────────────────────────────────┘
```

### 4.2 后端测试类型

#### 4.2.1 单元测试（Unit Tests）

**目标：** 验证纯业务逻辑函数、数据转换、规则引擎

**工具：** pytest + pytest-asyncio

**覆盖范围：**
- Brief 解析规则提取逻辑
- 违禁词匹配算法
- 语境理解判断逻辑
- 时间戳对齐算法
- 审核状态机
- 权限校验逻辑

**测试模式：**
```python
# tests/unit/test_brief_parser.py
import pytest
from app.services.brief_parser import extract_rules

class TestBriefParser:
    def test_extract_forbidden_words(self):
        """从 Brief 中提取违禁词列表"""
        brief_text = "禁止出现：竞品A、竞品B、敏感词C"
        rules = extract_rules(brief_text)

        assert "竞品A" in rules.forbidden_words
        assert "竞品B" in rules.forbidden_words
        assert "敏感词C" in rules.forbidden_words

    def test_extract_duration_requirement(self):
        """从 Brief 中提取时长要求"""
        brief_text = "视频时长要求：30秒-60秒"
        rules = extract_rules(brief_text)

        assert rules.min_duration == 30
        assert rules.max_duration == 60

    @pytest.mark.parametrize("input_text,expected", [
        ("必须出现品牌 Logo", True),
        ("建议出现品牌 Logo", False),
        ("", False),
    ])
    def test_detect_logo_requirement(self, input_text, expected):
        """检测是否有 Logo 强制要求"""
        rules = extract_rules(input_text)
        assert rules.logo_required == expected
```

#### 4.2.2 接口测试（API Tests）

**目标：** 验证 API 契约、请求/响应格式、错误处理、认证授权

**工具：** pytest + httpx + pytest-asyncio

**覆盖范围：**
- 所有 P0 API 接口 100% 覆盖
- 认证流程（登录、刷新 token、登出）
- 文件上传接口
- 审核提交与结果查询接口
- AI 配置接口
- WebSocket 连接与消息格式

**测试模式：**
```python
# tests/api/test_review_api.py
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac

@pytest.fixture
async def auth_headers(client):
    """获取认证 token"""
    response = await client.post("/api/auth/login", json={
        "email": "test@example.com",
        "password": "password123"
    })
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

class TestReviewAPI:
    async def test_submit_review_success(self, client, auth_headers):
        """提交审核请求成功"""
        response = await client.post(
            "/api/reviews",
            headers=auth_headers,
            json={
                "video_url": "https://example.com/video.mp4",
                "brief_id": "brief-123"
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert "review_id" in data
        assert data["status"] == "pending"

    async def test_submit_review_unauthorized(self, client):
        """未认证用户提交审核应返回 401"""
        response = await client.post("/api/reviews", json={
            "video_url": "https://example.com/video.mp4"
        })

        assert response.status_code == 401

    async def test_submit_review_invalid_video_format(self, client, auth_headers):
        """提交不支持的视频格式应返回 400"""
        response = await client.post(
            "/api/reviews",
            headers=auth_headers,
            json={
                "video_url": "https://example.com/video.exe",
                "brief_id": "brief-123"
            }
        )

        assert response.status_code == 400
        assert "不支持的视频格式" in response.json()["detail"]
```

#### 4.2.3 集成测试（Integration Tests）

**目标：** 验证服务间协作、数据库操作、外部 API 调用、异步任务

**工具：** pytest + testcontainers + celery.contrib.testing

**覆盖范围：**
- 数据库 CRUD 操作
- Redis 缓存与消息队列
- Celery 任务链执行
- AI 模型 API 调用（mock）
- 文件存储（OSS/S3 mock）

**测试模式：**
```python
# tests/integration/test_review_pipeline.py
import pytest
from testcontainers.postgres import PostgresContainer
from app.services.review_pipeline import ReviewPipeline
from app.models import Review, ReviewStatus
from unittest.mock import AsyncMock, patch

@pytest.fixture(scope="module")
def postgres():
    with PostgresContainer("postgres:14") as postgres:
        yield postgres

class TestReviewPipeline:
    @patch("app.services.ai_client.AIClient.analyze_video")
    async def test_full_pipeline_execution(self, mock_ai, postgres):
        """完整审核流水线执行测试"""
        # 配置 AI mock 返回
        mock_ai.return_value = {
            "violations": [],
            "score": 95,
            "summary": "内容合规"
        }

        pipeline = ReviewPipeline(db_url=postgres.get_connection_url())

        # 提交审核
        review_id = await pipeline.submit(
            video_url="https://example.com/test.mp4",
            brief_id="brief-123",
            user_id="user-456"
        )

        # 执行审核
        await pipeline.execute(review_id)

        # 验证结果
        review = await pipeline.get_result(review_id)
        assert review.status == ReviewStatus.COMPLETED
        assert review.score == 95
        assert len(review.violations) == 0
```

#### 4.2.4 AI 模型测试

**目标：** 验证 AI 模型封装、Prompt 模板、规则验证、回归测试

**工具：** pytest + 标注测试集 + golden files

**覆盖范围：**
- P0 规则样本覆盖 ≥ 90%
- P1 规则样本覆盖 ≥ 70%
- 回归测试集 100% 通过
- Prompt 模板渲染正确性

**测试模式：**
```python
# tests/ai/test_violation_detection.py
import pytest
import json
from pathlib import Path
from app.services.ai_analyzer import ViolationDetector

# 加载标注测试集
FIXTURES_DIR = Path(__file__).parent / "fixtures"
with open(FIXTURES_DIR / "violation_cases.json") as f:
    VIOLATION_CASES = json.load(f)

class TestViolationDetection:
    @pytest.fixture
    def detector(self):
        return ViolationDetector(model="mock")

    @pytest.mark.parametrize("case", VIOLATION_CASES["p0_rules"])
    def test_p0_violation_detection(self, detector, case):
        """P0 规则违规检测测试"""
        result = detector.detect(
            text=case["input_text"],
            rules=case["rules"]
        )

        assert result.has_violation == case["expected_violation"]
        if case["expected_violation"]:
            assert case["expected_type"] in [v.type for v in result.violations]

    @pytest.mark.parametrize("case", VIOLATION_CASES["context_understanding"])
    def test_context_understanding(self, detector, case):
        """语境理解测试（避免误报）"""
        result = detector.detect(
            text=case["input_text"],
            rules=case["rules"],
            context=case.get("context")
        )

        # 验证语境理解能力，不应误报
        assert result.has_violation == case["expected_violation"]
        assert result.false_positive_rate <= 0.05  # ≤ 5% 误报率

    def test_regression_suite(self, detector):
        """回归测试套件"""
        with open(FIXTURES_DIR / "regression_cases.json") as f:
            regression_cases = json.load(f)

        for case in regression_cases:
            result = detector.detect(
                text=case["input_text"],
                rules=case["rules"]
            )
            assert result.has_violation == case["expected"], \
                f"Regression failed for case: {case['id']}"
```

### 4.3 Mock 策略

#### 4.3.1 AI API Mock

```python
# tests/mocks/ai_mock.py
from unittest.mock import AsyncMock
import json
from pathlib import Path

class AIMockFactory:
    """AI API Mock 工厂"""

    FIXTURES = Path(__file__).parent / "fixtures"

    @classmethod
    def create_doubao_mock(cls) -> AsyncMock:
        """创建豆包 API mock"""
        mock = AsyncMock()
        mock.chat.completions.create.return_value = cls._load_response("doubao_response.json")
        return mock

    @classmethod
    def create_qwen_mock(cls) -> AsyncMock:
        """创建通义千问 API mock"""
        mock = AsyncMock()
        mock.chat.completions.create.return_value = cls._load_response("qwen_response.json")
        return mock

    @classmethod
    def _load_response(cls, filename: str):
        with open(cls.FIXTURES / filename) as f:
            return json.load(f)

# 使用示例
@pytest.fixture
def mock_ai_client():
    with patch("app.services.ai_client.get_client") as mock:
        mock.return_value = AIMockFactory.create_doubao_mock()
        yield mock
```

#### 4.3.2 Celery 任务 Mock

```python
# tests/conftest.py
import pytest
from celery.contrib.testing.app import TestApp
from celery.contrib.testing.worker import start_worker

@pytest.fixture(scope="module")
def celery_app():
    """创建测试用 Celery 应用"""
    app = TestApp()
    app.conf.update(
        task_always_eager=True,  # 同步执行任务
        task_eager_propagates=True,
    )
    return app

@pytest.fixture
def celery_worker(celery_app):
    """启动测试 worker"""
    with start_worker(celery_app, perform_ping_check=False) as worker:
        yield worker
```

---

## 5. 测试分层与覆盖要求

### 5.1 覆盖率目标

| 层级 | 目标 | 工具 | 覆盖要求 | 门槛策略 |
|------|------|------|---------|---------|
| **前端单元测试** | 组件渲染与交互 | Vitest + RTL | ≥ 70% | PR 阻断 |
| **前端集成测试** | 组件组合行为 | Vitest + RTL | 关键流程 100% | PR 阻断 |
| **前端 E2E** | 用户路径 | Playwright | 核心路径覆盖 | 定时回归 |
| **后端单元测试** | 业务逻辑 | pytest | ≥ 80% | PR 阻断 |
| **后端接口测试** | API 契约 | pytest + httpx | P0 接口 100% | PR 阻断 |
| **后端集成测试** | 服务协作 | pytest + testcontainers | 关键链路 100% | PR 阻断 |
| **AI 模型测试** | 规则验证 | pytest + 标注集 | P0 ≥ 90%, P1 ≥ 70%, 回归 100% | PR 阻断 |

### 5.2 覆盖率豁免

以下代码可豁免覆盖率检查：

```python
# pytest 配置
[tool.coverage.run]
omit = [
    "*/migrations/*",           # 数据库迁移脚本
    "*/__init__.py",            # 空初始化文件
    "*/tests/*",                # 测试代码本身
    "*/conftest.py",            # pytest 配置
    "*/main.py",                # 入口文件（仅启动逻辑）
]
```

```typescript
// vitest 配置
coverage: {
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/*.d.ts',
    '**/types/**',
    '**/index.ts',  // 仅导出的聚合文件
  ]
}
```

---

## 6. 工具链配置方案

> 📋 **历史模板**：本章配置用于当时的测试建设规划；当前前后端配置和 CI 状态以仓库实际文件为准。

### 6.1 前端配置

> 前端目录 `frontend/` 已存在，测试配置文件已创建完成（vitest.config.ts, vitest.setup.ts）。

#### 6.1.1 vitest.config.ts ✅ 已创建

```typescript
// frontend/vitest.config.ts  [已创建]
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
      exclude: [
        '**/node_modules/**',
        '**/*.d.ts',
        '**/types/**',
        '**/index.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@/components': path.resolve(__dirname, './components'),
      '@/constants': path.resolve(__dirname, './constants'),
      '@/styles': path.resolve(__dirname, './styles'),
      '@/lib': path.resolve(__dirname, './lib'),
      '@/hooks': path.resolve(__dirname, './hooks'),
      '@/types': path.resolve(__dirname, './types'),
    },
  },
});
```

#### 6.1.2 vitest.setup.ts ✅ 已创建

```typescript
// frontend/vitest.setup.ts  [已创建]
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// 每个测试后自动清理
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
```

#### 6.1.3 Playwright 配置 （待创建）

```typescript
// frontend/playwright.config.ts  [待创建]
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'playwright-report.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### 6.2 后端配置

> ✅ **2026-02-04 更新**：后端基础框架已创建，测试配置在 `pyproject.toml` 中。

#### 6.2.1 pytest 配置 ✅ 已创建

```ini
# backend/pyproject.toml [tool.pytest.ini_options] 已创建
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
asyncio_mode = auto
addopts =
    -v
    --tb=short
    --strict-markers
    --cov=app
    --cov-report=term-missing
    --cov-report=html:coverage_html
    --cov-report=xml:coverage.xml
    --cov-fail-under=80
markers =
    slow: marks tests as slow (deselect with '-m "not slow"')
    integration: marks tests as integration tests
    e2e: marks tests as end-to-end tests
filterwarnings =
    ignore::DeprecationWarning
```

#### 6.2.2 conftest.py ✅ 已创建

```python
# backend/tests/conftest.py  [已创建]
import pytest
import asyncio
from typing import AsyncGenerator
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db
from app.config import settings

# 测试数据库 URL
TEST_DATABASE_URL = "postgresql+asyncpg://test:test@localhost:5432/test_db"

@pytest.fixture(scope="session")
def event_loop():
    """创建事件循环"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="session")
async def engine():
    """创建测试数据库引擎"""
    engine = create_async_engine(TEST_DATABASE_URL, echo=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()

@pytest.fixture
async def db_session(engine) -> AsyncGenerator[AsyncSession, None]:
    """创建数据库会话"""
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session() as session:
        yield session
        await session.rollback()

@pytest.fixture
async def client(db_session) -> AsyncGenerator[AsyncClient, None]:
    """创建测试客户端"""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()

@pytest.fixture
def mock_ai_response():
    """AI 响应 mock 数据"""
    return {
        "violations": [],
        "score": 95,
        "summary": "内容合规",
        "details": {
            "forbidden_words": [],
            "logo_detected": True,
            "duration_valid": True,
        }
    }
```

#### 6.2.3 pyproject.toml ✅ 已创建

```toml
# backend/pyproject.toml  [已创建]
[tool.poetry]
name = "contentguard-backend"
version = "1.0.0"
description = "内容卫士 AI 审核平台后端服务"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.109.0"
uvicorn = "^0.27.0"
celery = "^5.3.0"
redis = "^5.0.0"
sqlalchemy = "^2.0.0"
asyncpg = "^0.29.0"
httpx = "^0.26.0"
pydantic = "^2.5.0"
python-jose = "^3.3.0"
passlib = "^1.7.4"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0.0"
pytest-asyncio = "^0.23.0"
pytest-cov = "^4.1.0"
httpx = "^0.26.0"
testcontainers = "^3.7.0"
factory-boy = "^3.3.0"
faker = "^22.0.0"
respx = "^0.20.0"

[tool.coverage.run]
source = ["app"]
branch = true
omit = [
    "*/migrations/*",
    "*/__init__.py",
    "*/tests/*",
]

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "raise NotImplementedError",
    "if TYPE_CHECKING:",
]
```

---

## 7. CI/CD 集成方案

> 📋 **模板文件**：以下 GitHub Actions 工作流为**待创建模板**，`.github/workflows/` 目录当前不存在。
> 在执行 TASK-005-C（CI/CD 配置）时，需按此模板创建对应文件。

### 7.0 前置条件：Codecov 配置

> ⚠️ **必须先完成**：工作流中使用了 `fail_ci_if_error: true`，如果未配置 Codecov，CI 会直接失败。

**配置步骤：**

1. **注册 Codecov 账号**
   - 访问 https://codecov.io
   - 使用 GitHub 账号登录

2. **添加仓库**
   - 在 Codecov Dashboard 中点击 "Add Repository"
   - 选择本项目仓库并授权

3. **获取 Upload Token**（私有仓库必需）
   - 进入仓库设置页：`https://codecov.io/gh/{owner}/{repo}/settings`
   - 复制 "Repository Upload Token"

4. **配置 GitHub Secrets**
   ```bash
   # 方式一：GitHub Web UI
   # 仓库 → Settings → Secrets and variables → Actions → New repository secret
   # Name: CODECOV_TOKEN
   # Value: <粘贴上一步的 token>

   # 方式二：GitHub CLI
   gh secret set CODECOV_TOKEN --body "<your-token>"
   ```

5. **更新工作流**（可选，公开仓库可跳过）
   ```yaml
   - name: Upload coverage to Codecov
     uses: codecov/codecov-action@v3
     with:
       token: ${{ secrets.CODECOV_TOKEN }}  # 添加此行
       files: ./frontend/coverage/lcov.info
       flags: frontend
       fail_ci_if_error: true
   ```

**如果暂不使用 Codecov：** 将 `fail_ci_if_error: true` 改为 `false`，CI 不会因覆盖率上传失败而阻断。

---

### 7.1 GitHub Actions 工作流

#### 7.1.1 前端测试工作流 （待创建）

```yaml
# .github/workflows/frontend-test.yml  [待创建]
name: Frontend Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'frontend/**'
  pull_request:
    branches: [main, develop]
    paths:
      - 'frontend/**'

jobs:
  unit-test:
    name: Unit & Integration Tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ./frontend

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type check
        run: npm run type-check

      - name: Run unit tests
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}  # 见 7.0 配置说明
          files: ./frontend/coverage/lcov.info
          flags: frontend
          fail_ci_if_error: true  # 未配置 token 时改为 false

  e2e-test:
    name: E2E Tests
    runs-on: ubuntu-latest
    needs: unit-test
    defaults:
      run:
        working-directory: ./frontend

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 7
```

#### 7.1.2 后端测试工作流 （待创建）

```yaml
# .github/workflows/backend-test.yml  [待创建]
name: Backend Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'backend/**'
  pull_request:
    branches: [main, develop]
    paths:
      - 'backend/**'

jobs:
  test:
    name: Unit & Integration Tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ./backend

    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Poetry
        uses: snok/install-poetry@v1
        with:
          version: 1.7.0
          virtualenvs-create: true
          virtualenvs-in-project: true

      - name: Load cached venv
        id: cached-poetry-dependencies
        uses: actions/cache@v3
        with:
          path: backend/.venv
          key: venv-${{ runner.os }}-${{ hashFiles('**/poetry.lock') }}

      - name: Install dependencies
        if: steps.cached-poetry-dependencies.outputs.cache-hit != 'true'
        run: poetry install --no-interaction --no-root

      - name: Run linter
        run: poetry run ruff check .

      - name: Run type check
        run: poetry run mypy app

      - name: Run tests
        env:
          DATABASE_URL: postgresql+asyncpg://test:test@localhost:5432/test_db
          REDIS_URL: redis://localhost:6379/0
        run: poetry run pytest --cov-report=xml

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}  # 见 7.0 配置说明
          files: ./backend/coverage.xml
          flags: backend
          fail_ci_if_error: true  # 未配置 token 时改为 false
```

### 7.2 PR 检查配置（分支保护规则）

> ⚠️ **重要提示**：GitHub 分支保护规则**不能**通过配置文件自动生效，必须执行配置脚本或手动配置。

#### 方式一：自动化脚本（推荐）

项目提供了一键配置脚本，自动完成所有 GitHub 设置：

```bash
# 运行 GitHub 配置脚本
./scripts/setup-github.sh
```

**脚本功能：**
- ✅ 检查 GitHub CLI 安装和登录状态
- ✅ 自动配置分支保护规则
- ✅ 设置必需的状态检查（CI 通过才能合并）
- ✅ 设置必需的 PR 审批（至少 1 人）
- ✅ 启用合并后自动删除分支
- ✅ 验证配置是否生效

**前置条件：**
```bash
# 1. 安装 GitHub CLI
brew install gh          # macOS
sudo apt install gh      # Ubuntu

# 2. 登录 GitHub
gh auth login

# 3. 运行配置脚本
./scripts/setup-github.sh
```

#### 方式二：GitHub Web UI（备选）

如果脚本执行失败（如免费版 GitHub 不支持 API 配置），可手动配置：

1. 进入仓库 → **Settings** → **Branches**
2. 点击 **Add branch protection rule**
3. 配置以下选项：

| 配置项 | 设置值 |
|--------|--------|
| Branch name pattern | `main` |
| ✅ Require a pull request before merging | 启用 |
| ✅ Require approvals | 1 |
| ✅ Require status checks to pass before merging | 启用 |
| ✅ Require branches to be up to date before merging | 启用 |
| Status checks that are required | `Frontend Tests / Unit & Integration Tests`<br>`Backend Tests / Unit & Integration Tests` |

### 7.3 覆盖率报告配置 （待创建）

```yaml
# codecov.yml  [待创建]
coverage:
  precision: 2
  round: down
  range: "70...100"
  status:
    project:
      default:
        target: auto
        threshold: 1%
    patch:
      default:
        target: 80%
        threshold: 1%

flags:
  frontend:
    paths:
      - frontend/
    carryforward: true
  backend:
    paths:
      - backend/
    carryforward: true

comment:
  layout: "reach,diff,flags,files"
  behavior: default
  require_changes: true
```

---

## 8. 实施路线图

### 8.1 阶段划分

```
Phase 1: 基础设施搭建 (Week 1)
├── 配置文件创建
├── CI/CD 流水线
├── 测试示范代码
└── 团队培训

Phase 2: 前端 TDD (Week 2-3)
├── UI 组件测试
├── 导航组件测试
├── 布局组件测试
└── 集成测试

Phase 3: 后端 TDD - 基础模块 (Week 4-5)
├── 认证授权测试
├── 数据库操作测试
├── API 框架测试
└── 文件上传测试

Phase 4: 后端 TDD - 核心业务 (Week 6-9)
├── Brief 解析测试
├── 脚本预审测试
├── 视频审核流水线测试
└── AI 模型集成测试

Phase 5: E2E 与回归 (Week 10-11)
├── 核心用户路径 E2E
├── 回归测试套件
├── 性能测试
└── 上线前验收
```

### 8.2 详细任务分解

#### Phase 1: 基础设施搭建 (Week 1)

| 任务 | 产出物 | 预估工时 | 状态 |
|------|--------|---------|------|
| 创建 vitest.config.ts | 配置文件 | 2h | ✅ 完成 |
| 创建 vitest.setup.ts | 测试环境配置 | 2h | ✅ 完成 |
| 创建 playwright.config.ts | E2E 配置 | 2h | ⏳ 待完成 |
| 创建 pytest.ini | 后端测试配置 | 2h | ✅ 完成 (pyproject.toml) |
| 创建 conftest.py | 测试 fixtures | 4h | ✅ 完成 |
| 配置 GitHub Actions - 前端 | CI/CD 流水线 | 4h | ⏳ 待完成 |
| 配置 GitHub Actions - 后端 | CI/CD 流水线 | 4h | ⏳ 待完成 |
| 配置 Codecov | 覆盖率报告 | 2h | ⏳ 待完成 |
| 编写 Button.test.tsx 示范 | 测试示范代码 | 4h | ✅ 完成 |
| 编写 Modal.test.tsx 示范 | 副作用测试示范 | 4h | ✅ 完成 |
| 团队 TDD 培训 | 培训材料 | 8h | ⏳ 待完成 |

**Phase 1 进度：前端配置完成，CI/CD 待配置**

#### Phase 2: 前端 TDD (Week 2-3) ✅ 已完成

| 任务 | 测试文件 | 测试数量 | 状态 |
|------|---------|----------|------|
| Button 组件测试 | Button.test.tsx | 26 | ✅ 完成 |
| Card 组件测试 | Card.test.tsx | 24 | ✅ 完成 |
| Input 组件测试 | Input.test.tsx | 27 | ✅ 完成 |
| Select 组件测试 | Select.test.tsx | 20 | ✅ 完成 |
| Modal 组件测试 | Modal.test.tsx | 29 | ✅ 完成 |
| ProgressBar 组件测试 | ProgressBar.test.tsx | 36 | ✅ 完成 |
| Tag 组件测试 | Tag.test.tsx | 22 | ✅ 完成 |
| Sidebar 组件测试 | Sidebar.test.tsx | 21 | ✅ 完成 |
| BottomNav 组件测试 | BottomNav.test.tsx | 15 | ✅ 完成 |
| StatusBar 组件测试 | StatusBar.test.tsx | 8 | ✅ 完成 |
| Layout 组件测试 | DesktopLayout.test.tsx + MobileLayout.test.tsx | 29 | ✅ 完成 |
| 常量模块测试 | - | - | ⏭️ 跳过 (纯静态常量) |
| 表单集成测试 | forms.integration.test.tsx | - | ⏳ 待完成 |
| 导航集成测试 | navigation.integration.test.tsx | - | ⏳ 待完成 |

**Phase 2 结果：257 个单元测试通过，100% 覆盖率**

#### Phase 3-5: 后端 TDD (Week 4-11)

详见 `tasks.md` 中的后端开发任务，每个任务均需遵循 TDD 流程。

---

## 9. 风险与应对

### 9.1 技术风险

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| AI API 响应不稳定导致测试波动 | 高 | 高 | 使用确定性 mock + golden files |
| 异步任务测试复杂度高 | 高 | 中 | 使用 eager 模式 + 任务链 mock |
| E2E 测试运行时间过长 | 中 | 中 | 并行执行 + 关键路径优先 |
| 覆盖率目标难以达成 | 中 | 低 | 分阶段提升目标，先 60% 再 80% |
| 测试代码维护成本高 | 中 | 中 | 建立测试工具库 + 定期重构 |

### 9.2 团队风险

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| 团队缺乏 TDD 经验 | 高 | 高 | 先期培训 + Pair Programming |
| 赶进度跳过测试 | 高 | 高 | CI 强制检查 + 代码审查 |
| 测试质量参差不齐 | 中 | 中 | 建立测试规范 + 示范代码库 |

### 9.3 应急预案

1. **覆盖率低于门槛**：临时下调门槛，记录技术债务，安排补测 Sprint
2. **CI 流水线阻塞**：建立临时绕过机制（需 Tech Lead 审批）
3. **E2E 环境不稳定**：降级为 API 集成测试，后续修复环境

---

## 10. 验收标准与成功指标

### 10.1 TDD 实施验收标准

| 阶段 | 验收标准 | 验收方式 | 状态 |
|------|---------|---------|------|
| Phase 1 完成 | CI/CD 流水线可运行，测试示范通过 | Demo 演示 | ⏳ CI/CD 待配置 |
| Phase 2 完成 | 前端覆盖率 ≥ 70%，所有组件有测试 | 覆盖率报告 | ✅ 100% 覆盖率 |
| Phase 3-4 完成 | 后端覆盖率 ≥ 80%，P0 API 100% 覆盖 | 覆盖率报告 | 🔄 进行中 (基础 74%) |
| Phase 5 完成 | E2E 核心路径通过，回归测试 100% | 测试报告 | ⏳ 待开始 |

### 10.2 长期成功指标

| 指标 | 目标值 | 测量方式 |
|------|--------|---------|
| **前端覆盖率** | ≥ 70% | Codecov 报告 |
| **后端覆盖率** | ≥ 80% | Codecov 报告 |
| **P0 API 测试覆盖** | 100% | 接口清单核对 |
| **AI 规则 P0 覆盖** | ≥ 90% | 标注集验证 |
| **AI 规则 P1 覆盖** | ≥ 70% | 标注集验证 |
| **回归测试通过率** | 100% | 回归测试套件 |
| **CI 成功率** | ≥ 95% | GitHub Actions 统计 |
| **上线后回归缺陷** | ≤ 2% | QA 缺陷统计 |
| **开发周期缩短** | 30% | 与历史项目对比 |

### 10.3 TDD 统一约定

- 每个任务必须包含：
  - 至少 1 个失败测试用例（先写）
  - 核心成功路径测试
  - 关键异常路径测试
- 合并前需满足：
  - 测试全部通过
  - 覆盖率达标
  - 关键路径无回归
- 任务完成即具备可运行测试与最小化覆盖
- 关键功能（如审核台、AI 配置、上传链路）必须包含 E2E 测试

---

## 附录 A：测试命名规范

### 前端测试命名

```typescript
// 文件命名：[ComponentName].test.tsx
// 例如：Button.test.tsx, Modal.test.tsx

// 测试套件命名：describe('[ComponentName]', ...)
// 例如：describe('Button', ...)

// 测试用例命名：it('[动作] when [条件]', ...)
// 例如：
it('renders primary variant when variant prop is primary', ...)
it('calls onClick when button is clicked', ...)
it('shows loading spinner when loading is true', ...)
it('disables button when disabled prop is true', ...)
```

### 后端测试命名

```python
# 文件命名：test_[module_name].py
# 例如：test_brief_parser.py, test_review_api.py

# 测试类命名：class Test[FeatureName]:
# 例如：class TestBriefParser:, class TestReviewAPI:

# 测试方法命名：def test_[行为]_[条件]():
# 例如：
def test_extract_forbidden_words_from_brief():
def test_submit_review_returns_401_when_unauthorized():
def test_detect_violation_when_forbidden_word_present():
```

---

## 附录 B：测试数据管理

### B.1 Fixtures 目录结构

```
tests/
├── fixtures/
│   ├── videos/                    # 测试视频文件
│   │   ├── valid_video.mp4
│   │   ├── invalid_format.avi
│   │   └── oversized_video.mp4
│   ├── briefs/                    # Brief 测试数据
│   │   ├── standard_brief.pdf
│   │   └── complex_brief.pdf
│   ├── ai_responses/              # AI API 响应 mock
│   │   ├── doubao_response.json
│   │   ├── qwen_response.json
│   │   └── error_response.json
│   ├── violation_cases.json       # 违规检测测试集
│   └── regression_cases.json      # 回归测试集
```

### B.2 Golden Files 管理

```python
# 使用 golden files 进行 AI 输出验证
def test_ai_analysis_output(snapshot):
    result = ai_analyzer.analyze(test_video)
    snapshot.assert_match(result.to_json(), "ai_analysis_output.json")
```

---

## 附录 C：变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|---------|--------|
| V1.0 | 2026-02-03 | 初始版本，基础 TDD 框架 | - |
| V2.0 | 2026-02-03 | 完整重写，增加项目诊断、前后端策略、CI/CD 方案 | Claude |

---

**文档维护：** 覆盖率阈值调整需经过 PM + 技术负责人确认；重大功能变更需同步更新本计划。
