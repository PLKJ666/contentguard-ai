"""
SSE (Server-Sent Events) 实时推送 API
用于推送审核进度等实时通知

支持 Redis pub/sub 跨进程通知（Celery worker → FastAPI → 前端）
"""
import asyncio
import json
import logging
from typing import AsyncGenerator, Optional, Set
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User, UserRole
from app.models.organization import Brand, Agency, Creator
from app.api.deps import get_current_user
from sqlalchemy import select

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sse", tags=["实时推送"])

# 存储活跃的客户端连接
# 结构: {user_id: set of AsyncGenerator}
active_connections: dict[str, Set[asyncio.Queue]] = {}

# Redis pub/sub 频道名
SSE_REDIS_CHANNEL = "contentguard:sse:notifications"

# Redis 客户端（懒加载）
_redis_client = None


async def _get_redis_client():
    """获取 Redis 异步客户端"""
    global _redis_client
    if _redis_client is None:
        try:
            import redis.asyncio as aioredis
            _redis_client = aioredis.from_url(
                settings.REDIS_URL, decode_responses=True
            )
            # 测试连接
            await _redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis 连接失败，SSE 将使用纯内存模式: {e}")
            _redis_client = None
    return _redis_client


async def publish_sse_event(user_id: str, event: str, data: dict):
    """
    通过 Redis 发布 SSE 事件（支持跨进程通知）

    Redis 不可用时回退到内存直接通知
    """
    try:
        client = await _get_redis_client()
        if client:
            message = json.dumps({
                "user_id": user_id,
                "event": event,
                "data": data,
            })
            await client.publish(SSE_REDIS_CHANNEL, message)
            return
    except Exception as e:
        logger.debug(f"Redis publish 失败，回退到内存通知: {e}")

    # Redis 不可用，直接内存通知
    await send_to_user(user_id, event, data)


async def start_redis_subscriber():
    """
    后台订阅 Redis SSE 频道，将消息分发到内存中的 SSE 连接

    应在 FastAPI startup 事件中启动
    """
    try:
        client = await _get_redis_client()
        if not client:
            logger.info("Redis 不可用，跳过 SSE Redis 订阅")
            return

        pubsub = client.pubsub()
        await pubsub.subscribe(SSE_REDIS_CHANNEL)
        logger.info("SSE Redis 订阅已启动")

        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                payload = json.loads(message["data"])
                user_id = payload["user_id"]
                event = payload["event"]
                data = payload["data"]
                await send_to_user(user_id, event, data)
            except Exception as e:
                logger.debug(f"处理 Redis SSE 消息失败: {e}")

    except asyncio.CancelledError:
        logger.info("SSE Redis 订阅已停止")
    except Exception as e:
        logger.error(f"SSE Redis 订阅异常: {e}")


async def add_connection(user_id: str, queue: asyncio.Queue):
    """添加客户端连接"""
    if user_id not in active_connections:
        active_connections[user_id] = set()
    active_connections[user_id].add(queue)


async def remove_connection(user_id: str, queue: asyncio.Queue):
    """移除客户端连接"""
    if user_id in active_connections:
        active_connections[user_id].discard(queue)
        if not active_connections[user_id]:
            del active_connections[user_id]


async def send_to_user(user_id: str, event: str, data: dict):
    """发送消息给指定用户的所有连接"""
    if user_id in active_connections:
        message = {
            "event": event,
            "data": data,
            "timestamp": datetime.utcnow().isoformat(),
        }
        for queue in active_connections[user_id]:
            await queue.put(message)


async def broadcast_to_role(role: UserRole, event: str, data: dict, db: AsyncSession):
    """广播消息给指定角色的所有用户"""
    # 这里简化处理，实际应该批量查询
    # 在生产环境中应该使用 Redis 等消息队列
    pass


async def event_generator(user_id: str, queue: asyncio.Queue) -> AsyncGenerator[dict, None]:
    """SSE 事件生成器"""
    try:
        await add_connection(user_id, queue)

        # 发送连接成功消息
        yield {
            "event": "connected",
            "data": json.dumps({
                "message": "连接成功",
                "user_id": user_id,
            }),
        }

        while True:
            try:
                # 等待消息，超时后发送心跳
                message = await asyncio.wait_for(queue.get(), timeout=30.0)
                yield {
                    "event": message["event"],
                    "data": json.dumps(message["data"]),
                }
            except asyncio.TimeoutError:
                # 发送心跳保持连接
                yield {
                    "event": "heartbeat",
                    "data": json.dumps({"timestamp": datetime.utcnow().isoformat()}),
                }

    except asyncio.CancelledError:
        pass
    finally:
        await remove_connection(user_id, queue)


