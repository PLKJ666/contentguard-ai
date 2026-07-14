from types import SimpleNamespace

import pytest

from app.models.ai_config import AIConfig
from app.models.tenant import Tenant
from app.services.ai_service import AIServiceFactory


@pytest.mark.asyncio
async def test_get_client_cache_is_scoped_to_event_loop(test_db_session, monkeypatch):
    AIServiceFactory.clear_cache()

    tenant = Tenant(id="tenant-ai-cache", name="Tenant AI Cache", is_active=True)
    config = AIConfig(
        tenant_id=tenant.id,
        provider="openai",
        base_url="https://example.com/v1",
        api_key_encrypted="encrypted",
        models={"text": "gpt-4o-mini"},
        temperature=0.3,
        max_tokens=1024,
        is_configured=True,
    )
    test_db_session.add_all([tenant, config])
    await test_db_session.commit()

    created_clients: list[object] = []

    class FakeClient:
        def __init__(self, **kwargs):
            created_clients.append(object())

    loop_one = SimpleNamespace(name="loop-one")
    loop_two = SimpleNamespace(name="loop-two")

    monkeypatch.setattr("app.services.ai_service.decrypt_api_key", lambda value: "plain-key")
    monkeypatch.setattr("app.services.ai_service.OpenAICompatibleClient", FakeClient)
    monkeypatch.setattr("app.services.ai_service.asyncio.get_running_loop", lambda: loop_one)

    client_one = await AIServiceFactory.get_client(tenant.id, test_db_session)
    client_one_again = await AIServiceFactory.get_client(tenant.id, test_db_session)

    monkeypatch.setattr("app.services.ai_service.asyncio.get_running_loop", lambda: loop_two)
    client_two = await AIServiceFactory.get_client(tenant.id, test_db_session)

    assert client_one is client_one_again
    assert client_one is not client_two
    assert len(created_clients) == 2


def test_invalidate_cache_only_clears_exact_tenant_scope():
    AIServiceFactory.clear_cache()

    target_key = AIServiceFactory._client_cache_key("tenant-ai-cache")
    other_key = AIServiceFactory._client_cache_key("tenant-ai-cache-extra")
    target_client = object()
    other_client = object()

    AIServiceFactory._cache[target_key] = target_client
    AIServiceFactory._cache[other_key] = other_client

    AIServiceFactory.invalidate_cache("tenant-ai-cache")

    assert target_key not in AIServiceFactory._cache
    assert AIServiceFactory._cache[other_key] is other_client
