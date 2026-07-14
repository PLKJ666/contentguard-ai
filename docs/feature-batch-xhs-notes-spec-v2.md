# 功能文档 2: 小红书图文笔记批量「审核 + 完美改写」(无人工)

版本: v0.1 (讨论稿)  
日期: 2026-03-17  
作者: Codex / lyy  

## 1. 目标与原则

### 1.1 目标

为运营/代理商提供一个“像内容运营专家一样”的批量能力：一次性粘贴或上传多篇小红书图文笔记草稿，系统自动完成：

- **分篇**: 自动识别粘贴内容中多篇笔记的边界（分隔符不固定）。
- **逐篇改写**: 每篇独立产出“可直接发布的终稿”，目标营销效果优先，同时满足合规规则。
- **逐篇复核闭环**: AI 复核不通过则自动回炉再改，尽量做到无人工。
- **批量导出**:
  - 合并导出 `all.md` (只包含终稿，自动编号，便于一次性全选复制一千篇)。
  - 飞书文档导出（写入指定文件夹，细节参数可配置）。

### 1.2 “无人工”的工程定义

“无人工”不等于“永远不可能失败”。工程上定义为：

- 对于每篇笔记，系统在可控迭代次数内（例如 3 轮）尝试“营销优先”的改写。
- 若仍无法通过规则/复核，则进入 **Safe Rewrite**（自动降风险模板化改写）以保证产出“可发布终稿”。
- 系统永远给出结果；同时内部保存“风险/降级原因”，方便后续规则包优化。

> 备注: 最终能否通过平台机审取决于平台口径变化与素材真实性；系统目标是最大化通过率与可用性，并提供可追溯的规则命中证据用于持续迭代。

### 1.3 核心原则

- **通用化**: 不绑定某品牌/某案例；通过配置包实现差异化。
- **可控生成**: 允许“补全”但必须在可控边界内（素材包/结构化事实边界）。
- **可追溯**: 每篇独立记录：输入、配置版本、输出、复核结果、命中规则证据、模型调用元数据。
- **批量不串味**: 即使批量调用模型，返回也必须按 `item_id` 对齐，禁止跨样本引用。

## 2. 关键概念与配置模型

### 2.1 品类 (Category)

例如：美妆、食品、保健、母婴、金融等。第一版支持后台“新增品类”。

### 2.2 RulePack (品类规则包)

描述“小红书图文笔记”在某品类下的合规规则集合（可版本化、可启用默认版本）。

最小字段建议：

- `id`, `name`, `category_id`, `version`, `status(active|draft|archived)`
- `banned_terms[]`: 禁词/禁表达（支持正则）
- `risk_patterns[]`: 高风险模式（如“疗效承诺、绝对化背书、引流”），用于提升复核等级
- `replace_map{}`: 推荐替换（可选）
- `format_rules`:
  - `allow_markdown`: false/true（默认 false，避免 H1/分割线误触发）
  - `max_chars_per_note`: 默认 1000（可配置）
  - `hashtag`:
    - `max_count`: 默认 10（可配置）
    - `banned_terms_in_tags[]`
- `structure_rules`（可选）:
  - 如“四段式隔离”，或“标题 + 正文 + 标签”的结构约束

### 2.2.1 RiskPack / ReviewPack（卡审点与风险经验包）

除了 RulePack 之外，第一版建议增加一层专门描述“平台卡审经验”的配置包，用于承接用户上传的卡审点、退回原因、历史高风险表达。

它和 RulePack 的区别：

- `RulePack`
  - 更偏“明确规则”
  - 例如禁词、格式边界、硬性红线
- `RiskPack / ReviewPack`
  - 更偏“经验风险”
  - 例如平台常卡的表达、模糊高危句式、退回原因归纳、替换样例

建议字段：

- `id`, `category_id`, `version`, `status`
- `risk_clues[]`
  - 历史卡审点
  - 平台退回原因
  - 高风险词/句/结构猜测
- `replace_hints[]`
  - 推荐替换方向
  - 正反样例
- `confidence_level`
  - 区分“明确规则”与“经验猜测”

作用：

- 支持用户上传“卡审点”
- 支持系统据此做风险定位
- 支持低损伤改写，而不是简单粗暴删词

### 2.2.2 BriefPack / BriefParser（Brief 解析层）

为了支持“上传 brief 后自动梳理正确卖点逻辑”，第一版建议增加 Brief 解析层。

输入可包括：

- 产品 brief
- 卖点梳理文档
- 竞品对比摘要
- 品牌给定的话术边界

系统职责：

1. 读取 brief
2. 自动抽取结构化卖点
3. 自动归并到 BrandPack 草稿
4. 标出不确定字段供人工确认

建议输出：

- `brand_facts`
- `sku_facts`
- `selling_point_priority`
- `recommended_phrasings`
- `forbidden_phrasings`
- `uncertain_fields[]`

原则：

- Brief 不是直接拿来喂 Editor 的原始文本
- 而是先经过 `BriefParser` 变成结构化资产

### 2.3 BrandPack (品牌/产品素材包)

与品类无关，描述“允许写什么、必须怎么写、禁止写什么”。由运营后台上传维护，支持多版本。

战略定位补充：

- BrandPack 不应只被定义为“小红书写稿配置”
- 它本质上是品牌的结构化事实资产中心
- 当前可结合小红书 RulePack 生成图文笔记
- 后续也应能复用到抖音脚本、淘宝问答、公众号内容、客服知识库等场景

最小字段建议：

- `id`, `brand_name`, `version`, `status`
- `products[]`（每个产品一份事实与表达边界）
  - `product_id`, `product_display_name`
  - `naming_rules`:
    - `first_mention_full_name`: 例如“中英无空格全称”
    - `later_short_name`: 例如“后文简称”
  - `fact_graph`（强约束，主事实来源）:
    - 结构化事实节点与关系
  - `facts_whitelist`（辅助层）:
    - 面向生成和展示的事实摘要，不是唯一事实来源
  - `claims_policy`:
    - 允许的“软表达”模板、禁止的因果承诺
  - `cta_policy`:
    - 是否允许出现活动、是否允许出现引导话术、是否可出现价格等
- `optional_blocks[]`（可选模块）
  - 例如“推荐来源话术块”“结尾补充段句库”等

### 2.3.2 BrandPack Schema v1（全品类通用骨架）

为支撑“产品卖点逻辑校验”，BrandPack 第一版不能只存平铺宣传语，而要升级为：

- 通用事实骨架
- 品类扩展字段
- 营销表达层

原则：

- 所有品类先共用一套通用事实结构
- 再按品类补充扩展字段
- 不是要求所有品类都人工填到同样深度
- 而是先保证“关键事实关系可校验”

#### 2.3.2.1 通用事实实体（全品类共用）

建议定义以下基础实体：

- `brand`
- `product_line`
- `sku`
- `component`
- `formula`
- `amount`
- `certification`
- `research`
- `claim`
- `person_or_org`
- `usage_rule`

其中：

- `sku`
  - 是最核心对象
  - 所有成分、认证、研究、claim 最终都要能回挂到某个 SKU 或其子实体
- `component`
  - 可表示成分、菌株、原料、功效成分、辅料等
- `amount`
  - 单独抽成实体或结构块，避免数值和对象绑定错误
- `certification`
  - 必须包含认证主体
- `research`
  - 必须包含研究主体

#### 2.3.2.2 通用关系（全品类共用）

建议统一支持以下关系：

- `belongs_to_brand`
- `belongs_to_product_line`
- `has_component`
- `has_formula`
- `has_amount`
- `amount_subject_is`
- `uses_strain`
- `has_certification`
- `certification_subject_is`
- `has_research`
- `research_subject_is`
- `has_claim`
- `claim_subject_is`
- `co_created_with`
- `has_usage_rule`

这样系统就能判断：

- 一个数值到底修饰谁
- 一个认证到底属于品牌、产品、菌株还是成分
- 一条研究到底是在说产品、菌株还是配方
- 一条 claim 到底属于哪个 SKU

#### 2.3.2.2.1 通用 FactNode / FactRelation 数据模型

为了让不同品类共用同一套校验能力，建议在存储层进一步统一为：

- `FactNode`
- `FactRelation`

其中：

- `FactNode`
  - `id`
  - `node_type`
  - `name`
  - `normalized_name`
  - `attributes_json`
- `FactRelation`
  - `id`
  - `source_node_id`
  - `relation_type`
  - `target_node_id`
  - `attributes_json`

示意：

- `FactNode(sku, "AKK银标")`
- `FactNode(component, "AKK菌")`
- `FactNode(strain, "Akk MucT")`
- `FactNode(certification, "欧洲EFSA安全认证")`
- `FactRelation(sku -> has_component -> component)`
- `FactRelation(amount -> amount_subject_is -> component)`
- `FactRelation(certification -> certification_subject_is -> strain)`

这样做的目的：

- 让 BrandPack 不再依赖某一类目专属表结构
- 让 Verifier 可以做统一的关系回查
- 后续新增品类时，不需要推倒重来

