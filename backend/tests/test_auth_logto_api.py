"""
Auth API (Logto-only) tests.

These tests intentionally avoid legacy /auth/register|login|refresh flows.
"""
import uuid
import pytest
from httpx import AsyncClient

from tests._logto_test_utils import make_test_logto_token


API = "/api/v1"
ME_URL = f"{API}/auth/me"
ONBOARDING_URL = f"{API}/auth/onboarding"
LOGIN_URL = f"{API}/auth/login"
REGISTER_URL = f"{API}/auth/register"
REFRESH_URL = f"{API}/auth/refresh"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _sub(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


@pytest.mark.asyncio
async def test_me_needs_onboarding_when_user_missing(client: AsyncClient):
    token = make_test_logto_token(sub=_sub("u"), email="u@test.com", name="U")
    resp = await client.get(ME_URL, headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["needs_onboarding"] is True
    assert data["logto_sub"] is not None


@pytest.mark.asyncio
async def test_onboarding_then_me_returns_user(client: AsyncClient):
    token = make_test_logto_token(sub=_sub("brand"), email="brand@test.com", name="BrandUser")

    onboard = await client.post(
        ONBOARDING_URL,
        json={"role": "brand", "name": "BrandUser"},
        headers=_auth(token),
    )
    assert onboard.status_code == 201, onboard.text
    user = onboard.json()
    assert user["brand_id"] is not None

    me = await client.get(ME_URL, headers=_auth(token))
    assert me.status_code == 200, me.text
    data = me.json()
    assert data["needs_onboarding"] is False
    assert data["id"] == user["id"]
    assert data["brand_id"] == user["brand_id"]


@pytest.mark.asyncio
async def test_operator_onboarding_requires_access_code(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.api.auth.settings.OPERATOR_ACCESS_CODE", "portfolio-operator-test", raising=False)
    token = make_test_logto_token(sub=_sub("operator"), email="operator@test.com", name="OperatorUser")

    missing_code = await client.post(
        ONBOARDING_URL,
        json={"role": "operator", "name": "OperatorUser"},
        headers=_auth(token),
    )
    assert missing_code.status_code == 403
    assert missing_code.json()["detail"] == "代运营身份开通码不正确"

    wrong_code = await client.post(
        ONBOARDING_URL,
        json={"role": "operator", "name": "OperatorUser", "operator_access_code": "wrong-code"},
        headers=_auth(token),
    )
    assert wrong_code.status_code == 403
    assert wrong_code.json()["detail"] == "代运营身份开通码不正确"


@pytest.mark.asyncio
async def test_operator_onboarding_fails_closed_when_access_code_is_unconfigured(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr("app.api.auth.settings.OPERATOR_ACCESS_CODE", "", raising=False)
    token = make_test_logto_token(sub=_sub("operator-empty-code"), email="operator-empty@test.com", name="OperatorUser")

    response = await client.post(
        ONBOARDING_URL,
        json={
            "role": "operator",
            "name": "OperatorUser",
            "operator_access_code": "portfolio-operator-test",
        },
        headers=_auth(token),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "代运营身份开通码不正确"


@pytest.mark.asyncio
async def test_operator_onboarding_with_access_code_succeeds(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr("app.api.auth.settings.OPERATOR_ACCESS_CODE", "portfolio-operator-test", raising=False)
    token = make_test_logto_token(sub=_sub("operator"), email="operator-ok@test.com", name="OperatorUser")

    onboard = await client.post(
        ONBOARDING_URL,
        json={"role": "operator", "name": "OperatorUser", "operator_access_code": "portfolio-operator-test"},
        headers=_auth(token),
    )
    assert onboard.status_code == 201, onboard.text
    data = onboard.json()
    assert data["role"] == "operator"
    assert data["operator_id"] is not None
    assert data["agency_id"] is not None
    assert data["tenant_id"] is not None
    assert data["tenant_name"] == "OperatorUser"

    me = await client.get(ME_URL, headers=_auth(token))
    assert me.status_code == 200, me.text
    me_data = me.json()
    assert me_data["needs_onboarding"] is False
    assert me_data["role"] == "operator"
    assert me_data["operator_id"] == data["operator_id"]
    assert me_data["agency_id"] == data["agency_id"]
    assert me_data["tenant_id"] == data["tenant_id"]


@pytest.mark.asyncio
async def test_legacy_endpoints_are_removed(client: AsyncClient):
    reg = await client.post(REGISTER_URL, json={
        "email": "x@test.com",
        "password": "test123456",
        "name": "X",
        "role": "brand",
        "email_code": "000000",
    })
    assert reg.status_code == 404

    login = await client.post(LOGIN_URL, json={"email": "x@test.com", "password": "test123456"})
    assert login.status_code == 404

    refresh = await client.post(REFRESH_URL, json={"refresh_token": "whatever"})
    assert refresh.status_code == 404
