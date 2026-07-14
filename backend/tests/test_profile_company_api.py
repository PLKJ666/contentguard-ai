"""
代理商企业资料 API 测试
覆盖: GET/PUT/POST /api/v1/profile/company*
"""

import uuid
import pytest
from httpx import AsyncClient
from tests._logto_test_utils import make_test_logto_token


ONBOARDING_URL = "/api/v1/auth/onboarding"
COMPANY_URL = "/api/v1/profile/company"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, name: str, email: str) -> dict:
    token = make_test_logto_token(sub=f"{role}-{uuid.uuid4().hex[:10]}", email=email, name=name)
    resp = await client.post(
        ONBOARDING_URL,
        json={"role": role, "name": name},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return {"access_token": token, "user": resp.json()}


@pytest.mark.asyncio
async def test_get_company_profile_default_unverified(client: AsyncClient):
    agency = await _register(client, "agency", "企业资料代理", "company-agency@test.com")
    token = agency["access_token"]

    resp = await client.get(COMPANY_URL, headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["verify_status"] == "unverified"


@pytest.mark.asyncio
async def test_update_and_verify_company_profile(client: AsyncClient):
    agency = await _register(client, "agency", "企业资料代理2", "company-agency2@test.com")
    token = agency["access_token"]

    put_resp = await client.put(COMPANY_URL, json={
        "company_name": "上海星辰文化传媒有限公司",
        "short_name": "星辰传媒",
        "business_license": "91310000MA1FL8XXXX",
        "legal_person": "张三",
        "registered_capital": "500万人民币",
        "establish_date": "2020-03-15",
        "business_scope": "文化传媒",
        "address": "上海市浦东新区",
        "status": "在营",
        "bank_name": "中国工商银行上海浦东支行",
        "bank_account_last4": "1234",
        "contact_phone": "021-12345678",
        "contact_email": "contact@starmedia.com",
    }, headers=_auth(token))
    assert put_resp.status_code == 200, put_resp.text
    body = put_resp.json()
    assert body["company_name"] == "上海星辰文化传媒有限公司"
    assert body["bank_account_last4"] == "1234"
    assert body["contact_phone"] == "021-12345678"

    verify_resp = await client.post(f"{COMPANY_URL}/verify", json={"method": "bank", "code": "1234"}, headers=_auth(token))
    assert verify_resp.status_code == 200, verify_resp.text
    assert verify_resp.json()["verify_status"] == "verified"

    get_resp = await client.get(COMPANY_URL, headers=_auth(token))
    assert get_resp.status_code == 200
    assert get_resp.json()["verify_status"] == "verified"


@pytest.mark.asyncio
async def test_company_profile_forbidden_for_non_agency(client: AsyncClient):
    brand = await _register(client, "brand", "非代理", "company-brand@test.com")
    token = brand["access_token"]
    resp = await client.get(COMPANY_URL, headers=_auth(token))
    assert resp.status_code == 403
