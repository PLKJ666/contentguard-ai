"""
通知设置 API 测试
覆盖: GET/PUT /api/v1/profile/notification-settings
"""

import uuid
import pytest
from httpx import AsyncClient
from tests._logto_test_utils import make_test_logto_token


ONBOARDING_URL = "/api/v1/auth/onboarding"
URL = "/api/v1/profile/notification-settings"


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
async def test_notification_settings_roundtrip(client: AsyncClient):
    user = await _register(client, "creator", "通知达人", "notify-creator@test.com")
    token = user["access_token"]

    resp = await client.get(URL, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["items"] == []

    put = await client.put(URL, json={
        "items": [
            {"id": "review", "email": True, "push": True, "sms": False},
            {"id": "system", "email": True, "push": False, "sms": False},
        ]
    }, headers=_auth(token))
    assert put.status_code == 200, put.text
    items = put.json()["items"]
    assert len(items) == 2
    ids = [x["id"] for x in items]
    assert ids == sorted(ids)

    get2 = await client.get(URL, headers=_auth(token))
    assert get2.status_code == 200
    assert len(get2.json()["items"]) == 2
