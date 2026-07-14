"""数据库配置"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.config import settings

# 导入所有模型，确保在创建表时被注册
from app.models.base import Base
from app.models import (
    # 用户与组织
    User,
    UserRole,
    Brand,
    Agency,
    Creator,
    Operator,
    OperatorInvite,
    # 项目与任务
    Project,
    Task,
    TaskStage,
    TaskStatus,
    Brief,
    # AI 配置
    AIConfig,
    # 审核
    ReviewTask,
    # 规则
    ForbiddenWord,
    WhitelistItem,
    Competitor,
    # 审计日志
    AuditLog,
    # 兼容
    Tenant,
)

# 创建异步引擎
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    pool_pre_ping=True,
    pool_recycle=3600,
)

# 创建异步会话工厂
AsyncSessionLocal = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    """获取数据库会话依赖"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """初始化数据库（创建所有表）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def drop_db():
    """删除所有表（仅用于测试）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


# 导出所有模型，供其他模块使用
__all__ = [
    "Base",
    "engine",
    "AsyncSessionLocal",
    "get_db",
    "init_db",
    "drop_db",
    # 用户与组织
    "User",
    "UserRole",
    "Brand",
    "Agency",
    "Creator",
    "Operator",
    "OperatorInvite",
    # 项目与任务
    "Project",
    "Task",
    "TaskStage",
    "TaskStatus",
    "Brief",
    # AI 配置
    "AIConfig",
    # 审核
    "ReviewTask",
    # 规则
    "ForbiddenWord",
    "WhitelistItem",
    "Competitor",
    # 审计日志
    "AuditLog",
    # 兼容
    "Tenant",
]
