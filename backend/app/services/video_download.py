"""
视频下载服务
从 URL 下载视频到临时目录，支持重试和进度回调
"""
import asyncio
import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import httpx


@dataclass
class DownloadResult:
    """下载结果"""
    success: bool
    file_path: Optional[str] = None
    file_size: int = 0
    content_type: Optional[str] = None
    error: Optional[str] = None


class VideoDownloadService:
    """视频下载服务"""

    def __init__(
        self,
        temp_dir: Optional[str] = None,
        max_file_size: int = 500 * 1024 * 1024,  # 500MB
        timeout: float = 300.0,  # 5 分钟
        chunk_size: int = 1024 * 1024,  # 1MB
    ):
        """
        初始化下载服务

        Args:
            temp_dir: 临时目录，默认使用系统临时目录
            max_file_size: 最大文件大小（字节）
            timeout: 下载超时（秒）
            chunk_size: 分块大小（字节）
        """
        self.temp_dir = temp_dir or tempfile.gettempdir()
        self.max_file_size = max_file_size
        self.timeout = timeout
        self.chunk_size = chunk_size

        # 确保临时目录存在
        Path(self.temp_dir).mkdir(parents=True, exist_ok=True)

    def _generate_filename(self, url: str, content_type: Optional[str] = None) -> str:
        """根据 URL 生成唯一文件名"""
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]

        # 根据 content-type 确定扩展名
        ext = ".mp4"
        if content_type:
            ext_map = {
                "video/mp4": ".mp4",
                "video/webm": ".webm",
                "video/quicktime": ".mov",
                "video/x-msvideo": ".avi",
                "video/x-matroska": ".mkv",
            }
            ext = ext_map.get(content_type, ".mp4")

        return f"video_{url_hash}{ext}"

    async def download(
        self,
        url: str,
        progress_callback: Optional[Callable[[int, int], None]] = None,
        max_retries: int = 3,
    ) -> DownloadResult:
        """
        下载视频文件

        Args:
            url: 视频 URL
            progress_callback: 进度回调函数 (downloaded_bytes, total_bytes)
            max_retries: 最大重试次数

        Returns:
            DownloadResult: 下载结果
        """
        # 优先用 TOS SDK 直接下载（AK/SK 认证头，兼容所有桶策略）
        from app.services.oss import download_from_tos
        import asyncio as _asyncio
        try:
            tos_data = await _asyncio.to_thread(download_from_tos, url)
            if tos_data is not None:
                # SDK 下载成功，写入临时文件
                filename = self._generate_filename(url, "video/mp4")
                file_path = os.path.join(self.temp_dir, filename)
                with open(file_path, "wb") as f:
                    f.write(tos_data)
                return DownloadResult(
                    success=True,
                    file_path=file_path,
                    file_size=len(tos_data),
                )
        except Exception:
            pass  # 回退到 HTTP 下载

        last_error = None

        for attempt in range(max_retries):
            try:
                result = await self._download_once(url, progress_callback)
                if result.success:
                    return result
                last_error = result.error
            except Exception as e:
                last_error = str(e)

            # 重试前等待
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)

        return DownloadResult(
            success=False,
            error=f"下载失败（已重试 {max_retries} 次）: {last_error}",
        )

    async def _download_once(
        self,
        url: str,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> DownloadResult:
        """单次下载尝试"""
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout),
            follow_redirects=True,
        ) as client:
            # 先获取文件信息
            head_resp = await client.head(url)
            if head_resp.status_code >= 400:
                return DownloadResult(
                    success=False,
                    error=f"HTTP {head_resp.status_code}",
                )

            content_type = head_resp.headers.get("content-type", "")
            content_length = int(head_resp.headers.get("content-length", 0))

            # 检查文件大小
            if content_length > self.max_file_size:
                return DownloadResult(
                    success=False,
                    error=f"文件过大: {content_length / 1024 / 1024:.1f}MB > {self.max_file_size / 1024 / 1024:.1f}MB",
                )

            # 检查是否为视频类型
            if content_type and not content_type.startswith("video/"):
                return DownloadResult(
                    success=False,
                    error=f"非视频文件类型: {content_type}",
                )

            # 生成本地文件路径
            filename = self._generate_filename(url, content_type)
            file_path = os.path.join(self.temp_dir, filename)

            # 如果文件已存在且大小匹配，直接返回
            if os.path.exists(file_path):
                existing_size = os.path.getsize(file_path)
                if existing_size == content_length:
                    return DownloadResult(
                        success=True,
                        file_path=file_path,
                        file_size=existing_size,
                        content_type=content_type,
                    )

            # 流式下载
            downloaded = 0
            async with client.stream("GET", url) as response:
                if response.status_code >= 400:
                    return DownloadResult(
                        success=False,
                        error=f"HTTP {response.status_code}",
                    )

                with open(file_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=self.chunk_size):
                        f.write(chunk)
                        downloaded += len(chunk)

                        # 检查是否超过最大限制
                        if downloaded > self.max_file_size:
                            os.remove(file_path)
                            return DownloadResult(
                                success=False,
                                error=f"文件过大，已下载 {downloaded / 1024 / 1024:.1f}MB",
                            )

                        if progress_callback:
                            progress_callback(downloaded, content_length or downloaded)

            return DownloadResult(
                success=True,
                file_path=file_path,
                file_size=downloaded,
                content_type=content_type,
            )

    def cleanup(self, file_path: str) -> bool:
        """
        清理下载的临时文件

        Args:
            file_path: 文件路径

        Returns:
            是否成功删除
        """
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                return True
        except OSError:
            pass
        return False

    def cleanup_old_files(self, max_age_seconds: int = 3600) -> int:
        """
        清理过期的临时文件

        Args:
            max_age_seconds: 最大文件年龄（秒）

        Returns:
            删除的文件数量
        """
        import time

        deleted = 0
        now = time.time()

        for filename in os.listdir(self.temp_dir):
            if not filename.startswith("video_"):
                continue

            file_path = os.path.join(self.temp_dir, filename)
            try:
                file_age = now - os.path.getmtime(file_path)
                if file_age > max_age_seconds:
                    os.remove(file_path)
                    deleted += 1
            except OSError:
                pass

        return deleted


# 全局实例
_download_service: Optional[VideoDownloadService] = None


def get_download_service() -> VideoDownloadService:
    """获取下载服务单例"""
    global _download_service
    if _download_service is None:
        _download_service = VideoDownloadService()
    return _download_service
