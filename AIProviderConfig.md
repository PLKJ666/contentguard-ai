# AIProviderConfig.md - AI 服务配置架构设计

| 文档类型 | **Technical Design (技术设计文档)** |
| --- | --- |
| **项目名称** | 内容卫士 AI 审核平台 (AI 营销内容合规审核平台) |
| **版本号** | V2.1 |
| **日期** | 2026-02-03 |
| **侧重** | AI 服务动态配置、多租户隔离、模型选择 |

---

## 版本历史 (Version History)

| 版本 | 日期 | 作者 | 变更说明 |
| --- | --- | --- | --- |
| V1.0 | 2026-02-02 | Claude | 初稿：AI 厂商动态配置架构设计 |
| V2.0 | 2026-02-02 | Claude | 重构：简化为统一提供商+三模型配置方案 |
| V2.1 | 2026-02-03 | Claude | 文档一致性修订：明确单提供商模式与可切换原则 |

---

## 1. 设计背景与目标

### 1.1 业务需求

内容卫士 AI 审核平台 系统需要调用三类 AI 服务完成视频审核：

| 服务类型 | 用途 | 示例模型 |
| --- | --- | --- |
| **文字处理模型** | Brief 解析、违禁词检测、语义分析、舆情分析 | claude-opus-4-5-20251101, deepseek-chat |
| **视频分析模型** | 画面理解、场景分析、产品识别 | Doubao-Seed-1.6-thinking, qwen-vl-max |
| **音频解析模型** | 视频口播转文字 (ASR) | whisper-large-v3, paraformer-v2 |

### 1.2 设计目标

| 目标 | 描述 |
| --- | --- |
| **灵活配置** | 品牌方可在后台自由选择 AI 提供商和模型 |
| **单一提供商** | 每租户仅保留一套提供商配置，必要时手动切换 |
| **统一接入** | 支持 OneAPI/OpenRouter 中转，一套配置调用多种模型 |
| **直连支持** | 也支持直连 Anthropic、OpenAI、DeepSeek 等厂商 |
| **多租户隔离** | 不同品牌方使用独立的 AI 配置和配额 |
| **动态模型列表** | 根据 API Key 自动获取可用模型 |
| **连接测试** | 保存前可测试三个模型的连通性 |

### 1.3 使用流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI 配置使用流程                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   🛡️ 品牌方配置 AI 服务                                                      │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  • 选择 AI 提供商 (OneAPI/Anthropic/OpenAI/...)                       │  │
│   │  • 填写 Base URL 和 API Key                                           │  │
│   │  • 选择三个模型 (文字处理/视频分析/音频解析)                            │  │
│   │  • 配置参数 (Temperature/Max Tokens)                                  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    │ 自动继承                                │
│                                    ▼                                         │
│   👥 代理商 / 👤 达人                                                        │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  上传视频 → 系统自动调用品牌方配置的 AI 服务 → 获得审核结果            │  │
│   │  (用户无感知，不知道也不需要关心使用的是哪个 AI)                        │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 系统架构

### 2.1 架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       品牌方管理后台 (Brand Admin)                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  系统设置 → AI 服务配置                                            │  │
│   │  • 选择提供商                                                      │  │
│   │  • 配置连接信息                                                    │  │
│   │  • 选择模型                                                        │  │
│   │  • 测试连接                                                        │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           API 层 (FastAPI)                               │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  GET  /api/v1/ai-config              - 获取当前配置                 │  │
│   │  PUT  /api/v1/ai-config              - 更新配置                    │  │
│   │  POST /api/v1/ai-config/models       - 获取可用模型列表             │  │
│   │  POST /api/v1/ai-config/test         - 测试连接 (三个模型)          │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       AI 服务路由器 (AIServiceRouter)                      │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  • 根据租户 ID 获取对应的 AI 配置                                   │  │
│   │  • 根据任务类型选择对应的模型                                       │  │
│   │  • 创建 AI 客户端并调用                                            │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │  文字处理    │ │  视频分析    │ │  音频解析    │
            │  Claude     │ │  豆包 VL    │ │  Whisper    │
            └─────────────┘ └─────────────┘ └─────────────┘
