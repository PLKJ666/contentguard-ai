"""
火山引擎 TOS (Volcengine Object Storage) 服务 — 表单直传签名 (V4)
"""
import logging
import time
import hmac
import base64
import hashlib
import json
from typing import Optional
from datetime import datetime, timezone
from app.config import settings
from app.services.local_file_storage import (
    build_local_file_url,
    local_file_exists,
    parse_local_file_key_from_url,
    read_bytes,
)

logger = logging.getLogger(__name__)


def generate_upload_policy(
    max_size_mb: int = 500,
    expire_seconds: int = 3600,
    upload_dir: Optional[str] = None,
) -> dict:
    """
    生成前端直传 TOS 所需的 Policy 和签名 (V4 HMAC-SHA256)

    TOS 表单直传签名流程 (PostObject):
    1. 构建 policy JSON → Base64 编码
    2. 派生签名密钥: kDate → kRegion → kService → kSigning
    3. signature = HMAC-SHA256(kSigning, policy_base64)

    Returns:
        {
            "x_tos_algorithm": "TOS4-HMAC-SHA256",
            "x_tos_credential": "AKIDxxxx/20260210/cn-beijing/tos/request",
            "x_tos_date": "20260210T120000Z",
            "x_tos_signature": "...",
            "policy": "base64 encoded policy",
            "host": "https://bucket.tos-cn-beijing.volces.com",
            "dir": "uploads/2026/02/",
            "expire": 1234567890,
        }
    """
    if not settings.TOS_ACCESS_KEY_ID or not settings.TOS_SECRET_ACCESS_KEY:
        raise ValueError("TOS 配置未设置")

    # 计算时间
    now_utc = datetime.now(timezone.utc)
    date_stamp = now_utc.strftime("%Y%m%d")  # 20260210
    tos_date = now_utc.strftime("%Y%m%dT%H%M%SZ")  # 20260210T120000Z
    expire_time = int(time.time()) + expire_seconds
    expiration = datetime.fromtimestamp(expire_time, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )

    # Credential scope
    region = settings.TOS_REGION
    credential = f"{settings.TOS_ACCESS_KEY_ID}/{date_stamp}/{region}/tos/request"

    # 默认上传目录：uploads/年/月/
    if upload_dir is None:
        now = datetime.now()
        upload_dir = f"uploads/{now.year}/{now.month:02d}/"

    # 1. 构建 Policy
    policy_dict = {
        "expiration": expiration,
        "conditions": [
            {"bucket": settings.TOS_BUCKET_NAME},
            ["starts-with", "$key", upload_dir],
            {"x-tos-algorithm": "TOS4-HMAC-SHA256"},
            {"x-tos-credential": credential},
            {"x-tos-date": tos_date},
            ["content-length-range", 0, max_size_mb * 1024 * 1024],
        ],
    }

    # 2. Base64 编码 Policy
    policy_json = json.dumps(policy_dict)
    policy_base64 = base64.b64encode(policy_json.encode()).decode()

    # 3. 派生签名密钥 (V4 Signing Key)
    k_date = hmac.new(
        f"TOS4{settings.TOS_SECRET_ACCESS_KEY}".encode(),
        date_stamp.encode(),
        hashlib.sha256,
    ).digest()

    k_region = hmac.new(k_date, region.encode(), hashlib.sha256).digest()
    k_service = hmac.new(k_region, b"tos", hashlib.sha256).digest()
    k_signing = hmac.new(k_service, b"request", hashlib.sha256).digest()

    # 4. signature = HMAC-SHA256(kSigning, policy_base64)
    signature = hmac.new(
        k_signing,
        policy_base64.encode(),
        hashlib.sha256,
    ).hexdigest()

    # 构建 Host
    endpoint = settings.TOS_ENDPOINT or f"tos-cn-{region}.volces.com"
    host = f"https://{settings.TOS_BUCKET_NAME}.{endpoint}"

    return {
        "x_tos_algorithm": "TOS4-HMAC-SHA256",
        "x_tos_credential": credential,
        "x_tos_date": tos_date,
        "x_tos_signature": signature,
        "policy": policy_base64,
        "host": host,
        "dir": upload_dir,
        "expire": expire_time,
    }


