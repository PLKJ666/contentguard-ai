import base64
import json
from typing import Any, Optional


_PREFIX = "test-logto."


def make_test_logto_token(*, sub: str, email: Optional[str] = None, name: Optional[str] = None) -> str:
    """
    Create a deterministic "fake Logto token" for unit tests.

    This is NOT a JWT. Tests monkeypatch decode_logto_token() to accept this format.
    """
    payload = {"sub": sub}
    if email is not None:
        payload["email"] = email
    if name is not None:
        payload["name"] = name
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    b64 = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return f"{_PREFIX}{b64}"


def decode_test_logto_token(token: str) -> Optional[dict[str, Any]]:
    """Decode tokens made by make_test_logto_token()."""
    if not token.startswith(_PREFIX):
        return None
    b64 = token[len(_PREFIX) :]
    # Restore padding.
    pad = "=" * (-len(b64) % 4)
    try:
        raw = base64.urlsafe_b64decode((b64 + pad).encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return payload