```

### 2.2 核心组件

| 组件 | 职责 |
| --- | --- |
| **AIConfig** | 数据模型，存储品牌方的 AI 配置 |
| **AIServiceRouter** | 路由器，根据租户和任务类型选择模型 |
| **AIClientFactory** | 工厂类，创建 OpenAI 兼容客户端 |
| **ModelRegistry** | 模型注册表，缓存可用模型列表 |
| **SecretsManager** | 加密存储和解密 API Key |

---

## 3. 数据模型设计

### 3.1 AI 配置表 (ai_configs)

```sql
CREATE TABLE ai_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 租户
    tenant_id       UUID NOT NULL UNIQUE,        -- 品牌方 ID，一个品牌方只有一条配置

    -- 提供商
    provider        VARCHAR(50) NOT NULL,        -- 提供商类型

    -- 连接配置
    base_url        VARCHAR(500) NOT NULL,       -- API Base URL
    api_key_encrypted BYTEA NOT NULL,            -- 加密后的 API Key

    -- 模型配置
    text_model      VARCHAR(100) NOT NULL,       -- 文字处理模型
    vision_model    VARCHAR(100) NOT NULL,       -- 视频分析模型
    audio_model     VARCHAR(100) NOT NULL,       -- 音频解析模型

    -- 参数配置
    temperature     DECIMAL(3,2) DEFAULT 0.7,    -- 温度参数
    max_tokens      INT DEFAULT 2000,            -- 最大 Token 数

    -- 缓存的可用模型列表
    available_models JSONB DEFAULT '{}',         -- {"text": [...], "vision": [...], "audio": [...]}
    models_updated_at TIMESTAMPTZ,               -- 模型列表更新时间

    -- 状态
    is_configured   BOOLEAN DEFAULT false,       -- 是否已完成配置
    last_test_at    TIMESTAMPTZ,                 -- 最后测试时间
    last_test_result JSONB,                      -- 最后测试结果

    -- 元数据
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_by      UUID,

    -- 外键
    CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES brands(id)
);

-- 索引
CREATE INDEX idx_ai_config_tenant ON ai_configs(tenant_id);
```

### 3.2 提供商类型枚举

```python
from enum import Enum

class AIProvider(str, Enum):
    """支持的 AI 提供商"""

    # 中转服务
    ONEAPI = "oneapi"               # OneAPI 中转
    OPENROUTER = "openrouter"       # OpenRouter

    # 直连厂商 - 国际
    ANTHROPIC = "anthropic"         # Anthropic Claude
    OPENAI = "openai"               # OpenAI

    # 直连厂商 - 国内
    DEEPSEEK = "deepseek"           # DeepSeek
    QWEN = "qwen"                   # 阿里云通义千问
    DOUBAO = "doubao"               # 字节豆包
    ZHIPU = "zhipu"                 # 智谱 GLM
    MOONSHOT = "moonshot"           # Moonshot (Kimi)


# 提供商默认 Base URL
PROVIDER_DEFAULT_URLS = {
    AIProvider.ANTHROPIC: "https://api.anthropic.com/v1",
    AIProvider.OPENAI: "https://api.openai.com/v1",
    AIProvider.DEEPSEEK: "https://api.deepseek.com/v1",
    AIProvider.QWEN: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    AIProvider.DOUBAO: "https://ark.cn-beijing.volces.com/api/v3",
    AIProvider.ZHIPU: "https://open.bigmodel.cn/api/paas/v4",
    AIProvider.MOONSHOT: "https://api.moonshot.cn/v1",
}
```

### 3.3 模型能力分类

```python
class ModelCapability(str, Enum):
    """模型能力类型"""
    TEXT = "text"           # 文字处理
    VISION = "vision"       # 视觉理解
    AUDIO = "audio"         # 音频处理


