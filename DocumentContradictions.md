# 设计文档矛盾与模糊点分析 (V1.7)

本文档用于记录并跟踪 `内容卫士 AI 审核平台` 项目各设计文档之间的矛盾点与模糊点。

**最后检查时间：** 2026-02-03
**检查版本：** PRD V1.0, RequirementsDoc V1.0, FeatureSummary V1.6, DevelopmentPlan V1.6, tasks.md V1.6, UIDesignSpec V1.0, UIDesign V1.1, User_Role_Interfaces V1.5, AIProviderConfig V2.1, tdd_plan V1.0

---

## 1. 核心功能与技术实现

### 1.1 移动端交付形态 (已统一)
- **结论：** 统一为 **响应式 H5 / 小程序**，不开发原生 App。
- **对齐文档：** `DevelopmentPlan.md`、`User_Role_Interfaces.md`

### 1.2 Logo 检测职责边界 (已澄清)
- **结论：** 视觉模型仅用于画面语义/场景风险分析；竞品 Logo 检测由内置 CV 模型（Grounding DINO + Vector DB）处理，不受配置影响。
- **对齐文档：** `AIProviderConfig.md`、`UIDesign.md`、`User_Role_Interfaces.md`、`DevelopmentPlan.md`

### 1.3 文件上传方案 (已同步)
- **结论：** 批量上传采用 **多文件拖拽并发上传 + Tus 断点续传**，弃用 ZIP。
- **对齐文档：** `PRD.md`、`RequirementsDoc.md`、`FeatureSummary.md`、`DevelopmentPlan.md`

### 1.4 AI 厂商配置范围 (已统一)
- **结论：** 每租户仅配置**单一 AI 提供商**（OneAPI/OpenRouter 中转或直连厂商），不做自动故障转移；需要切换由管理员手动更新配置。
- **对齐文档：** `AIProviderConfig.md`、`PRD.md`、`RequirementsDoc.md`、`FeatureSummary.md`、`DevelopmentPlan.md`

---

## 2. 权限与工作流

### 2.1 强制通过与特例关系 (已统一)
- **结论：** "强制通过"弹窗内提供 **保存为特例** 勾选项（默认不勾选）；勾选后生成豁免条款并等待品牌方确认生效。
- **对齐文档：** `PRD.md`、`UIDesign.md`、`User_Role_Interfaces.md`

### 2.2 强制通过禁用后的流程 (已统一)
- **结论：** 品牌方关闭授权后，代理商端按钮文案变为"申请强制通过"，填写理由并提交品牌方审批。
- **对齐文档：** `PRD.md`、`UIDesign.md`、`User_Role_Interfaces.md`

### 2.3 AI 配置可见性 (已统一)
- **结论：** 代理商/达人 **不可见** AI 配置，仅品牌方管理员可查看与修改。
- **对齐文档：** `UIDesign.md`、`User_Role_Interfaces.md`、`AIProviderConfig.md`

---

## 3. AI 功能与 UI

### 3.1 多模态模型的 UI 呈现 (已统一)
- **结论：** 模型下拉选项显示能力标签（如 `gpt-4o [文字/视觉]`），便于识别多模态模型。
- **对齐文档：** `UIDesign.md`、`User_Role_Interfaces.md`

### 3.2 多租户 AI 配置范围 (已统一)
- **结论：** F-49 提升为 **P0**；MVP 必须包含多租户 AI 配置隔离能力。
- **对齐文档：** `FeatureSummary.md`、`tasks.md`、`DevelopmentPlan.md`、`PRD.md`

---

## 4. 文档一致性

### 4.1 TDD 计划文档 (已补齐)
- **结论：** 新增 `featuredoc/tdd_plan.md`，作为 `tasks.md` 中 TDD 引用的正式文档。
- **对齐文档：** `tasks.md`、`DevelopmentPlan.md`

### 4.2 视频采样率假设 (已同步)
- **结论：** CV 采样率默认 **2fps**，并在该采样率下验证时长统计准确性。
- **对齐文档：** `PRD.md`、`FeatureSummary.md`、`DevelopmentPlan.md`

