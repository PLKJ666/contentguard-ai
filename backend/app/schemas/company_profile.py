"""
代理商企业资料 Schema
"""

from __future__ import annotations

from typing import Optional, Literal
from datetime import date

from pydantic import BaseModel, Field


VerifyStatus = Literal["unverified", "pending", "verified"]


class AgencyCompanyProfileResponse(BaseModel):
    company_name: Optional[str] = None
    short_name: Optional[str] = None
    business_license: Optional[str] = None
    legal_person: Optional[str] = None
    registered_capital: Optional[str] = None
    establish_date: Optional[date] = None
    business_scope: Optional[str] = None
    address: Optional[str] = None
    status: Optional[str] = None
    verify_status: VerifyStatus = "unverified"

    bank_name: Optional[str] = None
    bank_account_last4: Optional[str] = Field(None, min_length=4, max_length=4)

    # contact_* 来自 Agency 表（便于与“资料编辑”保持一致）
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None


class AgencyCompanyProfileUpdateRequest(BaseModel):
    company_name: Optional[str] = Field(None, max_length=255)
    short_name: Optional[str] = Field(None, max_length=255)
    business_license: Optional[str] = Field(None, max_length=128)
    legal_person: Optional[str] = Field(None, max_length=100)
    registered_capital: Optional[str] = Field(None, max_length=100)
    establish_date: Optional[date] = None
    business_scope: Optional[str] = None
    address: Optional[str] = None
    status: Optional[str] = Field(None, max_length=50)
    verify_status: Optional[VerifyStatus] = None

    bank_name: Optional[str] = Field(None, max_length=255)
    bank_account_last4: Optional[str] = Field(None, min_length=4, max_length=4)

    contact_phone: Optional[str] = Field(None, max_length=20)
    contact_email: Optional[str] = Field(None, max_length=255)


class AgencyCompanyVerifyRequest(BaseModel):
    method: Literal["bank", "legalPerson"]
    code: str = Field(..., min_length=1, max_length=1000)


class AgencyCompanyVerifyResponse(BaseModel):
    verify_status: VerifyStatus
    message: str