建议：

- 对外仍可保留 `core_facts / category_extension` 这种更易读的 JSON
- 对内可在入库时同步编译为 `FactNode / FactRelation`
- Editor 和 Verifier 统一消费编译后的事实图

#### 2.3.2.3 SKU 级核心字段（L1，建议必填）

不是每个品类都要录入很多字段，但以下核心字段建议作为 `L1`：

- `sku_id`
- `sku_name`
- `brand_name`
- `category_id`
- `product_line`
- `amount_facts[]`
  - `value`
  - `unit`
  - `subject_name`
  - `subject_type`
- `formula_type`
- `formula_components[]`
- `certifications[]`
  - `cert_name`
  - `cert_subject_name`
  - `cert_subject_type`
- `research_mentions[]`
  - `publication_name`
  - `research_subject_name`
  - `research_subject_type`
- `storage_rules[]`
- `facts_whitelist[]`
- `facts_blacklist[]`

说明：

- `facts_whitelist` 仍然保留，但它不再是唯一事实来源
- 真正的判错依赖结构化字段
- `facts_whitelist` 更适合作为可引用事实清单和展示摘要

#### 2.3.2.4 品类扩展字段（L2，按类目选填）

在通用骨架之外，每个品类可以挂自己的扩展 schema。

例如：

- 保健品/益生菌
  - `strain_name`
  - `strain_origin_type`
  - `clinical_duration`
  - `clinical_scope`
  - `formula_components_detail`
- 护肤品
  - `ingredient_concentration`
  - `applicable_skin_type`
  - `test_type`
- 母婴
  - `applicable_age_range`
  - `usage_stage`
- 食品/饮料
  - `flavor`
  - `serving_size`
  - `target_scene`
- 家电/器械
  - `power`
  - `coverage_area`
  - `lab_test_standard`

原则：

- 全品类共享骨架
- 品类差异放在扩展层
- Verifier 先检查通用逻辑，再检查类目专属逻辑

#### 2.3.2.5 营销表达层（L3，可选）

除了事实层，还需要一层给 Editor 用的“表达资源”，但必须和事实层分开：

- `recommended_phrasings[]`
- `soft_expression_map[]`
- `forbidden_phrasings[]`
- `trusted_tone_blocks[]`
- `cta_blocks[]`

原则：

- 表达层可以改写
- 事实层不能漂移
- 不允许用 L3 覆盖 L1/L2 的事实约束

#### 2.3.2.6 自动抽取 + 人工确认

为了避免所有 BrandPack 都靠人工从零录入，第一版建议采用：

1. 上传原始产品资料
2. 系统抽取结构化事实
3. 人工确认关键字段
4. 再入库为 BrandPack v1

原始输入来源可包括：

- 产品卖点文档
- 营销手册
- 包装文案
- FAQ
- 认证证明摘要
- 研究摘要

系统自动抽取的重点字段：

- 数值与数值主体
- 配方与配方组成
- 菌株/成分名
- 认证与认证主体
- 研究与研究主体
- SKU 归属

人工确认重点字段：

- `amount_subject`
- `certification_subject`
- `research_subject`
- `sku_isolation`
- `forbidden_phrasings`

#### 2.3.2.7 分级建设策略

不是所有产品第一天都要做到最全，而是按 3 级建设：

- `L1 核心可校验`
  - 保证不会把关键事实写错
- `L2 品类增强`
  - 保证重点品类能识别更细的逻辑关系
- `L3 营销增强`
  - 保证文案更自然、更像种草

上线建议：

- 第一阶段先保证重点品类做到 L1
- 核心商业品类逐步补到 L2
- 表达资产和风格资源持续沉淀到 L3

#### 2.3.2.8 品类扩展校验器（Category Adapters）

为了避免把所有品类逻辑都硬塞进一个 Verifier，建议采用：

- 通用校验器
- 品类扩展校验器

结构：

- `base_product_logic_verifier`
  - 负责全品类通用规则
- `category_adapter_healthcare`
  - 负责菌株、临床周期、配方等专属规则
- `category_adapter_skincare`
  - 负责浓度、肤质、测试类型等专属规则
- `category_adapter_maternal`
  - 负责月龄、阶段、人群适用性等专属规则

运行顺序建议：

1. 先跑通用校验
2. 再按 `category_id` 跑对应 adapter
3. 合并 violations 返回

原则：

- 通用校验必须始终执行
- 品类扩展校验按需挂载
- 新品类上线时，至少先接通用校验

### 2.3.3 RulePack 与 BrandPack 的边界与优先级

为避免规则冲突与职责混乱，需明确：

- `RulePack`
  - 负责平台规则、品类规则、表达红线、格式约束
  - 解决“什么不能写、什么必须弱化、格式如何限制”
- `BrandPack`
  - 负责品牌事实、产品事实、允许使用的卖点与写法资源
  - 解决“什么能写、第一次如何命名、哪些结构化事实可引用”

冲突优先级原则：

1. 平台/合规硬规则（RulePack）优先
2. 品牌/产品结构化事实（BrandPack fact_graph）其次
3. 风格模板、营销表达、可选模块最后

结论：

- BrandPack 不能覆盖 RulePack 的合规红线
- BrandPack 只能在 RulePack 允许的边界内丰富表达

### 2.4 TaskConfig (本次任务配置)

批量任务创建时选择/填写：

- `category_id` + `rule_pack_version`
- `risk_pack_version`（可选）
- `brand_pack_id` + `product_id(s)`（可单品或多品）
- `brief_pack_id`（可选）
- `style_template_id`（风格模板：真实分享/干货测评/清单种草等）
- `tag_policy`（话题标签策略）:
  - `functional_tags[]`（功能性标签: 场景/人设/生活方式）
  - `brand_tags[]`（品牌标签: 品牌/产品/系列）
  - `tag_max_count`（可覆盖 RulePack 默认）
- `export`:
  - `all_md` 开启/关闭
  - `feishu_export` 开启/关闭 + 目标文件夹配置

建议补充：

- `run_mode`
  - `trial`（试运行，默认 1-3 篇）
  - `full`（全量运行）

说明：

- 当用户首次使用某套配置，或本次任务篇数很大时，建议优先使用 `trial`
- 用户确认试运行结果后，再切换到 `full`
- 该模式用于降低大批量错误配置带来的成本浪费

### 2.4.1 XHS 专用 AI 角色配置

为兼顾“营销效果 + 安全 + 无人工”，第一版建议在现有租户级 `AIConfig` 基础上扩展 3 个专用模型角色：

- `xhs_split`
  - 用途：仅在规则切分失败或疑似混篇时做 AI 辅助分篇
  - 建议模型：普通文本模型（速度优先）
- `xhs_editor`
  - 用途：主改写模型，负责生成“终稿”
  - 建议模型：高级文本模型（质量优先）
- `xhs_verifier`
  - 用途：复核判卷模型，只输出结构化判定，不负责改写
  - 建议模型：中强文本模型（稳定遵守规则优先）

第一版不单独配置 `safe_rewrite_model`，默认复用 `xhs_editor`。

### 2.4.2 与现有 AIConfig 的兼容方案

当前项目已有：

- `models.text`
- `models.vision`
- `models.audio`

建议扩展为：

```json
{
  "text": "gpt-4o",
  "vision": "gpt-4o",
  "audio": "whisper-1",
  "xhs_split": "gpt-4o-mini",
  "xhs_editor": "gpt-4o",
  "xhs_verifier": "gpt-4o-mini"
}
```

兼容原则：

- 若未配置 `xhs_split`，则回退到 `models.text`
- 若未配置 `xhs_editor`，则回退到 `models.text`
- 若未配置 `xhs_verifier`，则回退到 `models.text`
- 旧租户不要求立即迁移；只要 `models.text` 可用，新功能即可运行

### 2.4.3 后台配置要求

AI 配置后台需补充：

- `xhs_split` 模型下拉选择
- `xhs_editor` 模型下拉选择
- `xhs_verifier` 模型下拉选择
- 每个角色的“测试连接”与“测试示例”

第一版建议：

- 仍复用现有 provider / base_url / api_key
- 不额外拆分成多 provider；即同一租户的 XHS 三角色默认走同一个 AI 服务商
- 后续如有需要，再扩展为“不同角色使用不同 provider”

### 2.5 配置 JSON 示例

#### 2.5.1 RulePack JSON 示例

```json
{
  "name": "小红书-保健品-基础规则",
  "category_id": "healthcare",
  "version": "2026.03.1",
  "status": "active",
  "rules_json": {
    "banned_terms": [
      "治疗",
      "治愈",
      "顶刊",
      "药到病除",
      "100%有效"
    ],
    "risk_patterns": [
      {
        "id": "medical_claim",
        "pattern": "(改善|治疗|缓解).*(疾病|炎症|便秘)",
        "severity": "high"
      },
      {
        "id": "absolute_claim",
        "pattern": "(最好|第一|顶级|无敌)",
        "severity": "medium"
      }
    ],
    "replace_map": {
      "减肥": "调整状态",
      "瘦": "轻松一点",
      "顶刊": "相关研究期刊"
    },
    "format_rules": {
      "allow_markdown": false,
      "max_chars_per_note": 1000,
      "forbidden_symbols": ["---", "# "],
      "hashtag": {
        "max_count": 10,
        "banned_terms_in_tags": ["减肥", "治疗", "瘦身"]
      }
    },
    "structure_rules": {
      "preferred_sections": ["title", "pain_point", "product_facts", "trust_signal", "experience", "hashtags"],
      "section_isolation": true
    }
  }
}
```

