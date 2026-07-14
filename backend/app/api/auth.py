"""
认证 API
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.api.deps import get_current_user
from app.models.user import User, UserRole
from app.models.organization import Brand, Agency, Creator
from app.models.operator import Operator
from app.models.tenant import Tenant
from app.schemas.auth import (
    UserResponse,
    OnboardingRequest,
    MeResponse,
)
from app.services.auth import (
    get_user_organization_info,
    decode_logto_token,
    get_user_by_logto_id,
    generate_id,
)
from app.services.audit import log_action
from app.services.verification import verify_code  # re-export for tests/compat

router = APIRouter(prefix="/auth", tags=["认证"])


async def _ensure_operator_workspace_exists(workspace_id: str, display_name: str, db: AsyncSession) -> Tenant:
    result = await db.execute(select(Tenant).where(Tenant.id == workspace_id))
    tenant = result.scalar_one_or_none()
    if tenant:
        tenant.name = display_name
        return tenant

    tenant = Tenant(id=workspace_id, name=display_name)
    db.add(tenant)
    await db.flush()
    return tenant


async def _create_operator_account(
    *,
    user: User,
    display_name: str,
    db: AsyncSession,
) -> Operator:
    workspace_id = generate_id("WS")
    agency_name = f"{display_name}的运营空间"

    agency = Agency(
        id=generate_id("AG"),
        user_id=user.id,
        name=agency_name,
        contact_name=user.name,
        contact_phone="",
    )
    db.add(agency)
    await db.flush()

    await _ensure_operator_workspace_exists(workspace_id, display_name, db)

    operator = Operator(
        id=generate_id("OP"),
        user_id=user.id,
        agency_id=agency.id,
        workspace_id=workspace_id,
        display_name=display_name,
        permissions={},
        created_by=user.id,
    )
    db.add(operator)
    await db.flush()
    return operator


@router.post("/logout")
async def logout(
    req: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    退出登录

    - 当前会话由 Logto 管理，这里只记录审计日志
    """
    # 审计日志
    await log_action(
        db, "logout", "user", current_user.id, current_user.id,
        current_user.name, current_user.role.value,
        ip_address=req.client.host if req.client else None,
    )

    await db.commit()
    return {"message": "已退出登录"}


@router.get("/me", response_model=MeResponse)
async def get_me(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=True)),
    db: AsyncSession = Depends(get_db),
):
    """
    登录后获取当前用户信息（Logto JWT）

    - 已注册用户：返回完整用户信息
    - 未注册用户：返回 needs_onboarding=True
    """
    token = credentials.credentials

    # 优先尝试 Logto JWT
    payload = decode_logto_token(token)
    if payload:
        logto_sub = payload.get("sub")
        user = await get_user_by_logto_id(db, logto_sub) if logto_sub else None

        if user:
            org_info = await get_user_organization_info(db, user)
            return MeResponse(
                needs_onboarding=False,
                logto_sub=logto_sub,
                email=user.email,
                name=user.name,
                id=user.id,
                phone=user.phone,
                avatar=user.avatar,
                role=user.role,
                is_verified=user.is_verified,
                **org_info,
            )
        else:
            # 从 Logto token 提取基本信息
            return MeResponse(
                needs_onboarding=True,
                logto_sub=logto_sub,
                email=payload.get("email"),
                name=payload.get("name") or payload.get("username"),
            )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效的 Token",
    )


@router.post("/onboarding", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def onboarding(
    request: OnboardingRequest,
    req: Request,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=True)),
    db: AsyncSession = Depends(get_db),
):
    """
    Logto 新用户 Onboarding — 选择角色并创建用户

    需要有效的 Logto access token。
    """
    token = credentials.credentials
    payload = decode_logto_token(token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 Logto Token",
        )

    logto_sub = payload.get("sub")
    if not logto_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 中无 sub 字段",
        )

    # 检查是否已注册
    existing = await get_user_by_logto_id(db, logto_sub)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户已注册，无需再次 onboarding",
        )

    # 从 token 提取 email
    email = payload.get("email")
    name = request.name or payload.get("name") or payload.get("username") or "用户"

    if (
        request.role == UserRole.OPERATOR
        and (
            not settings.OPERATOR_ACCESS_CODE
            or request.operator_access_code != settings.OPERATOR_ACCESS_CODE
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="代运营身份开通码不正确",
        )

    # 创建用户 (无密码，通过 Logto 认证)
    user_id = generate_id("U")
    user = User(
        id=user_id,
        logto_id=logto_sub,
        email=email,
        phone=None,
        name=name,
        role=request.role,
        is_active=True,
        is_verified=True,
    )
    db.add(user)

    # 根据角色创建对应的组织实体
    if request.role == UserRole.OPERATOR:
        await db.flush()
        await _create_operator_account(
            user=user,
            display_name=request.company_name or name,
            db=db,
        )

    elif request.role == UserRole.BRAND:
        org_name = request.company_name or name
        brand = Brand(
            id=generate_id("BR"),
            user_id=user_id,
            name=org_name,
            contact_name=name,
            contact_phone="",
        )
        db.add(brand)
        tenant = Tenant(id=brand.id, name=org_name)
        db.add(tenant)
    elif request.role == UserRole.AGENCY:
        org_name = request.company_name or name
        agency = Agency(
            id=generate_id("AG"),
            user_id=user_id,
            name=org_name,
            contact_name=name,
            contact_phone="",
        )
        db.add(agency)
    elif request.role == UserRole.CREATOR:
        creator = Creator(
            id=generate_id("CR"),
            user_id=user_id,
            name=name,
        )
        if request.platform and request.platform_account:
            if request.platform == "douyin":
                creator.douyin_account = request.platform_account
            elif request.platform == "xiaohongshu":
                creator.xiaohongshu_account = request.platform_account
            elif request.platform == "bilibili":
                creator.bilibili_account = request.platform_account
        db.add(creator)

    await db.flush()

    # 审计日志
    await log_action(
        db, "onboarding", "user", user.id, user.id, user.name, user.role.value,
        ip_address=req.client.host if req.client else None,
    )

    await db.commit()

    # 获取组织信息
    org_info = await get_user_organization_info(db, user)

    return UserResponse(
        id=user.id,
        email=user.email,
        phone=user.phone,
        name=user.name,
        avatar=user.avatar,
        role=user.role,
        is_verified=user.is_verified,
        **org_info,
    )
