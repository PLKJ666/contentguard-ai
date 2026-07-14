"""
用户资料 API 测试
覆盖: GET /profile, PUT /profile, PUT /profile/password(弃用)
"""
import uuid
import pytest
from httpx import AsyncClient
from tests._logto_test_utils import make_test_logto_token


PROFILE_URL = "/api/v1/profile"
ONBOARDING_URL = "/api/v1/auth/onboarding"


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


# ==================== GET /profile ====================


class TestGetProfile:
    """获取用户资料"""

    @pytest.mark.asyncio
    async def test_get_brand_profile(self, client: AsyncClient):
        data = await _register(client, "brand", "测试品牌", "brand-profile@test.com")
        token = data["access_token"]

        resp = await client.get(PROFILE_URL, headers=_auth(token))
        assert resp.status_code == 200

        body = resp.json()
        assert body["name"] == "测试品牌"
        assert body["role"] == "brand"
        assert body["email"] == "brand-profile@test.com"
        assert body["brand"] is not None
        assert body["brand"]["name"] == "测试品牌"

    @pytest.mark.asyncio
    async def test_get_agency_profile(self, client: AsyncClient):
        data = await _register(client, "agency", "测试代理商", "agency-profile@test.com")
        token = data["access_token"]

        resp = await client.get(PROFILE_URL, headers=_auth(token))
        assert resp.status_code == 200

        body = resp.json()
        assert body["role"] == "agency"
        assert body["agency"] is not None
        assert body["agency"]["name"] == "测试代理商"

    @pytest.mark.asyncio
    async def test_get_creator_profile(self, client: AsyncClient):
        data = await _register(client, "creator", "测试达人", "creator-profile@test.com")
        token = data["access_token"]

        resp = await client.get(PROFILE_URL, headers=_auth(token))
        assert resp.status_code == 200

        body = resp.json()
        assert body["role"] == "creator"
        assert body["creator"] is not None
        assert body["creator"]["name"] == "测试达人"

    @pytest.mark.asyncio
    async def test_get_profile_unauthenticated(self, client: AsyncClient):
        resp = await client.get(PROFILE_URL)
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_get_profile_invalid_token(self, client: AsyncClient):
        resp = await client.get(PROFILE_URL, headers=_auth("invalid-token"))
        assert resp.status_code in (401, 403)


# ==================== PUT /profile ====================


class TestUpdateProfile:
    """更新用户资料"""

    @pytest.mark.asyncio
    async def test_update_brand_name(self, client: AsyncClient):
        data = await _register(client, "brand", "原始品牌", "brand-update@test.com")
        token = data["access_token"]

        resp = await client.put(
            PROFILE_URL,
            json={"name": "新品牌名称"},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "新品牌名称"
        assert body["brand"]["name"] == "新品牌名称"

    @pytest.mark.asyncio
    async def test_update_brand_contact(self, client: AsyncClient):
        data = await _register(client, "brand", "品牌联系人", "brand-contact@test.com")
        token = data["access_token"]

        resp = await client.put(
            PROFILE_URL,
            json={
                "description": "品牌描述",
                "contact_name": "张三",
                "contact_phone": "13800000001",
                "contact_email": "zhangsan@brand.com",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["brand"]["description"] == "品牌描述"
        assert body["brand"]["contact_name"] == "张三"
        assert body["brand"]["contact_phone"] == "13800000001"
        assert body["brand"]["contact_email"] == "zhangsan@brand.com"

    @pytest.mark.asyncio
    async def test_update_agency_profile(self, client: AsyncClient):
        data = await _register(client, "agency", "代理商", "agency-update@test.com")
        token = data["access_token"]

        resp = await client.put(
            PROFILE_URL,
            json={
                "name": "新代理商名",
                "description": "专业MCN机构",
                "contact_name": "李四",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "新代理商名"
        assert body["agency"]["name"] == "新代理商名"
        assert body["agency"]["description"] == "专业MCN机构"

    @pytest.mark.asyncio
    async def test_update_creator_profile(self, client: AsyncClient):
        data = await _register(client, "creator", "达人", "creator-update@test.com")
        token = data["access_token"]

        resp = await client.put(
            PROFILE_URL,
            json={
                "name": "新达人名",
                "bio": "美食博主",
                "douyin_account": "douyin123",
                "xiaohongshu_account": "xhs456",
                "bilibili_account": "bili789",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "新达人名"
        assert body["creator"]["name"] == "新达人名"
        assert body["creator"]["bio"] == "美食博主"
        assert body["creator"]["douyin_account"] == "douyin123"
        assert body["creator"]["xiaohongshu_account"] == "xhs456"
        assert body["creator"]["bilibili_account"] == "bili789"

    @pytest.mark.asyncio
    async def test_update_phone_and_avatar(self, client: AsyncClient):
        data = await _register(client, "brand", "头像测试", "avatar-test@test.com")
        token = data["access_token"]

        resp = await client.put(
            PROFILE_URL,
            json={
                "phone": "13900000000",
                "avatar": "https://example.com/avatar.png",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["phone"] == "13900000000"
        assert body["avatar"] == "https://example.com/avatar.png"

    @pytest.mark.asyncio
    async def test_update_empty_body(self, client: AsyncClient):
        """空请求体不应报错"""
        data = await _register(client, "brand", "空更新测试", "empty-update@test.com")
        token = data["access_token"]

        resp = await client.put(PROFILE_URL, json={}, headers=_auth(token))
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_update_profile_unauthenticated(self, client: AsyncClient):
        resp = await client.put(PROFILE_URL, json={"name": "hack"})
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_update_persists(self, client: AsyncClient):
        """更新后重新 GET 应返回最新数据"""
        data = await _register(client, "creator", "持久化测试", "persist@test.com")
        token = data["access_token"]

        await client.put(
            PROFILE_URL,
            json={"bio": "更新后的简介"},
            headers=_auth(token),
        )

        resp = await client.get(PROFILE_URL, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["creator"]["bio"] == "更新后的简介"


# ==================== PUT /profile/password ====================


class TestChangePassword:
    """站内改密码入口已弃用"""

    @pytest.mark.asyncio
    async def test_change_password_returns_410_for_logto_user(self, client: AsyncClient):
        data = await _register(client, "brand", "密码测试", "pwd-change@test.com")
        token = data["access_token"]

        resp = await client.put(
            f"{PROFILE_URL}/password",
            json={"old_password": "Test1234!", "new_password": "NewPass5678!"},
            headers=_auth(token),
        )
        assert resp.status_code == 410
        assert "统一认证" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_change_password_returns_410_even_with_wrong_old(self, client: AsyncClient):
        data = await _register(client, "brand", "错误密码", "wrong-pwd@test.com")
        token = data["access_token"]

        resp = await client.put(
            f"{PROFILE_URL}/password",
            json={"old_password": "WrongPassword!", "new_password": "NewPass!"},
            headers=_auth(token),
        )
        assert resp.status_code == 410
        assert "Logto" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_change_password_returns_410_even_with_short_new_password(self, client: AsyncClient):
        data = await _register(client, "brand", "短密码", "short-pwd@test.com")
        token = data["access_token"]

        resp = await client.put(
            f"{PROFILE_URL}/password",
            json={"old_password": "Test1234!", "new_password": "12345"},
            headers=_auth(token),
        )
        assert resp.status_code == 410
        assert "统一认证" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_change_password_unauthenticated(self, client: AsyncClient):
        resp = await client.put(
            f"{PROFILE_URL}/password",
            json={"old_password": "a", "new_password": "b"},
        )
        assert resp.status_code in (401, 403)