#### 2.5.2 BrandPack JSON 示例

```json
{
  "brand_name": "示例品牌",
  "version": "2026.03.1",
  "status": "active",
  "pack_json": {
    "products": [
      {
        "product_id": "gold",
        "product_display_name": "示例品牌金标",
        "naming_rules": {
          "first_mention_full_name": "innerhealth茵澳斯AKK金标",
          "later_short_name": "AKK金标",
          "no_space_between_cn_en": true
        },
        "fact_schema_level": "L2",
        "core_facts": {
          "sku_id": "gold",
          "sku_name": "示例品牌金标",
          "brand_name": "示例品牌",
          "category_id": "healthcare",
          "product_line": "AKK系列",
          "amount_facts": [
            {
              "value": 300,
              "unit": "亿",
              "subject_name": "AKK菌",
              "subject_type": "component"
            }
          ],
          "formula_type": "益生菌配方",
          "formula_components": [
            {
              "name": "AKK菌",
              "type": "component"
            }
          ],
          "storage_rules": [
            "常温保存",
            "无需冷藏"
          ]
        },
        "category_extension": {
          "strain_name": "Akk MucT",
          "strain_origin_type": "原研菌株",
          "co_creation": [
            {
              "partner_name": "威廉·德沃斯",
              "partner_type": "person"
            }
          ],
          "clinical_claims": [
            {
              "claim_subject_name": "Akk MucT菌株",
              "claim_subject_type": "strain",
              "claim_condition": "90天",
              "claim_scope": [
                "有效控制体重",
                "帮助糖脂代谢管理"
              ]
            }
          ]
        },
        "certifications": [
          {
            "cert_name": "欧洲EFSA安全认证",
            "cert_subject_name": "Akk MucT菌株",
            "cert_subject_type": "strain"
          },
          {
            "cert_name": "澳洲TGA认证",
            "cert_subject_name": "Akk MucT菌株",
            "cert_subject_type": "strain"
          }
        ],
        "research_mentions": [
          {
            "publication_name": "Nature Medicine",
            "publication_cn_name": "自然医学",
            "research_subject_name": "Akk MucT菌株",
            "research_subject_type": "strain"
          }
        ],
        "facts_whitelist": {
          "allowed_fact_summaries": [
            "每粒含300亿AKK菌",
            "所用菌株为Akk MucT",
            "Akk MucT菌株获得欧洲EFSA安全认证和澳洲TGA认证",
            "Akk MucT菌株相关研究成果发表于《Nature Medicine（自然医学）》"
          ],
          "forbidden_fact_patterns": [
            "品牌获得EFSA认证",
            "产品获得双认证",
            "顶刊",
            "治愈",
            "官方代言"
          ]
        },
        "claims_policy": {
          "allow_soft_claims": [
            "状态舒展了不少",
            "没有之前那种沉坠感",
            "更适合忙碌节奏"
          ],
          "forbid_direct_causality": true
        },
        "cta_policy": {
          "allow_promo": true,
          "allow_price": false,
          "allow_direct_purchase_urge": true
        }
      }
    ],
    "optional_blocks": [
      {
        "id": "recommendation_block",
        "type": "fixed_line",
        "enabled": true,
        "value": "帕姐推荐，果断入手！",
        "must_be_standalone_paragraph": true
      },
      {
        "id": "silver_appendix_bank",
        "type": "sentence_bank",
        "enabled": true,
        "position": "tail",
      "items": [
          "如果不需要金标那么强的配置，同系列银标完全能满足日常所需！150亿AKK菌+B420+益生元的三生元组合，小基数每天维个稳妥妥的。",
          "小声打个岔，同系列银标其实性价比超高，150亿AKK菌带上B420和益生元，温和的三生元配方，小基数姐妹每天吃都能保持内在舒坦。"
        ]
      }
    ]
  }
}
```

#### 2.5.3 TaskConfig JSON 示例

```json
{
  "category_id": "healthcare",
  "rule_pack_version": "2026.03.1",
  "brand_pack_id": "brandpack_001",
  "product_ids": ["gold"],
  "style_template_id": "xiaohongshu_real_share",
  "tag_policy": {
    "functional_tags": [
      "打工人日常",
      "久坐族",
      "懒人轻养生"
    ],
    "brand_tags": [
      "innerhealth益生菌",
      "茵澳斯",
      "茵澳斯AKK金标"
    ],
    "tag_max_count": 8
  },
  "export": {
    "all_md": true,
    "feishu_export": true,
    "feishu_folder_token": "fldcnxxxxxxxx"
  }
}
```

#### 2.5.4 emoji_policy 示例

```json
{
  "emoji_policy": {
    "enabled": true,
    "density": "medium",
    "style": "xiaohongshu_lifestyle",
    "max_per_note": 12,
    "max_per_paragraph": 2,
    "allow_in_title": true,
    "blacklist": ["💯", "‼️"],
    "preferred_groups": {
      "mom": ["👶", "🍼", "✨", "💧"],
      "office": ["💻", "☕", "📎", "✨"],
      "student": ["📚", "⏰", "🧃", "✨"]
    }
  }
}
```

## 3. 用户流程与交互

### 3.1 前台页面 (批量笔记改写)

页面结构：

- 输入区:
  - 大文本框（支持粘贴，支持 <100 到 1000 篇）
  - 上传文件（txt/csv/xlsx）可选
  - 分隔提示（用户可选“我使用 --- 分隔/空行分隔/编号分隔”，但不是必填）
- 配置区（默认展开，非极简隐藏）:
  - 品类（必选）
  - 品牌/产品（必选）
  - 风格模板（必选）
  - 是否参考爆款笔记（可选）
  - 产品主推强度（默认可见）
  - 语言软化程度（默认可见）
  - 仿写强度（默认可见）
  - emoji 策略（默认可见）
  - 标签策略（可选）：功能性标签/品牌标签开关 + 数量上限
  - 导出：all.md / 飞书导出（可选）
- 处理按钮:
  - “AI 合规审核并生成完美版”
- 进度与结果:
  - 批量进度条（已完成/总数/失败重试中/预计剩余）
  - 逐篇列表（可搜索/筛选）:
    - 状态: pending/editing/rewrite_round_2/verifying/done
    - 快捷操作: 查看终稿、复制单篇、标记问题（可选）

### 3.1.1 配置分层原则

本功能不是“前台极简到只剩 4 个字段”，而是要做到：

- 用户真正关心、会直接影响出稿效果的配置，前台必须可见可改
- 技术实现细节、模型路由、兜底策略等，才放到后台默认值
- “规则配置”不能和“普通表单项”混在一起，更不能被折叠到用户找不到

因此第一版建议把配置分为 3 层：

1. 前台常用配置
2. 前台规则配置
3. 后台系统配置

### 3.1.2 前台常用配置（默认可见）

这些是创建任务时最常用、最高频的操作项，默认直接展示：

- 品类
- 品牌/产品
- 风格模板
- 是否参考爆款笔记
- 导出到飞书

说明：

- 这几项决定“写什么、按什么风格写、是否参考现有爆文、是否直接输出到交付渠道”
- 不应隐藏

### 3.1.3 前台规则配置（默认可见，可单独成区块）

以下配置虽然常被称为“高级项”，但实际上它们直接决定改写质量与最终调性，因此不应隐藏到后台：

- 产品主推强度
- 语言软化程度
- 仿写强度
- emoji 策略
- 标签策略

建议以前台单独区块展示，例如：`写作规则配置` 或 `改写规则配置`。

原因：

- 用户给出的反馈已经证明，这些项不是“锦上添花”
- 它们会直接影响：
  - 产品是不是主角
  - 文案会不会太专业、太硬、太像说明书
  - 仿写会不会不够像，或者像过头
  - emoji 是否自然
  - 标签是否够像小红书、是否贴近人设

建议字段定义：

- `product_focus_level`
  - `low / medium / high`
- `language_softness`
  - `balanced / lifestyle`
- `style_reference_mode`
  - `disabled / soft_reference / strong_reference`
- `emoji_policy`
  - 可前台配置 `density / allow_in_title / max_per_note / style`
- `tag_policy`
  - 功能标签策略
  - 品牌标签策略
  - 最大标签数
  - 自动补标签开关

### 3.1.4 最关键的规则配置（必须独立成层）

真正最关键的，不是几个改写滑杆，而是“规则配置”本身。

第一版必须把规则配置作为独立概念，而不是散落在表单里：

- 规则包（RulePack）
- 品牌/产品素材包（BrandPack）
- 风格模板（StyleTemplate）

