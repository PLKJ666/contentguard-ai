# ContentGuard AI 作品集展示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 生成 3 张不含原始组织信息的 ContentGuard AI 展示图和 1 张架构图，并将它们按已确认的 `A + B` 结构接入中文 README。

**Architecture:** 使用临时本地 HTML 预览页面绘制当前产品的代表性界面，使用浏览器元素截图生成公开 PNG；架构图使用仓库内可审查的 SVG。公开目录只保存最终图片，不保存临时页面、浏览器缓存或真实运行配置。

**Tech Stack:** HTML/CSS mockup、Playwright MCP screenshots、SVG、Markdown、PowerShell、Git。

---

### Task 1: 创建公开资产目录和临时展示页

**Files:**
- Create: `docs/portfolio/` (public final assets)
- Create: `.codex-tmp/portfolio-assets/preview.html` (ignored local screenshot source)

- [ ] **Step 1: 创建目录并确认公开资产目录没有旧文件**

Run:

```powershell
New-Item -ItemType Directory -Force docs/portfolio, .codex-tmp/portfolio-assets | Out-Null
Get-ChildItem docs/portfolio -ErrorAction SilentlyContinue
```

Expected: `docs/portfolio` 为空或不存在旧资产。

- [ ] **Step 2: 写入临时 HTML 展示页**

页面包含 3 个固定尺寸 `section[data-screen]`：

```html
<section data-screen="dashboard" aria-label="品牌方项目看板">...</section>
<section data-screen="review" aria-label="代理商审核工作台">...</section>
<section data-screen="task" aria-label="创作者任务审核">...</section>
```

每个画面只使用 `ContentGuard AI`、虚构项目名、虚构任务编号和结构化审核结果；不得出现秒思、MUSE、Token、私有 URL、真实客户或错误 Toast。尺寸固定为 `1440px x 860px`，窄屏预览使用 `transform` 或响应式缩放，不改变内容比例。

- [ ] **Step 3: 检查临时页面中不存在敏感字符串**

Run:

```powershell
rg -n -i "秒思|MUSE|token|sk-|192\.168\.|10\.[0-9]|172\.(1[6-9]|2[0-9]|3[0-1])\." .codex-tmp/portfolio-assets/preview.html
```

Expected: no matches。

### Task 2: 生成并检查 3 张产品展示图

**Files:**
- Create: `docs/portfolio/contentguard-project-dashboard.png`
- Create: `docs/portfolio/contentguard-review-workbench.png`
- Create: `docs/portfolio/contentguard-task-review.png`

- [ ] **Step 1: 通过本地预览页加载当前展示结构**

Run the existing local visual companion at `http://localhost:58381` and open the new preview page. Use the browser snapshot before selecting elements.

- [ ] **Step 2: 分别截取 3 个 `data-screen` 元素**

Use Playwright element screenshots with these target outputs:

```text
docs/portfolio/contentguard-project-dashboard.png
docs/portfolio/contentguard-review-workbench.png
docs/portfolio/contentguard-task-review.png
```

Expected: each PNG is 1440x860 or a proportional capture of one screen only, with no companion header, browser chrome, or neighboring screen.

- [ ] **Step 3: 逐张目视检查**

Check with the image viewer:

- product name is `ContentGuard AI`;
- no original brand or private identity is visible;
- headings and labels fit inside their parent blocks;
- no overlapping toast, sidebar, badge, or table content;
- the screen communicates a real product state rather than a blank wireframe.

### Task 3: 创建架构图

**Files:**
- Create: `docs/portfolio/contentguard-architecture.svg`

- [ ] **Step 1: 创建可审查的 SVG 架构图**

The diagram must show only current implemented boundaries:

```text
Browser
  -> Next.js / SSE client
      -> FastAPI API
          -> PostgreSQL / Alembic
          -> Redis / Celery workers
          -> TOS or local storage
          -> Compatible OpenAI API service
```

Use neutral labels, arrows, a readable light background, and no private hostname or secret. Do not include planned microservices, vector search, or WebSocket claims.

- [ ] **Step 2: Render the SVG in a browser**

Open the SVG through a local static server or README preview and verify that all labels are readable at desktop width and the arrows do not overlap nodes.

### Task 4: 更新中文 README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在项目简介后添加展示图矩阵**

Add a `## 产品界面（脱敏展示）` section with three relative links:

```markdown
![品牌方项目看板](docs/portfolio/contentguard-project-dashboard.png)
![代理商审核工作台](docs/portfolio/contentguard-review-workbench.png)
![创作者任务审核](docs/portfolio/contentguard-task-review.png)
```

Use captions that say these are sanitized portfolio presentation images, not production data.

- [ ] **Step 2: 添加 A+B 案例叙事**

Add `## 案例叙事` with these subsections and facts only:

```markdown
### 问题
内容交付涉及品牌方、代理商和创作者，审核意见、版本和最终决策容易分散。

### 方案
以 Project -> Brief -> Task 为主线，把脚本审核、视频审核、AI 预审、人工复核和申诉串成可追踪流程。

### 关键取舍
AI 输出结构化建议但不替代人工决策；耗时媒体处理通过 Celery/Redis 异步执行，前端通过 SSE 接收进度。
```

Do not add unverified performance metrics or customer outcomes.

- [ ] **Step 3: 在技术架构章节引用架构图**

Add the relative SVG image and keep the existing text architecture explanation beneath it.

- [ ] **Step 4: 检查所有链接和公开文件存在**

Run:

```powershell
@('docs/portfolio/contentguard-project-dashboard.png','docs/portfolio/contentguard-review-workbench.png','docs/portfolio/contentguard-task-review.png','docs/portfolio/contentguard-architecture.svg') | ForEach-Object { if (-not (Test-Path $_)) { throw "Missing $_" } }
rg -n "docs/portfolio/|产品界面|案例叙事|contentguard-architecture" README.md
```

Expected: all four files exist and all README sections/links are present。

### Task 5: 公开化扫描和阶段提交

**Files:**
- Modify: `ECC_AUDIT_REPORT.md`

- [ ] **Step 1: 扫描公开资产和 README**

Run:

```powershell
git grep -n -I -i -E "秒思|MUSE|internal\.example|192\.168\.|sk-[A-Za-z0-9]{16,}|BEGIN .* PRIVATE KEY" -- README.md docs/portfolio ECC_AUDIT_REPORT.md
```

Expected: no matches。示例占位符只能出现在明确的配置文档中，不得出现在展示图或 README 展示内容中。

- [ ] **Step 2: 更新审计报告**

Record the three public images, SVG architecture diagram, visual inspection, and the fact that `docs/images/` remains excluded because the old assets contain the original identity and invalid runtime state。

- [ ] **Step 3: Run documentation checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only the planned public assets, README, audit report, and this plan/spec history are changed。

- [ ] **Step 4: Commit in Chinese**

```powershell
git add README.md ECC_AUDIT_REPORT.md docs/portfolio
git commit -m "完善作品集展示与脱敏素材"
```

- [ ] **Step 5: Push and verify**

```powershell
git push origin main
git status --short --branch
```

Expected: push succeeds and `main` tracks `origin/main` with no uncommitted files。
