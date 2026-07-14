"""
AI 配置模型
"""
from typing import TYPE_CHECKING, Optional
from datetime import datetime
from sqlalchemy import String, Text, Float, Integer, ForeignKey, DateTime
from app.models.types import JSONType
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.tenant import Tenant


class AIConfig(Base, TimestampMixin):
    """AI 服务配置表"""
    __tablename__ = "ai_configs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )

    # 提供商配置
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)

    # 模型配置 (JSON)
    # {"text": "gpt-4o", "vision": "gpt-4o", "audio": "whisper-1"}
    models: Mapped[dict] = mapped_column(JSONType, nullable=False)

    # 参数配置
    temperature: Mapped[float] = mapped_column(Float, default=0.7, nullable=False)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096, nullable=False)

    # 可用模型缓存 (JSON)
    available_models: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)

    # 测试结果
    last_test_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_test_result: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)

    # 配置状态
    is_configured: Mapped[bool] = mapped_column(default=False, nullable=False)

    # 关联
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="ai_config")

    def __repr__(self) -> str:
        return f"<AIConfig(tenant_id={self.tenant_id}, provider={self.provider})>"