其中：

- `RulePack`
  - 决定哪些表达能写、哪些必须弱化、哪些绝对不能写
  - 决定标题/正文/标签/格式的硬边界
- `BrandPack`
  - 决定当前品牌和产品到底允许说什么
  - 决定命名、事实白名单、认证写法、金标/银标等差异
- `StyleTemplate`
  - 决定整篇的节奏、结构、语气、种草方式

前台表现建议：

- 前台让用户选：
  - 品类
  - 品牌/产品
  - 风格模板
- 系统自动带出：
  - 当前命中的 RulePack 版本
  - 当前命中的 BrandPack 版本
- 在前台可查看但默认折叠显示：
  - `当前规则版本`
  - `当前品牌素材版本`
  - `主要限制摘要`

这样用户不会被一堆 JSON 吓到，但也不会不知道系统到底按什么规则在写。

### 3.1.5 后台系统配置（内部使用，不暴露给普通运营）

以下才属于真正适合隐藏到后台的系统级配置：

- `xhs_split / xhs_editor / xhs_verifier` 的模型选择
- AI provider、base_url、api_key
- 低置信边界复判阈值
- Safe Rewrite 模板池与轮换策略
- 相似度阈值
- 自动重试次数
- 任务并发、切片大小、token 预算
- 规则命中日志、模型元数据记录策略

原则：

- 用户配置“结果”
- 后台配置“实现”

不要把决定文案效果的控制项误归类为后台配置。

### 3.2 结果展示

第一版对比视图：

- 默认只展示“终稿”（最简单）
- 可展开“内部信息”（权限控制）：命中规则、证据片段、回炉次数、降级原因

## 4. 分篇与幂等

### 4.1 分篇策略（预清洗 + AI 结构标注 + 程序组装）

由于真实输入可能包含：

- 无显式 `标题：` 标记的标题
- `### 笔记2` / `#21 人设角度` / `11` 等混杂编号
- 对话残留（如“收到，我已经理解了...”）
- 分隔符、空块、说明文字、半篇成稿混在一起

因此第一版不采用“纯规则切分”，而采用三层混合策略：

1. 预清洗层（不用 AI，只做低风险标准化）
  - 统一换行、空格、全角/半角标点
  - 识别明显的分隔符、编号、标题候选、标签行
  - 去掉纯空块、纯分隔符块、纯日志块
  - 对“像说明文字/对话壳子”的段落只做 `candidate_instruction_block` 标记，不直接删除
2. AI 结构标注层（`xhs_split`）
  - 不是直接“切成第 1 篇、第 2 篇”
  - 而是对每个段落/块输出结构标签：
    - `title_candidate`
    - `body`
    - `hashtags`
    - `instruction_or_noise`
    - `separator`
    - `boundary_confidence`
3. 程序组装层
  - 按 AI 标注结果将块组装为一篇篇笔记
  - 对低置信边界做二次修复
  - 结果写入 `split_by` 与 `boundary_confidence`

### 4.1.2 低置信边界升级复判

当出现以下情况时，不直接采用普通 `xhs_split` 结果，而是升级给高级模型做边界复判：

- 连续两个块都像标题
- 一篇内部出现多个明显分隔但边界不清
- `instruction_or_noise` 与正文混杂
- 编号跳号/重复号且结构不一致
- `boundary_confidence < threshold`

升级策略：

- 第一轮：普通 `xhs_split` 做结构标注
- 第二轮：高级 AI 对低置信边界做复判
- 复判结果优先级高于第一轮切分结果

返回字段建议：

- `boundary_confidence`
- `boundary_rechecked`（是否升级复判）
- `boundary_model`（最终定界所用模型）

补充规则：

- 标题不要求前面必须写 `标题：`
- 只要满足“短句 + 后接正文 + 结构上像总起句”等特征，也可识别为标题候选
- 最终是否成立为标题，由 `xhs_split` + 组装层综合决定

### 4.1.1 预清洗层原则

预清洗层只做：

- 标准化
- 候选标注
- 极高置信垃圾块清除

预清洗层**不得做高风险语义删除**，例如：

- 不得因为“像对话说明”就直接删正文
- 不得自己决定段落属于哪一篇
- 不得直接重写内容

原则：**预清洗层只做标准化和候选标注，不做不可逆的强语义判断。**

### 4.2 幂等与去重

- `item_id = sha256(normalize(text))`
- 若同一批内重复，默认复用结果（可配置为强制重写）

## 5. AI 工作流 (Editor + Verifier + Safe Rewrite)

### 5.1 Editor（改写）

输入：

- 原文（单篇）
- RulePack（结构化）
- RiskPack / ReviewPack（结构化，承接卡审经验与高风险提示）
- BrandPack（结构化，含 fact_graph / 表达资源 / facts_whitelist 摘要层）
- BriefPack（可选，承接 brief 解析后的卖点优先级与表达边界）
- 风格模板（结构化）
- 标签策略（功能性/品牌标签）
- 上一轮失败原因（若存在）
- `source_assets`（从原文抽取出的可复用素材）
- `style_reference`（如用户提供“成功种草笔记”作为参考风格）

输出（强制 JSON）：

- `title`
- `body`（纯文本，遵守 format_rules）
- `hashtags[]`（不超过上限）
- `edit_mode`（`polish` / `refactor` / `rewrite`）
- `marketing_intensity_score`（可选）
- `marketing_retention_score`（可选）
- `self_check`（简短结构化自检：是否含禁词、是否符合首次全称/后文简称等）

约束：

- 默认 `allow_markdown=false` 时禁止输出 `#`、`---` 等可能触发格式的符号（由系统也会二次清洗）
- 不允许编造 BrandPack 事实图之外的硬事实；如需补全，必须从 BrandPack 提供的素材块中选用

### 5.1.1 Editor 三档策略

为适配真实业务中的不同输入类型，Editor 不只做“局部修补”，而是先判断本篇的编辑策略：

- `polish`
  - 原文整体可用
  - 只需做润色、合规修补、标签整理、emoji 调整
- `refactor`
  - 原文有可复用的素材、模板、句式或节奏
  - 但结构、口吻、产品映射、人设映射需要重组
  - 这是第一版最常见模式
- `rewrite`
  - 原文严重不合规、结构失控、或只保留少量主题价值
  - 仅保留主题/产品/人设/少量素材点，整篇重写

### 5.1.2 source_assets（可复用素材抽取）

系统不能把原文只当作“待修文本”，还应当把原文当成“素材池”。

建议在 Editor 前增加轻量素材抽取，输出结构化 `source_assets`，例如：

- `persona_hint`（人设线索）
- `scene_hint`（场景线索）
- `pain_points[]`（痛点）
- `selling_points[]`（卖点）
- `sentiment_retention`
  - `emotion_type`
  - `emotion_intensity`
  - `key_emotion_phrases[]`
- `good_phrases[]`（可复用的高质量句式）
- `cta_hint`（行动号召/结尾语气）
- `tag_candidates[]`

Editor 可以保留这些素材的“写法价值”，但不必保留原文结构。

补充原则：

- 除了保留主题和卖点，还应尽量保留原文中最有价值的情绪张力
- 避免把原稿中的焦虑、惊喜、吐槽、庆幸等情绪洗成“白开水”

### 5.1.3 style_reference（参考种草模板）

用户有可能输入的不是“待修原稿”，而是“成功种草模板/对标笔记”，要求系统“按这个语气、节奏、话术仿写”，同时替换：

- 人设
- 产品卖点
- 痛点
- 标签

因此 TaskConfig 需要支持：

- `style_reference_text`（单篇或多篇参考笔记）
- `style_reference_mode`
  - `disabled`
  - `soft_reference`（参考语气和节奏，不强仿）
  - `strong_reference`（优先模仿结构和话术节奏，但内容必须替换）

使用原则：

- 只允许学习“写法和结构”，不允许复用对方品牌事实或原文句子到可疑相似度
- 必须替换成当前任务的 BrandPack 事实与人设/场景
- Verifier 需额外检查是否混入了 style reference 的错误品牌、错误事实、错误标签

### 5.1.4 style_reference 边界控制

为避免“仿写过像”或误带入参考文案信息，系统需额外控制：

- 不允许直接复用参考文案中的品牌名、产品名、认证、研究、活动信息
- 不允许连续复用长句或整段句式
- 允许借鉴：
  - 语气
  - 节奏
  - 段落组织方式
  - 钩子写法
- Verifier 需检测：
  - 是否混入参考模板里的错误事实
  - 是否保留了参考模板中的旧标签
  - 是否与参考模板过度相似（可基于 n-gram / embedding 做简单相似度阈值检测）

补充原则：

- 第一版只保留 `soft_reference` 与 `strong_reference` 两档，不增加更多用户可见档位
- 相似度控制由系统内部统一处理，不暴露为用户配置项
- 若输出与参考模板过于相似，则强制回炉重写

### 5.1.5 emoji 策略

emoji 不应“原样保留”，而应作为受控生成的一部分：

