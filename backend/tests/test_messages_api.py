"""
消息 API 测试
覆盖: GET /messages, GET /messages/unread-count, PUT /messages/{id}/read, PUT /messages/read-all
"""
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.message_service import create_message
from tests._logto_test_utils import make_test_logto_token


MESSAGES_URL = "/api/v1/messages"
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


async def _seed_messages(
    db: AsyncSession,
    user_id: str,
    count: int = 5,
    msg_type: str = "system",
    is_read: bool = False,
) -> list:
    """在数据库中直接创建消息（绕过 API）"""
    msgs = []
    for i in range(count):
        m = await create_message(
            db=db,
            user_id=user_id,
            type=msg_type,
            title=f"测试消息 {i+1}",
            content=f"消息内容 {i+1}",
            related_task_id=f"TK{100000+i}",
            sender_name="系统",
        )
        if is_read:
            m.is_read = True
        msgs.append(m)
    await db.commit()
    return msgs


# ==================== GET /messages ====================


class TestGetMessages:
    """消息列表"""

    @pytest.mark.asyncio
    async def test_empty_messages(self, client: AsyncClient):
        data = await _register(client, "brand", "空消息", "empty-msg@test.com")
        token = data["access_token"]

        resp = await client.get(MESSAGES_URL, headers=_auth(token))
        assert resp.status_code == 200

        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0
        assert body["page"] == 1

    @pytest.mark.asyncio
    async def test_list_messages(self, client: AsyncClient, test_db_session: AsyncSession):
        data = await _register(client, "brand", "消息列表", "list-msg@test.com")
        token = data["access_token"]
        user_id = data["user"]["id"]

        await _seed_messages(test_db_session, user_id, count=3)

        resp = await client.get(MESSAGES_URL, headers=_auth(token))
        assert resp.status_code == 200

        body = resp.json()
        assert body["total"] == 3
        assert len(body["items"]) == 3

        # 验证消息结构
        msg = body["items"][0]
        assert "id" in msg
        assert "type" in msg
        assert "title" in msg
        assert "content" in msg
        assert "is_read" in msg

    @pytest.mark.asyncio
    async def test_pagination(self, client: AsyncClient, test_db_session: AsyncSession):
        data = await _register(client, "brand", "分页测试", "page-msg@test.com")
        token = data["access_token"]
        user_id = data["user"]["id"]

        await _seed_messages(test_db_session, user_id, count=15)

        # 第 1 页
        resp1 = await client.get(
            MESSAGES_URL, params={"page": 1, "page_size": 10}, headers=_auth(token),
        )
        assert resp1.status_code == 200
        body1 = resp1.json()
        assert len(body1["items"]) == 10
        assert body1["total"] == 15
        assert body1["page"] == 1

        # 第 2 页
        resp2 = await client.get(
            MESSAGES_URL, params={"page": 2, "page_size": 10}, headers=_auth(token),
        )
        assert resp2.status_code == 200
        body2 = resp2.json()
        assert len(body2["items"]) == 5

    @pytest.mark.asyncio
    async def test_filter_by_read_status(self, client: AsyncClient, test_db_session: AsyncSession):
        data = await _register(client, "brand", "已读过滤", "read-filter@test.com")
        token = data["access_token"]
        user_id = data["user"]["id"]

        await _seed_messages(test_db_session, user_id, count=3, is_read=False)
        await _seed_messages(test_db_session, user_id, count=2, is_read=True)

        # 只看未读
        resp = await client.get(
            MESSAGES_URL, params={"is_read": False}, headers=_auth(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 3
        for m in body["items"]:
            assert m["is_read"] is False

        # 只看已读
        resp2 = await client.get(
            MESSAGES_URL, params={"is_read": True}, headers=_auth(token),
        )
        assert resp2.status_code == 200
        assert resp2.json()["total"] == 2

    @pytest.mark.asyncio
    async def test_filter_by_type(self, client: AsyncClient, test_db_session: AsyncSession):
        data = await _register(client, "brand", "类型过滤", "type-filter@test.com")
        token = data["access_token"]
        user_id = data["user"]["id"]

        await _seed_messages(test_db_session, user_id, count=3, msg_type="new_task")
        await _seed_messages(test_db_session, user_id, count=2, msg_type="system")

        resp = await client.get(
            MESSAGES_URL, params={"type": "new_task"}, headers=_auth(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 3
        for m in body["items"]:
            assert m["type"] == "new_task"

    @pytest.mark.asyncio
    async def test_messages_isolation(self, client: AsyncClient, test_db_session: AsyncSession):
        """用户只能看到自己的消息"""
        data_a = await _register(client, "brand", "用户A", "user-a@test.com")
        data_b = await _register(client, "agency", "用户B", "user-b@test.com")

        await _seed_messages(test_db_session, data_a["user"]["id"], count=3)
        await _seed_messages(test_db_session, data_b["user"]["id"], count=5)

        resp = await client.get(MESSAGES_URL, headers=_auth(data_a["access_token"]))
        assert resp.json()["total"] == 3

        resp2 = await client.get(MESSAGES_URL, headers=_auth(data_b["access_token"]))
        assert resp2.json()["total"] == 5

    @pytest.mark.asyncio
    async def test_messages_unauthenticated(self, client: AsyncClient):
        resp = await client.get(MESSAGES_URL)
        assert resp.status_code in (401, 403)


# ==================== GET /messages/unread-count ====================


class TestUnreadCount:
    """未读消息数"""

    @pytest.mark.asyncio
    async def test_unread_count_zero(self, client: AsyncClient):
        data = await _register(client, "brand", "零未读", "zero-unread@test.com")
        token = data["access_token"]

        resp = await client.get(f"{MESSAGES_URL}/unread-count", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_unread_count(self, client: AsyncClient, test_db_session: AsyncSession):
        data = await _register(client, "brand", "未读计数", "unread-count@test.com")
        token = data["access_token"]
        user_id = data["user"]["id"]

        await _seed_messages(test_db_session, user_id, count=5, is_read=False)
        await _seed_messages(test_db_session, user_id, count=3, is_read=True)

        resp = await client.get(f"{MESSAGES_URL}/unread-count", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["count"] == 5


# ==================== PUT /messages/{id}/read ====================


class TestMarkAsRead:
    """标记单条消息已读"""

    @pytest.mark.asyncio
    async def test_mark_as_read(self, client: AsyncClient, test_db_session: AsyncSession):
        data = await _register(client, "brand", "标记已读", "mark-read@test.com")
        token = data["access_token"]
        user_id = data["user"]["id"]

        msgs = await _seed_messages(test_db_session, user_id, count=1)
        msg_id = msgs[0].id

        resp = await client.put(f"{MESSAGES_URL}/{msg_id}/read", headers=_auth(token))
        assert resp.status_code == 200

        # 验证未读数减少
        count_resp = await client.get(f"{MESSAGES_URL}/unread-count", headers=_auth(token))
        assert count_resp.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_mark_nonexistent_message(self, client: AsyncClient):
        data = await _register(client, "brand", "不存在", "nonexist-msg@test.com")
        token = data["access_token"]

        resp = await client.put(f"{MESSAGES_URL}/MSG999999/read", headers=_auth(token))
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_mark_other_users_message(self, client: AsyncClient, test_db_session: AsyncSession):
        """不能标记别人的消息"""
        data_a = await _register(client, "brand", "用户A标记", "mark-a@test.com")
        data_b = await _register(client, "agency", "用户B标记", "mark-b@test.com")

        msgs = await _seed_messages(test_db_session, data_a["user"]["id"], count=1)
        msg_id = msgs[0].id

        # 用户B尝试标记用户A的消息
        resp = await client.put(
            f"{MESSAGES_URL}/{msg_id}/read",
            headers=_auth(data_b["access_token"]),
        )
        assert resp.status_code == 404  # 看不到别人的消息，返回 404


# ==================== PUT /messages/read-all ====================


class TestMarkAllAsRead:
    """标记所有消息已读"""

    @pytest.mark.asyncio
    async def test_mark_all_as_read(self, client: AsyncClient, test_db_session: AsyncSession):
        data = await _register(client, "brand", "全部已读", "all-read@test.com")
        token = data["access_token"]
        user_id = data["user"]["id"]

        await _seed_messages(test_db_session, user_id, count=5)

        resp = await client.put(f"{MESSAGES_URL}/read-all", headers=_auth(token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 5

        # 验证未读数为 0
        count_resp = await client.get(f"{MESSAGES_URL}/unread-count", headers=_auth(token))
        assert count_resp.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_mark_all_no_messages(self, client: AsyncClient):
        data = await _register(client, "brand", "无消息全读", "no-msg-all@test.com")
        token = data["access_token"]

        resp = await client.put(f"{MESSAGES_URL}/read-all", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_mark_all_only_affects_own(self, client: AsyncClient, test_db_session: AsyncSession):
        """全部已读只影响自己的消息"""
        data_a = await _register(client, "brand", "全读A", "all-own-a@test.com")
        data_b = await _register(client, "agency", "全读B", "all-own-b@test.com")

        await _seed_messages(test_db_session, data_a["user"]["id"], count=3)
        await _seed_messages(test_db_session, data_b["user"]["id"], count=4)

        # A 全部已读
        await client.put(f"{MESSAGES_URL}/read-all", headers=_auth(data_a["access_token"]))

        # B 的未读数不受影响
        count_resp = await client.get(
            f"{MESSAGES_URL}/unread-count", headers=_auth(data_b["access_token"]),
        )
        assert count_resp.json()["count"] == 4
