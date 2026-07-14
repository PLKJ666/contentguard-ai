"""
消息/通知 API
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.api.deps import get_current_user
from app.schemas.message import MessageResponse, MessageListResponse, UnreadCountResponse
from app.services.message_service import (
    list_messages,
    get_unread_count,
    mark_as_read,
    mark_all_as_read,
)

router = APIRouter(prefix="/messages", tags=["消息"])


@router.get("", response_model=MessageListResponse)
async def get_messages(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    is_read: Optional[bool] = Query(None),
    type: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取消息列表"""
    messages, total = await list_messages(
        db=db,
        user_id=current_user.id,
        page=page,
        page_size=page_size,
        is_read=is_read,
        type=type,
    )

    return MessageListResponse(
        items=[
            MessageResponse(
                id=m.id,
                type=m.type,
                title=m.title,
                content=m.content,
                is_read=m.is_read,
                related_task_id=m.related_task_id,
                related_project_id=m.related_project_id,
                sender_name=m.sender_name,
                related_agency_id=m.related_agency_id,
                related_brand_id=m.related_brand_id,
                action_status=m.action_status,
                created_at=m.created_at,
            )
            for m in messages
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
async def get_message_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取未读消息数"""
    count = await get_unread_count(db, current_user.id)
    return UnreadCountResponse(count=count)


@router.put("/{message_id}/read")
async def mark_message_as_read(
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """标记消息已读"""
    success = await mark_as_read(db, message_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="消息不存在",
        )
    await db.commit()
    return {"message": "已标记为已读"}


@router.put("/read-all")
async def mark_all_messages_as_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """标记所有消息已读"""
    count = await mark_all_as_read(db, current_user.id)
    await db.commit()
    return {"message": f"已标记 {count} 条消息为已读", "count": count}
