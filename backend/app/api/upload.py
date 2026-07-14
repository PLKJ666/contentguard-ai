"""
文件上传 API
"""
import io
import logging
import os
import tempfile
from urllib.parse import quote, unquote
from fastapi import APIRouter, Depends, HTTPException, Query, Header, UploadFile, File, Form, Request, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

from app.services.oss import (
    generate_upload_policy,
    get_file_url,
    generate_presigned_url,
    generate_presigned_upload_url,
)
from app.config import settings
from app.models.user import User
from app.api.deps import get_current_user
from app.services.auth import decode_logto_token
from app.services.local_file_storage import (
    build_local_file_url,
    copy_file,
    get_file_size,
    get_local_file_path,
    local_file_exists,
    read_bytes,
    save_bytes,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["文件上传"])

TOS_REQUEST_TIMEOUT_SECONDS = 600
TOS_SOCKET_TIMEOUT_SECONDS = 600
TOS_CONNECT_TIMEOUT_SECONDS = 30
PROXY_UPLOAD_TMP_CHUNK_SIZE = 1024 * 1024


def _normalize_upload_filename(filename: Optional[str]) -> tuple[str, str]:
    """返回显示名和可安全写入对象存储 key 的文件名。"""
    display_name = (filename or "unknown").strip() or "unknown"
    display_name = display_name.replace("\\", "/").split("/")[-1].strip() or "unknown"
    if display_name in {".", ".."}:
        display_name = "unknown"
    ext = ""
    if "." in display_name:
        candidate_ext = display_name.rsplit(".", 1)[-1].strip().lower()
        if candidate_ext and all(ch.isalnum() for ch in candidate_ext):
            ext = f".{candidate_ext}"
    object_name = f"{uuid.uuid4().hex}{ext}"
    return display_name, object_name


def _extract_filename_from_key(file_key: str) -> str:
    parts = [part for part in file_key.split("/") if part]
    filename = parts[-1] if parts else "unknown"
    prefix, sep, rest = filename.partition("_")
    if sep and prefix.isdigit() and len(prefix) >= 10:
        filename = rest
    return unquote(filename)


def _build_proxy_file_key(file_type: str, display_name: str, object_name: str, now: datetime) -> str:
    """构造兼顾对象存储安全性和原始显示名可回溯的代理上传 key。"""
    base_dir = f"uploads/{now.year}/{now.month:02d}"
    type_dirs = {"script": "scripts", "video": "videos", "image": "images"}
    sub_dir = type_dirs.get(file_type, "files")
    encoded_display_name = quote(display_name, safe="")
    return f"{base_dir}/{sub_dir}/{int(now.timestamp())}_{object_name}/{encoded_display_name}"


class UploadPolicyRequest(BaseModel):
    """获取上传凭证请求"""
    file_type: str = "general"  # script, video, image, general
    file_name: Optional[str] = None


class UploadPolicyResponse(BaseModel):
    """TOS 直传凭证响应"""
    x_tos_algorithm: str
    x_tos_credential: str
    x_tos_date: str
    x_tos_signature: str
    policy: str
    host: str
    dir: str
    expire: int
    max_size_mb: int


class PresignedUploadRequest(BaseModel):
    """获取预签名上传链接请求"""
    file_type: str = "general"
    file_name: Optional[str] = None


class PresignedUploadResponse(BaseModel):
    """预签名上传链接响应"""
    upload_url: str
    file_key: str
    file_name: str
    file_type: str
    expire_seconds: int


class FileUploadedRequest(BaseModel):
    """文件上传完成回调"""
    file_key: str
    file_name: str
    file_size: int
    file_type: str


class FileUploadedResponse(BaseModel):
    """文件上传完成响应"""
    url: str
    file_key: str
    file_name: str
    file_size: int
    file_type: str


