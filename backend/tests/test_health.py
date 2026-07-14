"""
健康检查 API 测试
测试覆盖: /health, /health/ready, /health/live
使用依赖注入 mock 健康检查器
"""
import pytest
from httpx import AsyncClient

from app.config import Settings


class TestHealthCheck:
    """健康检查端点测试"""

    # ==================== /health 测试 ====================
    @pytest.mark.asyncio
    async def test_health_check_returns_200(self, client: AsyncClient):
        """健康检查返回 200 状态码"""
        response = await client.get("/api/v1/health")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_health_check_response_structure(self, client: AsyncClient):
        """健康检查返回正确的响应结构"""
        response = await client.get("/api/v1/health")
        data = response.json()

        assert "status" in data
        assert "service" in data
        assert "version" in data

    @pytest.mark.asyncio
    async def test_health_check_uses_settings(
        self, client: AsyncClient, app_settings: Settings
    ):
        """健康检查使用 settings 中的配置"""
        response = await client.get("/api/v1/health")
        data = response.json()

        assert data["status"] == "healthy"
        # 使用 settings 中的值，而非硬编码
        assert data["service"] == app_settings.APP_NAME
        assert data["version"] == app_settings.APP_VERSION

    # ==================== /health/ready 测试 ====================
    @pytest.mark.asyncio
    async def test_readiness_check_returns_200(
        self, client: AsyncClient, mock_health_checker
    ):
        """就绪检查返回 200 状态码"""
        response = await client.get("/api/v1/health/ready")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_readiness_check_ready_when_all_healthy(
        self, client: AsyncClient, mock_health_checker
    ):
        """所有依赖健康时返回 ready=true"""
        response = await client.get("/api/v1/health/ready")
        data = response.json()

        assert data["ready"] is True
        assert data["checks"]["database"] is True
        assert data["checks"]["redis"] is True

    @pytest.mark.asyncio
    async def test_readiness_check_not_ready_when_db_unhealthy(
        self, client: AsyncClient, mock_unhealthy_db_checker
    ):
        """数据库不健康时返回 ready=false"""
        response = await client.get("/api/v1/health/ready")
        data = response.json()

        assert data["ready"] is False
        assert data["checks"]["database"] is False
        assert data["checks"]["redis"] is True

    @pytest.mark.asyncio
    async def test_readiness_check_not_ready_when_redis_unhealthy(
        self, client: AsyncClient, mock_unhealthy_redis_checker
    ):
        """Redis 不健康时返回 ready=false"""
        response = await client.get("/api/v1/health/ready")
        data = response.json()

        assert data["ready"] is False
        assert data["checks"]["database"] is True
        assert data["checks"]["redis"] is False

    @pytest.mark.asyncio
    async def test_readiness_check_not_ready_when_all_unhealthy(
        self, client: AsyncClient, mock_all_unhealthy_checker
    ):
        """所有依赖不健康时返回 ready=false"""
        response = await client.get("/api/v1/health/ready")
        data = response.json()

        assert data["ready"] is False
        assert data["checks"]["database"] is False
        assert data["checks"]["redis"] is False

    @pytest.mark.asyncio
    async def test_readiness_check_returns_checks_detail(
        self, client: AsyncClient, mock_health_checker
    ):
        """就绪检查返回详细的检查结果"""
        response = await client.get("/api/v1/health/ready")
        data = response.json()

        assert "checks" in data
        assert "database" in data["checks"]
        assert "redis" in data["checks"]

    # ==================== /health/live 测试 ====================
    @pytest.mark.asyncio
    async def test_liveness_check_returns_200(self, client: AsyncClient):
        """存活检查返回 200 状态码"""
        response = await client.get("/api/v1/health/live")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_liveness_check_always_alive(self, client: AsyncClient):
        """存活检查始终返回 alive=true（只检查进程存活）"""
        response = await client.get("/api/v1/health/live")
        data = response.json()

        # liveness 不依赖外部服务，只要进程活着就返回 true
        assert data["alive"] is True


class TestRootEndpoint:
    """根路径测试"""

    @pytest.mark.asyncio
    async def test_root_returns_200(self, client: AsyncClient):
        """根路径返回 200 状态码"""
        response = await client.get("/")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_root_response_structure(self, client: AsyncClient):
        """根路径返回正确的响应结构"""
        response = await client.get("/")
        data = response.json()

        assert "message" in data
        assert "version" in data

    @pytest.mark.asyncio
    async def test_root_uses_settings(
        self, client: AsyncClient, app_settings: Settings
    ):
        """根路径使用 settings 中的应用名称"""
        response = await client.get("/")
        data = response.json()

        # 验证响应中包含 settings.APP_NAME
        assert app_settings.APP_NAME in data["message"]
