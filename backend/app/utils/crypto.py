"""
加密工具
API Key 加解密
"""
import base64
import os
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.config import settings


def _get_fernet() -> Fernet:
    """
    获取 Fernet 加密器
    使用应用的 SECRET_KEY 派生加密密钥
    """
    # 使用 PBKDF2 从 SECRET_KEY 派生 32 字节密钥
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"miaosi-api-key-salt",  # 固定兼容盐值，已有加密配置不可随意更改
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(
        kdf.derive(settings.SECRET_KEY.encode())
    )
    return Fernet(key)


def encrypt_api_key(api_key: str) -> str:
    """
    加密 API Key

    Args:
        api_key: 明文 API Key

    Returns:
        加密后的 Base64 字符串
    """
    if not api_key:
        return ""

    fernet = _get_fernet()
    encrypted = fernet.encrypt(api_key.encode())
    return encrypted.decode()


def decrypt_api_key(encrypted: str) -> str:
    """
    解密 API Key

    Args:
        encrypted: 加密的 API Key

    Returns:
        明文 API Key
    """
    if not encrypted:
        return ""

    fernet = _get_fernet()
    decrypted = fernet.decrypt(encrypted.encode())
    return decrypted.decode()


def mask_api_key(api_key: str) -> str:
    """
    脱敏 API Key

    Args:
        api_key: API Key（明文或加密均可）

    Returns:
        脱敏后的字符串，如 "sk-1234****5678"
    """
    if not api_key:
        return ""

    if len(api_key) <= 8:
        return "****"

    return f"{api_key[:4]}****{api_key[-4:]}"
