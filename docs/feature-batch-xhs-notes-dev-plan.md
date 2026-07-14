# 小红书批量改写功能开发计划

版本: v0.1  
日期: 2026-03-19  
关联文档: `docs/feature-batch-xhs-notes-spec-v2.md`

## 1. 目标

在现有系统基础上，分阶段落地以下能力：

- 上传 `brief`
- 支持直接输入飞书文档链接导入内容
- 自动抽取并梳理产品卖点逻辑
- 上传卡审点 / 退回原因
- 自动沉淀风险经验
- 批量改写
- 自动定位高疑似风险来源
- 自动低损伤修复
- 导出 `all.md` / 飞书文档

本计划只定义开发顺序、模块边界、阶段目标，不展开详细接口和表结构实现。

## 2. 开发原则

- 先数据结构，后 AI 编排
- 先单篇闭环，后批量系统
- 先可校验，后强营销
- 先可交付，后做体验增强
- 代理商端单端闭环，品牌端与达人端不承担该功能配置职责

## 2.1 端侧分工

本功能按最终决策，采用“纯代理商端配置”模式。

- `agency`
  - 唯一主操作端
  - 负责：
    - 上传 brief
    - 输入飞书文档链接导入内容
    - 配置 RulePack / RiskPack / BrandPack / BriefPack
    - 发起 `trial / full`
    - 查看结果与风险详情
    - 导出 `all.md` / 飞书
- `brand`
  - 第一版不承接该功能页面
  - 如后续需要，仅保留只读查看或审批扩展空间
- `creator`
  - 第一版不接入该功能
  - 达人不承担任何配置、修稿、风险处理动作

## 3. 分期计划

### P0 基础模型层

目标：

- 把 PRD 中的核心配置与任务字段落到数据库和 schema

范围：

- 扩展 AI 角色配置
  - `xhs_split`
  - `xhs_editor`
  - `xhs_verifier`
- 新增/扩展数据模型
  - `BrandPack`
  - `BriefPack`
  - `RiskPack / ReviewPack`
  - `xhs_batch_jobs`
  - `xhs_batch_items`
- 支持以下关键字段
  - `fact_graph`
  - `run_mode`
  - `trial_sample_count`
  - `estimated_tokens`
  - `estimated_cost`
  - `actual_tokens`
  - `actual_cost`
  - `system_blocked`
  - `system_block_reason`

交付物：

- SQLAlchemy models
- Alembic migrations
- Pydantic schemas
- 内部模型与外部 API schema 边界说明

验收标准：

- 核心表结构可落库
- 关键 schema 可供 API 与任务链路复用
- 内部中间产物与对外返回结构边界明确

### P1 配置资产层

目标：

- 让 BrandPack / BriefPack / RiskPack 可以进入系统并可版本化维护

范围：

- RulePack 后台接入
  - 版本选择
  - 规则包保存与发布
- BrandPack 后台录入
  - 上传资料
  - 自动抽取草稿
  - 人工确认关键字段
  - 发布版本
- BriefPack 后台录入
  - 上传 brief
  - 支持飞书文档链接导入
  - 自动抽取卖点逻辑
  - 归并到 BrandPack 草稿
- RiskPack 后台录入
  - 上传卡审点
  - 录入退回原因
  - 维护替换建议
- 保存前冲突检测
  - RulePack 冲突
  - 主体缺失
  - SKU 矛盾
  - 推荐/禁用表达冲突

交付物：

- 后端 CRUD API
- 前端配置页面
- 版本发布流程
- RulePack / BrandPack / RiskPack / BriefPack 联动关系

验收标准：

- 四类配置资产都能保存、编辑、发布
- 任务创建时可选择正确版本
- 保存前冲突检测能给出可读反馈
- 飞书链接可被系统读取并进入 Brief 解析流程

### P2 单篇 AI 闭环

目标：

- 先跑通“单篇输入 -> 单篇终稿输出”

范围：

- `BriefParser`
- `RiskLocator`
- `source_assets` 抽取
  - 含 `sentiment_retention`
- Editor 三档策略
  - `polish`
  - `refactor`
  - `rewrite`
- `product_logic_verifier`
- `marketing_retention_score`
- Safe Rewrite
- Verifier 增强返回结构
  - `group`
  - `severity`
  - `summary`
  - `needs_safe_rewrite`

交付物：

- 单篇处理 pipeline
- 单篇结果结构
- 基础回炉与重试

验收标准：

- 单篇输入可返回终稿
- 可返回风险分组和严重程度
- 可区分正常通过、自动修复、Safe Rewrite