def get_file_url(file_key: str) -> str:
    """
    获取文件的访问 URL

    优先使用 CDN 域名，否则用 TOS 源站域名。

    Args:
        file_key: 文件在 TOS 中的 key，如 "uploads/2026/02/video.mp4"

    Returns:
        完整的访问 URL
    """
    local_file_key = parse_local_file_key_from_url(file_key)
    if local_file_key:
        return build_local_file_url(local_file_key)

    normalized_key = file_key.lstrip("/")
    if local_file_exists(normalized_key):
        return build_local_file_url(normalized_key)

    if settings.TOS_CDN_DOMAIN:
        host = settings.TOS_CDN_DOMAIN
    else:
        endpoint = settings.TOS_ENDPOINT or f"tos-cn-{settings.TOS_REGION}.volces.com"
        host = f"https://{settings.TOS_BUCKET_NAME}.{endpoint}"

    # 确保 host 以 https:// 开头
    if not host.startswith("http"):
        host = f"https://{host}"

    # 确保 host 不以 / 结尾
    host = host.rstrip("/")

    # 确保 file_key 不以 / 开头
    file_key = normalized_key

    return f"{host}/{file_key}"


def generate_presigned_url(
    file_key: str,
    expire_seconds: int = 3600,
) -> str:
    """
    为私有桶中的文件生成预签名访问 URL（使用 TOS SDK）

    Args:
        file_key: 文件在 TOS 中的 key
        expire_seconds: URL 有效期（秒），默认 1 小时

    Returns:
        预签名 URL
    """
    if local_file_exists(file_key):
        return build_local_file_url(file_key)

    if not settings.TOS_ACCESS_KEY_ID or not settings.TOS_SECRET_ACCESS_KEY:
        raise ValueError("TOS 配置未设置")

    import tos as tos_sdk

    region = settings.TOS_REGION
    endpoint = settings.TOS_ENDPOINT or f"tos-cn-{region}.volces.com"

    client = tos_sdk.TosClientV2(
        ak=settings.TOS_ACCESS_KEY_ID,
        sk=settings.TOS_SECRET_ACCESS_KEY,
        endpoint=f"https://{endpoint}",
        region=region,
    )

    result = client.pre_signed_url(
        http_method=tos_sdk.HttpMethodType.Http_Method_Get,
        bucket=settings.TOS_BUCKET_NAME,
        key=file_key,
        expires=expire_seconds,
    )

    return result.signed_url


def generate_presigned_upload_url(
    file_key: str,
    expire_seconds: int = 600,
) -> str:
    """
    为上传生成预签名 PUT URL（使用 TOS SDK）。

    Args:
        file_key: 文件在 TOS 中的 key
        expire_seconds: URL 有效期（秒），默认 10 分钟

    Returns:
        预签名上传 URL
    """
    if local_file_exists(file_key):
        raise ValueError("本地文件存储不支持预签名上传")

    if not settings.TOS_ACCESS_KEY_ID or not settings.TOS_SECRET_ACCESS_KEY:
        raise ValueError("TOS 配置未设置")

    import tos as tos_sdk

    region = settings.TOS_REGION
    endpoint = settings.TOS_ENDPOINT or f"tos-cn-{region}.volces.com"

    client = tos_sdk.TosClientV2(
        ak=settings.TOS_ACCESS_KEY_ID,
        sk=settings.TOS_SECRET_ACCESS_KEY,
        endpoint=f"https://{endpoint}",
        region=region,
    )

    result = client.pre_signed_url(
        http_method=tos_sdk.HttpMethodType.Http_Method_Put,
        bucket=settings.TOS_BUCKET_NAME,
        key=file_key,
        expires=expire_seconds,
    )

    return result.signed_url


