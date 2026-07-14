"""
pytest 配置和 fixtures
测试覆盖: 数据库会话、HTTP 客户端、Mock 数据
使用 app.dependency_overrides 实现测试隔离（支持并行测试）
"""
import pytest
import asyncio
import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.config import settings
from app.database import get_db
from app.models.base import Base
from app.services.health import (
    MockHealthChecker,
    get_health_checker,
)
from app.middleware.rate_limit import RateLimitMiddleware
from app.services import verification as verification_module
from app.api import auth as auth_api_module
from tests._logto_test_utils import decode_test_logto_token


@pytest.fixture(scope="session")
def event_loop():
    """创建事件循环（session 级别）"""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
def _bypass_verification(monkeypatch):
    """测试环境中跳过验证码验证，所有验证码校验直接通过"""
    _always_true = lambda email, code, purpose="register": True
    monkeypatch.setattr(verification_module, "verify_code", _always_true)
    monkeypatch.setattr(auth_api_module, "verify_code", _always_true)
    verification_module.clear_all()
    yield
    verification_module.clear_all()


@pytest.fixture(autouse=True)
def _stub_logto_decode(monkeypatch):
    """
    Unit tests should not depend on real Logto JWKS / crypto.
    Monkeypatch decode_logto_token() in modules that import it directly.
    """
    def _decode(token: str):
        return decode_test_logto_token(token)

    # Core implementation module.
    from app import services as _services_pkg  # noqa: F401
    import app.services.auth as auth_service_module
    monkeypatch.setattr(auth_service_module, "decode_logto_token", _decode)

    # Modules that do `from app.services.auth import decode_logto_token`.
    import app.api.deps as deps_module
    import app.api.auth as auth_api_module_local
    import app.api.operator as operator_api_module
    import app.api.upload as upload_module
    monkeypatch.setattr(deps_module, "decode_logto_token", _decode)
    monkeypatch.setattr(auth_api_module_local, "decode_logto_token", _decode)
    monkeypatch.setattr(operator_api_module, "decode_logto_token", _decode)
    monkeypatch.setattr(upload_module, "decode_logto_token", _decode)

    yield


@pytest.fixture(autouse=True)
def _clear_rate_limiter():
    """清除限流中间件的请求记录，防止测试间互相影响"""
    for middleware in app.user_middleware:
        if middleware.cls is RateLimitMiddleware:
            break
    # Clear any instance that may be stored
    for m in getattr(app, '_middleware_stack', None).__dict__.values() if hasattr(app, '_middleware_stack') else []:
        if isinstance(m, RateLimitMiddleware):
            m.requests.clear()
            break
    # Also try via the middleware attribute directly
    try:
        stack = app.middleware_stack
        while stack:
            if isinstance(stack, RateLimitMiddleware):
                stack.requests.clear()
                break
            stack = getattr(stack, 'app', None)
    except Exception:
        pass


# ==================== 数据库测试 Fixtures ====================

@pytest.fixture(scope="function")
async def test_db_engine():
    """创建测试数据库引擎（使用 SQLite 内存数据库）"""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        future=True,
    )

    # 创建所有表
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    # 清理
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest.fixture(scope="function")
async def test_db_session(test_db_engine):
    """创建测试数据库会话"""
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session_factory() as session:
        yield session


@pytest.fixture
async def client(test_db_session) -> AsyncGenerator[AsyncClient, None]:
    """
    创建异步测试客户端（使用测试数据库）

    Yields:
        AsyncClient: httpx 异步客户端
    """
    # 覆盖数据库依赖
    async def override_get_db():
        yield test_db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # 每个测试结束后清理 dependency_overrides
    app.dependency_overrides.clear()


@pytest.fixture
async def client_no_db() -> AsyncGenerator[AsyncClient, None]:
    """
    创建异步测试客户端（不使用数据库，用于简单测试）

    Yields:
        AsyncClient: httpx 异步客户端
    """
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def mock_health_checker(client: AsyncClient):
    """
    创建 Mock 健康检查器（所有依赖健康）
    使用 FastAPI dependency_overrides 实现隔离

    Yields:
        MockHealthChecker: mock 实例
    """
    checker = MockHealthChecker(database_healthy=True, redis_healthy=True)
    app.dependency_overrides[get_health_checker] = lambda: checker
    yield checker
    # 清理由 client fixture 统一处理