- 允许：
  - 保留合适 emoji
  - 删除不合适 emoji
  - 补充更贴合人设/场景的 emoji
- 不允许：
  - 过度堆砌
  - 与职业/场景风格严重冲突
  - 使用 RulePack 禁止的 emoji

建议由 `emoji_policy` 控制：

- `density`: `low` / `medium` / `high`
- `style`: 宝妈风 / 打工人风 / 校园风 / 轻专业风
- `max_per_note`
- `max_per_paragraph`
- `allow_in_title`
- `blacklist`

Editor 负责按策略生成，Verifier 负责检查是否过量或风格失配。

### 5.1.6 产品主推型改写策略

该系统不仅要“改稿”，还要支持“把产品自然写成主角”的种草改写能力。

适用场景：

- 用户提供的原文里，生活习惯/场景占比过高，产品戏份太弱
- 用户明确要求“更像在说益生菌/产品”
- 用户提供了成功种草模板，希望系统按类似节奏重写

建议新增策略字段：

- `product_focus_level`
  - `low`：产品轻带，生活方式为主
  - `medium`：产品与生活习惯均衡
  - `high`：产品为主角，生活习惯仅做辅助
- `language_softness`
  - `clinical`：偏专业表达
  - `balanced`：专业与生活化平衡
  - `lifestyle`：大白话、闺蜜聊天式表达
- `fact_expression_style`
  - `plain_fact`：原始事实型
  - `seeded_fact`：种草型表达
  - `soft_fact`：口语化、生活化表达

第一版默认建议：

- `product_focus_level=high`
- `language_softness=lifestyle`
- `fact_expression_style=seeded_fact`

### 5.1.7 事实层与表达层分离

为了既不胡编，又能写得更像种草笔记，系统需要把“事实层”和“表达层”分开处理：

- 事实层（不可乱改）
  - 成分/规格/菌株/认证/研究等
  - 来自 BrandPack `fact_graph` 与结构化事实字段
- 表达层（可以改写）
  - 语气
  - 节奏
  - 口语化程度
  - 种草感/安利感

示例：

- 事实层：`150亿AKK菌 + B420 + 益生元`
- 生硬表达：`标注原研菌株 AKK MucT-`
- 更合适表达：`Akk MucT菌株可是获得欧洲EFSA安全认证和澳洲TGA双认证哦`

要求：

- 事实不变
- 句式可重写
- Verifier 负责检查是否改写后仍与事实一致

### 5.1.8 专业术语软化策略

当 `language_softness=lifestyle` 时，Editor 应主动把过于专业、医疗化、课本化的表达软化为生活语言。

例如：

- `肠道菌群`
  - 可软化为：`肚子里的小环境` / `肚肚里的节奏`
- `代谢节奏`
  - 可软化为：`身体的小马达` / `身体变懒了`
- `停滞`
  - 可软化为：`囤着不走` / `堵得慌`

约束：

- 软化表达不能变成虚假承诺
- 软化后仍需保持可读性，不可过度低幼化
- 不同人设需要不同软化程度（例如教师/职场人可稍微收敛）

### 5.1.9 产品主次重心重写

当 `product_focus_level=high` 时，Editor 应主动重排篇幅重心：

- 生活习惯段缩短为“辅助背景”
- 产品段扩充为“主承接段”
- 痛点与产品之间要建立明确承接关系

推荐结构：

1. 痛点/场景引入
2. 为什么仅靠生活习惯不够
3. 产品作为关键主角出场
4. 产品事实与感受承接
5. 生活习惯只保留为辅助建议

目标：

- 不再出现“前面 80% 都在说生活习惯，产品只是顺手一提”
- 用户一眼看过去能感知到“这是在种草益生菌/产品”

### 5.1.10 style_reference 如何驱动产品主推

当用户提供的是“成功种草模板”时，系统应学习：

- 钩子节奏
- 种草推进顺序
- 产品出场时机
- “痛点 -> 产品 -> 感受” 的承接方式

而不是机械模仿句子。

要求：

- 可借结构与节奏
- 必须替换成当前产品事实与当前人设痛点
- 若参考文案“产品存在感强”，则当前改写应同步提高 `product_focus_level`

### 5.2 Verifier（复核）

目标：不改写，只判卷。

输出（强制 JSON）：

- `pass: boolean`
- `confidence`
- `needs_safe_rewrite: boolean`（如缺事实/高风险，建议进入 Safe Rewrite）
- `violations[]`
  - `group`
  - `type`
  - `severity`
  - `evidence_snippet`
  - `reason`
  - `fix_hint`
- `summary`
  - `compliance_count`
  - `product_logic_count`
  - `style_count`

### 5.2.1 产品卖点逻辑校验（必须内置，不可只靠人工）

该功能不能只解决“禁词”和“风格”问题，还必须自动识别产品信息在文案中的逻辑错误。

这类错误在真实种草稿里非常高频，且通常不是明显假话，而是：

- 成分写全了，但修饰关系错了
- 数值写对了，但数值挂错对象
- 认证存在，但认证主体写错
- 研究存在，但研究对象/归属写错
- 金标/银标事实混写
- 产品事实与口语化表达混写后，句子变顺了但逻辑变错了

因此第一版必须增加一层 `product_logic_verifier` 能力，可作为 Verifier 的子模块实现，不一定单独起模型角色。

校验维度至少包括：

- `amount_binding_check`
  - 检查数值修饰对象是否正确
  - 例如不能把 `150亿` 误修饰成整个“三生元组合”
- `formula_completeness_check`
  - 如果写了“三生元配方”，是否把该配方要求的关键组成说完整
- `entity_binding_check`
  - 检查“认证/研究/共创/临床验证”的主体是否绑定到正确实体
  - 例如认证属于菌株，不应误写成品牌整体
- `sku_isolation_check`
  - 检查银标与金标事实是否串用
  - 例如金标专属信息不能无依据写到银标上
- `fact_sentence_naturalness_check`
  - 检查事实虽然都对，但句子是否存在明显的病句式拼接
  - 例如“150亿AKK MucT原研菌株+B420+益生元”这类逻辑上不顺的表达

### 5.2.1.2 RiskLocator（风险来源定位）

系统不应宣称“精准猜中平台到底卡了哪个词”，但应具备“高概率定位风险来源”的能力。

建议增加 `RiskLocator` 子模块，输入包括：

- 当前原文
- RulePack
- RiskPack / ReviewPack
- BrandPack
- 历史相似案例（如有）

输出目标：

- `suspected_risk_terms[]`
- `suspected_risk_phrases[]`
- `suspected_risk_structures[]`
- `risk_reasoning`
- `confidence`

定位原则：

- 优先给出“高疑似风险来源”
- 不承诺 100% 还原平台机审规则
- 重点服务于后续的低损伤改写

### 5.2.1.3 MarketingRetention（营销保真）

为了做到“改掉风险但尽量不伤种草效果”，系统需要显式引入营销保真目标，而不是默认一降风险就牺牲表达。

建议增加：

- `marketing_retention_score`
- `retained_elements[]`
  - 保留的痛点
  - 保留的人设
  - 保留的情绪
  - 保留的产品主角感
- `lost_elements[]`
  - 被迫弱化或删除的卖点

改写原则：

- 优先删除高风险表达，不优先删除种草骨架
- 若无法同时保留合规与强营销，则优先保留：
  - 人设
  - 场景
  - 痛点共鸣
  - 产品出场逻辑
- Safe Rewrite 也不应退化成“说明书体”

### 5.2.1.1 product_logic_verifier 通用判错模板

为支持全品类复用，`product_logic_verifier` 建议输出统一 violation 类型，而不是按某个产品单独写规则。

建议类型：

- `amount_subject_mismatch`
  - 数值与对象绑定错误
- `formula_incomplete`
  - 提到配方类型，但关键组成缺失
- `formula_component_mismatch`
  - 配方组成写错或串用
- `certification_subject_mismatch`
  - 认证主体错误
- `research_subject_mismatch`
  - 研究主体错误
- `claim_subject_mismatch`
  - 卖点或功效主体错误
- `sku_fact_leak`
  - A SKU 的事实被写到 B SKU
- `category_extension_mismatch`
  - 命中了某品类专属逻辑错误
- `fact_sentence_awkward`
  - 事实关系未错，但表达关系不自然

返回结构建议：

```json
{
  "pass": false,
  "violations": [
    {
      "type": "amount_subject_mismatch",
      "severity": "high",
      "evidence_snippet": "每粒含150亿XXX配方",
      "expected_subject": "AKK菌",
      "actual_subject": "三生元配方",
      "fix_hint": "把数值绑定到具体成分，不要绑定到整套组合"
    }
  ]
}
```

处理建议：

- `high`
  - 直接打回重写
- `medium`
  - 定点修复后再复核
- `low`
  - 可作为润色建议，不阻断导出

### 5.2.2 典型错误类型（系统必须能拦）

以用户当前场景为例，系统应能自动识别以下问题：

