# 小红书批量改写功能执行清单

版本: v0.1  
日期: 2026-03-19  
关联文档:

- `docs/feature-batch-xhs-notes-spec-v2.md`
- `docs/feature-batch-xhs-notes-dev-plan.md`

## 1. 范围说明

本清单只面向第一版执行落地，聚焦：

- 数据库改动
- 后端接口改动
- 代理商端前端页面规划

采用最终确认方案：

- 纯代理商端配置闭环
- 支持飞书文档链接导入
- 品牌端与达人端第一版不接入

## 2. 数据库改动清单

### 2.1 新增表

#### 2.1.1 `xhs_brand_packs`

用途：

- 存储品牌/产品结构化事实资产

核心字段：

- `id`
- `tenant_id`
- `brand_name`
- `category_id`
- `version`
- `status`
- `is_default`
- `pack_json`
- `created_by`
- `created_at`
- `updated_at`

#### 2.1.2 `xhs_brief_packs`

用途：

- 存储通过 brief 解析出的结构化卖点资产

核心字段：

- `id`
- `tenant_id`
- `brand_name`
- `category_id`
- `version`
- `status`
- `pack_json`
- `source_type`
  - `upload`
  - `feishu_link`
- `source_ref`
- `created_by`
- `created_at`
- `updated_at`

#### 2.1.3 `xhs_risk_packs`

用途：

- 存储卡审点、退回原因和高风险经验

核心字段：

- `id`
- `tenant_id`
- `category_id`
- `name`
- `version`
- `status`
- `pack_json`
- `created_by`
- `created_at`
- `updated_at`

#### 2.1.4 `xhs_batch_jobs`

用途：

- 批量任务主表

核心字段：

- `id`
- `tenant_id`
- `created_by`
- `status`
- `category_id`
- `rule_pack_version`
- `risk_pack_version`
- `brand_pack_version`
- `brief_pack_id`
- `style_template_id`
- `run_mode`
- `trial_sample_count`
- `input_type`
- `input_stats_json`
- `tag_policy_json`
- `export_options_json`
- `estimated_tokens`
- `estimated_cost`
- `actual_tokens`
- `actual_cost`
- `system_blocked`
- `system_block_reason`
- `total_items`
- `done_items`
- `running_items`
- `export_all_md_status`
- `export_all_md_url`
- `export_feishu_status`
- `export_feishu_doc_title`
- `export_feishu_error`
- `created_at`
- `updated_at`

#### 2.1.5 `xhs_batch_items`

用途：

- 单篇任务条目表

核心字段：

- `id`
- `batch_id`
- `item_id`
- `source_text`
- `source_title_guess`
- `split_by`
- `status`
- `round`
- `editor_output_json`
- `verifier_json`
- `verifier_pass`
- `verifier_confidence`
- `rewrite_fail_reasons_json`
- `safe_rewrite_used`
- `safe_rewrite_reason`
- `final_title`
- `final_body`
- `final_hashtags_json`
- `copy_ready_text`
- `quality_score`
- `duration_ms`
- `model_meta_json`
- `started_at`
- `finished_at`

#### 2.1.6 `xhs_export_logs`

用途：

- 导出日志

核心字段：

- `id`
- `batch_id`
- `type`
  - `all_md`
  - `feishu`
- `status`
- `request_json`
- `response_json`
- `error`
- `created_at`

### 2.2 可能复用/扩展现有表

#### 2.2.1 `ai_configs`

扩展字段：

- `models.xhs_split`
- `models.xhs_editor`
- `models.xhs_verifier`

#### 2.2.2 现有 `briefs`

说明：

- 现有项目级 `briefs` 继续保留
- 不直接替代 `xhs_brief_packs`
- 第一版可通过：
  - 项目级 brief
  - xhs 专用 BriefPack
 共同存在

### 2.3 索引建议

- `xhs_brand_packs (tenant_id, category_id, status, version)`
- `xhs_brief_packs (tenant_id, category_id, status, version)`
- `xhs_risk_packs (tenant_id, category_id, status, version)`
- `xhs_batch_jobs (tenant_id, status, created_at desc)`
- `xhs_batch_items (batch_id, status, item_id)`

## 3. 后端接口清单

### 3.1 配置资产接口

#### 3.1.1 BrandPack

- `GET /api/v1/xhs/config/brand-packs`
- `POST /api/v1/xhs/config/brand-packs`
- `GET /api/v1/xhs/config/brand-packs/{id}`
- `PUT /api/v1/xhs/config/brand-packs/{id}`
- `POST /api/v1/xhs/config/brand-packs/{id}/publish`

#### 3.1.2 BriefPack

- `GET /api/v1/xhs/config/brief-packs`
- `POST /api/v1/xhs/config/brief-packs`
- `GET /api/v1/xhs/config/brief-packs/{id}`
- `PUT /api/v1/xhs/config/brief-packs/{id}`
- `POST /api/v1/xhs/config/brief-packs/{id}/publish`
- `POST /api/v1/xhs/config/brief-packs/parse`

用途：

- 上传文本 / 文件
- 输入飞书文档链接
- 返回结构化草稿

#### 3.1.3 RiskPack

- `GET /api/v1/xhs/config/risk-packs`
- `POST /api/v1/xhs/config/risk-packs`
- `GET /api/v1/xhs/config/risk-packs/{id}`
- `PUT /api/v1/xhs/config/risk-packs/{id}`
- `POST /api/v1/xhs/config/risk-packs/{id}/publish`