@pytest.fixture
def mock_unhealthy_db_checker(client: AsyncClient):
    """
    创建 Mock 健康检查器（数据库不健康）

    Yields:
        MockHealthChecker: mock 实例
    """
    checker = MockHealthChecker(database_healthy=False, redis_healthy=True)
    app.dependency_overrides[get_health_checker] = lambda: checker
    yield checker


@pytest.fixture
def mock_unhealthy_redis_checker(client: AsyncClient):
    """
    创建 Mock 健康检查器（Redis 不健康）

    Yields:
        MockHealthChecker: mock 实例
    """
    checker = MockHealthChecker(database_healthy=True, redis_healthy=False)
    app.dependency_overrides[get_health_checker] = lambda: checker
    yield checker


@pytest.fixture
def mock_all_unhealthy_checker(client: AsyncClient):
    """
    创建 Mock 健康检查器（所有依赖不健康）

    Yields:
        MockHealthChecker: mock 实例
    """
    checker = MockHealthChecker(database_healthy=False, redis_healthy=False)
    app.dependency_overrides[get_health_checker] = lambda: checker
    yield checker


@pytest.fixture
def app_settings():
    """
    获取应用配置（用于测试断言）

    Returns:
        Settings: 应用配置实例
    """
    return settings


# ==================== 通用测试数据 Fixtures ====================