# 已知模型的能力映射（用于分类显示）
MODEL_CAPABILITIES = {
    # 文字处理模型
    "claude-opus-4-5-20251101": [ModelCapability.TEXT, ModelCapability.VISION],
    "claude-sonnet-4-20250514": [ModelCapability.TEXT, ModelCapability.VISION],
    "gpt-4o": [ModelCapability.TEXT, ModelCapability.VISION],
    "gpt-4o-mini": [ModelCapability.TEXT, ModelCapability.VISION],
    "deepseek-chat": [ModelCapability.TEXT],
    "deepseek-reasoner": [ModelCapability.TEXT],
    "qwen-max": [ModelCapability.TEXT],
    "qwen-plus": [ModelCapability.TEXT],
    "glm-4": [ModelCapability.TEXT],
    "moonshot-v1-128k": [ModelCapability.TEXT],

    # 视觉模型
    # 注：Logo 检测由系统内置 CV 模型（Grounding DINO）处理，不受此配置影响。
    # 品牌方配置的视觉模型仅用于语义场景理解（如环境分析、画面质量判定）。
    "qwen-vl-max": [ModelCapability.VISION],
    "qwen-vl-plus": [ModelCapability.VISION],
    "Doubao-Seed-1.6-thinking": [ModelCapability.VISION],
    "doubao-vision-pro": [ModelCapability.VISION],
    "glm-4v": [ModelCapability.VISION],

    # 音频模型
    "whisper-large-v3": [ModelCapability.AUDIO],
    "whisper-1": [ModelCapability.AUDIO],
    "paraformer-v2": [ModelCapability.AUDIO],
    "sensevoice": [ModelCapability.AUDIO],
}
```

---

## 4. API 接口设计

### 4.1 获取当前配置

```
GET /api/v1/ai-config
Authorization: Bearer {token}
```

**响应：**
```json
{
  "provider": "oneapi",
  "base_url": "https://ai.example.com/v1",
  "api_key_masked": "sk-****...****",
  "models": {
    "text": "claude-opus-4-5-20251101",
    "vision": "Doubao-Seed-1.6-thinking",
    "audio": "whisper-large-v3"
  },
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 2000
  },
  "available_models": {
    "text": ["claude-opus-4-5-20251101", "deepseek-chat", "gpt-4o", ...],
    "vision": ["Doubao-Seed-1.6-thinking", "qwen-vl-max", "gpt-4o", ...],
    "audio": ["whisper-large-v3", "paraformer-v2", ...]
  },
  "is_configured": true,
  "last_test_at": "2026-02-02T10:30:00Z",
  "last_test_result": {
    "text": {"success": true, "latency_ms": 342},
    "vision": {"success": true, "latency_ms": 528},
    "audio": {"success": true, "latency_ms": 215}
  }
}
```

> **模型说明：** 同一模型可能同时出现在 `text` 与 `vision` 列表中，名称保持一致，仅能力标签不同（如 `gpt-4o` 兼具文字与视觉能力）。

> **未配置说明：** 若租户未完成 AI 配置，接口返回明确错误（如 409/404），前端需提示品牌方完成配置；所有 AI 调用在此之前应被阻断。

### 4.2 更新配置

```
PUT /api/v1/ai-config
Authorization: Bearer {token}
Content-Type: application/json

{
  "provider": "oneapi",
  "base_url": "https://ai.example.com/v1",
  "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  "models": {
    "text": "claude-opus-4-5-20251101",
    "vision": "Doubao-Seed-1.6-thinking",
    "audio": "whisper-large-v3"
  },
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 2000
  }
}
```

### 4.3 获取可用模型列表

```
POST /api/v1/ai-config/models
Authorization: Bearer {token}
Content-Type: application/json

{
  "provider": "oneapi",
  "base_url": "https://ai.example.com/v1",
  "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
}
```

**响应：**
```json
{
  "success": true,
  "models": {
    "text": [
      {"id": "claude-opus-4-5-20251101", "name": "Claude Opus 4.5"},
      {"id": "deepseek-chat", "name": "DeepSeek Chat"},
      {"id": "gpt-4o", "name": "GPT-4o"},
      ...
    ],
    "vision": [
      {"id": "Doubao-Seed-1.6-thinking", "name": "豆包 Seed 1.6"},
      {"id": "qwen-vl-max", "name": "通义千问 VL Max"},
      {"id": "gpt-4o", "name": "GPT-4o"},
      ...
    ],
    "audio": [
      {"id": "whisper-large-v3", "name": "Whisper Large V3"},
      {"id": "paraformer-v2", "name": "Paraformer V2"},
      ...
    ]
  }
}
```

### 4.4 测试连接

```
POST /api/v1/ai-config/test
Authorization: Bearer {token}
Content-Type: application/json