@router.post("/policy", response_model=UploadPolicyResponse)
async def get_upload_policy(
    request: UploadPolicyRequest,
    current_user: User = Depends(get_current_user),
):
    """
    获取 TOS 直传凭证

    前端使用此凭证直接上传文件到火山引擎 TOS，无需经过后端。

    文件类型说明：
    - script: 脚本文档 (docx, pdf, xlsx, txt, pptx)
    - video: 视频文件 (mp4, mov, webm)
    - image: 图片文件 (jpg, png, gif)
    - general: 通用文件
    """
    # 根据文件类型设置上传目录
    now = datetime.now()
    base_dir = f"uploads/{now.year}/{now.month:02d}"

    if request.file_type == "script":
        upload_dir = f"{base_dir}/scripts/"
    elif request.file_type == "video":
        upload_dir = f"{base_dir}/videos/"
    elif request.file_type == "image":
        upload_dir = f"{base_dir}/images/"
    else:
        upload_dir = f"{base_dir}/files/"

    try:
        policy = generate_upload_policy(
            max_size_mb=settings.MAX_FILE_SIZE_MB,
            expire_seconds=3600,
            upload_dir=upload_dir,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )

    return UploadPolicyResponse(
        x_tos_algorithm=policy["x_tos_algorithm"],
        x_tos_credential=policy["x_tos_credential"],
        x_tos_date=policy["x_tos_date"],
        x_tos_signature=policy["x_tos_signature"],
        policy=policy["policy"],
        host=policy["host"],
        dir=policy["dir"],
        expire=policy["expire"],
        max_size_mb=settings.MAX_FILE_SIZE_MB,
    )


@router.post("/complete", response_model=FileUploadedResponse)
async def file_uploaded(
    request: FileUploadedRequest,
    current_user: User = Depends(get_current_user),
):
    """
    文件上传完成回调

    前端上传完成后调用此接口，获取文件的完整 URL。
    """
    url = get_file_url(request.file_key)

    return FileUploadedResponse(
        url=url,
        file_key=request.file_key,
        file_name=request.file_name,
        file_size=request.file_size,
        file_type=request.file_type,
    )


class SignedUrlResponse(BaseModel):
    """签名 URL 响应"""
    signed_url: str
    expire_seconds: int


@router.post("/presign-put", response_model=PresignedUploadResponse)
async def get_presigned_upload_url(
    payload: PresignedUploadRequest,
    current_user: User = Depends(get_current_user),
):
    """
    获取浏览器直传 TOS 所需的预签名 PUT URL。
    """
    now = datetime.now()
    display_name, object_name = _normalize_upload_filename(payload.file_name)
    file_key = _build_proxy_file_key(payload.file_type, display_name, object_name, now)
    expire_seconds = 600

    try:
        upload_url = generate_presigned_upload_url(file_key, expire_seconds=expire_seconds)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        ) from e

    return PresignedUploadResponse(
        upload_url=upload_url,
        file_key=file_key,
        file_name=display_name,
        file_type=payload.file_type,
        expire_seconds=expire_seconds,
    )


@router.get("/sign-url", response_model=SignedUrlResponse)
async def get_signed_url(
    url: str = Query(..., description="文件的原始 URL 或 file_key"),
    expire: int = Query(3600, ge=60, le=43200, description="有效期（秒），默认1小时，最长12小时"),
    current_user: User = Depends(get_current_user),
):
    """
    获取私有桶文件的预签名访问 URL

    前端在展示/下载文件前调用此接口，获取带签名的临时访问链接。
    支持传入完整 URL 或 file_key。
    """
    from app.services.oss import parse_file_key_from_url

    file_key = parse_file_key_from_url(url)

    if not file_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的文件路径",
        )

    try:
        signed_url = generate_presigned_url(file_key, expire_seconds=expire)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )

    return SignedUrlResponse(
        signed_url=signed_url,
        expire_seconds=expire,
    )


def _get_tos_object(file_key: str) -> tuple[bytes, str]:
    """
    从本地存储或 TOS 获取文件内容和文件名（内部工具函数）

    Returns:
        (content, filename)
    """
    if local_file_exists(file_key):
        return read_bytes(file_key), _extract_filename_from_key(file_key)

    client = _get_tos_client()
    resp = client.get_object(bucket=settings.TOS_BUCKET_NAME, key=file_key)
    content = resp.read()

    return content, _extract_filename_from_key(file_key)


def _resolve_file_key(url: str) -> str:
    """从 URL 或 file_key 解析出实际 file_key"""
    from app.services.oss import parse_file_key_from_url

    return parse_file_key_from_url(url)


def _guess_content_type(filename: str) -> str:
    """根据文件名猜测 MIME 类型"""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mime_map = {
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
        "mp4": "video/mp4",
        "mov": "video/quicktime",
        "webm": "video/webm",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "txt": "text/plain",
    }
    return mime_map.get(ext, "application/octet-stream")