def _unique(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def tenant_id() -> str:
    return _unique("tenant")


@pytest.fixture
def brand_id() -> str:
    return _unique("brand")


@pytest.fixture
def other_brand_id() -> str:
    return _unique("brand")


@pytest.fixture
def creator_id() -> str:
    return _unique("creator")


@pytest.fixture
def influencer_id() -> str:
    return _unique("influencer")


@pytest.fixture
def applicant_id() -> str:
    return _unique("applicant")


@pytest.fixture
def approver_id() -> str:
    return _unique("approver")


@pytest.fixture
def video_url() -> str:
    return f"https://example.com/video-{uuid.uuid4().hex[:8]}.mp4"


@pytest.fixture
def forbidden_word() -> str:
    return f"测试违禁词-{uuid.uuid4().hex[:6]}"


@pytest.fixture
def whitelist_term() -> str:
    return f"品牌专属词-{uuid.uuid4().hex[:6]}"


@pytest.fixture
def competitor_name() -> str:
    return f"竞品-{uuid.uuid4().hex[:6]}"


# ==================== 集成测试 Fixtures ====================
# 使用 testcontainers 运行真实依赖，标记为 integration


def _is_docker_available() -> bool:
    """检查 Docker 是否可用"""
    import subprocess
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
        return False


# 在模块加载时检查一次 Docker 可用性
_docker_available = None


def docker_available() -> bool:
    """获取 Docker 可用性（缓存结果）"""
    global _docker_available
    if _docker_available is None:
        _docker_available = _is_docker_available()
    return _docker_available


@pytest.fixture(scope="session")
def postgres_container():
    """
    启动 PostgreSQL 容器（集成测试用）
    需要 Docker 运行

    Yields:
        PostgresContainer: 容器实例
    """
    pytest.importorskip("testcontainers")

    if not docker_available():
        pytest.skip("Docker is not available")

    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:15-alpine") as postgres:
        yield postgres


@pytest.fixture(scope="session")
def redis_container():
    """
    启动 Redis 容器（集成测试用）
    需要 Docker 运行

    Yields:
        RedisContainer: 容器实例
    """
    pytest.importorskip("testcontainers")

    if not docker_available():
        pytest.skip("Docker is not available")

    from testcontainers.redis import RedisContainer

    with RedisContainer("redis:7-alpine") as redis:
        yield redis


# ==================== Mock 数据 Fixtures ====================

@pytest.fixture
def mock_ai_response():
    """
    AI 审核响应 mock 数据

    Returns:
        dict: 模拟的 AI 审核结果
    """
    return {
        "violations": [],
        "score": 95,
        "summary": "内容合规",
        "details": {
            "forbidden_words": [],
            "logo_detected": True,
            "duration_valid": True,
        }
    }


@pytest.fixture
def mock_ai_violation_response():
    """
    AI 审核违规响应 mock 数据

    Returns:
        dict: 模拟的违规审核结果
    """
    return {
        "violations": [
            {
                "type": "forbidden_word",
                "content": "最好",
                "position": {"start": 10, "end": 12},
                "severity": "medium",
                "suggestion": "建议删除或替换为其他词汇",
            }
        ],
        "score": 65,
        "summary": "发现1处违规",
        "details": {
            "forbidden_words": ["最好"],
            "logo_detected": True,
            "duration_valid": True,
        }
    }


@pytest.fixture
def sample_video_metadata():
    """
    示例视频元数据

    Returns:
        dict: 视频元数据
    """
    return {
        "id": "video-001",
        "title": "测试视频",
        "duration": 30,
        "resolution": "1080p",
        "creator_id": "creator-001",
        "platform": "douyin",
    }


@pytest.fixture
def sample_task_data():
    """
    示例审核任务数据

    Returns:
        dict: 任务数据
    """
    return {
        "video_url": "https://example.com/video.mp4",
        "platform": "douyin",
        "creator_id": "creator-001",
        "priority": "normal",
        "rules": ["ad_law", "platform_rules"],
    }


# ==================== AI 配置相关 Fixtures ====================

@pytest.fixture
def mock_ai_models_response():
    """Mock 模型列表响应"""
    return {
        "success": True,
        "models": {
            "text": [
                {"id": "gpt-4o", "name": "GPT-4o"},
                {"id": "claude-3-opus", "name": "Claude 3 Opus"},
            ],
            "vision": [
                {"id": "gpt-4o", "name": "GPT-4o"},
                {"id": "qwen-vl-max", "name": "Qwen VL Max"},
            ],
            "audio": [
                {"id": "whisper-1", "name": "Whisper"},
                {"id": "whisper-large-v3", "name": "Whisper Large V3"},
            ],
        },
    }


@pytest.fixture
def mock_connection_test_success():
    """Mock 连接测试成功响应"""
    return {
        "success": True,
        "results": {
            "text": {"success": True, "latency_ms": 342, "model": "gpt-4o"},
            "vision": {"success": True, "latency_ms": 528, "model": "gpt-4o"},
            "audio": {"success": True, "latency_ms": 215, "model": "whisper-1"},
        },
        "message": "所有模型连接成功",
    }


@pytest.fixture
def mock_connection_test_partial_fail():
    """Mock 连接测试部分失败响应"""
    return {
        "success": False,
        "results": {
            "text": {"success": True, "latency_ms": 342, "model": "gpt-4o"},
            "vision": {"success": True, "latency_ms": 528, "model": "gpt-4o"},
            "audio": {"success": False, "error": "Model not found", "model": "invalid-model"},
        },
        "message": "1 个模型连接失败，请检查模型名称或 API 权限",
    }


# ==================== AI 客户端 Mock Fixtures ====================

@pytest.fixture
def mock_ai_client():
    """创建 Mock AI 客户端"""
    client = MagicMock()
    client.chat_completion = AsyncMock(return_value=MagicMock(
        content="[]",
        model="gpt-4o",
        usage={"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        finish_reason="stop",
    ))
    client.vision_analysis = AsyncMock(return_value=MagicMock(
        content="无竞品 Logo",
        model="gpt-4o",
        usage={"prompt_tokens": 200, "completion_tokens": 50, "total_tokens": 250},
        finish_reason="stop",
    ))
    client.test_connection = AsyncMock(return_value=MagicMock(
        success=True,
        latency_ms=100,
        error=None,
    ))
    client.close = AsyncMock()
    return client