{
  "provider": "oneapi",
  "base_url": "https://ai.example.com/v1",
  "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  "models": {
    "text": "claude-opus-4-5-20251101",
    "vision": "Doubao-Seed-1.6-thinking",
    "audio": "whisper-large-v3"
  }
}
```

**响应：**
```json
{
  "success": false,
  "results": {
    "text": {
      "success": true,
      "latency_ms": 342,
      "model": "claude-opus-4-5-20251101"
    },
    "vision": {
      "success": true,
      "latency_ms": 528,
      "model": "Doubao-Seed-1.6-thinking"
    },
    "audio": {
      "success": false,
      "error": "Model not found or unauthorized",
      "model": "whisper-large-v3"
    }
  },
  "message": "1 个模型连接失败，请检查模型名称或 API 权限"
}
```

---

## 5. 核心代码设计

### 5.1 配置模型 (Pydantic)

```python
# app/models/ai_config.py

from pydantic import BaseModel, Field, SecretStr
from typing import Optional, Dict, List
from decimal import Decimal

from app.models.enums import AIProvider


class AIModelsConfig(BaseModel):
    """三个模型配置"""
    text: str = Field(..., description="文字处理模型")
    vision: str = Field(..., description="视频分析模型")
    audio: str = Field(..., description="音频解析模型")


class AIParametersConfig(BaseModel):
    """参数配置"""
    temperature: Decimal = Field(default=Decimal("0.7"), ge=0, le=1)
    max_tokens: int = Field(default=2000, ge=100, le=32000)


class AIConfigUpdate(BaseModel):
    """更新 AI 配置请求"""
    provider: AIProvider
    base_url: str
    api_key: SecretStr
    models: AIModelsConfig
    parameters: AIParametersConfig = AIParametersConfig()


class AIConfigResponse(BaseModel):
    """AI 配置响应"""
    provider: AIProvider
    base_url: str
    api_key_masked: str  # 脱敏后的 API Key
    models: AIModelsConfig
    parameters: AIParametersConfig
    available_models: Dict[str, List[dict]]
    is_configured: bool
    last_test_at: Optional[str]
    last_test_result: Optional[dict]


class ModelTestResult(BaseModel):
    """单个模型测试结果"""
    success: bool
    latency_ms: Optional[int] = None
    error: Optional[str] = None
    model: str


class TestConnectionResponse(BaseModel):
    """测试连接响应"""
    success: bool  # 三个都成功才为 True
    results: Dict[str, ModelTestResult]
    message: str
```

### 5.2 AI 服务路由器

```python
# app/services/ai/router.py

from typing import Optional
from uuid import UUID

from app.models.ai_config import AIModelsConfig, AIParametersConfig
from app.repositories.ai_config_repo import AIConfigRepository
from app.services.ai.client_factory import AIClientFactory


class AIServiceRouter:
    """AI 服务路由器 - 根据租户获取配置并调用对应模型"""

    def __init__(
        self,
        config_repo: AIConfigRepository,
        client_factory: AIClientFactory,
    ):
        self.config_repo = config_repo
        self.client_factory = client_factory

    async def get_config(self, tenant_id: UUID) -> dict:
        """获取租户的 AI 配置"""
        config = await self.config_repo.get_by_tenant(tenant_id)
        if not config or not config.is_configured:
            # 未配置时阻断调用并提示品牌方完成配置
            raise ValueError(f"AI service not configured for tenant {tenant_id}")
        return config

    async def chat(
        self,
        tenant_id: UUID,
        messages: list,
        model_type: str = "text",  # text / vision / audio
        **kwargs
    ) -> dict:
        """统一的对话接口"""
        config = await self.get_config(tenant_id)

        # 根据类型选择模型
        model = getattr(config.models, model_type)

        # 获取客户端
        client = await self.client_factory.get_client(
            base_url=config.base_url,
            api_key=config.api_key,
        )

        # 调用
        return await client.chat(
            messages=messages,
            model=model,
            temperature=float(config.parameters.temperature),
            max_tokens=config.parameters.max_tokens,
            **kwargs
        )

    async def transcribe(
        self,
        tenant_id: UUID,
        audio_file: bytes,
    ) -> dict:
        """音频转文字"""
        config = await self.get_config(tenant_id)

        client = await self.client_factory.get_client(
            base_url=config.base_url,
            api_key=config.api_key,
        )

        return await client.transcribe(
            audio=audio_file,
            model=config.models.audio,
        )
```

### 5.3 测试连接服务

```python
# app/services/ai/connection_tester.py

import asyncio
from typing import Dict
from openai import AsyncOpenAI