- 数值挂错对象
  - 错：`每粒含150亿AKK MucT原研菌株+B420+益生元`
  - 对：`每粒含150亿AKK菌，搭配B420和益生元，是三生元配方`
- 菌株与菌量混写
  - 错：`150亿AKK MucT原研菌株`
  - 对：`150亿AKK菌，所用菌株为Akk MucT`
- 认证主体错误
  - 错：`品牌获得EFSA/TGA双认证`
  - 对：`Akk MucT菌株获得欧洲EFSA安全认证和澳洲TGA双认证`
- 研究归属错误
  - 错：`银标登上《自然医学》`
  - 对：`Akk MucT菌株相关研究成果发表在《Nature Medicine（自然医学）》上`
- SKU 信息串用
  - 错：把金标专属临床验证或共创信息直接写进银标卖点主段
  - 对：银标只写银标可用事实，金标若只是轻提，则只保留一句安全带过

补充说明：

- 上述示例只是某个具体产品下的表现
- 系统实现不能按这个产品写死规则
- 应抽象归入以下通用错误类别：
  - 数值主体错
  - 认证主体错
  - 研究主体错
  - SKU 串用
  - 句法关系错

### 5.2.3 BrandPack 需要支持“事实拆件”

为让系统真正识别上述错误，BrandPack 不能只存一堆平铺句子，而要支持结构化事实拆件。

建议产品事实最少拆成：

- `sku_id`
- `display_name`
- `amount_value`
- `amount_unit`
- `amount_subject`
- `strain_name`
- `formula_components[]`
- `formula_type`
- `certifications[]`
  - `cert_name`
  - `cert_subject`
- `research_mentions[]`
  - `publication_name`
  - `research_subject`
- `co_creation[]`
- `clinical_claims[]`
  - `claim_subject`
  - `claim_condition`
  - `claim_scope`

这样模型生成后，系统才能做“主语-谓语-宾语”级别的回查，而不是只做关键词命中。

### 5.2.3.1 通用校验与品类校验的协作方式

`product_logic_verifier` 不应只依赖单一规则表，而应采用：

- `base verifier`
  - 根据 `FactNode / FactRelation` 做全品类通用校验
- `category adapter`
  - 根据品类扩展 schema 做类目专属校验

例如：

- 通用层负责：
  - 数值绑定
  - 认证主体
  - 研究主体
  - SKU 串用
- 类目层负责：
  - 保健品的菌株/临床信息
  - 护肤品的浓度/肤质/测试类型
  - 母婴的月龄/阶段

这样新增类目时，只需要：

1. 先接入通用 BrandPack 骨架
2. 再补类目 adapter

不需要重写整个逻辑校验系统。

### 5.2.4 产出策略

这类问题不能只在最终验收时报错，而应在两处介入：

1. Editor 生成前
  - 把 BrandPack 事实先整理成“推荐表达片段”
  - 降低模型自由拼接导致的逻辑错位
2. Verifier 生成后
  - 对最终文本做产品逻辑回查
  - 发现错误则直接打回重写，不允许带错导出

结论：

- 本功能应包含“产品事实改写”
- 也必须包含“产品逻辑纠错”
- 否则系统只能写得像，不能写得准

### 5.3 回炉策略（定点修复，避免全篇重写）

- Round 1: Editor 正常改写
- Round 2: 仅根据 `fix_hint` 定点修复（可按段落重写）
- Round 3: 若仍 fail，则进入 Safe Rewrite

### 5.4 Safe Rewrite（保证产出）

目的：在“营销与安全冲突 / 事实不足 / 规则矛盾”时，生成一个更保守但可发布的终稿：

- 保留风格（人设/场景/节奏）
- 弱化/删除所有可能踩线的强承诺句式
- 仅引用 BrandPack 结构化事实 + 合规模板句
- 依然输出标题/正文/标签，确保可用

> Safe Rewrite 是“无人工”的兜底；是否频繁触发，将作为 RulePack/BrandPack 优化指标。

### 5.4.1 Safe Rewrite 多样性策略

为避免批量兜底稿过于相似，Safe Rewrite 第一版建议支持：

- 多模板池（按人设/场景/产品类型区分）
- 开头钩子句库
- 过渡句库
- 结尾 CTA 句库
- 可控同义替换

实现要求：

- 同一批次内，尽量避免相同模板连续复用
- 同一产品的多篇兜底稿，应在结构和措辞上有明显差异
- Safe Rewrite 产物仍需通过 Verifier 复核

## 6. 后端架构与数据模型

### 6.1 任务与条目

建议表：

- `xhs_batch_jobs`
  - `id`, `created_by`, `status`, `category_id`, `rule_pack_version`, `brand_pack_version`, `style_template_id`
  - `total_items`, `done_items`, `running_items`, `created_at`, `updated_at`
  - `export_all_md_status`, `export_feishu_status`
- `xhs_batch_items`
  - `id`, `batch_id`, `item_id`, `source_text`
  - `status`, `round`, `final_title`, `final_body`, `final_hashtags_json`
  - `verifier_json`, `safe_rewrite_used`, `error`, `duration_ms`
  - `model_meta_json`（模型、tokens、成本估算等）

推荐补充字段：

- `xhs_batch_jobs`
  - `input_type`（paste/file）
  - `run_mode`（trial/full）
  - `trial_sample_count`
  - `input_stats_json`（原始字符数、切分出的篇数、ai_assisted_split_count）
  - `estimated_tokens`
  - `estimated_cost`
  - `actual_tokens`
  - `actual_cost`
  - `export_all_md_url`
  - `export_feishu_doc_token`
  - `export_feishu_doc_url`
  - `export_feishu_doc_title`
  - `export_feishu_error`
  - `tag_policy_json`
  - `export_options_json`
  - `system_blocked`
  - `system_block_reason`
- `xhs_batch_items`
  - `source_title_guess`
  - `split_by`（rule/weak_rule/ai_assisted）
  - `editor_output_json`
  - `verifier_pass`
  - `verifier_confidence`
  - `rewrite_fail_reasons_json`
  - `safe_rewrite_reason`
  - `quality_score`
  - `copy_ready_text`（前端复制单篇时直接使用）
  - `started_at`, `finished_at`

#### 6.1.2 成本预估与系统性阻断

第一版建议增加两类任务级能力：

1. 成本预估
  - 创建 batch 前，根据输入篇数、平均长度、预估回炉次数计算：
    - `estimated_tokens`
    - `estimated_cost`
  - 前端在大批量任务前给出提示，避免误触发高成本调用
2. 系统性错误阻断
  - 若同一 batch 在短时间内连续出现大量同类错误，应自动暂停任务
  - 例如：
    - 连续多篇命中同一 `product_logic` 高危错误
    - 连续多篇命中同一 RulePack 冲突
    - 连续多篇因 BrandPack 主体绑定错误被打回

阻断后的系统行为：

- 将 batch 标记为 `system_blocked=true`
- 记录 `system_block_reason`
- 前端提示用户优先检查 BrandPack / RulePack / 当前配置

### 6.1.1 配置类表（建议）

- `xhs_categories`
  - `id`, `name`, `description`, `status`, `created_at`
- `xhs_rule_packs`
  - `id`, `category_id`, `name`, `version`, `status`, `is_default`, `rules_json`, `created_by`, `created_at`
- `xhs_brand_packs`
  - `id`, `brand_name`, `version`, `status`, `is_default`, `pack_json`, `created_by`, `created_at`
- `xhs_brief_packs`
  - `id`, `brand_name`, `category_id`, `version`, `status`, `pack_json`, `created_by`, `created_at`
- `xhs_risk_packs`
  - `id`, `category_id`, `name`, `version`, `status`, `pack_json`, `created_by`, `created_at`
- `xhs_style_templates`
  - `id`, `name`, `status`, `template_json`, `created_at`
- `xhs_export_logs`
  - `id`, `batch_id`, `type`（all_md/feishu）, `status`, `request_json`, `response_json`, `error`, `created_at`

### 6.2 异步执行

- Celery 队列按 batch 分片处理（装箱：每批 5-20 篇，按 token 预算动态）
- 每篇的核心状态机在 DB 中推进，支持断点续跑与重试
- SSE/轮询提供实时进度

### 6.3 BrandPack 后台录入与发布流程

为了让 BrandPack 真的可维护，而不是停留在文档设计，后台需要提供一套“自动抽取 + 人工确认 + 版本发布”的工作流。

建议流程：

1. 新建 BrandPack
  - 选择品牌
  - 选择品类
  - 输入版本号或自动生成草稿版本
2. 上传资料
  - 支持粘贴文本 / 上传 txt、docx、pdf、xlsx
  - 资料类型可选：
    - 产品卖点文档
    - 包装文案
    - FAQ
    - 认证摘要
    - 研究摘要
    - SKU 清单
3. 系统自动抽取
  - 提取 SKU
  - 提取通用事实骨架
  - 提取品类扩展字段
  - 生成 `FactNode / FactRelation`
4. 人工确认
  - 重点确认高风险字段
  - 修正错误绑定关系
5. 保存草稿
  - 允许多次编辑