### 4.3 UI 设计风格 (已统一)
- **问题：** 存在两份 UI 设计文档，风格不一致：
  - `UIDesign.md`: Apple Human Interface Guidelines **浅色系** (#FFFFFF 为主背景)
  - `UIDesignSpec.md`: Apple-style **暗色主题** (#0B0B0E 为页面背景)
- **结论：** 以 `UIDesignSpec.md` 和设计稿 `pencil-new.pen` 为准，采用 **暗色主题**。
- **已处理：** 在 `UIDesign.md` 头部添加废弃声明，指向 `UIDesignSpec.md` 为正式规范。
- **对齐文档：** `UIDesign.md`、`UIDesignSpec.md`
- **备注：** `tasks.md` 中的 UIDesign.md 引用保持不变，因 UIDesign.md 中的设计原则和交互说明仍有参考价值；具体颜色/组件规范以 UIDesignSpec.md 为准。

### 4.4 审计日志不可篡改实现 (已明确)
- **结论：** 采用 append-only + hash chain（前序哈希 + 当前内容）保证审计日志可追溯与不可篡改。
- **对齐文档：** `PRD.md`、`RequirementsDoc.md`、`FeatureSummary.md`、`DevelopmentPlan.md`、`tasks.md`

---

## 5. 数值与指标一致性 (已验证)

### 5.1 功能优先级数量
| 优先级 | PRD | FeatureSummary | DevelopmentPlan | tasks.md | 状态 |
| --- | --- | --- | --- | --- | --- |
| P0 (MVP) | 12项 (场景级) | 23 | 21 | 23 | ✅ 一致（新增 F-51, F-52） |
| P1 | 4项 (场景级) | 22 | - | 22 | ✅ 一致 |
| P2 | 2项 (场景级) | 8 | - | 8 | ✅ 一致 |

### 5.2 技术指标
| 指标 | PRD | FeatureSummary | DevelopmentPlan | 状态 |
| --- | --- | --- | --- | --- |
| 审核报告产出时间 | ≤ 5 分钟（含排队 ≤ 2 分钟） | ≤ 5 分钟（含排队 ≤ 2 分钟） | ≤ 5 分钟（含排队 ≤ 2 分钟） | ✅ 一致 |
| 竞品 Logo F1 | ≥ 0.85 | ≥ 0.85 | ≥ 0.85 | ✅ 一致 |
| ASR 字错率 | ≤ 10% | ≤ 10% | ≤ 10% | ✅ 一致 |
| OCR 准确率 | ≥ 95% | ≥ 95% | ≥ 95% | ✅ 一致 |
| 语境理解误报率 | ≤ 5% | ≤ 5% | ≤ 5% | ✅ 一致 |
| 时长统计误差 | ≤ 1秒 | ≤ 1秒 | ≤ 1秒 | ✅ 一致 |
| 频次统计准确率 | ≥ 95% | ≥ 95% | ≥ 95% | ✅ 一致 |
| 加密方案 | AES-256-GCM | AES-256-GCM | AES-256-GCM | ✅ 一致 |
| CV 采样率 | 2fps | 2fps | 2fps | ✅ 一致 |

### 5.3 开发周期
| 项目 | DevelopmentPlan | tasks.md | 状态 |
| --- | --- | --- | --- |
| 总周期 | 11 周 | 11 周 | ✅ 一致 |
| Phase 1 | Week 1-2 | Week 1-2 | ✅ 一致 |
| Phase 2 | Week 3-6 (4周) | Week 3-6 (4周) | ✅ 一致 |
| Phase 3 | Week 7-9 | Week 7-9 | ✅ 一致 |
| Phase 4 | Week 10-11 | Week 10-11 | ✅ 一致 |

### 5.4 测试覆盖率要求
| 类型 | DevelopmentPlan | tdd_plan.md | tasks.md | 状态 |
| --- | --- | --- | --- | --- |
| 后端覆盖率 | ≥ 80% | ≥ 80% | ≥ 80% | ✅ 一致 |
| 前端覆盖率 | ≥ 70% | ≥ 70% | ≥ 70% | ✅ 一致 |

---

## 6. 合理性评估 (已验证)

### 6.1 技术方案合理性
- ✅ **前后端分离 + AI 微服务化**：适合视频处理的高算力需求
- ✅ **FastAPI + Celery + Redis**：Python 生态成熟，适合 AI 集成
- ✅ **PostgreSQL + pgvector**：减少架构复杂度，统一向量检索
- ✅ **Tus 协议**：解决大文件上传不稳定问题
- ✅ **弹性 GPU 集群**：支持自动扩缩容，控制成本

### 6.2 时间估算合理性
- ✅ **Phase 2 延长至 4 周**：预留多模态时间戳对齐的工程时间
- ✅ **Phase 3 移动端 + 审核台**：3 周合理
- ✅ **Phase 4 联调验收**：2 周合理

### 6.3 功能优先级合理性
- ✅ **F-09 语境理解提升至 P0**：避免"人工智障"体验
- ✅ **F-17 进度展示提升至 P0**：缓解等待焦虑
- ✅ **F-05 拆分为 A/B**：MVP 聚焦核心防竞品能力
- ✅ **F-45 时长频次校验 P0**：满足 Brief 硬性指标
- ✅ **F-47/48/49 AI 配置 P0**：AI 服务基础设施

---

## 7. 已完成处理项

### 7.1 UI 设计文档统一 ✅
**状态：** 已完成 (2026-02-03)
**描述：** `UIDesign.md`（浅色系）与 `UIDesignSpec.md`（暗色主题）风格冲突
**决策：** 以 `UIDesignSpec.md` 和 `pencil-new.pen` 为准（暗色主题）
**已完成行动：**
1. ✅ 在 `UIDesign.md` 头部添加废弃声明，指向 `UIDesignSpec.md` 为正式规范
2. ✅ `tasks.md` 中的引用保持不变（设计原则部分仍有参考价值）

### 7.2 AIProviderConfig 文档引用更新 ✅
**状态：** 已完成 (2026-02-03)
**描述：** `AIProviderConfig.md` 第7章引用了已废弃的 `UIDesign.md`
**已完成行动：**
- ✅ 更新引用为 `User_Role_Interfaces.md` 第 4.6 章

### 7.3 tdd_plan.md 版本号补充 ✅
**状态：** 已完成 (2026-02-03)
**描述：** `tdd_plan.md` 缺少版本号和文档头部元信息
**已完成行动：**
- ✅ 添加文档头部元信息，版本号 V1.0

---

**当前状态：** ✅ 无待决策项。所有文档一致性问题已解决，可开始开发。

---

## 8. 检查历史

| 检查时间 | 版本 | 检查人 | 发现问题 | 处理结果 |
| --- | --- | --- | --- | --- |
| 2026-02-03 | V1.4 | Claude | UI设计风格不一致、版本号引用 | 已统一 |
| 2026-02-03 | V1.5 | Claude | AIProviderConfig引用过时、tdd_plan缺版本号 | 已修复 |
| 2026-02-03 | V1.6 | Claude | 新增 F-51 品牌方终审开关、F-52 审核流程进度可视化 | 已同步至全部文档 |
| 2026-02-03 | V1.7 | Claude | F-52 扩展为全角色（达人/代理商/品牌方）可见 | 已同步：FeatureSummary、tasks.md、User_Role_Interfaces、UI设计 |
