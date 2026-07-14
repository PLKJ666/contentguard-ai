"""
健康检查服务
提供依赖注入接口，便于测试 mock
"""
from typing import Protocol, Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine


class HealthChecker(Protocol):
    """健康检查协议（用于类型提示）"""

    async def check_database(self) -> bool:
        """检查数据库连接"""
        ...

    async def check_redis(self) -> bool:
        """检查 Redis 连接"""
        ...

    async def check_all(self) -> dict[str, bool]:
        """检查所有依赖"""
        ...


class DefaultHealthChecker:
    """
    默认健康检查实现
    生产环境使用，检查真实依赖
    """

    # 默认连接超时（秒）
    DEFAULT_CONNECT_TIMEOUT = 5

    def __init__(
        self,
        db_engine: Optional[AsyncEngine] = None,
        redis_url: Optional[str] = None,
        connect_timeout: float = DEFAULT_CONNECT_TIMEOUT,
    ):
        self._db_engine = db_engine
        self._redis_url = redis_url
        self._connect_timeout = connect_timeout

    async def check_database(self) -> bool:
        """
        检查数据库连接

        Returns:
            bool: 数据库是否可用
        """
        if self._db_engine is None:
            # 未配置数据库引擎，尝试从全局获取
            try:
                from app.database import engine
                self._db_engine = engine
            except Exception:
                return False

        try:
            async with self._db_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    async def check_redis(self) -> bool:
        """
        检查 Redis 连接

        Returns:
            bool: Redis 是否可用
        """
        if self._redis_url is None:
            # 未配置 Redis URL，尝试从配置获取
            try:
                from app.config import settings
                self._redis_url = settings.REDIS_URL
            except Exception:
                return False

        try:
            import redis.asyncio as aioredis
            client = aioredis.from_url(
                self._redis_url,
                socket_connect_timeout=self._connect_timeout
            )
            try:
                await client.ping()
                return True
            finally:
                await client.aclose()
        except Exception:
            return False

    async def check_all(self) -> dict[str, bool]:
        """检查所有依赖"""
        return {
            "database": await self.check_database(),
            "redis": await self.check_redis(),
        }


class MockHealthChecker:
    """
    Mock 健康检查实现
    测试环境使用，可配置返回值
    """

    def __init__(
        self,
        database_healthy: bool = True,
        redis_healthy: bool = True,
    ):
        self._database_healthy = database_healthy
        self._redis_healthy = redis_healthy

    async def check_database(self) -> bool:
        return self._database_healthy

    async def check_redis(self) -> bool:
        return self._redis_healthy

    async def check_all(self) -> dict[str, bool]:
        return {
            "database": self._database_healthy,
            "redis": self._redis_healthy,
        }


def get_health_checker() -> HealthChecker:
    """
    获取健康检查器依赖

    生产环境返回 DefaultHealthChecker（检查真实依赖）
    测试环境通过 app.dependency_overrides 替换
    """
    return DefaultHealthChecker()
