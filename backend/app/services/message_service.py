"""
消息服务
"""
import secrets
from typing import Optional, Tuple, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update

from app.models.message import Message


def _generate_message_id() -> str:
    """生成消息 ID"""
    random_part = secrets.randbelow(900000) + 100000
    return f"MSG{random_part}"


async def create_message(
    db: AsyncSession,
    user_id: str,
    type: str,
    title: str,
    content: str,
    related_task_id: Optional[str] = None,
    related_project_id: Optional[str] = None,
    sender_name: Optional[str] = None,
    related_agency_id: Optional[str] = None,
    related_brand_id: Optional[str] = None,
    action_status: Optional[str] = None,
) -> Message:
    """创建消息"""
    message = Message(
        id=_generate_message_id(),
        user_id=user_id,
        type=type,
        title=title,
        content=content,
        is_read=False,
        related_task_id=related_task_id,
        related_project_id=related_project_id,
        sender_name=sender_name,
        related_agency_id=related_agency_id,
        related_brand_id=related_brand_id,
        action_status=action_status,
    )
    db.add(message)
    await db.flush()
    return message


async def list_messages(
    db: AsyncSession,
    user_id: str,
    page: int = 1,
    page_size: int = 20,
    is_read: Optional[bool] = None,
    type: Optional[str] = None,
) -> Tuple[List[Message], int]:
    """查询消息列表"""
    query = select(Message).where(Message.user_id == user_id)
    count_query = select(func.count()).select_from(Message).where(Message.user_id == user_id)

    if is_read is not None:
        query = query.where(Message.is_read == is_read)
        count_query = count_query.where(Message.is_read == is_read)

    if type is not None:
        query = query.where(Message.type == type)
        count_query = count_query.where(Message.type == type)

    # 总数
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # 分页
    query = query.order_by(Message.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    messages = list(result.scalars().all())

    return messages, total


async def get_unread_count(db: AsyncSession, user_id: str) -> int:
    """获取未读消息数"""
    result = await db.execute(
        select(func.count()).select_from(Message).where(
            Message.user_id == user_id,
            Message.is_read == False,
        )
    )
    return result.scalar() or 0


async def mark_as_read(db: AsyncSession, message_id: str, user_id: str) -> bool:
    """标记单条消息已读"""
    result = await db.execute(
        select(Message).where(
            Message.id == message_id,
            Message.user_id == user_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return False

    message.is_read = True
    await db.flush()
    return True


async def mark_all_as_read(db: AsyncSession, user_id: str) -> int:
    """标记所有消息已读，返回更新数量"""
    result = await db.execute(
        update(Message)
        .where(Message.user_id == user_id, Message.is_read == False)
        .values(is_read=True)
    )
    await db.flush()
    return result.rowcount
