"""
ASR 语音转写服务
集成 Whisper API 实现音频转写
"""
import asyncio
import os
import tempfile
from dataclasses import dataclass, field
from typing import Optional

import httpx


@dataclass
class TranscriptSegment:
    """转写片段"""
    text: str
    start: float  # 开始时间（秒）
    end: float  # 结束时间（秒）
    confidence: float = 1.0


@dataclass
class TranscriptionResult:
    """转写结果"""
    success: bool
    text: str = ""  # 完整文本
    segments: list[TranscriptSegment] = field(default_factory=list)
    language: str = "zh"
    duration: float = 0.0
    error: Optional[str] = None


class ASRService:
    """ASR 语音转写服务"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "whisper-1",
        timeout: float = 300.0,
    ):
        """
        初始化 ASR 服务

        Args:
            api_key: API Key
            base_url: API 基础 URL
            model: 模型名称
            timeout: 请求超时（秒）
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def transcribe_file(
        self,
        audio_path: str,
        language: str = "zh",
        response_format: str = "verbose_json",
    ) -> TranscriptionResult:
        """
        转写音频文件

        Args:
            audio_path: 音频文件路径
            language: 语言代码
            response_format: 响应格式

        Returns:
            TranscriptionResult: 转写结果
        """
        if not os.path.exists(audio_path):
            return TranscriptionResult(
                success=False,
                error=f"文件不存在: {audio_path}",
            )

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout)
            ) as client:
                with open(audio_path, "rb") as f:
                    files = {"file": (os.path.basename(audio_path), f, "audio/mpeg")}
                    data = {
                        "model": self.model,
                        "language": language,
                        "response_format": response_format,
                    }

                    response = await client.post(
                        f"{self.base_url}/audio/transcriptions",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        files=files,
                        data=data,
                    )

                    if response.status_code != 200:
                        return TranscriptionResult(
                            success=False,
                            error=f"API 错误 {response.status_code}: {response.text[:200]}",
                        )

                    result = response.json()
                    return self._parse_response(result, language)

        except Exception as e:
            return TranscriptionResult(
                success=False,
                error=str(e),
            )

    async def transcribe_url(
        self,
        audio_url: str,
        language: str = "zh",
    ) -> TranscriptionResult:
        """
        转写远程音频

        Args:
            audio_url: 音频 URL
            language: 语言代码

        Returns:
            TranscriptionResult: 转写结果
        """
        # 下载音频到临时文件（确保 TOS 私有桶 URL 已签名）
        from app.services.oss import ensure_signed_url
        signed_audio_url = ensure_signed_url(audio_url, expire_seconds=300)

        temp_path = None
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(60.0),
                follow_redirects=True,
            ) as client:
                response = await client.get(signed_audio_url)
                if response.status_code != 200:
                    return TranscriptionResult(
                        success=False,
                        error=f"下载音频失败: HTTP {response.status_code}",
                    )

                # 写入临时文件
                with tempfile.NamedTemporaryFile(
                    suffix=".mp3",
                    delete=False,
                ) as f:
                    f.write(response.content)
                    temp_path = f.name

            # 转写
            result = await self.transcribe_file(temp_path, language)
            return result

        except Exception as e:
            return TranscriptionResult(
                success=False,
                error=str(e),
            )
        finally:
            # 清理临时文件
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    def _parse_response(
        self,
        response: dict,
        language: str,
    ) -> TranscriptionResult:
        """解析 API 响应"""
        text = response.get("text", "")
        duration = response.get("duration", 0.0)

        segments = []
        for seg in response.get("segments", []):
            segments.append(TranscriptSegment(
                text=seg.get("text", "").strip(),
                start=seg.get("start", 0.0),
                end=seg.get("end", 0.0),
                confidence=seg.get("confidence", 1.0) if "confidence" in seg else 1.0,
            ))

        # 如果没有分段信息，创建单个分段
        if not segments and text:
            segments = [TranscriptSegment(
                text=text,
                start=0.0,
                end=duration,
            )]

        return TranscriptionResult(
            success=True,
            text=text,
            segments=segments,
            language=language,
            duration=duration,
        )


class AudioExtractor:
    """从视频中提取音频"""

    def __init__(self, ffmpeg_path: str = "ffmpeg"):
        self.ffmpeg_path = ffmpeg_path

    async def extract_audio(
        self,
        video_path: str,
        output_path: Optional[str] = None,
        format: str = "mp3",
        sample_rate: int = 16000,
    ) -> Optional[str]:
        """
        从视频中提取音频

        Args:
            video_path: 视频文件路径
            output_path: 输出路径，默认生成临时文件
            format: 输出格式
            sample_rate: 采样率

        Returns:
            音频文件路径，失败返回 None
        """
        import shutil

        if not shutil.which(self.ffmpeg_path):
            return None

        if output_path is None:
            output_path = tempfile.mktemp(suffix=f".{format}")

        cmd = [
            self.ffmpeg_path,
            "-i", video_path,
            "-vn",  # 不要视频
            "-acodec", "libmp3lame" if format == "mp3" else "pcm_s16le",
            "-ar", str(sample_rate),
            "-ac", "1",  # 单声道
            "-y",
            output_path,
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await process.communicate()

            if process.returncode != 0:
                return None

            return output_path

        except Exception:
            return None


class VideoASRService:
    """视频 ASR 服务（组合音频提取和转写）"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "whisper-1",
    ):
        self.asr = ASRService(api_key, base_url, model)
        self.audio_extractor = AudioExtractor()

    async def transcribe_video(
        self,
        video_path: str,
        language: str = "zh",
    ) -> TranscriptionResult:
        """
        转写视频中的语音

        Args:
            video_path: 视频文件路径
            language: 语言代码

        Returns:
            TranscriptionResult: 转写结果
        """
        # 提取音频
        audio_path = await self.audio_extractor.extract_audio(video_path)
        if not audio_path:
            return TranscriptionResult(
                success=False,
                error="音频提取失败，请确保 FFmpeg 已安装",
            )

        try:
            # 转写
            result = await self.asr.transcribe_file(audio_path, language)
            return result
        finally:
            # 清理临时音频
            if os.path.exists(audio_path):
                try:
                    os.remove(audio_path)
                except OSError:
                    pass
