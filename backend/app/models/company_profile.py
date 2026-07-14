"""
企业信息/认证资料（当前仅代理商使用）
"""

from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from datetime import date

from sqlalchemy import String, Text, ForeignKey, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Agency


class VerifyStatus(str):
    UNVERIFIED = "unverified"
    PENDING = "pending"
    VERIFIED = "verified"


class AgencyCompanyProfile(Base, TimestampMixin):
    """
    代理商企业资料表（1:1）

    说明：
    - 这是“企业信息/认证”页的落库模型，不与 Agency 的 name/logo/description/contact_* 混在一起，
      避免对现有组织模型造成侵入式变更。
    - verify_status 目前为产品内状态位，不对接第三方 KYC。
    """

    __tablename__ = "agency_company_profiles"

    agency_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("agencies.id", ondelete="CASCADE"),
        primary_key=True,
    )

    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    short_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    business_license: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    legal_person: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    registered_capital: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    establish_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    business_scope: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    verify_status: Mapped[str] = mapped_column(String(20), default=VerifyStatus.UNVERIFIED, nullable=False)

    # 对公账户（仅用于展示，避免落库全量敏感信息）
    bank_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    bank_account_last4: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)

    agency: Mapped["Agency"] = relationship("Agency", lazy="selectin")

