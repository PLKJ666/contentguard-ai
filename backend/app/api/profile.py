"""
用户资料 API
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User, UserRole
from app.models.organization import Brand, Agency, Creator
from app.api.deps import get_current_user, get_current_agency
from app.services.auth import generate_id
from app.models.company_profile import AgencyCompanyProfile, VerifyStatus
from app.models.notification_settings import NotificationSettings
from app.schemas.profile import (
    ProfileResponse,
    ProfileUpdateRequest,
    BrandProfile,
    AgencyProfile,
    CreatorProfile,
)
from app.schemas.company_profile import (
    AgencyCompanyProfileResponse,
    AgencyCompanyProfileUpdateRequest,
    AgencyCompanyVerifyRequest,
    AgencyCompanyVerifyResponse,
)
from app.schemas.notification_settings import (
    NotificationSettingsResponse,
    NotificationSettingsUpdateRequest,
    NotificationSettingItem,
)

router = APIRouter(prefix="/profile", tags=["用户资料"])


def _build_profile_response(user: User, brand=None, agency=None, creator=None) -> ProfileResponse:
    """构建资料响应"""
    resp = ProfileResponse(
        id=user.id,
        email=user.email,
        phone=user.phone,
        name=user.name,
        avatar=user.avatar,
        role=user.role.value,
        is_verified=user.is_verified,
        created_at=user.created_at,
    )
    if brand:
        resp.brand = BrandProfile(
            id=brand.id,
            name=brand.name,
            logo=brand.logo,
            description=brand.description,
            contact_name=brand.contact_name,
            contact_phone=brand.contact_phone,
            contact_email=brand.contact_email,
        )
    if agency:
        resp.agency = AgencyProfile(
            id=agency.id,
            name=agency.name,
            logo=agency.logo,
            description=agency.description,
            contact_name=agency.contact_name,
            contact_phone=agency.contact_phone,
            contact_email=agency.contact_email,
        )
    if creator:
        resp.creator = CreatorProfile(
            id=creator.id,
            name=creator.name,
            avatar=creator.avatar,
            bio=creator.bio,
            douyin_account=creator.douyin_account,
            xiaohongshu_account=creator.xiaohongshu_account,
            bilibili_account=creator.bilibili_account,
        )
    return resp


async def _get_role_entity(db: AsyncSession, user: User):
    """根据角色获取对应实体"""
    if user.role == UserRole.BRAND:
        result = await db.execute(select(Brand).where(Brand.user_id == user.id))
        return result.scalar_one_or_none(), None, None
    elif user.role == UserRole.AGENCY:
        result = await db.execute(select(Agency).where(Agency.user_id == user.id))
        return None, result.scalar_one_or_none(), None
    elif user.role == UserRole.CREATOR:
        result = await db.execute(select(Creator).where(Creator.user_id == user.id))
        return None, None, result.scalar_one_or_none()
    return None, None, None


@router.get("", response_model=ProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户资料"""
    brand, agency, creator = await _get_role_entity(db, current_user)
    return _build_profile_response(current_user, brand, agency, creator)


