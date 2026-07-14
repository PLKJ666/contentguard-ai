"""审计日志服务"""
import json
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit_log import AuditLog


async def log_action(
    db: AsyncSession,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    user_id: Optional[str] = None,
    user_name: Optional[str] = None,
    user_role: Optional[str] = None,
    detail: Optional[dict] = None,
    ip_address: Optional[str] = None,
):
    """记录审计日志"""
    log = AuditLog(
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
        detail=json.dumps(detail, ensure_ascii=False) if detail else None,
        ip_address=ip_address,
    )
    db.add(log)
    # Don't commit here - let the request lifecycle handle it
