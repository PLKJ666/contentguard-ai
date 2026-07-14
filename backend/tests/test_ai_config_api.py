"""
AI 服务配置 API 测试 (TDD - 红色阶段)
测试覆盖: 配置管理、模型列表、连通性测试
"""
import pytest
from httpx import AsyncClient

from app.schemas.ai_config import (
    AIConfigResponse,
    ConnectionTestResponse,
    ModelsListResponse,
)


class TestGetAIConfig:
    """获取 AI 配置"""

    @pytest.mark.asyncio
    async def test_get_config_unconfigured_returns_404(self, client: AsyncClient, tenant_id: str):
        """未配置时返回 404"""
        response = await client.get(
            "/api/v1/ai-config",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_config_returns_200(self, client: AsyncClient, tenant_id: str):
        """已配置时返回 200"""
        headers = {"X-Tenant-ID": tenant_id}
        # 先创建配置
        await client.put(
            "/api/v1/ai-config",
            headers=headers,
            json={
                "provider": "openai",
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test-key-12345678",
                "models": {"text": "gpt-4o", "vision": "gpt-4o", "audio": "whisper-1"},
            },
        )
        response = await client.get("/api/v1/ai-config", headers=headers)
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_get_config_returns_masked_api_key(self, client: AsyncClient, tenant_id: str):
        """API Key 应该脱敏"""
        headers = {"X-Tenant-ID": tenant_id}
        # 先创建配置
        await client.put(
            "/api/v1/ai-config",
            headers=headers,
            json={
                "provider": "openai",
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test-key-12345678",
                "models": {"text": "gpt-4o", "vision": "gpt-4o", "audio": "whisper-1"},
            },
        )
        response = await client.get("/api/v1/ai-config", headers=headers)
        data = response.json()
        parsed = AIConfigResponse.model_validate(data)

        # API Key 应该脱敏，包含 ****
        assert "****" in parsed.api_key_masked

    @pytest.mark.asyncio
    async def test_get_config_returns_models(self, client: AsyncClient, tenant_id: str):
        """返回三个模型配置"""
        headers = {"X-Tenant-ID": tenant_id}
        # 先创建配置
        await client.put(
            "/api/v1/ai-config",
            headers=headers,
            json={
                "provider": "openai",
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test-key-12345678",
                "models": {"text": "gpt-4o", "vision": "gpt-4o", "audio": "whisper-1"},
            },
        )
        response = await client.get("/api/v1/ai-config", headers=headers)
        data = response.json()
        parsed = AIConfigResponse.model_validate(data)

        assert parsed.models.text
        assert parsed.models.vision
        assert parsed.models.audio


class TestUpdateAIConfig:
    """更新 AI 配置"""

    @pytest.mark.asyncio
    async def test_update_config_returns_200(self, client: AsyncClient, tenant_id: str):
        """更新配置返回 200"""
        response = await client.put(
            "/api/v1/ai-config",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "provider": "oneapi",
                "base_url": "https://oneapi.example.com",
                "api_key": "sk-test-key-12345678",
                "models": {
                    "text": "gpt-4o",
                    "vision": "gpt-4o",
                    "audio": "whisper-1",
                },
                "parameters": {
                    "temperature": 0.7,
                    "max_tokens": 2000,
                },
            },
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_update_config_validates_provider(self, client: AsyncClient, tenant_id: str):
        """校验提供商类型"""
        response = await client.put(
            "/api/v1/ai-config",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "provider": "invalid_provider",
                "base_url": "https://example.com",
                "api_key": "sk-test",
                "models": {"text": "gpt-4o", "vision": "gpt-4o", "audio": "whisper-1"},
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_config_allows_text_only_models(self, client: AsyncClient, tenant_id: str):
        """仅基础文本模型也允许保存"""
        response = await client.put(
            "/api/v1/ai-config",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "provider": "oneapi",
                "base_url": "https://example.com",
                "api_key": "sk-test",
                "models": {"text": "gpt-4o"},
            },
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_update_config_persists(self, client: AsyncClient, tenant_id: str):
        """配置更新后可查询"""
        headers = {"X-Tenant-ID": tenant_id}
        # 更新
        await client.put(
            "/api/v1/ai-config",
            headers=headers,
            json={
                "provider": "openai",
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test-persist-12345678",
                "models": {
                    "text": "gpt-4o-mini",
                    "vision": "gpt-4o",
                    "audio": "whisper-1",
                },
            },
        )

        # 查询
        response = await client.get("/api/v1/ai-config", headers=headers)
        data = response.json()
        parsed = AIConfigResponse.model_validate(data)

        assert parsed.provider == "openai"
        assert parsed.models.text == "gpt-4o-mini"
        assert parsed.is_configured is True


class TestGetModels:
    """获取可用模型列表"""

    @pytest.mark.asyncio
    async def test_get_models_returns_200(self, client: AsyncClient, tenant_id: str):
        """获取模型列表返回 200"""
        response = await client.post(
            "/api/v1/ai-config/models",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "provider": "oneapi",
                "base_url": "https://oneapi.example.com",
                "api_key": "sk-test-key",
            },
        )
        # 可能返回 200（成功）或 502（连接失败）
        assert response.status_code in [200, 502]

    @pytest.mark.asyncio
    async def test_get_models_returns_categorized_list(self, client: AsyncClient, mock_ai_models_response):
        """返回按类型分类的模型列表"""
        # 使用 mock 响应
        data = mock_ai_models_response
        parsed = ModelsListResponse.model_validate(data)

        assert "text" in parsed.models
        assert "vision" in parsed.models
        assert "audio" in parsed.models
        assert isinstance(parsed.models["text"], list)


class TestConnectionTest:
    """连通性测试"""

    @pytest.mark.asyncio
    async def test_connection_test_returns_200(self, client: AsyncClient, tenant_id: str):
        """测试连接返回 200"""
        response = await client.post(
            "/api/v1/ai-config/test",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "provider": "oneapi",
                "base_url": "https://oneapi.example.com",
                "api_key": "sk-test-key",
                "models": {
                    "text": "gpt-4o",
                    "vision": "gpt-4o",
                    "audio": "whisper-1",
                },
            },
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_connection_test_returns_all_results(self, client: AsyncClient, tenant_id: str):
        """返回三个模型的测试结果"""
        response = await client.post(
            "/api/v1/ai-config/test",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "provider": "oneapi",
                "base_url": "https://oneapi.example.com",
                "api_key": "sk-test-key",
                "models": {
                    "text": "gpt-4o",
                    "vision": "gpt-4o",
                    "audio": "whisper-1",
                },
            },
        )
        data = response.json()
        parsed = ConnectionTestResponse.model_validate(data)

        assert "text" in parsed.results
        assert "vision" in parsed.results
        assert "audio" in parsed.results
        assert isinstance(parsed.message, str)

    @pytest.mark.asyncio
    async def test_connection_test_allows_omitting_audio(self, client: AsyncClient, tenant_id: str):
        """支持只测试文本和视觉模型"""
        response = await client.post(
            "/api/v1/ai-config/test",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "provider": "oneapi",
                "base_url": "https://oneapi.example.com",
                "api_key": "sk-test-key",
                "models": {
                    "text": "gpt-4o",
                    "vision": "gpt-4o",
                },
            },
        )
        assert response.status_code == 200
        data = response.json()
        parsed = ConnectionTestResponse.model_validate(data)
        assert "text" in parsed.results
        assert "vision" in parsed.results
        assert "audio" not in parsed.results

    @pytest.mark.asyncio
    async def test_connection_test_includes_latency(self, client: AsyncClient, mock_connection_test_success):
        """成功时包含延迟信息"""
        data = mock_connection_test_success
        parsed = ConnectionTestResponse.model_validate(data)

        for model_type, result in parsed.results.items():
            if result.success:
                assert result.latency_ms is not None
                assert result.latency_ms > 0

    @pytest.mark.asyncio
    async def test_connection_test_includes_error_message(self, client: AsyncClient, mock_connection_test_partial_fail):
        """失败时包含错误信息"""
        data = mock_connection_test_partial_fail
        parsed = ConnectionTestResponse.model_validate(data)

        assert parsed.success is False
        # 至少有一个失败
        failed = [r for r in parsed.results.values() if not r.success]
        assert len(failed) > 0
        assert failed[0].error is not None


