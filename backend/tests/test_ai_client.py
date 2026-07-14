from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.ai_client import OpenAICompatibleClient


def test_infer_capabilities_marks_gemini_as_audio_capable():
    capabilities = OpenAICompatibleClient._infer_capabilities("gemini-2.5-pro")

    assert "text" in capabilities
    assert "vision" in capabilities
    assert "audio" in capabilities


def test_infer_capabilities_keeps_whisper_in_audio_only():
    capabilities = OpenAICompatibleClient._infer_capabilities("whisper-large-v3")

    assert capabilities == ["audio"]


@pytest.mark.asyncio
async def test_list_models_filters_audio_to_combined_models_only():
    client = OpenAICompatibleClient.__new__(OpenAICompatibleClient)
    client.client = SimpleNamespace(
        models=SimpleNamespace(
            list=AsyncMock(
                return_value=SimpleNamespace(
                    data=[
                        SimpleNamespace(id="whisper-1"),
                        SimpleNamespace(id="gpt-4o"),
                        SimpleNamespace(id="gemini-2.5-pro"),
                    ]
                )
            )
        )
    )
    client.base_url = "https://example.com/v1"
    client.probe_audio_understanding = AsyncMock(
        side_effect=lambda model_id: model_id in {"gpt-4o", "gemini-2.5-pro"}
    )

    result = await OpenAICompatibleClient.list_models(client)

    assert [item["id"] for item in result["audio"]] == ["gemini-2.5-pro", "gpt-4o"]
    assert client.probe_audio_understanding.await_count == 2