from app.models.ai_config import ModelTestResult, TestConnectionResponse


class AIConnectionTester:
    """AI 连接测试服务"""

    async def test_all_models(
        self,
        base_url: str,
        api_key: str,
        models: Dict[str, str],  # {"text": "...", "vision": "...", "audio": "..."}
    ) -> TestConnectionResponse:
        """并行测试三个模型"""

        # 并行执行测试
        tasks = [
            self._test_model(base_url, api_key, model_type, model_id)
            for model_type, model_id in models.items()
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 整理结果
        result_dict = {}
        all_success = True
        failed_count = 0

        for model_type, result in zip(models.keys(), results):
            if isinstance(result, Exception):
                result_dict[model_type] = ModelTestResult(
                    success=False,
                    error=str(result),
                    model=models[model_type]
                )
                all_success = False
                failed_count += 1
            else:
                result_dict[model_type] = result
                if not result.success:
                    all_success = False
                    failed_count += 1

        # 生成消息
        if all_success:
            message = "所有模型连接成功"
        else:
            message = f"{failed_count} 个模型连接失败，请检查模型名称或 API 权限"

        return TestConnectionResponse(
            success=all_success,
            results=result_dict,
            message=message
        )

    async def _test_model(
        self,
        base_url: str,
        api_key: str,
        model_type: str,
        model_id: str,
    ) -> ModelTestResult:
        """测试单个模型"""
        import time

        client = AsyncOpenAI(base_url=base_url, api_key=api_key)

        start_time = time.time()

        try:
            if model_type == "audio":
                # ASR 模型测试 - 检查模型是否存在
                models = await client.models.list()
                model_exists = any(m.id == model_id for m in models.data)
                if not model_exists:
                    return ModelTestResult(
                        success=False,
                        error="Model not found",
                        model=model_id
                    )
            else:
                # 文字/视觉模型测试 - 发送简单请求
                await client.chat.completions.create(
                    model=model_id,
                    messages=[{"role": "user", "content": "Hi"}],
                    max_tokens=5,
                )

            latency_ms = int((time.time() - start_time) * 1000)

            return ModelTestResult(
                success=True,
                latency_ms=latency_ms,
                model=model_id
            )

        except Exception as e:
            return ModelTestResult(
                success=False,
                error=str(e),
                model=model_id
            )
```

---

## 6. 安全设计

### 6.1 API Key 加密存储

- 使用 AES-256-GCM 加密存储 API Key
- 主密钥从环境变量或密钥管理服务 (Vault/KMS) 获取
- API 响应中永不返回完整 API Key，仅返回脱敏版本

```python
def mask_api_key(api_key: str) -> str:
    """API Key 脱敏"""
    if len(api_key) <= 8:
        return "****"
    return f"{api_key[:4]}...{api_key[-4:]}"
```

### 6.2 权限控制

| 操作 | 品牌方管理员 | 代理商 | 达人 |
| --- | :---: | :---: | :---: |
| 查看 AI 配置 | ✅ (本租户) | ❌ | ❌ |
| 修改 AI 配置 | ✅ (本租户) | ❌ | ❌ |
| 测试连接 | ✅ (本租户) | ❌ | ❌ |
| 查看完整 API Key | ❌ | ❌ | ❌ |

> 注：系统不设独立的系统管理员角色。AI 配置由各品牌方管理员自行管理本租户的配置。

---

## 7. 界面设计

> 详见 User_Role_Interfaces.md 第 4.6 章「AI 服务配置」

### 7.1 界面入口

品牌方端 → 系统设置 → AI 服务配置

### 7.2 界面结构

1. **提供商选择** - 下拉选择 AI 提供商
2. **连接配置** - Base URL 和 API Key 输入
3. **获取模型按钮** - 点击后从 API 获取可用模型列表
4. **模型配置** - 三个下拉框分别选择文字/视觉/音频模型
5. **参数配置** - Temperature 滑块和 Max Tokens 输入
6. **测试连接按钮** - 并行测试三个模型
7. **保存配置按钮**

---

## 8. 相关文档

| 文档 | 说明 |
| --- | --- |
| UIDesign.md | UI 设计规范（第 10 章 AI 配置界面） |
| User_Role_Interfaces.md | 用户角色与界面规范 |
| tasks.md | 开发任务清单 |
| DevelopmentPlan.md | 开发计划与技术架构 |