async def _write_upload_to_temp_file(file: UploadFile, suffix: str = "") -> tuple[str, int]:
    """把上传文件流落到本地临时文件，供大文件分片上传使用。"""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    total_size = 0
    try:
        while chunk := await file.read(PROXY_UPLOAD_TMP_CHUNK_SIZE):
            tmp.write(chunk)
            total_size += len(chunk)
    except Exception:
        tmp.close()
        os.remove(tmp.name)
        raise

    tmp.close()
    return tmp.name, total_size


async def _write_request_stream_to_temp_file(request: Request, suffix: str = "") -> tuple[str, int]:
    """把原始请求体流式写入本地临时文件，避免大文件进入内存。"""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    total_size = 0
    try:
        async for chunk in request.stream():
            if not chunk:
                continue
            tmp.write(chunk)
            total_size += len(chunk)
    except Exception:
        tmp.close()
        os.remove(tmp.name)
        raise

    tmp.close()
    return tmp.name, total_size


def _build_proxy_upload_response(
    *,
    file_type: str,
    display_name: str,
    content_type: str,
    file_size: int,
    temp_file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
) -> FileUploadedResponse:
    """统一处理代理上传到 TOS/本地回退，避免不同入口逻辑漂移。"""
    now = datetime.now()
    display_name, object_name = _normalize_upload_filename(display_name)
    file_key = _build_proxy_file_key(file_type, display_name, object_name, now)
    logger.info(
        "proxy upload start: file_type=%s, display_name=%s, file_key=%s, mode=%s",
        file_type,
        display_name,
        file_key,
        "temp-file" if temp_file_path else "memory",
    )

    try:
        client = _get_tos_client()
        if temp_file_path:
            logger.info(
                "proxy upload using streaming put_object: file_type=%s, display_name=%s, temp_file=%s",
                file_type,
                display_name,
                temp_file_path,
            )
            with open(temp_file_path, "rb") as file_obj:
                client.put_object(
                    bucket=settings.TOS_BUCKET_NAME,
                    key=file_key,
                    content=file_obj,
                    content_type=content_type,
                )
        elif file_bytes is not None:
            client.put_object(
                bucket=settings.TOS_BUCKET_NAME,
                key=file_key,
                content=io.BytesIO(file_bytes),
                content_type=content_type,
            )
        else:
            raise ValueError("未读取到上传内容")
    except Exception as e:
        logger.exception("proxy upload failed: file_type=%s, display_name=%s, file_key=%s", file_type, display_name, file_key)
        if settings.LOCAL_FILE_STORAGE_ENABLED:
            try:
                if temp_file_path:
                    copy_file(file_key, temp_file_path)
                    file_size = os.path.getsize(temp_file_path)
                elif file_bytes is not None:
                    save_bytes(file_key, file_bytes)
                    file_size = len(file_bytes)
                else:
                    raise ValueError("未读取到上传内容")

                logger.warning(
                    "proxy upload fallback to local storage: file_type=%s, display_name=%s, file_key=%s",
                    file_type,
                    display_name,
                    file_key,
                )
                return FileUploadedResponse(
                    url=build_local_file_url(file_key),
                    file_key=file_key,
                    file_name=display_name,
                    file_size=file_size,
                    file_type=file_type,
                )
            except Exception:
                logger.exception(
                    "proxy upload local fallback failed: file_type=%s, display_name=%s, file_key=%s",
                    file_type,
                    display_name,
                    file_key,
                )

        raise HTTPException(
            status_code=502,
            detail=f"TOS 上传失败: {str(e)[:200]}",
        ) from e

    return FileUploadedResponse(
        url=get_file_url(file_key),
        file_key=file_key,
        file_name=display_name,
        file_size=file_size,
        file_type=file_type,
    )


@router.get("/download")
async def download_file(
    url: str = Query(..., description="文件的原始 URL 或 file_key"),
    current_user: User = Depends(get_current_user),
):
    """
    代理下载文件 — 后端获取 TOS 文件后返回给前端，
    设置 Content-Disposition: attachment 确保浏览器触发下载。
    """
    file_key = _resolve_file_key(url)
    if not file_key:
        raise HTTPException(status_code=400, detail="无效的文件路径")

    try:
        content, filename = _get_tos_object(file_key)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"下载文件失败: {e}")

    from fastapi.responses import Response
    encoded_filename = quote(filename)
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )


@router.get("/preview")
async def preview_file(
    url: str = Query(..., description="文件的原始 URL 或 file_key"),
    current_user: User = Depends(get_current_user),
):
    """
    代理预览文件 — 后端获取 TOS 文件后返回给前端，
    设置正确的 Content-Type 让浏览器可以直接渲染（PDF / 图片等）。
    """
    file_key = _resolve_file_key(url)
    if not file_key:
        raise HTTPException(status_code=400, detail="无效的文件路径")

    try:
        content, filename = _get_tos_object(file_key)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"获取文件失败: {e}")

    from fastapi.responses import Response
    content_type = _guess_content_type(filename)
    return Response(
        content=content,
        media_type=content_type,
    )


@router.get("/local")
async def serve_local_file(
    key: str = Query(..., description="本地文件 key"),
):
    """
    本地开发环境文件直出。

    仅在开启 LOCAL_FILE_STORAGE_ENABLED 时可用，用于图片/文档直接预览。
    """
    if not settings.LOCAL_FILE_STORAGE_ENABLED:
        raise HTTPException(status_code=404, detail="本地文件存储未启用")

    try:
        file_path = get_local_file_path(key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    filename = _extract_filename_from_key(key)
    return FileResponse(
        path=file_path,
        media_type=_guess_content_type(filename),
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/proxy", response_model=FileUploadedResponse)
async def proxy_upload(
    file: UploadFile = File(...),
    file_type: str = Form("general"),
    current_user: User = Depends(get_current_user),
):
    """
    后端代理上传（用于本地开发 / 浏览器无法直连 TOS 的场景）

    前端把文件 POST 到此接口，后端使用 TOS SDK 上传到对象存储。
    """
    display_name = file.filename or "unknown"
    content_type = file.content_type or "application/octet-stream"
    file_size = 0
    temp_file_path: Optional[str] = None
    file_bytes: Optional[bytes] = None

    try:
        if file_type == "video":
            _, object_name = _normalize_upload_filename(display_name)
            suffix = object_name[object_name.rfind("."):] if "." in object_name else ""
            temp_file_path, file_size = await _write_upload_to_temp_file(file, suffix=suffix)
        else:
            file_bytes = await file.read()
            file_size = len(file_bytes)
        return _build_proxy_upload_response(
            file_type=file_type,
            display_name=display_name,
            content_type=content_type,
            file_size=file_size,
            temp_file_path=temp_file_path,
            file_bytes=file_bytes,
        )
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        await file.close()


@router.post("/proxy-binary", response_model=FileUploadedResponse)
async def proxy_upload_binary(
    request: Request,
    file_name: str = Header(..., alias="X-Upload-File-Name"),
    file_type: str = Header("general", alias="X-Upload-File-Type"),
    current_user: User = Depends(get_current_user),
):
    """
    原始二进制代理上传。

    浏览器直接发送文件字节流，避开 Safari/iPad 对 File/FormData 序列化的不稳定问题。
    """
    display_name = unquote(file_name).strip() or "unknown"
    content_type = request.headers.get("content-type") or _guess_content_type(display_name)
    _, object_name = _normalize_upload_filename(display_name)
    suffix = object_name[object_name.rfind("."):] if "." in object_name else ""
    temp_file_path: Optional[str] = None

    try:
        temp_file_path, file_size = await _write_request_stream_to_temp_file(request, suffix=suffix)
        if file_size <= 0:
            raise HTTPException(status_code=400, detail="上传文件为空")

        return _build_proxy_upload_response(
            file_type=file_type,
            display_name=display_name,
            content_type=content_type,
            file_size=file_size,
            temp_file_path=temp_file_path,
        )
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)


def _validate_query_token(token: str) -> bool:
    """验证 query 参数中的 JWT token（Logto）"""
    # Logto JWT
    logto_payload = decode_logto_token(token)
    if logto_payload and logto_payload.get("sub"):
        return True
    return False


def _get_tos_client():
    """创建 TOS SDK 客户端"""
    import tos as tos_sdk

    if not settings.TOS_ACCESS_KEY_ID or not settings.TOS_SECRET_ACCESS_KEY:
        raise HTTPException(status_code=500, detail="TOS 配置未设置")

    region = settings.TOS_REGION
    endpoint = settings.TOS_ENDPOINT or f"tos-cn-{region}.volces.com"
    return tos_sdk.TosClientV2(
        ak=settings.TOS_ACCESS_KEY_ID,
        sk=settings.TOS_SECRET_ACCESS_KEY,
        endpoint=f"https://{endpoint}",
        region=region,
        request_timeout=TOS_REQUEST_TIMEOUT_SECONDS,
        socket_timeout=TOS_SOCKET_TIMEOUT_SECONDS,
        connection_time=TOS_CONNECT_TIMEOUT_SECONDS,
    )


@router.get("/stream")
async def stream_file(
    url: str = Query(..., description="文件的原始 URL 或 file_key"),
    token: str = Query(..., description="JWT access token"),
    range: Optional[str] = Header(None, alias="range"),
):
    """
    流式代理文件访问 — 支持 Range 请求（视频拖动进度条）。

    使用 query 参数携带 token 鉴权，因为 <video src="..."> 无法设置 Authorization 头。
    """
    if not _validate_query_token(token):
        raise HTTPException(status_code=401, detail="无效的 Token")

    file_key = _resolve_file_key(url)
    if not file_key:
        raise HTTPException(status_code=400, detail="无效的文件路径")

    try:
        if local_file_exists(file_key):
            filename = _extract_filename_from_key(file_key)
            content_type = _guess_content_type(filename)
            total_size = get_file_size(file_key)

            if total_size == 0:
                return Response(
                    content=b"",
                    media_type=content_type,
                    headers={
                        "Content-Length": "0",
                        "Accept-Ranges": "bytes",
                        "Cache-Control": "private, max-age=3600",
                    },
                )

            range_start = 0
            range_end = total_size - 1

            if range:
                try:
                    range_spec = range.replace("bytes=", "")
                    parts = range_spec.split("-")
                    if parts[0]:
                        range_start = int(parts[0])
                    if len(parts) > 1 and parts[1]:
                        range_end = int(parts[1])
                except (ValueError, IndexError):
                    pass

            range_start = max(0, min(range_start, total_size - 1))
            range_end = max(range_start, min(range_end, total_size - 1))
            content_length = range_end - range_start + 1
            file_path = get_local_file_path(file_key)

            def iter_local_content():
                with open(file_path, "rb") as f:
                    f.seek(range_start)
                    remaining = content_length
                    while remaining > 0:
                        chunk = f.read(min(64 * 1024, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            headers = {
                "Content-Length": str(content_length),
                "Accept-Ranges": "bytes",
                "Cache-Control": "private, max-age=3600",
            }

            if range:
                headers["Content-Range"] = f"bytes {range_start}-{range_end}/{total_size}"
                return StreamingResponse(
                    iter_local_content(),
                    status_code=206,
                    media_type=content_type,
                    headers=headers,
                )

            return StreamingResponse(
                iter_local_content(),
                media_type=content_type,
                headers=headers,
            )

        client = _get_tos_client()

        # 获取文件元信息（大小）
        head = client.head_object(bucket=settings.TOS_BUCKET_NAME, key=file_key)
        total_size = head.content_length
        content_type = head.content_type or _guess_content_type(file_key.split("/")[-1])

        # 解析 Range 头
        range_start = 0
        range_end = total_size - 1

        if range:
            # 格式: bytes=0-1023
            try:
                range_spec = range.replace("bytes=", "")
                parts = range_spec.split("-")
                if parts[0]:
                    range_start = int(parts[0])
                if parts[1]:
                    range_end = int(parts[1])
                else:
                    # bytes=100- 表示从 100 到末尾
                    range_end = total_size - 1
            except (ValueError, IndexError):
                pass

        # 确保范围合法
        range_start = max(0, min(range_start, total_size - 1))
        range_end = max(range_start, min(range_end, total_size - 1))
        content_length = range_end - range_start + 1

        # 从 TOS 获取指定范围的数据
        resp = client.get_object(
            bucket=settings.TOS_BUCKET_NAME,
            key=file_key,
            range_start=range_start,
            range_end=range_end,
        )

        def iter_content():
            while True:
                chunk = resp.read(64 * 1024)  # 64KB chunks
                if not chunk:
                    break
                yield chunk

        headers = {
            "Content-Length": str(content_length),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=3600",
        }

        if range:
            headers["Content-Range"] = f"bytes {range_start}-{range_end}/{total_size}"
            return StreamingResponse(
                iter_content(),
                status_code=206,
                media_type=content_type,
                headers=headers,
            )
        else:
            return StreamingResponse(
                iter_content(),
                status_code=200,
                media_type=content_type,
                headers=headers,
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"流式代理失败: {e}")
        raise HTTPException(status_code=502, detail=f"获取文件失败: {str(e)[:200]}")
