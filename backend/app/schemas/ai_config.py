"""
AI 服务配置相关的 Pydantic 模型
"""
from typing import Optional
from decimal import Decimal
from pydantic import BaseModel, Field, SecretStr
from enum import Enum


class AIProvider(str, Enum):
    """支持的 AI 提供商"""
    # 中转服务
    ONEAPI = "oneapi"
    OPENROUTER = "openrouter"

    # 直连厂商 - 国际
    ANTHROPIC = "anthropic"
    OPENAI = "openai"

    # 直连厂商 - 国内
    DEEPSEEK = "deepseek"
    QWEN = "qwen"
    DOUBAO = "doubao"
    ZHIPU = "zhipu"
    MOONSHOT = "moonshot"


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


class ModelCapability(str, Enum):
    """模型能力类型"""
    TEXT = "text"
    VISION = "vision"
    AUDIO = "audio"


# ==================== 请求模型 ====================

class AIModelsConfig(BaseModel):
    """模型配置。

    text 为基础必填模型；vision/audio 允许缺省，便于 XHS 等轻量场景按需配置。
    """
    text: str = Field(..., description="文字处理模型")
    vision: Optional[str] = Field(default=None, description="视觉解析模型")
    audio: Optional[str] = Field(default=None, description="音频解析模型")
    xhs_split: Optional[str] = Field(default=None, description="小红书批量切分模型")
    xhs_editor: Optional[str] = Field(default=None, description="小红书改写模型")
    xhs_verifier: Optional[str] = Field(default=None, description="小红书复核模型")


class AIParametersConfig(BaseModel):
    """参数配置"""
    temperature: float = Field(default=0.7, ge=0, le=1)
    max_tokens: int = Field(default=4096, ge=100, le=32000)


class AIConfigUpdate(BaseModel):
    """更新 AI 配置请求"""
    provider: AIProvider
    base_url: str = Field(..., min_length=1)
    api_key: str = Field(..., min_length=1)
    models: AIModelsConfig
    parameters: AIParametersConfig = Field(default_factory=AIParametersConfig)


class GetModelsRequest(BaseModel):
    """获取模型列表请求"""
    provider: AIProvider
    base_url: str
    api_key: str


class TestConnectionRequest(BaseModel):
    """测试连接请求"""
    provider: AIProvider
    base_url: str
    api_key: str
    models: AIModelsConfig


# ==================== 响应模型 ====================

class AIConfigResponse(BaseModel):
    """AI 配置响应"""
    provider: str
    base_url: str
    api_key_masked: str = Field(..., description="脱敏后的 API Key")
    models: AIModelsConfig
    parameters: AIParametersConfig
    available_models: dict[str, list[dict]] = Field(default_factory=dict)
    is_configured: bool
    last_test_at: Optional[str] = None
    last_test_result: Optional[dict] = None


class ModelInfo(BaseModel):
    """模型信息"""
    id: str
    name: str


class ModelsListResponse(BaseModel):
    """模型列表响应"""
    success: bool
    models: dict[str, list[ModelInfo]] = Field(default_factory=dict)
    error: Optional[str] = None


class ModelTestResult(BaseModel):
    """单个模型测试结果"""
    success: bool
    latency_ms: Optional[int] = None
    error: Optional[str] = None
    model: str


class ConnectionTestResponse(BaseModel):
    """测试连接响应"""
    success: bool
    results: dict[str, ModelTestResult]
    message: str


# ==================== 工具函数 ====================

def mask_api_key(api_key: str) -> str:
    """API Key 脱敏"""
    if len(api_key) <= 8:
        return "****"
    return f"{api_key[:4]}****{api_key[-4:]}"
