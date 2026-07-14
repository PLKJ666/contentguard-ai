"""
本地文件存储服务
"""
from __future__ import annotations

import shutil
from pathlib import Path, PurePosixPath
from typing import Optional
from urllib.parse import parse_qs, quote, urlparse

from app.config import settings

LOCAL_FILE_ROUTE_PATH = "/api/v1/upload/local"


def is_local_file_storage_enabled() -> bool:
    return bool(settings.LOCAL_FILE_STORAGE_ENABLED)


def _normalize_relative_file_key(file_key: str) -> str:
    key = (file_key or "").strip().lstrip("/")
    if not key:
        raise ValueError("文件 key 不能为空")

    parts: list[str] = []
    for part in PurePosixPath(key).parts:
        if not part or part == ".":
            continue
        if part == "..":
            raise ValueError("非法文件 key")
        parts.append(part)

    if not parts:
        raise ValueError("文件 key 不能为空")

    return "/".join(parts)


def normalize_file_key(file_key: str) -> str:
    parsed_key = parse_local_file_key_from_url(file_key)
    if parsed_key:
        return parsed_key
    return _normalize_relative_file_key(file_key)


def _storage_root() -> Path:
    root = Path(settings.LOCAL_FILE_STORAGE_DIR).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root


def get_local_file_path(file_key: str, *, create_parent: bool = False) -> Path:
    if not is_local_file_storage_enabled():
        raise ValueError("本地文件存储未启用")

    normalized_key = normalize_file_key(file_key)
    root = _storage_root().resolve()
    file_path = (root / Path(*normalized_key.split("/"))).resolve()
    if not file_path.is_relative_to(root):
        raise ValueError("非法文件 key")

    if create_parent:
        file_path.parent.mkdir(parents=True, exist_ok=True)

    return file_path


def local_file_exists(file_key: str) -> bool:
    if not is_local_file_storage_enabled():
        return False

    try:
        return get_local_file_path(file_key).is_file()
    except (OSError, ValueError):
        return False


def save_bytes(file_key: str, content: bytes) -> str:
    file_path = get_local_file_path(file_key, create_parent=True)
    file_path.write_bytes(content)
    return str(file_path)


def copy_file(file_key: str, source_path: str) -> str:
    file_path = get_local_file_path(file_key, create_parent=True)
    shutil.copyfile(source_path, file_path)
    return str(file_path)


def read_bytes(file_key: str) -> bytes:
    return get_local_file_path(file_key).read_bytes()


def get_file_size(file_key: str) -> int:
    return get_local_file_path(file_key).stat().st_size


def build_local_file_url(file_key: str) -> str:
    normalized_key = normalize_file_key(file_key)
    return f"{LOCAL_FILE_ROUTE_PATH}?key={quote(normalized_key, safe='')}"


def parse_local_file_key_from_url(url: str) -> Optional[str]:
    source = (url or "").strip()
    if not source:
        return None

    parsed = urlparse(source)
    path = parsed.path or ""
    if path != LOCAL_FILE_ROUTE_PATH and not path.endswith("/upload/local"):
        return None

    key = parse_qs(parsed.query).get("key", [None])[0]
    if not key:
        return None

    return _normalize_relative_file_key(key)
