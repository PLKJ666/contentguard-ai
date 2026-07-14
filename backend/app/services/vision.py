"""
视觉分析服务
集成 GPT-4V 实现竞品 Logo 检测、画面分析、OCR 字幕提取
"""
import base64
import json
from dataclasses import dataclass, field
from typing import Optional

from app.services.ai_client import OpenAICompatibleClient
from app.services.keyframe import KeyFrame


@dataclass
class DetectedObject:
    """检测到的对象"""
    label: str
    confidence: float
    timestamp: float
    bounding_box: Optional[dict] = None  # {x, y, width, height}
    description: Optional[str] = None


@dataclass
class SubtitleSegment:
    """字幕片段"""
    text: str
    timestamp: float
    confidence: float = 1.0


@dataclass
class VisionAnalysisResult:
    """视觉分析结果"""
    success: bool
    detected_logos: list[DetectedObject] = field(default_factory=list)
    detected_texts: list[SubtitleSegment] = field(default_factory=list)
    scene_description: str = ""
    error: Optional[str] = None


class VisionAnalysisService:
    """视觉分析服务"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4o",
        max_tokens: int = 2000,
    ):
        """
        初始化视觉分析服务

        Args:
            api_key: API Key
            base_url: API 基础 URL
            model: 视觉模型名称
            max_tokens: 最大输出 token
        """
        self.client = OpenAICompatibleClient(
            base_url=base_url,
            api_key=api_key,
        )
        self.model = model
        self.max_tokens = max_tokens

    async def detect_logos(
        self,
        frames: list[KeyFrame],
        competitor_names: list[str],
        batch_size: int = 5,
    ) -> VisionAnalysisResult:
        """
        检测画面中的竞品 Logo

        Args:
            frames: 关键帧列表
            competitor_names: 竞品名称列表
            batch_size: 每批处理的帧数

        Returns:
            VisionAnalysisResult: 分析结果
        """
        if not frames:
            return VisionAnalysisResult(success=True)

        all_logos = []
        competitors_str = "、".join(competitor_names) if competitor_names else "任何品牌"

        # 分批处理帧
        for i in range(0, len(frames), batch_size):
            batch = frames[i:i + batch_size]

            try:
                result = await self._analyze_frames_for_logos(
                    batch,
                    competitors_str,
                )
                all_logos.extend(result)
            except Exception as e:
                # 单批失败不影响整体
                continue

        return VisionAnalysisResult(
            success=True,
            detected_logos=all_logos,
        )

    async def _analyze_frames_for_logos(
        self,
        frames: list[KeyFrame],
        competitors_str: str,
    ) -> list[DetectedObject]:
        """分析一批帧中的 Logo"""
        # 构建图片内容
        image_contents = []
        timestamps = []

        for frame in frames:
            base64_image = frame.to_base64()
            image_contents.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{base64_image}",
                    "detail": "low",
                },
            })
            timestamps.append(frame.timestamp)

        prompt = f"""分析这些视频帧，检测是否出现以下竞品品牌的 Logo 或产品：{competitors_str}

请以 JSON 格式返回检测结果，格式如下：
{{
  "detections": [
    {{
      "frame_index": 0,
      "brand": "品牌名称",
      "confidence": 0.9,
      "description": "Logo 出现在画面左上角"
    }}
  ]
}}

如果没有检测到任何竞品，返回空数组：{{"detections": []}}
只返回 JSON，不要其他文字。"""

        messages = [{
            "role": "user",
            "content": [{"type": "text", "text": prompt}] + image_contents,
        }]

        response = await self.client.chat_completion(
            messages=messages,
            model=self.model,
            temperature=0.1,
            max_tokens=self.max_tokens,
        )

        # 解析响应
        try:
            content = response.content.strip()
            # 尝试提取 JSON
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            data = json.loads(content)
            if isinstance(data, str):
                data = json.loads(data)
            detections = data.get("detections", [])

            result = []
            for det in detections:
                frame_idx = det.get("frame_index", 0)
                if 0 <= frame_idx < len(timestamps):
                    result.append(DetectedObject(
                        label=det.get("brand", ""),
                        confidence=det.get("confidence", 0.8),
                        timestamp=timestamps[frame_idx],
                        description=det.get("description", ""),
                    ))

            return result
        except (json.JSONDecodeError, KeyError):
            return []

    async def extract_text_from_frames(
        self,
        frames: list[KeyFrame],
        batch_size: int = 5,
    ) -> VisionAnalysisResult:
        """
        从帧中提取文字（OCR）

        Args:
            frames: 关键帧列表
            batch_size: 每批处理的帧数

        Returns:
            VisionAnalysisResult: 分析结果
        """
        if not frames:
            return VisionAnalysisResult(success=True)

        all_texts = []

        for i in range(0, len(frames), batch_size):
            batch = frames[i:i + batch_size]

            try:
                result = await self._extract_text_from_batch(batch)
                all_texts.extend(result)
            except Exception:
                continue

        return VisionAnalysisResult(
            success=True,
            detected_texts=all_texts,
        )

    async def _extract_text_from_batch(
        self,
        frames: list[KeyFrame],
    ) -> list[SubtitleSegment]:
        """从一批帧中提取文字"""
        image_contents = []
        timestamps = []

        for frame in frames:
            base64_image = frame.to_base64()
            image_contents.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{base64_image}",
                    "detail": "high",
                },
            })
            timestamps.append(frame.timestamp)

        prompt = """提取这些视频帧中的所有可见文字，特别是字幕和标题。