def ensure_signed_url(url: str, expire_seconds: int = 3600) -> str:
    """
    确保 URL 可访问：如果是 TOS 私有桶的 URL，生成签名 URL；否则原样返回。

    注意：部分 TOS 桶策略不支持 Query String Auth（签名 URL），
    此时应使用 download_from_tos() 通过 SDK 直接下载。

    Args:
        url: 原始文件 URL
        expire_seconds: 签名有效期（秒）

    Returns:
        可访问的 URL（签名后或原样）
    """
    if not url:
        return url

    local_file_key = parse_local_file_key_from_url(url)
    if local_file_key and local_file_exists(local_file_key):
        return build_local_file_url(local_file_key)

    # 检查是否是 TOS URL
    file_key = parse_file_key_from_url(url)
    if local_file_exists(file_key):
        return build_local_file_url(file_key)

    if url.startswith("http") and file_key == url:
        # 无法解析为 TOS key，说明不是 TOS URL，原样返回
        return url

    try:
        return generate_presigned_url(file_key, expire_seconds=expire_seconds)
    except (ValueError, Exception):
        # TOS 未配置或签名失败，回退原始 URL
        return url


def download_from_tos(url: str) -> Optional[bytes]:
    """
    通过 TOS SDK (AK/SK 认证头) 直接下载文件。

    当桶策略不支持预签名 URL 时，使用此方法下载。
    支持任意 TOS URL，自动解析 file_key。

    Args:
        url: TOS 文件 URL

    Returns:
        文件内容 bytes，失败返回 None
    """
    if not url:
        return None

    file_key = parse_file_key_from_url(url)
    if local_file_exists(file_key):
        try:
            data = read_bytes(file_key)
            logger.info(f"本地文件下载成功: key={file_key}, size={len(data)}")
            return data
        except Exception as e:
            logger.error(f"本地文件下载失败: {e}")
            return None

    if url.startswith("http") and file_key == url:
        return None

    if not settings.TOS_ACCESS_KEY_ID or not settings.TOS_SECRET_ACCESS_KEY:
        logger.warning("TOS AK/SK 未配置，无法通过 SDK 下载")
        return None

    try:
        import tos as tos_sdk
        region = settings.TOS_REGION
        endpoint = settings.TOS_ENDPOINT or f"tos-cn-{region}.volces.com"

        client = tos_sdk.TosClientV2(
            ak=settings.TOS_ACCESS_KEY_ID,
            sk=settings.TOS_SECRET_ACCESS_KEY,
            endpoint=f"https://{endpoint}",
            region=region,
        )
        resp = client.get_object(bucket=settings.TOS_BUCKET_NAME, key=file_key)
        data = resp.read()
        logger.info(f"TOS SDK 下载成功: key={file_key}, size={len(data)}")
        return data
    except Exception as e:
        logger.error(f"TOS SDK 下载失败: {e}")
        return None


def parse_file_key_from_url(url: str) -> str:
    """
    从完整 URL 解析出文件 key

    Args:
        url: 完整的 TOS URL

    Returns:
        文件 key
    """
    local_file_key = parse_local_file_key_from_url(url)
    if local_file_key:
        return local_file_key

    # 尝试移除 CDN 域名
    if settings.TOS_CDN_DOMAIN:
        cdn = settings.TOS_CDN_DOMAIN.rstrip("/")
        if not cdn.startswith("http"):
            cdn = f"https://{cdn}"
        if url.startswith(cdn):
            return url[len(cdn):].lstrip("/")

    # 尝试移除 TOS 源站域名
    endpoint = settings.TOS_ENDPOINT or f"tos-cn-{settings.TOS_REGION}.volces.com"
    tos_host = f"https://{settings.TOS_BUCKET_NAME}.{endpoint}"
    if url.startswith(tos_host):
        return url[len(tos_host):].lstrip("/")

    return url
