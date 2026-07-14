# XHS 批量图文 P0 Schema 边界说明

日期: 2026-03-19  
关联文档:

- `docs/feature-batch-xhs-notes-spec-v2.md`
- `docs/feature-batch-xhs-notes-dev-plan.md`
- `docs/feature-batch-xhs-notes-execution-plan.md`

## 1. 本次落地范围

P0 只解决“模型层可落库、schema 可复用、内外边界明确”。

已落地内容：

- ORM:
  - `xhs_brand_packs`
  - `xhs_brief_packs`
  - `xhs_risk_packs`
  - `xhs_batch_jobs`
  - `xhs_batch_items`
  - `xhs_export_logs`
- AI 配置 schema 扩展：
  - `xhs_split`
  - `xhs_editor`
  - `xhs_verifier`
- Pydantic:
  - internal schema
  - API request/response schema

## 2. Internal Schema 与 API Schema 的边界

代码位置：`backend/app/schemas/xhs_batch.py`

### 2.1 Internal Schema

用途：任务编排、Worker 中间态、数据库 JSON 字段读写。

包含：

- `FactNode`
- `FactRelation`
- `BrandPackPayload`
- `BriefPackPayload`
- `RiskPackPayload`
- `BatchJobCostSnapshot`
- `BatchItemResultSnapshot`
- `XHSBatchJobInternal`
- `XHSBatchItemInternal`

特点：

- 允许保留中间产物
- 字段可以更贴近任务链路
- 可承载 `editor_output`、`verifier`、`rewrite_fail_reasons` 等内部结构
- 不直接作为对外 API 的稳定契约

### 2.2 API Schema

用途：前后端接口契约。

包含：

- Pack 请求/响应：
  - `XHSBrandPackCreateRequest`
  - `XHSBrandPackUpdateRequest`
  - `XHSBrandPackResponse`
  - `XHSBriefPackCreateRequest`
  - `XHSBriefPackUpdateRequest`
  - `XHSBriefPackResponse`
  - `XHSRiskPackCreateRequest`
  - `XHSRiskPackUpdateRequest`
  - `XHSRiskPackResponse`
- Batch 请求/响应：
  - `XHSBatchCreateRequest`
  - `XHSBatchJobResponse`
  - `XHSBatchItemResponse`
  - `XHSExportLogResponse`

特点：

- 只暴露前端需要消费的稳定字段
- 不暴露过深的中间推理结构
- 不把内部 JSON 直接裸透出给前端

## 3. 数据库存储边界

### 3.1 Pack 表

- `pack_json` 存储结构化资产全文
- 表级字段只承载检索、版本、状态、租户、来源等元信息

这样做的原因：

- P0 先保证资产能沉淀、能版本化
- P1/P2 再按实际查询热点逐步拆更细字段或索引

### 3.2 Batch 主表

`xhs_batch_jobs` 只保存：

- 配置引用
- 成本信息
- 任务状态
- 导出状态
- 系统阻断信息

不保存单篇大文本结果。

### 3.3 Batch 条目表

`xhs_batch_items` 保存：

- 单篇源文本
- 改写/复核中间 JSON
- 终稿字段
- Safe Rewrite 与质量信息

## 4. AI Config 扩展边界

代码位置：`backend/app/schemas/ai_config.py`

当前策略：

- 保持现有 `text/vision/audio` 必填，不破坏旧接口
- 新增可选字段：
  - `xhs_split`
  - `xhs_editor`
  - `xhs_verifier`

这样可以：

- 兼容旧前端和旧测试
- 让 XHS 功能在 P1/P2 直接按角色取模型，不必再做破坏式变更

## 5. 后续阶段约束

P1/P2 开发时遵守以下规则：

- API 只读写 API schema，不直接把 ORM JSON 全量返回给前端
- 任务链路内部统一使用 internal schema 做校验
- 若某个内部 JSON 结构要对前端开放，先新增专门 response schema，再映射输出
- `fact_graph` 的节点/关系结构可扩展，但必须兼容 `FactNode/FactRelation` 基础骨架