@router.get("/events")
async def sse_events(
    current_user: User = Depends(get_current_user),
):
    """
    SSE 事件流

    - 客户端通过此端点订阅实时事件
    - 支持的事件类型:
      - connected: 连接成功
      - heartbeat: 心跳
      - task_updated: 任务状态更新
      - review_progress: AI 审核进度
      - review_completed: AI 审核完成
      - new_task: 新任务分配
      - invite: 代理商邀请
    """
    queue = asyncio.Queue(maxsize=100)

    return EventSourceResponse(
        event_generator(current_user.id, queue),
        media_type="text/event-stream",
    )


# ===== 推送工具函数（供其他模块调用） =====


async def notify_task_updated(task_id: str, user_ids: list[str], data: dict):
    """
    通知任务状态更新

    通过 Redis pub/sub 发送，支持从 Celery worker 跨进程通知。

    Args:
        task_id: 任务 ID
        user_ids: 需要通知的用户 ID 列表
        data: 推送数据
    """
    for user_id in user_ids:
        await publish_sse_event(user_id, "task_updated", {
            "task_id": task_id,
            **data,
        })


async def notify_review_progress(
    task_id: str,
    user_id: str,
    progress: int,
    current_step: str,
    review_type: str,  # "script" or "video"
):
    """
    通知 AI 审核进度

    Args:
        task_id: 任务 ID
        user_id: 达人用户 ID
        progress: 进度百分比 (0-100)
        current_step: 当前步骤描述
        review_type: 审核类型
    """
    await publish_sse_event(user_id, "review_progress", {
        "task_id": task_id,
        "review_type": review_type,
        "progress": progress,
        "current_step": current_step,
    })


async def notify_review_completed(
    task_id: str,
    user_id: str,
    review_type: str,
    score: int,
    violations_count: int,
):
    """
    通知 AI 审核完成

    Args:
        task_id: 任务 ID
        user_id: 达人用户 ID
        review_type: 审核类型
        score: 审核分数
        violations_count: 违规数量
    """
    await publish_sse_event(user_id, "review_completed", {
        "task_id": task_id,
        "review_type": review_type,
        "score": score,
        "violations_count": violations_count,
    })


async def notify_new_task(
    task_id: str,
    creator_user_id: str,
    task_name: str,
    project_name: str,
):
    """
    通知新任务分配

    Args:
        task_id: 任务 ID
        creator_user_id: 达人用户 ID
        task_name: 任务名称
        project_name: 项目名称
    """
    await publish_sse_event(creator_user_id, "new_task", {
        "task_id": task_id,
        "task_name": task_name,
        "project_name": project_name,
    })


async def notify_brand_invite(
    agency_user_id: str,
    brand_name: str,
    message_id: str,
):
    """
    通知品牌方邀请代理商

    Args:
        agency_user_id: 代理商用户 ID
        brand_name: 品牌方名称
        message_id: 消息 ID
    """
    await publish_sse_event(agency_user_id, "invite", {
        "brand_name": brand_name,
        "message_id": message_id,
    })


async def notify_invite(
    creator_user_id: str,
    agency_name: str,
    message_id: str,
):
    """
    通知代理商邀请

    Args:
        creator_user_id: 达人用户 ID
        agency_name: 代理商名称
        message_id: 消息 ID
    """
    await publish_sse_event(creator_user_id, "invite", {
        "agency_name": agency_name,
        "message_id": message_id,
    })


async def notify_review_decision(
    task_id: str,
    creator_user_id: str,
    review_type: str,  # "script" or "video"
    reviewer_type: str,  # "agency" or "brand"
    action: str,  # "pass", "reject", "force_pass"
    comment: Optional[str] = None,
):
    """
    通知审核决策

    Args:
        task_id: 任务 ID
        creator_user_id: 达人用户 ID
        review_type: 审核类型
        reviewer_type: 审核者类型
        action: 审核动作
        comment: 审核意见
    """
    await publish_sse_event(creator_user_id, "review_decision", {
        "task_id": task_id,
        "review_type": review_type,
        "reviewer_type": reviewer_type,
        "action": action,
        "comment": comment,
    })
