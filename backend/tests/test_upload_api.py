from datetime import datetime
import os
import uuid
from urllib.parse import quote
import sys
from types import SimpleNamespace

import pytest
from httpx import AsyncClient

from app.api.upload import _build_proxy_file_key, _extract_filename_from_key, _get_tos_client, _normalize_upload_filename
from app.config import settings
from tests._logto_test_utils import make_test_logto_token

API = "/api/v1"
ONBOARDING_URL = f"{API}/auth/onboarding"


def _email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.com"


async def _register(client: AsyncClient, role: str, name: str | None = None):
    email = _email(role)
    token = make_test_logto_token(
        sub=f"{role}-{uuid.uuid4().hex[:10]}",
        email=email,
        name=name or f"Test {role.title()}",
    )
    resp = await client.post(
        ONBOARDING_URL,
        json={"role": role, "name": name or f"Test {role.title()}"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return token, resp.json()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_normalize_upload_filename_keeps_display_name_and_escapes_object_name():
    display_name, object_name = _normalize_upload_filename("中文 Brief(终稿).pdf")

    assert display_name == "中文 Brief(终稿).pdf"
    assert object_name.endswith(".pdf")
    assert "中文" not in object_name
    assert len(object_name.split(".")[0]) == 32
    assert _extract_filename_from_key(
        "uploads/2026/03/files/1711111111_%E4%B8%AD%E6%96%87%20Brief(%E7%BB%88%E7%A8%BF).pdf"
    ) == display_name
    assert _extract_filename_from_key(
        _build_proxy_file_key("general", display_name, object_name, datetime(2026, 3, 24, 12, 0, 0))
    ) == display_name


def test_get_tos_client_uses_extended_timeouts(monkeypatch):
    captured: dict[str, object] = {}

    class FakeTosClientV2:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    fake_tos_module = SimpleNamespace(TosClientV2=FakeTosClientV2)
    monkeypatch.setitem(sys.modules, "tos", fake_tos_module)
    monkeypatch.setattr(settings, "TOS_ACCESS_KEY_ID", "test-ak")
    monkeypatch.setattr(settings, "TOS_SECRET_ACCESS_KEY", "test-sk")

    client = _get_tos_client()

    assert isinstance(client, FakeTosClientV2)
    assert captured["request_timeout"] == 600
    assert captured["socket_timeout"] == 600
    assert captured["connection_time"] == 30


class TestUploadProxyAPI:
    @pytest.mark.asyncio
    async def test_proxy_upload_falls_back_to_local_storage_when_tos_fails(self, client: AsyncClient, monkeypatch, tmp_path):
        token, _ = await _register(client, "agency", "Upload Agency")

        monkeypatch.setattr(settings, "LOCAL_FILE_STORAGE_ENABLED", True)
        monkeypatch.setattr(settings, "LOCAL_FILE_STORAGE_DIR", str(tmp_path))

        class FakeTOSClient:
            def put_object(self, bucket, key, content, content_type):
                raise TimeoutError("tos timeout")

        monkeypatch.setattr("app.api.upload._get_tos_client", lambda: FakeTOSClient())

        resp = await client.post(
            f"{API}/upload/proxy",
            headers=_auth(token),
            files={"file": ("中文Brief测试.pdf", b"brief-content", "application/pdf")},
            data={"file_type": "script"},
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["file_name"] == "中文Brief测试.pdf"
        assert data["url"].startswith("/api/v1/upload/local?key=")
        saved_path = tmp_path / data["file_key"]
        assert saved_path.read_bytes() == b"brief-content"

    @pytest.mark.asyncio
    async def test_proxy_upload_accepts_unicode_filename(self, client: AsyncClient, monkeypatch):
        token, _ = await _register(client, "agency", "Upload Agency")

        class FakeTOSClient:
            def __init__(self):
                self.bucket = None
                self.key = None
                self.content_type = None
                self.payload = None

            def put_object(self, bucket, key, content, content_type):
                self.bucket = bucket
                self.key = key
                self.content_type = content_type
                self.payload = content.read()

        fake_client = FakeTOSClient()
        monkeypatch.setattr("app.api.upload._get_tos_client", lambda: fake_client)

        resp = await client.post(
            f"{API}/upload/proxy",
            headers=_auth(token),
            files={"file": ("中文Brief测试.pdf", b"brief-content", "application/pdf")},
            data={"file_type": "script"},
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["file_name"] == "中文Brief测试.pdf"
        assert data["file_type"] == "script"
        assert "中文" not in data["file_key"]
        assert data["file_key"].endswith(".pdf")
        assert quote("中文Brief测试.pdf", safe="") in data["file_key"]
        assert fake_client.key == data["file_key"]
        assert fake_client.content_type == "application/pdf"
        assert fake_client.payload == b"brief-content"

    @pytest.mark.asyncio
    async def test_proxy_upload_streams_video_via_put_object(self, client: AsyncClient, monkeypatch):
        token, _ = await _register(client, "creator", "Video Creator")

        class FakeTOSClient:
            def __init__(self):
                self.put_object_called = False
                self.bucket = None
                self.key = None
                self.content_type = None
                self.payload = None

            def put_object(self, bucket, key, content, content_type):
                self.put_object_called = True
                self.bucket = bucket
                self.key = key
                self.content_type = content_type
                self.payload = content.read()

        fake_client = FakeTOSClient()
        monkeypatch.setattr("app.api.upload._get_tos_client", lambda: fake_client)

        resp = await client.post(
            f"{API}/upload/proxy",
            headers=_auth(token),
            files={"file": ("不同状态喝咖啡.mp4", b"video-bytes", "video/mp4")},
            data={"file_type": "video"},
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["file_name"] == "不同状态喝咖啡.mp4"
        assert data["file_type"] == "video"
        assert data["file_size"] == len(b"video-bytes")
        assert quote("不同状态喝咖啡.mp4", safe="") in data["file_key"]
        assert fake_client.put_object_called is True
        assert fake_client.key == data["file_key"]
        assert fake_client.content_type == "video/mp4"
        assert fake_client.payload == b"video-bytes"

    @pytest.mark.asyncio
    async def test_proxy_binary_upload_accepts_unicode_filename(self, client: AsyncClient, monkeypatch):
        token, _ = await _register(client, "agency", "Upload Agency")

        class FakeTOSClient:
            def __init__(self):
                self.bucket = None
                self.key = None
                self.content_type = None
                self.payload = None

            def put_object(self, bucket, key, content, content_type):
                self.bucket = bucket
                self.key = key
                self.content_type = content_type
                self.payload = content.read()

        fake_client = FakeTOSClient()
        monkeypatch.setattr("app.api.upload._get_tos_client", lambda: fake_client)

        resp = await client.post(
            f"{API}/upload/proxy-binary",
            headers={
                **_auth(token),
                "X-Upload-File-Name": quote("中文Brief测试.pdf", safe=""),
                "X-Upload-File-Type": "script",
                "Content-Type": "application/pdf",
            },
            content=b"brief-content",
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["file_name"] == "中文Brief测试.pdf"
        assert data["file_type"] == "script"
        assert "中文" not in data["file_key"]
        assert data["file_key"].endswith(".pdf")
        assert quote("中文Brief测试.pdf", safe="") in data["file_key"]
        assert fake_client.key == data["file_key"]
        assert fake_client.content_type == "application/pdf"
        assert fake_client.payload == b"brief-content"

    @pytest.mark.asyncio
    async def test_proxy_binary_upload_streams_video_via_put_object(self, client: AsyncClient, monkeypatch):
        token, _ = await _register(client, "creator", "Video Creator")

        class FakeTOSClient:
            def __init__(self):
                self.put_object_called = False
                self.bucket = None
                self.key = None
                self.content_type = None
                self.payload = None

            def put_object(self, bucket, key, content, content_type):
                self.put_object_called = True
                self.bucket = bucket
                self.key = key
                self.content_type = content_type
                self.payload = content.read()

        fake_client = FakeTOSClient()
        monkeypatch.setattr("app.api.upload._get_tos_client", lambda: fake_client)

        resp = await client.post(
            f"{API}/upload/proxy-binary",
            headers={
                **_auth(token),
                "X-Upload-File-Name": quote("不同状态喝咖啡.mp4", safe=""),
                "X-Upload-File-Type": "video",
                "Content-Type": "video/mp4",
            },
            content=b"video-bytes",
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["file_name"] == "不同状态喝咖啡.mp4"
        assert data["file_type"] == "video"
        assert data["file_size"] == len(b"video-bytes")
        assert quote("不同状态喝咖啡.mp4", safe="") in data["file_key"]
        assert fake_client.put_object_called is True
        assert fake_client.key == data["file_key"]
        assert fake_client.content_type == "video/mp4"
        assert fake_client.payload == b"video-bytes"

    @pytest.mark.asyncio
    async def test_download_uses_original_filename_for_proxy_uploaded_file(self, client: AsyncClient, monkeypatch):
        token, _ = await _register(client, "agency", "Upload Agency")

        class FakeObjectResponse:
            def __init__(self, payload: bytes):
                self._payload = payload

            def read(self):
                return self._payload

        class FakeTOSClient:
            def __init__(self):
                self.objects = {}

            def put_object(self, bucket, key, content, content_type):
                self.objects[key] = {
                    "bucket": bucket,
                    "payload": content.read(),
                    "content_type": content_type,
                }

            def get_object(self, bucket, key):
                assert bucket == self.objects[key]["bucket"]
                return FakeObjectResponse(self.objects[key]["payload"])

        fake_client = FakeTOSClient()
        monkeypatch.setattr("app.api.upload._get_tos_client", lambda: fake_client)

        upload_resp = await client.post(
            f"{API}/upload/proxy",
            headers=_auth(token),
            files={"file": ("中文Brief测试.pdf", b"brief-content", "application/pdf")},
            data={"file_type": "script"},
        )

        assert upload_resp.status_code == 200, upload_resp.text
        file_key = upload_resp.json()["file_key"]

        download_resp = await client.get(
            f"{API}/upload/download",
            headers=_auth(token),
            params={"url": file_key},
        )

        assert download_resp.status_code == 200, download_resp.text
        assert download_resp.content == b"brief-content"
        assert (
            download_resp.headers["content-disposition"]
            == f"attachment; filename*=UTF-8''{quote('中文Brief测试.pdf', safe='')}"
        )

    @pytest.mark.asyncio
    async def test_download_uses_original_filename_for_local_fallback_file(self, client: AsyncClient, monkeypatch, tmp_path):
        token, _ = await _register(client, "agency", "Upload Agency")

        monkeypatch.setattr(settings, "LOCAL_FILE_STORAGE_ENABLED", True)
        monkeypatch.setattr(settings, "LOCAL_FILE_STORAGE_DIR", str(tmp_path))

        class FakeTOSClient:
            def put_object(self, bucket, key, content, content_type):
                raise TimeoutError("tos timeout")

        monkeypatch.setattr("app.api.upload._get_tos_client", lambda: FakeTOSClient())

        upload_resp = await client.post(
            f"{API}/upload/proxy",
            headers=_auth(token),
            files={"file": ("中文Brief测试.pdf", b"brief-content", "application/pdf")},
            data={"file_type": "script"},
        )

        assert upload_resp.status_code == 200, upload_resp.text
        file_url = upload_resp.json()["url"]

        download_resp = await client.get(
            f"{API}/upload/download",
            headers=_auth(token),
            params={"url": file_url},
        )

        assert download_resp.status_code == 200, download_resp.text
        assert download_resp.content == b"brief-content"
        assert (
            download_resp.headers["content-disposition"]
            == f"attachment; filename*=UTF-8''{quote('中文Brief测试.pdf', safe='')}"
        )
