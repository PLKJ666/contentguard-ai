"""
认证服务
"""
from typing import Optional
import secrets
import logging
import jwt as pyjwt
from jwt import PyJWKClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.models.user import User, UserRole
from app.models.organization import Brand, Agency, Creator
from app.models.operator import Operator
from app.models.tenant import Tenant

logger = logging.getLogger(__name__)


def generate_id(prefix: str) -> str:
    """生成语义化 ID"""
    # 格式: BR123456, AG123456, CR123456
    random_part = secrets.randbelow(900000) + 100000  # 100000-999999
    return f"{prefix}{random_part}"


# ==================== Logto JWT (Asymmetric, via JWKS) ====================

_jwks_client: Optional[PyJWKClient] = None


def _get_jwks_client() -> PyJWKClient:
    """获取/缓存 JWKS 客户端"""
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(settings.LOGTO_JWKS_URI)
    return _jwks_client


def decode_logto_token(token: str) -> Optional[dict]:
    """解码 Logto 签发的 JWT（通过 JWKS 校验签名）

    返回 payload dict 或 None（无效时）
    """
    if not settings.LOGTO_ENDPOINT:
        return None
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        payload = pyjwt.decode(
            token,
            signing_key.key,
            # Logto 可能使用不同的非对称算法；这里兼容常见的 ES384 / RS256。
            algorithms=["ES384", "RS256"],
            audience=settings.LOGTO_API_RESOURCE,
            issuer=settings.LOGTO_ISSUER,
        )
        return payload
    except Exception as e:
        logger.debug("Logto JWT decode failed: %s", e)
        return None


async def get_user_by_logto_id(db: AsyncSession, logto_id: str) -> Optional[User]:
    """通过 Logto sub 查找用户"""
    result = await db.execute(
        select(User).where(User.logto_id == logto_id)
    )
    return result.scalar_one_or_none()


async def get_user_organization_info(db: AsyncSession, user: User) -> dict:
    """获取用户的组织信息"""
    info = {
        "brand_id": None,
        "agency_id": None,
        "creator_id": None,
        "operator_id": None,
        "tenant_id": None,
        "tenant_name": None,
    }

    if user.role == UserRole.BRAND:
        result = await db.execute(
            select(Brand).where(Brand.user_id == user.id)
        )
        brand = result.scalar_one_or_none()
        if brand:
            info["brand_id"] = brand.id
            info["tenant_id"] = brand.id
            info["tenant_name"] = brand.name

    elif user.role == UserRole.AGENCY:
        result = await db.execute(
            select(Agency).where(Agency.user_id == user.id)
        )
        agency = result.scalar_one_or_none()
        if agency:
            info["agency_id"] = agency.id
            # 代理商可能服务多个品牌，这里暂时不设置 tenant

    elif user.role == UserRole.CREATOR:
        result = await db.execute(
            select(Creator).where(Creator.user_id == user.id)
        )
        creator = result.scalar_one_or_none()
        if creator:
            info["creator_id"] = creator.id
            # 达人可能服务多个代理商，这里暂时不设置 tenant

    elif user.role == UserRole.OPERATOR:
        result = await db.execute(
            select(Operator).where(Operator.user_id == user.id)
        )
        operator = result.scalar_one_or_none()
        if operator:
            info["operator_id"] = operator.id
            info["agency_id"] = operator.agency_id
            info["tenant_id"] = operator.workspace_id
            tenant_result = await db.execute(
                select(Tenant).where(Tenant.id == operator.workspace_id)
            )
            tenant = tenant_result.scalar_one_or_none()
            info["tenant_name"] = tenant.name if tenant else operator.display_name

    return info
