"""
OpenAI 兼容 AI 客户端
支持多种 AI 提供商的统一接口
"""
import asyncio
import base64
import io
import logging
import time
import wave
from typing import Optional
from dataclasses import dataclass
import httpx
from openai import AsyncOpenAI

from app.schemas.ai_config import AIProvider, ModelCapability


logger = logging.getLogger(__name__)


@dataclass
class AIResponse:
    """AI 响应"""
    content: str
    model: str
    usage: dict
    finish_reason: str


@dataclass
class ConnectionTestResult:
    """连接测试结果"""
    success: bool
    latency_ms: int
    error: Optional[str] = None


@dataclass
class ImageGenerationResult:
    """图片生成结果"""
    images: list[str]
    model: str


class OpenAICompatibleClient:
    """
    OpenAI 兼容 API 客户端

    支持：
    - OpenAI
    - Azure OpenAI
    - Anthropic (通过 OpenAI 兼容层)
    - DeepSeek
    - Qwen (通义千问)
    - Doubao (豆包)
    - 各种中转服务 (OneAPI, OpenRouter)
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        provider: str = "openai",
        timeout: float = 600.0,
    ):
        self.base_url = base_url.rstrip("/")
        # 自动补全 /v1 后缀（OpenAI SDK 需要完整路径）
        # 但避免重复添加（用户可能已经填了 /v1）
        if not self.base_url.endswith("/v1") and "/v1" not in self.base_url:
            self.base_url = self.base_url + "/v1"
        self.api_key = api_key
        self.provider = provider
        self.timeout = timeout

        # 创建 OpenAI 客户端
        # max_retries=0: 禁止 SDK 内部重试，让超时快速返回
        # 外层任务级超时负责最终兜底；视频审核里的单次大模型调用可能显著超过 280s
        self.client = AsyncOpenAI(
            base_url=self.base_url,
            api_key=self.api_key,
            timeout=timeout,
            max_retries=0,
        )

    @staticmethod
    def _is_retryable_audio_exception(exc: Exception) -> bool:
        name = type(exc).__name__
        message = str(exc).lower()
        if name in {"APIConnectionError", "APITimeoutError", "RateLimitError", "TimeoutException", "ReadTimeout"}:
            return True

        retry_markers = (
            "connection error",
            "timed out",
            "timeout",
            "429",
            "500",
            "502",
            "503",
            "504",
            "temporarily unavailable",
            "multipart",
            "nextpart: eof",
            "convert_request_failed",
            "eof",
            "broken pipe",
        )
        return any(marker in message for marker in retry_markers)

    @staticmethod
    def _supports_audio_understanding(model_id: str) -> bool:
        mid = model_id.lower()
        keywords = (
            "gemini",
            "4o",
            "omni",
            "claude-3",
            "claude-4",
            "-vl",
            "vl-",
            "qwen-vl",
            "glm-4v",
        )
        return any(keyword in mid for keyword in keywords)

    @staticmethod
    def _looks_like_non_audio_model(model_id: str) -> bool:
        mid = model_id.lower()
        blocked_keywords = (
            "whisper",
            "transcribe",
            "tts",
            "embedding",
            "embed",
            "rerank",
            "moderation",
            "dall",
            "image",
            "sdxl",
            "stable-diffusion",
        )
        return any(keyword in mid for keyword in blocked_keywords)

    @staticmethod
    def _extract_modalities(model: object) -> set[str]:
        collected: set[str] = set()

        def _collect(value: object) -> None:
            if value is None:
                return
            if isinstance(value, str):
                token = value.strip().lower()
                if token:
                    collected.add(token)
                return
            if isinstance(value, dict):
                for item in value.values():
                    _collect(item)
                return
            if isinstance(value, (list, tuple, set)):
                for item in value:
                    _collect(item)

        for attr in (
            "modalities",
            "input_modalities",
            "output_modalities",
            "supported_modalities",
            "capabilities",
        ):
            _collect(getattr(model, attr, None))

        return collected

    @staticmethod
    def _build_silent_wav_base64(
        duration_ms: int = 200,
        sample_rate: int = 16000,
    ) -> str:
        frame_count = max(1, int(sample_rate * duration_ms / 1000))
        pcm = b"\x00\x00" * frame_count
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm)
        return base64.b64encode(buffer.getvalue()).decode("ascii")

    async def probe_audio_understanding(self, model: str) -> bool:
        try:
            payload = self._build_silent_wav_base64()
            response = await self.client.chat.completions.create(
                model=model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Reply with OK."},
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": payload,
                                "format": "wav",
                            },
                        },
                    ],
                }],
                temperature=0,
                max_tokens=5,
            )
            return bool(response and getattr(response, "choices", None))
        except Exception as exc:
            logger.info("音频能力探测失败 model=%s error=%s", model, exc)
            return False

    async def _discover_audio_models(self, models: list[object]) -> list[dict]:
        candidates: list[str] = []
        seen: set[str] = set()

        for model in models:
            model_id = getattr(model, "id", "")
            if not model_id or model_id in seen:
                continue

            modalities = self._extract_modalities(model)
            supports_audio_metadata = "audio" in modalities or "input_audio" in modalities
            if self._looks_like_non_audio_model(model_id):
                continue
            if not supports_audio_metadata and not self._supports_audio_understanding(model_id):
                continue

            seen.add(model_id)
            candidates.append(model_id)

        if not candidates:
            return []

        semaphore = asyncio.Semaphore(4)

        async def _probe(model_id: str) -> Optional[dict]:
            async with semaphore:
                try:
                    if await asyncio.wait_for(
                        self.probe_audio_understanding(model_id),
                        timeout=12.0,
                    ):
                        return {"id": model_id, "name": model_id}
                except asyncio.TimeoutError:
                    logger.info("音频能力探测超时 model=%s", model_id)
                return None

        probed = await asyncio.gather(*[_probe(model_id) for model_id in candidates])
        return [item for item in probed if item]

    async def chat_completion(
        self,
        messages: list[dict],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> AIResponse:
        """
        聊天补全

        Args:
            messages: 消息列表 [{"role": "user", "content": "..."}]
            model: 模型名称
            temperature: 温度参数
            max_tokens: 最大 token 数

        Returns:
            AIResponse 包含生成的内容
        """
        response = await self.client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs,
        )

        choice = response.choices[0]
        return AIResponse(
            content=choice.message.content or "",
            model=response.model,
            usage={
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                "total_tokens": response.usage.total_tokens if response.usage else 0,
            },
            finish_reason=choice.finish_reason or "stop",
        )

    async def vision_analysis(
        self,
        image_urls: list[str],
        prompt: str,
        model: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AIResponse:
        """
        视觉分析（图像理解）

        Args:
            image_urls: 图像 URL 列表
            prompt: 分析提示
            model: 视觉模型名称

        Returns:
            AIResponse 包含分析结果
        """
        # 构建多模态消息
        content = [{"type": "text", "text": prompt}]

        for url in image_urls:
            content.append({
                "type": "image_url",
                "image_url": {"url": url},
            })

        messages = [{"role": "user", "content": content}]

        return await self.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def image_generation(
        self,
        prompt: str,
        model: str,
        size: str = "1024x1536",
        quality: str = "medium",
        n: int = 1,
    ) -> ImageGenerationResult:
        """
        图片生成。

        优先返回 data URL，兼容 OpenAI 风格响应和兼容层 URL 响应。
        """
        response = await self.client.images.generate(
            model=model,
            prompt=prompt,
            size=size,
            quality=quality,
            n=n,
        )

        images: list[str] = []
        for item in getattr(response, "data", []) or []:
            b64_json = getattr(item, "b64_json", None)
            if b64_json:
                images.append(f"data:image/png;base64,{b64_json}")
                continue
            url = getattr(item, "url", None)
            if url:
                images.append(url)

        return ImageGenerationResult(
            images=images,
            model=getattr(response, "model", model),
        )

    async def audio_analysis(
        self,
        audio_file_path: str,
        prompt: str,
        model: str,
        temperature: float = 0.2,
        max_tokens: int = 2500,
    ) -> AIResponse:
        """
        音频理解：让多模态模型直接分析音频内容。

        适用于可同时完成口播识别、语气/情绪判断、BGM/环境声识别的模型。
        """
        ext = audio_file_path.rsplit(".", 1)[-1].lower() if "." in audio_file_path else "mp3"
        format_map = {
            "mp3": "mp3",
            "wav": "wav",
            "m4a": "mp3",
            "aac": "mp3",
            "ogg": "wav",
            "flac": "wav",
        }
        audio_format = format_map.get(ext, "mp3")

        with open(audio_file_path, "rb") as audio_file:
            audio_b64 = base64.b64encode(audio_file.read()).decode("ascii")

        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": audio_b64,
                        "format": audio_format,
                    },
                },
            ],
        }]

        return await self.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def audio_transcription(
        self,
        audio_url: str = "",
        audio_file_path: str = "",
        model: str = "whisper-1",
        language: str = "zh",
    ) -> AIResponse:
        """
        音频转写 (ASR)

        Args:
            audio_url: 音频文件 URL（二选一）
            audio_file_path: 本地音频文件路径（二选一，优先）
            model: 转写模型
            language: 语言代码

        Returns:
            AIResponse 包含转写文本
        """
        if audio_file_path:
            # 从本地文件读取
            import aiofiles
            async with aiofiles.open(audio_file_path, "rb") as f:
                audio_data = await f.read()
            # 根据扩展名推断 MIME
            ext = audio_file_path.rsplit(".", 1)[-1].lower() if "." in audio_file_path else "mp3"
            mime_map = {"mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4", "ogg": "audio/ogg", "flac": "audio/flac"}
            mime = mime_map.get(ext, "audio/mpeg")
            filename = f"audio.{ext}"
        elif audio_url:
            # 从 URL 下载（确保 TOS 私有桶 URL 已签名）
            from app.services.oss import ensure_signed_url
            signed_audio_url = ensure_signed_url(audio_url, expire_seconds=300)
            async with httpx.AsyncClient() as http_client:
                response = await http_client.get(signed_audio_url, timeout=60)
                response.raise_for_status()
                audio_data = response.content
            filename = "audio.mp3"
            mime = "audio/mpeg"
        else:
            raise ValueError("必须提供 audio_url 或 audio_file_path")

        transcription = None
        max_attempts = 3
        for attempt in range(1, max_attempts + 1):
            try:
                transcription = await self.client.audio.transcriptions.create(
                    model=model,
                    file=(filename, audio_data, mime),
                    language=language,
                )
                break
            except Exception as exc:
                if attempt >= max_attempts or not self._is_retryable_audio_exception(exc):
                    raise
                logger.warning(
                    "音频转写调用失败，重试中 attempt %s/%s: %s",
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(min(0.8 * attempt, 2.0))

        return AIResponse(
            content=transcription.text if transcription else "",
            model=model,
            usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            finish_reason="stop",
        )

    async def test_connection(
        self,
        model: str,
        capability: ModelCapability = ModelCapability.TEXT,
    ) -> ConnectionTestResult:
        """
        测试模型连接

        Args:
            model: 模型名称
            capability: 模型能力类型

        Returns:
            ConnectionTestResult 包含测试结果
        """
        start_time = time.time()

        try:
            if capability == ModelCapability.AUDIO:
                if not await self.probe_audio_understanding(model):
                    raise ValueError("模型不支持直接音频输入理解")

                latency_ms = int((time.time() - start_time) * 1000)
                return ConnectionTestResult(success=True, latency_ms=latency_ms)

            elif capability == ModelCapability.VISION:
                # 视觉模型测试：发送简单的文本请求
                response = await self.chat_completion(
                    messages=[{"role": "user", "content": "Hi"}],
                    model=model,
                    max_tokens=5,
                )

            else:
                # 文本模型测试
                response = await self.chat_completion(
                    messages=[{"role": "user", "content": "Hi"}],
                    model=model,
                    max_tokens=5,
                )

            latency_ms = int((time.time() - start_time) * 1000)
            return ConnectionTestResult(success=True, latency_ms=latency_ms)

        except Exception as e:
            import logging
            logging.getLogger(__name__).error(
                f"AI 连接测试失败: model={model}, capability={capability}, "
                f"base_url={self.base_url}, error={type(e).__name__}: {e}"
            )
            latency_ms = int((time.time() - start_time) * 1000)
            # 提供用户友好的错误信息
            error_msg = str(e)
            if "Connection" in error_msg or "timeout" in error_msg.lower():
                error_msg = f"连接失败，请检查 API 地址是否正确: {error_msg[:100]}"
            elif "401" in error_msg or "Unauthorized" in error_msg:
                error_msg = "API Key 无效或无权限"
            elif "404" in error_msg:
                error_msg = f"模型 {model} 不存在或 API 地址错误"
            elif "model" in error_msg.lower():
                error_msg = f"模型 {model} 不可用: {error_msg[:100]}"
            return ConnectionTestResult(
                success=False,
                latency_ms=latency_ms,
                error=error_msg,
            )

    @staticmethod
    def _infer_capabilities(model_id: str) -> list[str]:
        """根据模型名推断能力类别"""
        mid = model_id.lower()
        capabilities: list[str] = []

        # 音频/语音模型
        audio_keywords = ["whisper", "tts", "audio", "speech", "asr"]
        if any(k in mid for k in audio_keywords):
            capabilities.append("audio")

        # 嵌入模型 — 跳过（不属于三类）
        embed_keywords = ["embedding", "embed", "text-embedding"]
        if any(k in mid for k in embed_keywords):
            return []

        # 图像生成模型 — 跳过
        if mid.startswith("dall") or "image" in mid:
            return []

        # 视觉模型关键词
        vision_keywords = ["vision", "-vl", "vl-", "4o", "4v", "gpt-4-turbo",
                           "claude-3", "claude-4", "gemini", "glm-4v"]
        has_vision = any(k in mid for k in vision_keywords)

        if has_vision:
            capabilities.extend(["text", "vision"])

        # 多模态模型通常也可做音频理解，归入 audio 便于统一选择。
        audio_understanding_keywords = [
            "gemini",
            "4o",
            "omni",
            "claude-3",
            "claude-4",
            "-vl",
            "vl-",
            "qwen-vl",
            "glm-4v",
        ]
        if any(k in mid for k in audio_understanding_keywords):
            capabilities.append("audio")

        if capabilities:
            return list(dict.fromkeys(capabilities))

        # 其余一律归为 text
        return ["text"]

    async def list_models(self) -> dict[str, list[dict]]:
        """
        获取可用模型列表

        Returns:
            按能力分类的模型列表
            {"text": [...], "vision": [...], "audio": [...]}
        """
        try:
            models = await self.client.models.list()
            import logging
            logging.getLogger(__name__).info(
                f"list_models: API 返回 {len(models.data)} 个模型, base_url={self.base_url}"
            )

            result: dict[str, list[dict]] = {
                "text": [],
                "vision": [],
                "audio": [],
            }

            seen: dict[str, set] = {"text": set(), "vision": set(), "audio": set()}

            discovered_audio_models = await self._discover_audio_models(models.data)
            audio_ids = {item["id"] for item in discovered_audio_models}

            for model in models.data:
                model_id = model.id
                capabilities = self._infer_capabilities(model_id)

                for cap in capabilities:
                    if cap == "audio" and model_id not in audio_ids:
                        continue
                    if cap in result and model_id not in seen[cap]:
                        seen[cap].add(model_id)
                        result[cap].append({
                            "id": model_id,
                            "name": model_id,
                        })

            # 按模型名排序
            for cap in result:
                result[cap].sort(key=lambda x: x["id"])

            return result

        except Exception:
            # 如果无法获取模型列表，返回预设列表
            return {
                "text": [
                    {"id": "gpt-4o", "name": "gpt-4o"},
                    {"id": "gpt-4o-mini", "name": "gpt-4o-mini"},
                    {"id": "deepseek-chat", "name": "deepseek-chat"},
                ],
                "vision": [
                    {"id": "gpt-4o", "name": "gpt-4o"},
                ],
                "audio": [],
            }

    async def close(self):
        """关闭客户端"""
        try:
            await self.client.close()
        except Exception:
            # 关闭失败不应影响主流程
            pass


# 便捷函数
async def create_ai_client(
    base_url: str,
    api_key: str,
    provider: str = "openai",
) -> OpenAICompatibleClient:
    """创建 AI 客户端"""
    return OpenAICompatibleClient(
        base_url=base_url,
        api_key=api_key,
        provider=provider,
    )