6. 发布版本
  - 发布后可供任务引用
  - 老版本保留可回滚

#### 6.3.1 后台页面建议

BrandPack 后台建议拆成 4 个页签：

- `基础信息`
  - 品牌
  - 品类
  - 产品线
  - 版本号
  - 状态
- `原始资料`
  - 已上传文件
  - 原始文本预览
  - 资料来源备注
- `结构化事实`
  - SKU 列表
  - 核心事实字段
  - 品类扩展字段
  - 事实图预览
- `营销表达`
  - 推荐表达
  - 软化表达
  - 禁用表达
  - CTA 资源

#### 6.3.2 人工确认优先级

不是所有字段都要求人工逐条精修，第一版建议只强制确认高风险关系：

- `amount_subject`
- `formula_components`
- `certification_subject`
- `research_subject`
- `claim_subject`
- `sku_isolation`

如果这些字段未确认，则：

- BrandPack 状态只能为 `draft`
- 不允许发布为 `active`

#### 6.3.3 发布与版本管理

建议状态机：

- `draft`
- `reviewing`
- `active`
- `archived`

版本规则：

- 每次发布生成不可变版本快照
- 批量任务保存所引用的 `brand_pack_version`
- 后续即使 BrandPack 更新，已完成任务仍保持可追溯

#### 6.3.3.1 BrandPack 保存前冲突检测

在 BrandPack 保存或发布前，系统应自动执行一轮冲突检测，避免把明显有问题的配置放进生产环境。

检测范围建议包括：

- 命名规则与 RulePack 禁词冲突
- SKU 之间的事实互相矛盾
- `amount_subject / certification_subject / research_subject / claim_subject` 缺失
- 品类扩展字段与核心字段冲突
- `forbidden_phrasings` 与 `recommended_phrasings` 自相矛盾

若命中高优先级冲突：

- 不允许直接发布 `active`
- 前台显示冲突摘要与修复建议

#### 6.3.4 自动抽取失败的兜底策略

若系统无法稳定抽出结构化事实，不应阻断整包录入，而应降级为：

- 允许人工直接录入 `L1 核心字段`
- 允许暂时缺省 `L2/L3`
- 允许先发布“低完整度 BrandPack”

但系统需要记录：

- `schema_completeness_level`
- `missing_required_fields[]`
- `manual_override_fields[]`

这样后续可逐步补齐，而不是因为资料不整齐无法上线。

## 7. API 设计（草案）

以 `/api/v1` 为前缀。

- `POST /xhs/batches`
  - body: `{input_text|file_id, category_id, rule_pack_version, brand_pack_id, product_ids, style_template_id, tag_policy, export_options}`
  - resp: `{batch_id}`
- `GET /xhs/batches/{batch_id}`
  - resp: 批量状态与摘要
- `GET /xhs/batches/{batch_id}/items?status=&q=&page=`
  - resp: 条目列表
- `POST /xhs/batches/{batch_id}/retry`
  - 失败条目重试（通常不需要用户点，主要用于管理员）
- `GET /xhs/batches/{batch_id}/export/all.md`
  - 生成/下载合并稿
- `POST /xhs/batches/{batch_id}/export/feishu`
  - 将合并稿写入飞书文档（支持指定 folder）

推荐补充接口：

- `GET /xhs/config/categories`
  - 获取品类列表
- `GET /xhs/config/rule-packs?category_id=`
  - 获取某品类可用规则包
- `GET /xhs/config/brand-packs?category_id=&q=`
  - 获取品牌包列表
- `GET /xhs/config/brief-packs?category_id=&q=`
  - 获取 brief 包列表
- `GET /xhs/config/risk-packs?category_id=`
  - 获取风险经验包列表
- `POST /xhs/config/rule-packs`
  - 新增/保存规则包（后台）
- `POST /xhs/config/brand-packs`
  - 上传/保存品牌包（后台）
- `POST /xhs/config/brief-packs`
  - 上传/保存 brief 包（后台）
- `POST /xhs/config/risk-packs`
  - 上传/保存风险经验包（后台）
- `POST /xhs/config/brief-packs/parse`
  - 上传 brief 并解析为结构化草稿
- `GET /xhs/batches/{batch_id}/export/feishu/status`
  - 查询飞书导出状态与文档链接

### 7.1 返回状态建议

批量任务状态：

- `pending`
- `splitting`
- `queued`
- `running`
- `partially_done`
- `done`
- `exporting`
- `exported`
- `failed`

单篇状态：

- `pending`
- `editing`
- `verifying`
- `rewrite_round_2`
- `rewrite_round_3`
- `safe_rewrite`
- `done`
- `failed`

### 7.2 核心接口示例

#### 7.2.1 创建批量任务

`POST /api/v1/xhs/batches`

请求示例：

```json
{
  "input_text": "第一篇文案内容\\n\\n---\\n\\n第二篇文案内容",
  "category_id": "healthcare",
  "rule_pack_version": "2026.03.1",
  "risk_pack_version": "2026.03.1",
  "brand_pack_id": "brandpack_001",
  "brief_pack_id": "briefpack_001",
  "product_ids": ["gold"],
  "style_template_id": "xiaohongshu_real_share",
  "run_mode": "trial",
  "tag_policy": {
    "functional_tags": ["打工人日常", "懒人轻养生"],
    "brand_tags": ["innerhealth益生菌", "茵澳斯AKK金标"],
    "tag_max_count": 8
  },
  "export_options": {
    "all_md": true,
    "feishu_export": true,
    "feishu_folder_token": "fldcnxxxxxxxx"
  }
}
```

响应示例：

```json
{
  "batch_id": "xhs_batch_20260319_001",
  "status": "splitting",
  "message": "批量任务已创建"
}
```

#### 7.2.2 查询批量任务详情

`GET /api/v1/xhs/batches/{batch_id}`

响应示例：

```json
{
  "id": "xhs_batch_20260319_001",
  "status": "running",
  "total_items": 128,
  "done_items": 84,
  "running_items": 22,
  "failed_items": 0,
  "safe_rewrite_items": 6,
  "input_stats": {
    "raw_chars": 58221,
    "split_count": 128,
    "ai_assisted_split_count": 7
  },
  "export": {
    "all_md_status": "pending",
    "feishu_status": "pending"
  }
}
```

#### 7.2.3 查询单篇列表

`GET /api/v1/xhs/batches/{batch_id}/items?page=1&page_size=20`

响应示例：

```json
{
  "items": [
    {
      "id": "item_0001",
      "index": 1,
      "status": "done",
      "title": "打工人轻养生好物分享",
      "quality_score": 0.93,
      "safe_rewrite_used": false
    },
    {
      "id": "item_0002",
      "index": 2,
      "status": "done",
      "title": "久坐通勤党状态调整记录",
      "quality_score": 0.81,
      "safe_rewrite_used": true
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 128
}
```

#### 7.2.4 下载 all.md

`GET /api/v1/xhs/batches/{batch_id}/export/all.md`

响应：

- `200 text/markdown`
- 文件名建议：`xhs_batch_20260319_001_all.md`

#### 7.2.5 导出到飞书

`POST /api/v1/xhs/batches/{batch_id}/export/feishu`

请求示例：

```json
{
  "folder_token": "fldcnxxxxxxxx",
  "doc_title": "小红书批量终稿_20260319_001"
}
```

响应示例：

```json
{
  "status": "exporting",
  "message": "正在创建飞书文档"
}
```

#### 7.2.6 查询飞书导出状态

`GET /api/v1/xhs/batches/{batch_id}/export/feishu/status`

响应示例：

```json
{
  "status": "success",
  "docs": [
    {
      "doc_token": "doccn_part_001",
      "doc_title": "小红书批量终稿_20260319_001_1",
      "doc_url": "https://example.feishu.cn/docx/doccn_part_001",
      "item_range": "1-150"
    },
    {
      "doc_token": "doccn_part_002",
      "doc_title": "小红书批量终稿_20260319_001_2",
      "doc_url": "https://example.feishu.cn/docx/doccn_part_002",
      "item_range": "151-280"
    }
  ]
}
```

## 8. 导出规范

### 8.1 all.md 合并稿格式（只含终稿）

固定格式，便于“全选复制一千篇”：

```
# 小红书批量终稿

## 0001｜<人设/场景标题>
标题：<笔记标题>

<正文...>

<标签行: #tag1 #tag2 ...>

---

## 0002｜<人设/场景标题>
标题：<笔记标题>
...
```

约束：

- 整份导出文档只允许一个 H1：`# 小红书批量终稿`
- 每篇只允许一个 H2：`## 0001｜人设角度·xxx`
- 每篇笔记标题使用普通文本行：`标题：xxx`，不是 H3/H4
- 正文全部为普通文本（T），段与段之间空一行
- 标签为普通文本，放在每篇最后一行
- `---` 只用于分隔“篇与篇”，不允许模型产生（由系统生成）
- 每篇内部不允许 `---`，避免与分隔混淆
- 模型不得直接控制最终 Markdown 层级；最终 H1/H2/T 排版必须由系统统一生成
- 所有复制、下载、飞书导出均使用系统生成的 `copy_ready_text`