class TestMultiTenantIsolation:
    """多租户隔离"""

    @pytest.mark.asyncio
    async def test_config_isolated_between_tenants(self, client: AsyncClient, tenant_id: str, other_brand_id: str):
        """不同租户配置隔离"""
        # 为 tenant_id 配置
        await client.put(
            "/api/v1/ai-config",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "provider": "openai",
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-brand-a-key",
                "models": {"text": "gpt-4o", "vision": "gpt-4o", "audio": "whisper-1"},
            },
        )

        # 为 other_brand_id 配置
        await client.put(
            "/api/v1/ai-config",
            headers={"X-Tenant-ID": other_brand_id},
            json={
                "provider": "anthropic",
                "base_url": "https://api.anthropic.com/v1",
                "api_key": "sk-brand-b-key",
                "models": {"text": "claude-3-opus", "vision": "claude-3-opus", "audio": "whisper-1"},
            },
        )

        # 查询 tenant_id
        resp_a = await client.get("/api/v1/ai-config", headers={"X-Tenant-ID": tenant_id})
        data_a = resp_a.json()

        # 查询 other_brand_id
        resp_b = await client.get("/api/v1/ai-config", headers={"X-Tenant-ID": other_brand_id})
        data_b = resp_b.json()

        # 验证隔离
        assert data_a["provider"] == "openai"
        assert data_b["provider"] == "anthropic"


class TestProviderSupport:
    """提供商支持"""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("provider", [
        "oneapi",
        "openrouter",
        "anthropic",
        "openai",
        "deepseek",
    ])
    async def test_supported_providers(self, client: AsyncClient, tenant_id: str, provider: str):
        """支持的提供商类型"""
        response = await client.put(
            "/api/v1/ai-config",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "provider": provider,
                "base_url": f"https://api.{provider}.com/v1",
                "api_key": "sk-test-key",
                "models": {"text": "test-model", "vision": "test-model", "audio": "test-model"},
            },
        )
        assert response.status_code == 200