#### 3.1.4 RulePack

- 复用/扩展现有规则接口
- 若现有 `/rules` 不适配版本化与 pack 结构，则新增：
  - `GET /api/v1/xhs/config/rule-packs`
  - `POST /api/v1/xhs/config/rule-packs`
  - `PUT /api/v1/xhs/config/rule-packs/{id}`
  - `POST /api/v1/xhs/config/rule-packs/{id}/publish`

### 3.2 批量任务接口

#### 3.2.1 创建任务

- `POST /api/v1/xhs/batches`

请求关键字段：

- `input_text`
- `file_id`
- `feishu_doc_url`
- `category_id`
- `rule_pack_version`
- `risk_pack_version`
- `brand_pack_id`
- `brief_pack_id`
- `product_ids`
- `style_template_id`
- `run_mode`
- `tag_policy`
- `export_options`

#### 3.2.2 查询任务

- `GET /api/v1/xhs/batches/{batch_id}`
- `GET /api/v1/xhs/batches/{batch_id}/items`
- `POST /api/v1/xhs/batches/{batch_id}/retry`

#### 3.2.3 导出

- `GET /api/v1/xhs/batches/{batch_id}/export/all.md`
- `POST /api/v1/xhs/batches/{batch_id}/export/feishu`
- `GET /api/v1/xhs/batches/{batch_id}/export/feishu/status`

### 3.3 辅助接口

#### 3.3.1 试运行确认

- 方案 A：复用 `POST /xhs/batches`
  - 通过 `run_mode=trial/full`
- 方案 B：增加：
  - `POST /xhs/batches/{batch_id}/promote`

建议：

- 第一版优先方案 A
- 由前端基于 trial 结果重新发起 full

#### 3.3.2 成本预估

- `POST /api/v1/xhs/batches/estimate`

返回：

- `estimated_items`
- `estimated_tokens`
- `estimated_cost`

## 4. 代理商端前端页面规划

### 4.1 总入口

新增统一入口：

- `agency/xhs`

顶部采用二级 tab：

- `配置`
- `改写`
- `结果`

### 4.2 配置页

路由：

- `agency/xhs/config`

页面结构：

- 顶部：
  - 页面标题
  - 当前品牌 / 品类上下文
- tab 区：
  - `Brief`
  - `RulePack`
  - `RiskPack`
  - `BrandPack`

#### 4.2.1 Brief tab

能力：

- 上传文件
- 粘贴文本
- 输入飞书文档链接
- 调用 AI 解析
- 查看结构化草稿
- 保存为 BriefPack

#### 4.2.2 RulePack tab

能力：

- 选择品类
- 维护规则版本
- 查看禁词与风险模式
- 保存 / 发布

#### 4.2.3 RiskPack tab

能力：

- 上传卡审点
- 录入退回原因
- 维护替换提示
- 查看高风险样例
- 保存 / 发布

#### 4.2.4 BrandPack tab

能力：

- 上传产品资料
- 查看结构化事实
- 确认关键字段
- 查看冲突检测
- 保存 / 发布

### 4.3 改写页

路由：

- `agency/xhs/rewrite`

页面结构：

- 左侧输入区
  - 粘贴原文
  - 上传文件
  - 输入飞书文档链接
- 中间配置区
  - 品类
  - 品牌/产品
  - 风格模板
  - 是否参考爆款
  - 产品主推强度
  - 语言软化程度
  - 仿写强度
  - emoji 策略
  - 标签策略
  - `trial / full`
- 右侧摘要区
  - 当前使用版本
    - RulePack
    - RiskPack
    - BrandPack
    - BriefPack
  - 预计篇数
  - 预计成本
  - 风险提示

### 4.4 结果列表页

路由：

- `agency/xhs/batches`

页面结构：

- 任务列表
- 状态筛选
- 运行中 / 已完成 / 被阻断
- Safe Rewrite 占比
- 导出状态

### 4.5 结果详情页

路由：

- `agency/xhs/batches/[batchId]`

页面结构：

- 顶部摘要
  - 总数
  - 已完成
  - 阻断状态
  - 试运行 / 全量
- 中部列表
  - 单篇标题
  - 状态
  - 风险摘要
  - Safe Rewrite 标记
- 右侧详情抽屉
  - 终稿
  - 风险详情
  - 自动修复记录
  - 原文/终稿差分
- 底部导出区
  - 下载 `all.md`
  - 导出飞书
  - 查看飞书文档列表

## 5. 三端分配

### 5.1 agency

第一版唯一主操作端。

负责：

- 配置资产
- 发起任务
- 查看结果
- 导出交付物

### 5.2 brand

第一版不接入该功能页面。

### 5.3 creator

第一版不接入该功能页面。

## 6. 建议执行顺序

1. 先完成数据库迁移与 schema
2. 再完成配置资产接口
3. 再完成批量任务接口
4. 再完成代理商端页面
5. 最后接飞书导出与风险详情展示

## 7. 第一批开发优先级

### 后端优先级

1. `xhs_batch_jobs / xhs_batch_items`
2. `xhs_brand_packs / xhs_brief_packs / xhs_risk_packs`
3. 创建 batch / 查询 batch / 查询 items
4. brief parse
5. feishu export

### 前端优先级

1. `agency/xhs/rewrite`
2. `agency/xhs/batches`
3. `agency/xhs/batches/[batchId]`
4. `agency/xhs/config`