进一步约束：

- 标签统一输出为单独一行：`#tag1 #tag2 #tag3`
- 默认正文段落建议控制在 3-6 段
- 若风格模板未明确允许，正文中尽量去除复杂项目符号（如 `① ② ✅ ▶`）残留
- 最终 `copy_ready_text` 必须经过统一排版器二次清洗，包括：
  - 压缩多余空行
  - 统一标点与中英文空格
  - 去除模型残留 Markdown
  - 统一 emoji 间距与断行

### 8.2 飞书导出（第一版）

目标：把 `all.md` 的内容写入飞书云文档（Doc），并在每次导出时创建一份**新的**飞书文档。

配置（TaskConfig 或系统配置）：

- `feishu.app_id`
- `feishu.app_secret`
- `feishu.folder_token`（目标文件夹；第一版可为默认/任意可写文件夹，不要求用户每次选择）
- `feishu.doc_title`（默认: `批量终稿_YYYYMMDD_HHMM`，每次导出生成不同标题/不同文档）
- `feishu.split_policy`
  - 默认：`150 篇 / 文档`
  - 保护规则：若累计字符数或块数接近飞书上限，则提前拆分

第一版明确约束：

- 导出目标为 **飞书云文档**，不是知识库/Wiki。
- 每次点击“导出到飞书”都必须创建一份**新的文档**，禁止覆盖历史文档。
- 接入方式采用飞书**自建应用/机器人**模式，由服务端持有 `App ID / App Secret`。
- 目标文件夹第一版不做复杂选择逻辑，只要能写入一个预设或可配置的文件夹即可。
- 导出成功后，后端返回新建文档的 `doc_token`、访问链接、标题，供前端展示与跳转。
- 第一版不建议把大量篇数强行塞进单个飞书文档；应按 `split_policy` 自动拆分。

实现备注：

- 具体 API、鉴权方式（App/tenant token）按飞书开放平台文档落地。
- 第一版可先实现“服务端创建 Doc 并写入纯文本/Markdown-like 内容”，后续再做“结构化块级写入与样式”。

### 8.2.1 飞书导出服务端流程（第一版）

建议后端执行顺序：

1. 读取 batch 对应的 `all.md` 内容（如尚未生成则先生成）
2. 使用 `app_id/app_secret` 获取 tenant access token
3. 在预设 `folder_token` 下创建新文档
4. 写入文档标题（默认 `批量终稿_YYYYMMDD_HHMM_batchId`）
5. 将 `all.md` 内容按飞书文档接口支持的块级/段落级格式写入
6. 按 `split_policy` 自动拆成多个文档（默认每 150 篇一份，并受字符数/块数保护规则约束）
7. 回写 DB：
   - `export_feishu_status=success`
   - `export_feishu_doc_token`
   - `export_feishu_doc_url`
   - `export_feishu_doc_title`
8. 返回前端新文档链接

### 8.2.2 飞书导出失败重试策略

- 获取 tenant token 失败：最多重试 3 次，指数退避（1s/3s/8s）
- 创建文档失败：最多重试 3 次
- 写入内容失败：
  - 如果是限流/超时：按块重试 3 次
  - 如果是内容超长：按 `split_policy` 提前拆分再重试
- 所有重试失败后：
  - `export_feishu_status=failed`
  - 保存完整错误到 `xhs_export_logs`
  - 前端显示“导出失败，可重试”

## 8.3 前端导出与状态交互

### 8.3.1 页面按钮状态

- 主按钮：`AI 合规审核并生成完美版`
  - `idle`: 可点击
  - `submitting`: loading
  - `running`: 禁止重复提交
- 导出按钮：
  - `下载 all.md`
    - batch `done/partially_done` 可点击
  - `导出到飞书`
    - batch `done/partially_done` 可点击
    - 导出中显示 loading + “正在创建飞书文档”
    - 成功后显示“打开飞书文档”

### 8.3.2 页面提示文案（建议）

- 处理中：`AI 正在逐篇审核并改写，请勿关闭页面`
- 回炉中：`部分笔记正在自动复核并修正`
- 飞书导出中：`正在创建新的飞书文档并写入内容`
- 飞书导出成功：`飞书文档已创建`
- 飞书导出失败：`飞书导出失败，请重试`

### 8.3.3 结果页最简交互

- 顶部：
  - 总数
  - 已完成数
  - 回炉中数
  - Safe Rewrite 数
- 列表：
  - 每篇显示 `编号 + 标题 + 状态`
  - 操作：`查看终稿`、`复制单篇`
- 批量操作：
  - `下载 all.md`
  - `导出到飞书`
  - `复制当前页`

### 8.3.4 Verifier 结果结构与前台展示

这套功能不能只告诉用户“未通过”，还要让运营能快速看懂是：

- 合规问题
- 事实问题
- 产品逻辑问题
- 风格问题

建议 Verifier 输出进一步结构化为：

```json
{
  "pass": false,
  "confidence": 0.92,
  "needs_safe_rewrite": false,
  "violations": [
    {
      "group": "product_logic",
      "type": "certification_subject_mismatch",
      "severity": "high",
      "evidence_snippet": "品牌获得双认证",
      "reason": "认证主体应为菌株，不是品牌",
      "fix_hint": "改写为认证主体对应的实体"
    }
  ],
  "summary": {
    "compliance_count": 0,
    "product_logic_count": 1,
    "style_count": 0
  }
}
```

#### 8.3.4.1 前台默认展示

普通运营默认不需要看完整 JSON，但至少要看到：

- 当前状态
  - `已通过`
  - `自动修复中`
  - `已兜底改写`
- 问题摘要
  - 例如：`1 个产品逻辑问题，已自动修复`
  - 例如：`2 个表达风险，已降级处理`

#### 8.3.4.2 前台展开详情

用户点击“查看详情”后，建议按问题分组展示：

- `产品逻辑`
- `合规风险`
- `风格偏差`

每条显示：

- 问题类型
- 证据片段
- 原因
- 系统修复建议
- 当前处理状态

例如：

- 类型：`认证主体错误`
- 证据：`品牌获得双认证`
- 原因：`双认证属于菌株，不属于品牌`
- 处理：`已打回自动重写`

#### 8.3.4.3 面向运营的展示原则

前台不要直接暴露模型内部术语，而应转成可理解的话：

- `amount_subject_mismatch`
  - 前台显示：`数值对应对象写错了`
- `sku_fact_leak`
  - 前台显示：`不同产品的卖点混用了`
- `fact_sentence_awkward`
  - 前台显示：`产品信息语句不够通顺`

原则：

- 前台展示“业务语言”
- 后台保留“技术枚举值”

#### 8.3.4.4 导出前拦截策略

若存在以下问题，前端应明确标记该篇为“不可直接导出原稿”：

- `severity=high` 的 `product_logic`
- `severity=high` 的 `compliance`

系统行为：

- 默认继续自动修复
- 若已修复成功，则允许导出终稿
- 若进入 Safe Rewrite，则前台标记为：
  - `已自动降风险处理`

## 8.4 自动重试与失败处理

### 8.4.1 AI 调用重试

- 网络超时/429/5xx：自动重试 2-3 次
- 任一模型调用超时：记录到 `model_meta_json`
- 如果 Editor 连续失败：
  - 优先切换更小输入（按段重写）
  - 再不行进入 Safe Rewrite

### 8.4.2 单篇最终兜底

为了满足“无人工”目标，单篇不允许无结果结束：

- 优先尝试正常改写
- Verifier 不通过则定点修复
- 达到 `max_rounds` 后进入 Safe Rewrite
- Safe Rewrite 成功后状态记为 `done`，但 `safe_rewrite_used=true`

### 8.4.3 批量导出与部分完成

第一版建议支持：

- `done`：全部完成，可导出完整 `all.md` / 飞书
- `partially_done`：允许先导出已完成部分，页面需明确提示“当前为部分完成结果”

默认产品行为建议：

- 若用户点击导出时 batch 未全量完成，弹窗提示：
  - `导出已完成内容`
  - `等待全部完成`

## 9. 质量指标与验收

系统上线前至少需要一个“回归样本集”（真实笔记 50+）：

- 一次通过率（不回炉）  
- 最终通过率（含回炉与 Safe Rewrite）  
- 触发 Safe Rewrite 比例（越低越好）  
- 禁词漏检率（必须趋近 0）  
- 事实胡编率（必须趋近 0，靠 BrandPack 结构化事实控制）  
- 平均耗时（例如：100 篇 < X 分钟；1000 篇 < Y 分钟，取决于并发与模型配额）

## 10. 风险与边界

- 规则包互相矛盾会导致无限回炉：必须设置 `max_rounds` 与 Safe Rewrite 兜底。
- “营销效果 + 安全 + 无人工”三者冲突时：以“合规与不胡编”为硬底线；营销效果通过素材包与风格模板提升。
- 平台规则变化：需要 RulePack 版本化与回归测试机制。
