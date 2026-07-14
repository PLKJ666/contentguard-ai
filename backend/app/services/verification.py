"""
验证码服务

使用内存存储验证码，支持 TTL 自动过期。
生产环境建议替换为 Redis 存储。
"""
import secrets
import time
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

# 内存存储: { "email:purpose" -> (code, expire_timestamp) }
_code_store: dict[str, tuple[str, float]] = {}

# 发送频率限制: { "email:purpose" -> last_send_timestamp }
_rate_limit: dict[str, float] = {}

# 最小发送间隔（秒）
SEND_INTERVAL = 60


def _cleanup_expired() -> None:
    """清理过期的验证码"""
    now = time.time()
    expired_keys = [k for k, (_, exp) in _code_store.items() if now > exp]
    for k in expired_keys:
        del _code_store[k]


def generate_code(email: str, purpose: str = "register") -> tuple[str, Optional[str]]:
    """
    生成验证码并存储。

    返回 (code, error)。
    error 为 None 表示成功，否则返回错误信息。
    """
    _cleanup_expired()

    key = f"{email}:{purpose}"

    # 检查发送频率
    now = time.time()
    last_sent = _rate_limit.get(key, 0)
    if now - last_sent < SEND_INTERVAL:
        remaining = int(SEND_INTERVAL - (now - last_sent))
        return "", f"发送过于频繁，请 {remaining} 秒后重试"

    # 生成验证码
    code = "".join(str(secrets.randbelow(10)) for _ in range(settings.VERIFICATION_CODE_LENGTH))

    # 存储（带 TTL）
    expire_at = now + settings.VERIFICATION_CODE_EXPIRE_MINUTES * 60
    _code_store[key] = (code, expire_at)
    _rate_limit[key] = now

    logger.info("验证码已生成: email=%s, purpose=%s", email, purpose)
    return code, None


def verify_code(email: str, code: str, purpose: str = "register") -> bool:
    """
    验证验证码是否正确。

    验证成功后自动删除验证码（一次性使用）。
    """
    _cleanup_expired()

    key = f"{email}:{purpose}"
    stored = _code_store.get(key)

    if not stored:
        return False

    stored_code, expire_at = stored

    # 已过期
    if time.time() > expire_at:
        del _code_store[key]
        return False

    # 验证码匹配
    if stored_code == code:
        del _code_store[key]  # 一次性使用
        return True

    return False


def clear_all() -> None:
    """清除所有验证码（用于测试）"""
    _code_store.clear()
    _rate_limit.clear()
