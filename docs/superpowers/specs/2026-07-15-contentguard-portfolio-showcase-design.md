# ContentGuard AI 作品集展示设计

## Goal

把 `ContentGuard AI` 公开仓库的 README 从纯文字说明提升为可快速浏览的个人作品集页面，先展示产品界面，再用案例叙事解释业务流程和工程取舍；不改变业务代码、API 契约或生产运行行为。

## Confirmed Direction

采用 `A + B` 结构：

- `A：精选界面矩阵` 放在 README 前部，用 3 张脱敏展示图让读者快速理解产品形态。
- `B：案例叙事` 紧随展示图，按问题、方案、关键流程和结果解释项目价值。
- 技术架构、状态机、异步任务和权限边界放在后续章节，避免第一屏被技术细节占满。

## Asset Safety Decision

现有 `docs/images/` 不进入公开仓库。抽查结果显示其中包含原始品牌“秒思 / MUSE”、失效 Token 提示和 404 页面，不满足公开化要求。

公开展示图必须重新生成，使用以下约束：

- 产品标识只使用 `ContentGuard AI` / `内容卫士 AI 审核平台`。
- 使用虚构项目、Brief、任务和审核结果，不使用真实账号、域名、Token、客户名或业务数据。
- 不展示错误 Toast、失效认证状态、私有 URL 或部署路径。
- 图片作为“脱敏展示图”，只用于表达当前 UI 和流程，不虚构业务指标或线上运行数据。

## Public File Layout

新增公开资产放在 `docs/portfolio/`，不复用被 `.gitignore` 排除的 `docs/images/`：

```text
docs/portfolio/
├── contentguard-project-dashboard.png
├── contentguard-review-workbench.png
├── contentguard-task-review.png
└── contentguard-architecture.svg
```

展示图由临时本地预览页面生成后复制到公开目录。临时 HTML、浏览器截图缓存和真实运行配置不得进入 Git。

## README Structure

README 保留现有中文说明，并调整公开展示顺序：

1. 项目名称、独立作品集声明和一句话定位。
2. `产品界面`：三张展示图，分别对应品牌方看板、代理商审核工作台和创作者任务审核。
3. `案例叙事`：说明内容交付中多角色协作、AI 预审和人工决策之间的关系。
4. `核心流程`：保留 Project -> Brief -> Task 及脚本/视频两阶段审核流程。
5. `技术架构`：展示 Next.js、FastAPI、PostgreSQL、Redis/Celery、TOS 和 SSE 的当前关系。
6. `技术栈、验证结果、本地运行和范围限制`：沿用当前已验证事实，不添加未经验证的性能指标。

## Verification

- `git ls-files docs/images` 为空，确保旧截图不会被发布。
- 对 `docs/portfolio/` 逐文件扫描原始品牌、私有域名、内网 IP、Token 和真实业务名称。
- 使用 Markdown 链接检查 README 中的 4 个公开资产路径全部存在。
- 通过浏览器截图检查桌面和窄屏布局没有裁切、重叠或不可读文本。
- README 改动完成后运行 `git diff --check`，并保留现有前端、后端验证结果。

## Out Of Scope

- 不增加未认证的生产 Demo bypass。
- 不把旧截图简单覆盖 Logo 后直接公开。
- 不修改业务页面、数据库、API、任务状态或认证流程。
- GitHub Actions CI 作为下一阶段独立任务，在本阶段展示资产验收后再处理。
