"""
健康检查 API 集成测试
使用 testcontainers 运行真实 PostgreSQL 和 Redis
运行: pytest tests/test_health_integration.py -m integration
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.main import app
from app.services.health import get_health_checker, DefaultHealthChecker


class RealHealthChecker:
    """
    真实健康检查实现（用于集成测试）
    正确处理资源释放，支持连接超时配置
    """

    # 测试用短超时（秒），避免无效主机导致长时间等待
    DEFAULT_CONNECT_TIMEOUT = 2

    def __init__(self, db_url: str, redis_url: str, connect_timeout: float = DEFAULT_CONNECT_TIMEOUT):
        self._db_url = db_url
        self._redis_url = redis_url
        self._connect_timeout = connect_timeout

    async def check_database(self) -> bool:
        """检查数据库连接（确保资源释放）"""
        engine = None
        try:
            engine = create_async_engine(
                self._db_url,
                connect_args={"timeout": self._connect_timeout}
            )
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False
        finally:
            # 确保 engine 被正确释放
            if engine is not None:
                await engine.dispose()

    async def check_redis(self) -> bool:
        """检查 Redis 连接（确保资源释放）"""
        client = None
        try:
            import redis.asyncio as aioredis
            client = aioredis.from_url(
                self._redis_url,
                socket_connect_timeout=self._connect_timeout
            )
            await client.ping()
            return True
        except Exception:
            return False
        finally:
            # 确保 client 被正确释放
            if client is not None:
                try:
                    await client.aclose()
                except Exception:
                    pass

    async def check_all(self) -> dict[str, bool]:
        """检查所有依赖"""
        return {
            "database": await self.check_database(),
            "redis": await self.check_redis(),
        }


@pytest.mark.integration
class TestHealthCheckIntegration:
    """健康检查集成测试（需要 Docker）"""

    @pytest.mark.asyncio
    async def test_readiness_with_real_postgres(self, postgres_container):
        """使用真实 PostgreSQL 测试就绪检查"""
        # 获取容器连接信息
        host = postgres_container.get_container_host_ip()
        port = postgres_container.get_exposed_port(5432)
        db_url = f"postgresql+asyncpg://test:test@{host}:{port}/test"

        # 创建真实健康检查器
        checker = RealHealthChecker(db_url=db_url, redis_url="redis://invalid:6379")

        # 注入到 app
        app.dependency_overrides[get_health_checker] = lambda: checker

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/health/ready")
                data = response.json()

                # 数据库应该健康
                assert data["checks"]["database"] is True
                # Redis 连接失败（无效地址）
                assert data["checks"]["redis"] is False
                # 整体不就绪
                assert data["ready"] is False
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_readiness_with_real_redis(self, redis_container):
        """使用真实 Redis 测试就绪检查"""
        # 获取容器连接信息
        host = redis_container.get_container_host_ip()
        port = redis_container.get_exposed_port(6379)
        redis_url = f"redis://{host}:{port}"

        # 创建真实健康检查器
        checker = RealHealthChecker(
            db_url="postgresql+asyncpg://invalid:invalid@invalid:5432/invalid",
            redis_url=redis_url
        )

        # 注入到 app
        app.dependency_overrides[get_health_checker] = lambda: checker

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/health/ready")
                data = response.json()

                # 数据库连接失败（无效地址）
                assert data["checks"]["database"] is False
                # Redis 应该健康
                assert data["checks"]["redis"] is True
                # 整体不就绪
                assert data["ready"] is False
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_readiness_with_all_real_deps(
        self, postgres_container, redis_container
    ):
        """使用真实 PostgreSQL 和 Redis 测试就绪检查"""
        # PostgreSQL 连接信息
        pg_host = postgres_container.get_container_host_ip()
        pg_port = postgres_container.get_exposed_port(5432)
        db_url = f"postgresql+asyncpg://test:test@{pg_host}:{pg_port}/test"

        # Redis 连接信息
        redis_host = redis_container.get_container_host_ip()
        redis_port = redis_container.get_exposed_port(6379)
        redis_url = f"redis://{redis_host}:{redis_port}"

        # 创建真实健康检查器
        checker = RealHealthChecker(db_url=db_url, redis_url=redis_url)

        # 注入到 app
        app.dependency_overrides[get_health_checker] = lambda: checker

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/health/ready")
                data = response.json()

                # 所有依赖应该健康
                assert data["checks"]["database"] is True
                assert data["checks"]["redis"] is True
                # 整体就绪
                assert data["ready"] is True
        finally:
            app.dependency_overrides.clear()


@pytest.mark.integration
class TestDatabaseConnectionIntegration:
    """数据库连接集成测试"""

    @pytest.mark.asyncio
    async def test_database_query_execution(self, postgres_container):
        """测试真实数据库查询执行"""
        host = postgres_container.get_container_host_ip()
        port = postgres_container.get_exposed_port(5432)
        db_url = f"postgresql+asyncpg://test:test@{host}:{port}/test"

        engine = create_async_engine(db_url)
        try:
            async with engine.connect() as conn:
                result = await conn.execute(text("SELECT 1 as value"))
                row = result.fetchone()
                assert row is not None
                assert row[0] == 1
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_database_connection_failure(self):
        """测试数据库连接失败场景"""
        invalid_url = "postgresql+asyncpg://invalid:invalid@invalid:5432/invalid"
        checker = RealHealthChecker(db_url=invalid_url, redis_url="redis://invalid:6379")

        result = await checker.check_database()
        assert result is False


@pytest.mark.integration
class TestDefaultHealthCheckerIntegration:
    """DefaultHealthChecker 集成测试"""

    @pytest.mark.asyncio
    async def test_default_checker_with_real_postgres(self, postgres_container):
        """测试 DefaultHealthChecker 使用真实 PostgreSQL"""
        host = postgres_container.get_container_host_ip()
        port = postgres_container.get_exposed_port(5432)
        db_url = f"postgresql+asyncpg://test:test@{host}:{port}/test"

        engine = create_async_engine(db_url)
        try:
            # 使用短超时避免无效主机长时间等待
            checker = DefaultHealthChecker(
                db_engine=engine,
                redis_url="redis://invalid:6379",
                connect_timeout=2
            )
            result = await checker.check_database()
            assert result is True
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_default_checker_with_real_redis(self, redis_container):
        """测试 DefaultHealthChecker 使用真实 Redis"""
        host = redis_container.get_container_host_ip()
        port = redis_container.get_exposed_port(6379)
        redis_url = f"redis://{host}:{port}"

        checker = DefaultHealthChecker(db_engine=None, redis_url=redis_url)
        result = await checker.check_redis()
        assert result is True