请以 JSON 格式返回，格式如下：
{
  "texts": [
    {
      "frame_index": 0,
      "text": "提取到的文字内容",
      "type": "subtitle"
    }
  ]
}

type 可以是: subtitle（字幕）, title（标题）, caption（说明文字）, other（其他）
如果没有文字，返回空数组：{"texts": []}
只返回 JSON，不要其他文字。"""

        messages = [{
            "role": "user",
            "content": [{"type": "text", "text": prompt}] + image_contents,
        }]

        response = await self.client.chat_completion(
            messages=messages,
            model=self.model,
            temperature=0.1,
            max_tokens=self.max_tokens,
        )

        try:
            content = response.content.strip()
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            data = json.loads(content)
            if isinstance(data, str):
                data = json.loads(data)
            texts = data.get("texts", [])

            result = []
            for txt in texts:
                frame_idx = txt.get("frame_index", 0)
                if 0 <= frame_idx < len(timestamps):
                    text_content = txt.get("text", "").strip()
                    if text_content:
                        result.append(SubtitleSegment(
                            text=text_content,
                            timestamp=timestamps[frame_idx],
                        ))

            return result
        except (json.JSONDecodeError, KeyError):
            return []

    async def analyze_scene(
        self,
        frame: KeyFrame,
        context: str = "",
    ) -> str:
        """
        分析单帧场景

        Args:
            frame: 关键帧
            context: 额外上下文

        Returns:
            场景描述
        """
        base64_image = frame.to_base64()

        prompt = f"请简要描述这个视频画面的内容，特别关注：产品、人物、场景、文字。{context}"

        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_image}",
                        "detail": "low",
                    },
                },
            ],
        }]

        try:
            response = await self.client.chat_completion(
                messages=messages,
                model=self.model,
                temperature=0.3,
                max_tokens=500,
            )
            return response.content.strip()
        except Exception as e:
            return f"分析失败: {str(e)}"

    async def close(self):
        """关闭客户端"""
        await self.client.close()


class CompetitorLogoDetector:
    """竞品 Logo 检测器（封装简化接口）"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4o",
    ):
        self.service = VisionAnalysisService(api_key, base_url, model)

    async def detect(
        self,
        frames: list[KeyFrame],
        competitors: list[str],
    ) -> list[dict]:
        """
        检测竞品 Logo

        Args:
            frames: 关键帧
            competitors: 竞品列表

        Returns:
            违规列表（兼容 VideoReviewService 格式）
        """
        result = await self.service.detect_logos(frames, competitors)

        violations = []
        for logo in result.detected_logos:
            if logo.label in competitors or any(c in logo.label for c in competitors):
                violations.append({
                    "type": "competitor_logo",
                    "timestamp": logo.timestamp,
                    "timestamp_end": logo.timestamp + 1.0,
                    "content": logo.label,
                    "confidence": logo.confidence,
                    "risk_level": "medium",
                    "source": "visual",
                    "suggestion": f"请移除画面中的竞品露出：{logo.label}",
                })

        return violations

    async def close(self):
        await self.service.close()


class VideoOCRService:
    """视频 OCR 服务"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4o",
    ):
        self.service = VisionAnalysisService(api_key, base_url, model)

    async def extract_subtitles(
        self,
        frames: list[KeyFrame],
    ) -> list[dict]:
        """
        提取字幕

        Args:
            frames: 关键帧

        Returns:
            字幕列表（兼容 VideoReviewService 格式）
        """
        result = await self.service.extract_text_from_frames(frames)

        subtitles = []
        for seg in result.detected_texts:
            subtitles.append({
                "text": seg.text,
                "timestamp": seg.timestamp,
            })

        return subtitles

    async def close(self):
        await self.service.close()
