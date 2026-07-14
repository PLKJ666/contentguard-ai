"""
API 依赖项
"""
from typing import Optional
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User, UserRole
from app.models.organization import Brand, Agency, Creator
from app.models.operator import Operator
from app.services.auth import decode_logto_token, get_user_by_logto_id

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """获取当前登录用户（Logto JWT）"""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证信息",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    # Logto JWT（通过 JWKS 校验签名）
    logto_payload = decode_logto_token(token)
    if logto_payload:
        logto_sub = logto_payload.get("sub")
        if logto_sub:
            user = await get_user_by_logto_id(db, logto_sub)
            if user and user.is_active:
                return user
            if user and not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="账号已被禁用",
                )
            # 用户未完成 onboarding — 由 /auth/me 端点处理
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="用户未完成注册，请先完成 onboarding",
            )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效的 Token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """获取可选的当前用户（未登录时返回 None）"""
    if not credentials:
        return None

    try:
        return await get_current_user(credentials, db)
    except HTTPException:
        return None


async def get_current_brand(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Brand:
    """获取当前品牌方（仅品牌方角色可用）"""
    if current_user.role != UserRole.BRAND:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅品牌方可执行此操作",
        )

    result = await db.execute(
        select(Brand).where(Brand.user_id == current_user.id)
    )
    brand = result.scalar_one_or_none()

    if not brand:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="品牌方信息不存在",
        )

    return brand


async def get_current_agency(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Agency:
    """获取当前代理商（仅代理商角色可用）"""
    if current_user.role != UserRole.AGENCY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅代理商可执行此操作",
        )

    result = await db.execute(
        select(Agency).where(Agency.user_id == current_user.id)
    )
    agency = result.scalar_one_or_none()

    if not agency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="代理商信息不存在",
        )

    return agency


async def get_current_creator(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Creator:
    """获取当前达人（仅达人角色可用）"""
    if current_user.role != UserRole.CREATOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅达人可执行此操作",
        )

    result = await db.execute(
        select(Creator).where(Creator.user_id == current_user.id)
    )
    creator = result.scalar_one_or_none()

    if not creator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="达人信息不存在",
        )

    return creator


async def get_current_operator(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Operator:
    """获取当前代运营账号（仅 operator 角色可用）"""
    if current_user.role != UserRole.OPERATOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅代运营账号可执行此操作",
        )

    result = await db.execute(
        select(Operator).where(Operator.user_id == current_user.id)
    )
    operator = result.scalar_one_or_none()

    if not operator or not operator.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="代运营账号信息不存在",
        )

    return operator


def require_roles(*roles: UserRole):
    """角色权限检查装饰器"""
    async def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            role_names = [r.value for r in roles]
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要以下角色之一: {', '.join(role_names)}",
            )
        return current_user
    return checker