@router.put("", response_model=ProfileResponse)
async def update_profile(
    request: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新当前用户资料"""
    # 更新 User 表通用字段
    if request.name is not None:
        current_user.name = request.name
    if request.avatar is not None:
        current_user.avatar = request.avatar
    if request.phone is not None:
        current_user.phone = request.phone

    # 更新角色表字段
    brand, agency, creator = await _get_role_entity(db, current_user)

    if current_user.role == UserRole.BRAND and brand:
        if request.name is not None:
            brand.name = request.name
        if request.description is not None:
            brand.description = request.description
        if request.contact_name is not None:
            brand.contact_name = request.contact_name
        if request.contact_phone is not None:
            brand.contact_phone = request.contact_phone
        if request.contact_email is not None:
            brand.contact_email = request.contact_email

    elif current_user.role == UserRole.AGENCY and agency:
        if request.name is not None:
            agency.name = request.name
        if request.description is not None:
            agency.description = request.description
        if request.contact_name is not None:
            agency.contact_name = request.contact_name
        if request.contact_phone is not None:
            agency.contact_phone = request.contact_phone
        if request.contact_email is not None:
            agency.contact_email = request.contact_email

    elif current_user.role == UserRole.CREATOR and creator:
        if request.name is not None:
            creator.name = request.name
        if request.avatar is not None:
            creator.avatar = request.avatar
        if request.bio is not None:
            creator.bio = request.bio
        if request.douyin_account is not None:
            creator.douyin_account = request.douyin_account
        if request.xiaohongshu_account is not None:
            creator.xiaohongshu_account = request.xiaohongshu_account
        if request.bilibili_account is not None:
            creator.bilibili_account = request.bilibili_account

    await db.commit()

    # 重新查询返回最新数据
    brand, agency, creator = await _get_role_entity(db, current_user)
    return _build_profile_response(current_user, brand, agency, creator)


@router.put("/password")
async def change_password(
    current_user: User = Depends(get_current_user),
):
    """站内改密码入口已弃用，统一由 Logto 管理。"""
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="当前系统使用 Logto 统一认证，请在统一认证侧管理密码与安全设置",
    )


@router.get("/company", response_model=AgencyCompanyProfileResponse)
async def get_agency_company_profile(
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
) -> AgencyCompanyProfileResponse:
    """
    获取代理商企业资料
    """
    result = await db.execute(
        select(AgencyCompanyProfile).where(AgencyCompanyProfile.agency_id == agency.id)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        return AgencyCompanyProfileResponse(
            verify_status="unverified",
            contact_phone=agency.contact_phone,
            contact_email=agency.contact_email,
        )

    return AgencyCompanyProfileResponse(
        company_name=profile.company_name,
        short_name=profile.short_name,
        business_license=profile.business_license,
        legal_person=profile.legal_person,
        registered_capital=profile.registered_capital,
        establish_date=profile.establish_date,
        business_scope=profile.business_scope,
        address=profile.address,
        status=profile.status,
        verify_status=profile.verify_status,  # type: ignore[arg-type]
        bank_name=profile.bank_name,
        bank_account_last4=profile.bank_account_last4,
        contact_phone=agency.contact_phone,
        contact_email=agency.contact_email,
    )


@router.put("/company", response_model=AgencyCompanyProfileResponse)
async def update_agency_company_profile(
    request: AgencyCompanyProfileUpdateRequest,
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
) -> AgencyCompanyProfileResponse:
    """
    更新代理商企业资料
    """
    result = await db.execute(
        select(AgencyCompanyProfile).where(AgencyCompanyProfile.agency_id == agency.id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        profile = AgencyCompanyProfile(agency_id=agency.id)
        db.add(profile)
        await db.flush()

    # 更新资料表字段
    for field in (
        "company_name",
        "short_name",
        "business_license",
        "legal_person",
        "registered_capital",
        "establish_date",
        "business_scope",
        "address",
        "status",
        "bank_name",
        "bank_account_last4",
    ):
        val = getattr(request, field)
        if val is not None:
            setattr(profile, field, val)

    if request.verify_status is not None:
        profile.verify_status = request.verify_status

    # 更新 Agency 联系方式
    if request.contact_phone is not None:
        agency.contact_phone = request.contact_phone
    if request.contact_email is not None:
        agency.contact_email = request.contact_email

    await db.commit()

    return await get_agency_company_profile(agency=agency, db=db)


@router.post("/company/verify", response_model=AgencyCompanyVerifyResponse)
async def verify_agency_company_profile(
    request: AgencyCompanyVerifyRequest,
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
) -> AgencyCompanyVerifyResponse:
    """
    企业认证（当前为产品内“状态流转”实现，不对接第三方）
    """
    result = await db.execute(
        select(AgencyCompanyProfile).where(AgencyCompanyProfile.agency_id == agency.id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        profile = AgencyCompanyProfile(agency_id=agency.id)
        db.add(profile)
        await db.flush()

    profile.verify_status = VerifyStatus.VERIFIED
    await db.commit()
    return AgencyCompanyVerifyResponse(verify_status="verified", message="企业认证已完成")


@router.get("/notification-settings", response_model=NotificationSettingsResponse)
async def get_notification_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationSettingsResponse:
    result = await db.execute(
        select(NotificationSettings).where(NotificationSettings.user_id == current_user.id)
    )
    row = result.scalar_one_or_none()
    if not row or not row.settings:
        return NotificationSettingsResponse(items=[])

    items: list[NotificationSettingItem] = []
    for setting_id, channels in (row.settings or {}).items():
        if not isinstance(channels, dict):
            continue
        items.append(
            NotificationSettingItem(
                id=str(setting_id),
                email=bool(channels.get("email", False)),
                push=bool(channels.get("push", False)),
                sms=bool(channels.get("sms", False)),
            )
        )
    # 稳定排序，便于前端 diff
    items.sort(key=lambda x: x.id)
    return NotificationSettingsResponse(items=items)


@router.put("/notification-settings", response_model=NotificationSettingsResponse)
async def update_notification_settings(
    request: NotificationSettingsUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationSettingsResponse:
    result = await db.execute(
        select(NotificationSettings).where(NotificationSettings.user_id == current_user.id)
    )
    row = result.scalar_one_or_none()
    if not row:
        row = NotificationSettings(id=generate_id("NS"), user_id=current_user.id, settings={})
        db.add(row)
        await db.flush()

    settings_dict: dict[str, dict] = {}
    for item in request.items:
        settings_dict[item.id] = {"email": item.email, "push": item.push, "sms": item.sms}

    row.settings = settings_dict
    await db.commit()
    return await get_notification_settings(current_user=current_user, db=db)