### P3 批量任务系统

目标：

- 从单篇升级到批量异步任务

范围：

- 切分链路
  - 预清洗
  - `xhs_split`
  - 低置信复判
- 批量状态机
- Celery 异步执行
- SSE 进度推送
- `trial / full` 模式
- 系统性错误阻断

补充要求：

- `trial` 结束后，用户可基于同一配置发起 `full`
- `full` 应复用 `trial` 已确认的配置上下文
- 是否复用 `trial` 已生成样本结果，作为实现细节在开发时确定

交付物：

- 批量任务 API
- 条目查询 API
- 异步任务调度
- 阻断逻辑

验收标准：

- 可稳定跑通 trial 模式
- 可从 trial 平滑切换到 full
- 系统性错误出现时能自动阻断并提示

### P4 导出交付层

目标：

- 产出用户能直接使用的交付物

范围：

- `all.md` 排版器
- `copy_ready_text`
- 飞书导出
  - 默认 `150 篇 / 文档`
  - 字符数 / 块数保护拆分
- 导出状态查询
- 飞书失败重试
- 多文档返回结构
  - `docs[]`
  - 每个文档的标题、URL、覆盖篇数
- 目录文档或目录列表
  - 第一版至少返回目录列表

交付物：

- `all.md` 下载接口
- 飞书导出接口
- 导出状态接口

验收标准：

- 150 篇以上可自动拆分
- 前端可正确展示多个飞书文档
- 导出失败可重试

### P5 体验与信任增强

目标：

- 让用户更敢用、看得懂、能回溯

范围：

- 单篇试运行入口
- 成本预估提示
- 风险详情展示
- 改写前后差分
- Safe Rewrite 标记
- 审计日志查看

交付物：

- 前端试运行交互
- 风险详情展示
- 成本提示
- 审计页或审计抽屉

验收标准：

- 用户能看懂为什么被改
- 用户能区分产品逻辑问题、合规问题、风格问题
- 用户能查看审计与成本信息

## 4. 推荐开发顺序

1. P0 基础模型层
2. P1 配置资产层
3. P2 单篇 AI 闭环
4. P3 批量任务系统
5. P4 导出交付层
6. P5 体验与信任增强

## 5. 模块拆分建议

### 后端

- `xhs_config`
  - RulePack / 配置版本管理
- `xhs_assets`
  - BrandPack / BriefPack / RiskPack
- `xhs_pipeline`
  - parser / splitter / editor / verifier / safe_rewrite
- `xhs_jobs`
  - batch / item / state machine / celery
- `xhs_export`
  - markdown / feishu
- `xhs_review`
  - verifier 结果组织 / 审计日志 / 风险展示数据

### 前端

第一版仅在 `agency` 端落地页面：

- `agency/xhs`
  - 统一工作台入口
  - 顶部二级 tab：
    - `配置`
    - `改写`
    - `结果`
- `agency/xhs/config`
  - Brief
  - RulePack
  - RiskPack
  - BrandPack
- `agency/xhs/rewrite`
  - 粘贴文本
  - 上传文件
  - 飞书链接导入
  - 创建 `trial / full`
- `agency/xhs/batches`
  - 批量任务列表
- `agency/xhs/batches/[batchId]`
  - 结果详情
  - 风险详情
  - 导出状态

## 6. 里程碑

- M1：BrandPack / BriefPack / RiskPack 可录入
- M2：单篇输入可生成终稿
- M3：批量 50-200 篇可稳定运行
- M4：可导出 `all.md` 与飞书
- M5：具备试运行、阻断、成本提示、审计能力

## 7. 第一版建议范围

第一版建议承诺：

- BrandPack / BriefPack / RiskPack 基础录入
- 支持飞书文档链接导入为 Brief / 原始内容来源
- 单篇试运行
- 批量改写
- 基础产品逻辑校验
- `all.md` / 飞书导出

第一版不建议承诺：

- 平台机审规则的精准逆向
- 全品类深度 adapter 一次到位
- 完整模板市场
- 全自动零人工配置上线

## 8. 核心风险

- `BriefParser` 和 `RiskLocator` 早期不稳定
- `fact_graph` 建模过重会影响录入效率
- 批量任务最容易出问题的是状态机与阻断策略
- 飞书导出最容易出问题的是长文拆分与重试

## 9. 下一步

本计划确认后，再输出下一层文档：

- 数据库改动清单
- API 改动清单
- 前端页面清单
- 开发任务拆分表
