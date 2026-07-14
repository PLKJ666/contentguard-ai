"""
组织关系 API
品牌方管理代理商，代理商管理达人
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User, UserRole
from app.models.message import Message
from app.models.organization import (
    Brand, Agency, Creator,
    brand_agency_association, agency_creator_association,
)
from app.api.deps import get_current_user, get_current_brand, get_current_agency, get_current_creator
from app.schemas.organization import (
    BrandSummary,
    AgencySummary,
    CreatorSummary,
    InviteAgencyRequest,
    InviteCreatorRequest,
    UpdateAgencyPermissionRequest,
    AgencyListResponse,
    CreatorListResponse,
    BrandListResponse,
)
from app.services.message_service import create_message
from app.api.sse import notify_invite, notify_brand_invite

router = APIRouter(prefix="/organizations", tags=["组织关系"])


# ===== 品牌方管理代理商 =====


@router.get("/brand/agencies", response_model=AgencyListResponse)
async def list_brand_agencies(
    brand: Brand = Depends(get_current_brand),
    db: AsyncSession = Depends(get_db),
):
    """查询品牌方的代理商列表"""
    result = await db.execute(
        select(Brand)
        .options(selectinload(Brand.agencies))
        .where(Brand.id == brand.id)
    )
    brand_with_agencies = result.scalar_one()

    items = [
        AgencySummary(
            id=a.id,
            name=a.name,
            logo=a.logo,
            contact_name=a.contact_name,
            force_pass_enabled=a.force_pass_enabled,
        )
        for a in brand_with_agencies.agencies
    ]

    return AgencyListResponse(items=items, total=len(items))


@router.post("/brand/agencies", status_code=status.HTTP_201_CREATED)
async def invite_agency(
    request: InviteAgencyRequest,
    brand: Brand = Depends(get_current_brand),
    db: AsyncSession = Depends(get_db),
):
    """邀请代理商加入品牌方
    """
    # 1. 验证代理商存在
    result = await db.execute(
        select(Agency).where(Agency.id == request.agency_id)
    )
    agency = result.scalar_one_or_none()
    if not agency:
        raise HTTPException(status_code=404, detail="代理商不存在")

    # 2. 检查是否已关联
    brand_result = await db.execute(
        select(Brand)
        .options(selectinload(Brand.agencies))
        .where(Brand.id == brand.id)
    )
    brand_with_agencies = brand_result.scalar_one()

    if agency in brand_with_agencies.agencies:
        raise HTTPException(status_code=400, detail="该代理商已加入")

    # 3. 检查是否已有待处理邀请
    pending_message_result = await db.execute(
        select(Message).where(
            Message.type == "brand_invite",
            Message.user_id == agency.user_id,
            Message.related_brand_id == brand.id,
            Message.action_status == "pending",
        )
    )
    if pending_message_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="已发送邀请，等待对方处理")

    # 4. 创建待处理邀请消息
    message = await create_message(
        db=db,
        user_id=agency.user_id,
        type="brand_invite",
        title="品牌方邀请",
        content=f"「{brand.name}」邀请您成为合作代理商，加入后可参与该品牌方的推广项目",
        sender_name=brand.name,
        related_brand_id=brand.id,
        action_status="pending",
    )
    await db.commit()

    # 5. SSE 推送
    await notify_brand_invite(agency.user_id, brand.name, message.id)

    return {"message": "邀请已发送，等待对方确认", "agency_id": agency.id}


@router.delete("/brand/agencies/{agency_id}")
async def remove_agency(
    agency_id: str,
    brand: Brand = Depends(get_current_brand),
    db: AsyncSession = Depends(get_db),
):
    """移除代理商"""
    brand_result = await db.execute(
        select(Brand)
        .options(selectinload(Brand.agencies))
        .where(Brand.id == brand.id)
    )
    brand_with_agencies = brand_result.scalar_one()

    agency_result = await db.execute(
        select(Agency).where(Agency.id == agency_id)
    )
    agency = agency_result.scalar_one_or_none()

    if agency and agency in brand_with_agencies.agencies:
        brand_with_agencies.agencies.remove(agency)
        await db.flush()

    return {"message": "已移除"}


@router.put("/brand/agencies/{agency_id}/permission")
async def update_agency_permission(
    agency_id: str,
    request: UpdateAgencyPermissionRequest,
    brand: Brand = Depends(get_current_brand),
    db: AsyncSession = Depends(get_db),
):
    """更新代理商权限（如强制通过权）"""
    # 验证代理商是否属于该品牌
    brand_result = await db.execute(
        select(Brand)
        .options(selectinload(Brand.agencies))
        .where(Brand.id == brand.id)
    )
    brand_with_agencies = brand_result.scalar_one()

    agency_result = await db.execute(
        select(Agency).where(Agency.id == agency_id)
    )
    agency = agency_result.scalar_one_or_none()
    if not agency or agency not in brand_with_agencies.agencies:
        raise HTTPException(status_code=404, detail="代理商不存在或未加入")

    agency.force_pass_enabled = request.force_pass_enabled
    await db.flush()

    return {"message": "权限已更新"}


# ===== 代理商管理达人 =====


@router.get("/agency/creators", response_model=CreatorListResponse)
async def list_agency_creators(
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """查询代理商的达人列表"""
    result = await db.execute(
        select(Agency)
        .options(selectinload(Agency.creators))
        .where(Agency.id == agency.id)
    )
    agency_with_creators = result.scalar_one()

    items = [
        CreatorSummary(
            id=c.id,
            name=c.name,
            avatar=c.avatar,
            douyin_account=c.douyin_account,
            xiaohongshu_account=c.xiaohongshu_account,
            bilibili_account=c.bilibili_account,
        )
        for c in agency_with_creators.creators
    ]

    return CreatorListResponse(items=items, total=len(items))


@router.post("/agency/creators", status_code=status.HTTP_201_CREATED)
async def invite_creator(
    request: InviteCreatorRequest,
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """邀请达人加入代理商
    """
    # 1. 验证达人存在
    result = await db.execute(
        select(Creator).where(Creator.id == request.creator_id)
    )
    creator = result.scalar_one_or_none()
    if not creator:
        raise HTTPException(status_code=404, detail="达人不存在")

    # 2. 检查是否已关联
    agency_result = await db.execute(
        select(Agency)
        .options(selectinload(Agency.creators))
        .where(Agency.id == agency.id)
    )
    agency_with_creators = agency_result.scalar_one()

    if creator in agency_with_creators.creators:
        raise HTTPException(status_code=400, detail="该达人已加入")

    # 3. 检查是否已有待处理邀请
    pending_message_result = await db.execute(
        select(Message).where(
            Message.type == "invite",
            Message.user_id == creator.user_id,
            Message.related_agency_id == agency.id,
            Message.action_status == "pending",
        )
    )
    if pending_message_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="已发送邀请，等待对方处理")

    # 4. 创建待处理邀请消息
    message = await create_message(
        db=db,
        user_id=creator.user_id,
        type="invite",
        title="代理商邀请",
        content=f"「{agency.name}」邀请您成为签约达人，加入后可接收该代理商分配的推广任务",
        sender_name=agency.name,
        related_agency_id=agency.id,
        action_status="pending",
    )
    await db.commit()

    # 5. SSE 推送
    await notify_invite(creator.user_id, agency.name, message.id)

    return {"message": "邀请已发送，等待对方确认", "creator_id": creator.id}


@router.delete("/agency/creators/{creator_id}")
async def remove_creator(
    creator_id: str,
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """移除达人"""
    agency_result = await db.execute(
        select(Agency)
        .options(selectinload(Agency.creators))
        .where(Agency.id == agency.id)
    )
    agency_with_creators = agency_result.scalar_one()

    creator_result = await db.execute(
        select(Creator).where(Creator.id == creator_id)
    )
    creator = creator_result.scalar_one_or_none()

    if creator and creator in agency_with_creators.creators:
        agency_with_creators.creators.remove(creator)
        await db.flush()

    return {"message": "已移除"}


# ===== 代理商查看关联品牌方 =====


@router.get("/agency/brands", response_model=BrandListResponse)
async def list_agency_brands(
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """查询代理商关联的品牌方列表"""
    result = await db.execute(
        select(Agency)
        .options(selectinload(Agency.brands))
        .where(Agency.id == agency.id)
    )
    agency_with_brands = result.scalar_one()

    items = [
        BrandSummary(
            id=b.id,
            name=b.name,
            logo=b.logo,
            contact_name=b.contact_name,
        )
        for b in agency_with_brands.brands
    ]

    return BrandListResponse(items=items, total=len(items))


# ===== 代理商处理品牌方邀请 =====


@router.get("/agency/brand-invites")
async def list_agency_brand_invites(
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """代理商查看待处理的品牌方邀请"""
    result = await db.execute(
        select(Message).where(
            Message.type == "brand_invite",
            Message.user_id == agency.user_id,
            Message.action_status == "pending",
        ).order_by(Message.created_at.desc())
    )
    messages = list(result.scalars().all())

    return {
        "items": [
            {
                "id": m.id,
                "brand_id": m.related_brand_id,
                "brand_name": m.sender_name,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
        "total": len(messages),
    }


@router.post("/agency/brand-invites/{message_id}/accept")
async def accept_brand_invite(
    message_id: str,
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """接受品牌方邀请"""
    # 1. 查 message
    result = await db.execute(
        select(Message).where(
            Message.id == message_id,
            Message.type == "brand_invite",
            Message.user_id == agency.user_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="邀请不存在")

    if message.action_status != "pending":
        raise HTTPException(status_code=400, detail="邀请已处理")

    # 2. 获取 brand
    brand_result = await db.execute(
        select(Brand)
        .options(selectinload(Brand.agencies))
        .where(Brand.id == message.related_brand_id)
    )
    brand = brand_result.scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="品牌方不存在")

    # 3. 写入关联表
    if agency not in brand.agencies:
        brand.agencies.append(agency)

    # 4. 更新消息状态
    message.action_status = "accepted"
    message.is_read = True

    await db.commit()

    return {"message": "已接受邀请"}


@router.post("/agency/brand-invites/{message_id}/reject")
async def reject_brand_invite(
    message_id: str,
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """拒绝/忽略品牌方邀请"""
    # 1. 查 message
    result = await db.execute(
        select(Message).where(
            Message.id == message_id,
            Message.type == "brand_invite",
            Message.user_id == agency.user_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="邀请不存在")

    if message.action_status != "pending":
        raise HTTPException(status_code=400, detail="邀请已处理")

    # 2. 更新消息状态
    message.action_status = "rejected"
    message.is_read = True

    await db.commit()

    return {"message": "已忽略邀请"}


# ===== 达人处理邀请 =====


@router.get("/creator/invites")
async def list_creator_invites(
    creator: Creator = Depends(get_current_creator),
    db: AsyncSession = Depends(get_db),
):
    """达人查看待处理邀请"""
    result = await db.execute(
        select(Message).where(
            Message.type == "invite",
            Message.user_id == creator.user_id,
            Message.action_status == "pending",
        ).order_by(Message.created_at.desc())
    )
    messages = list(result.scalars().all())

    return {
        "items": [
            {
                "id": m.id,
                "agency_id": m.related_agency_id,
                "agency_name": m.sender_name,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
        "total": len(messages),
    }


@router.post("/creator/invites/{message_id}/accept")
async def accept_invite(
    message_id: str,
    creator: Creator = Depends(get_current_creator),
    db: AsyncSession = Depends(get_db),
):
    """接受邀请"""
    # 1. 查 message
    result = await db.execute(
        select(Message).where(
            Message.id == message_id,
            Message.type == "invite",
            Message.user_id == creator.user_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="邀请不存在")

    if message.action_status != "pending":
        raise HTTPException(status_code=400, detail="邀请已处理")

    # 2. 获取 agency
    agency_result = await db.execute(
        select(Agency)
        .options(selectinload(Agency.creators))
        .where(Agency.id == message.related_agency_id)
    )
    agency = agency_result.scalar_one_or_none()
    if not agency:
        raise HTTPException(status_code=404, detail="代理商不存在")

    # 3. 写入关联表
    if creator not in agency.creators:
        agency.creators.append(creator)

    # 4. 更新消息状态
    message.action_status = "accepted"
    message.is_read = True

    await db.commit()

    return {"message": "已接受邀请"}


@router.post("/creator/invites/{message_id}/reject")
async def reject_invite(
    message_id: str,
    creator: Creator = Depends(get_current_creator),
    db: AsyncSession = Depends(get_db),
):
    """拒绝/忽略邀请"""
    # 1. 查 message
    result = await db.execute(
        select(Message).where(
            Message.id == message_id,
            Message.type == "invite",
            Message.user_id == creator.user_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="邀请不存在")

    if message.action_status != "pending":
        raise HTTPException(status_code=400, detail="邀请已处理")

    # 2. 更新消息状态
    message.action_status = "rejected"
    message.is_read = True

    await db.commit()

    return {"message": "已忽略邀请"}


# ===== 搜索（用于邀请时查找） =====


@router.get("/search/agencies")
async def search_agencies(
    keyword: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """搜索代理商（用于邀请）"""
    result = await db.execute(
        select(Agency)
        .where(Agency.name.ilike(f"%{keyword}%"))
        .limit(20)
    )
    agencies = list(result.scalars().all())

    items = [
        AgencySummary(
            id=a.id,
            name=a.name,
            logo=a.logo,
            contact_name=a.contact_name,
            force_pass_enabled=a.force_pass_enabled,
        ).model_dump()
        for a in agencies
    ]
    return {"items": items, "total": len(items)}


@router.get("/search/creators")
async def search_creators(
    keyword: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """搜索达人（用于邀请）"""
    result = await db.execute(
        select(Creator)
        .where(Creator.name.ilike(f"%{keyword}%"))
        .limit(20)
    )
    creators = list(result.scalars().all())

    items = [
        CreatorSummary(
            id=c.id,
            name=c.name,
            avatar=c.avatar,
            douyin_account=c.douyin_account,
            xiaohongshu_account=c.xiaohongshu_account,
            bilibili_account=c.bilibili_account,
        ).model_dump()
        for c in creators
    ]
    return {"items": items, "total": len(items)}
