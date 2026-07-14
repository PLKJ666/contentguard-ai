"""
视频审核服务
核心业务逻辑：违规检测、时长校验、风险分类、分数计算
"""
from typing import Optional
from unittest.mock import AsyncMock


class VideoReviewService:
    """视频审核服务"""

    def __init__(self):
        # AI 服务依赖（可注入 mock）
        self.asr_service: Optional[AsyncMock] = None
        self.cv_service: Optional[AsyncMock] = None
        self.ocr_service: Optional[AsyncMock] = None

    async def detect_competitor_logos(
        self,
        frames: list[dict],
        competitors: list[str],
        min_confidence: float = 0.7,
    ) -> list[dict]:
        """
        检测画面中的竞品 Logo

        Args:
            frames: 视频帧数据，每帧包含 timestamp 和 objects
            competitors: 竞品列表
            min_confidence: 最小置信度阈值

        Returns:
            违规列表
        """
        violations = []
        for frame in frames:
            timestamp = frame.get("timestamp", 0.0)
            objects = frame.get("objects", [])

            for obj in objects:
                label = obj.get("label", "")
                confidence = obj.get("confidence", 0.0)

                if label in competitors and confidence >= min_confidence:
                    violations.append({
                        "type": "competitor_logo",
                        "timestamp": timestamp,
                        "content": label,
                        "confidence": confidence,
                        "risk_level": "medium",
                        "suggestion": f"请移除画面中的竞品露出：{label}",
                    })

        return violations

    async def detect_forbidden_words_in_speech(
        self,
        transcript: list[dict],
        forbidden_words: list[str],
        context_aware: bool = False,
    ) -> list[dict]:
        """
        检测语音转文字中的违禁词

        Args:
            transcript: ASR 转写结果，每段包含 text, start, end
            forbidden_words: 违禁词列表
            context_aware: 是否启用语境感知

        Returns:
            违规列表
        """
        violations = []

        # 广告语境关键词
        ad_context_keywords = ["产品", "购买", "推荐", "选择", "品牌", "效果"]

        for segment in transcript:
            text = segment.get("text", "")
            start = segment.get("start", 0.0)

            for word in forbidden_words:
                if word in text:
                    # 语境感知检测
                    if context_aware:
                        is_ad_context = any(kw in text for kw in ad_context_keywords)
                        if not is_ad_context:
                            continue  # 非广告语境，跳过

                    violations.append({
                        "type": "forbidden_word",
                        "content": word,
                        "timestamp": start,
                        "source": "speech",
                        "risk_level": "high",
                        "suggestion": f"建议删除或替换违禁词：{word}",
                    })

        return violations

    async def detect_forbidden_words_in_subtitle(
        self,
        subtitles: list[dict],
        forbidden_words: list[str],
    ) -> list[dict]:
        """
        检测字幕中的违禁词

        Args:
            subtitles: OCR 提取的字幕，每条包含 text, timestamp
            forbidden_words: 违禁词列表

        Returns:
            违规列表
        """
        violations = []

        for subtitle in subtitles:
            text = subtitle.get("text", "")
            timestamp = subtitle.get("timestamp", 0.0)

            for word in forbidden_words:
                if word in text:
                    violations.append({
                        "type": "forbidden_word",
                        "content": word,
                        "timestamp": timestamp,
                        "source": "subtitle",
                        "risk_level": "high",
                        "suggestion": f"建议删除字幕中的违禁词：{word}",
                    })

        return violations

    async def check_product_display_duration(
        self,
        appearances: list[dict],
        min_seconds: int,
    ) -> list[dict]:
        """
        校验产品同框时长

        Args:
            appearances: 产品出现时间段列表，每段包含 start, end
            min_seconds: 最小要求秒数

        Returns:
            违规列表（如果时长不足）
        """
        total_duration = 0.0
        for appearance in appearances:
            start = appearance.get("start", 0.0)
            end = appearance.get("end", 0.0)
            total_duration += (end - start)

        if total_duration < min_seconds:
            return [{
                "type": "duration_short",
                "content": f"产品同框时长 {total_duration:.0f} 秒，不足要求的 {min_seconds} 秒",
                "timestamp": 0.0,
                "risk_level": "medium",
                "suggestion": f"建议增加产品同框时长至 {min_seconds} 秒以上",
            }]

        return []

    async def check_brand_mention_frequency(
        self,
        transcript: list[dict],
        brand_name: str,
        min_mentions: int,
    ) -> list[dict]:
        """
        校验品牌提及频次

        Args:
            transcript: ASR 转写结果
            brand_name: 品牌名称
            min_mentions: 最小提及次数

        Returns:
            违规列表（如果提及不足）
        """
        mention_count = 0
        for segment in transcript:
            text = segment.get("text", "")
            mention_count += text.count(brand_name)

        if mention_count < min_mentions:
            return [{
                "type": "mention_missing",
                "content": f"品牌 '{brand_name}' 提及 {mention_count} 次，不足要求的 {min_mentions} 次",
                "timestamp": 0.0,
                "risk_level": "low",
                "suggestion": f"建议增加品牌提及至 {min_mentions} 次以上",
            }]

        return []

    def classify_risk_level(self, violation: dict) -> str:
        """
        根据违规项分类风险等级

        Args:
            violation: 违规项

        Returns:
            风险等级: high/medium/low
        """
        violation_type = violation.get("type", "")
        category = violation.get("category", "")

        # 法律违规 -> 高风险
        if category == "absolute_term" or violation_type == "forbidden_word":
            return "high"

        # 平台规则违规 -> 中风险
        if category == "platform_rule" or violation_type in ["duration_short", "competitor_logo"]:
            return "medium"

        # 品牌规范违规 -> 低风险
        if category == "brand_guideline" or violation_type == "mention_missing":
            return "low"

        return "medium"  # 默认中风险

    def calculate_score(self, violations: list[dict]) -> int:
        """
        计算合规分数

        规则：
        - 基础分 100 分
        - 高风险违规扣 25 分
        - 中风险违规扣 15 分
        - 低风险违规扣 5 分
        - 最低 0 分

        Args:
            violations: 违规列表

        Returns:
            合规分数 (0-100)
        """
        score = 100

        for violation in violations:
            risk_level = violation.get("risk_level", "medium")

            if risk_level == "high":
                score -= 25
            elif risk_level == "medium":
                score -= 15
            else:
                score -= 5

        return max(0, score)

    def build_brand_exposure_assessment(
        self,
        transcript: list[dict],
        subtitles: list[dict],
        brand_name: Optional[str],
    ) -> dict:
        """
        基于旧版视频审核链路已有文本数据，输出轻量级品牌曝光估算。

        旧链路没有品牌视觉识别能力，所以只稳定估算口播/字幕中的品牌提及，
        画面出镜时长暂时返回 None，避免伪造精确值。
        """
        cleaned_brand = (brand_name or "").strip()
        if not cleaned_brand:
            return {
                "score": None,
                "level": "low",
                "analysis": "旧版审核链路未获取到品牌名称，无法估算品牌曝光。",
                "visible_duration_seconds": None,
                "mention_duration_seconds": None,
                "related_duration_seconds": None,
                "evidence": [],
            }

        mention_duration = 0.0
        evidence: list[str] = []
        for segment in transcript:
            text = segment.get("text", "") or ""
            if cleaned_brand not in text:
                continue
            start = float(segment.get("start", 0.0) or 0.0)
            end = float(segment.get("end", start) or start)
            mention_duration += max(0.0, end - start)
            if len(evidence) < 3:
                evidence.append(f"口播提及：{text[:60]}")

        subtitle_mentions = 0
        for subtitle in subtitles:
            text = subtitle.get("text", "") or ""
            if cleaned_brand in text:
                subtitle_mentions += 1
                if len(evidence) < 3:
                    evidence.append(f"字幕提及：{text[:60]}")

        related_duration = mention_duration
        if mention_duration >= 3:
            score = 85
            level = "high"
        elif mention_duration > 0 or subtitle_mentions > 0:
            score = 65
            level = "medium"
        else:
            score = 30
            level = "low"

        if mention_duration > 0:
            analysis = f"旧版链路检测到品牌“{cleaned_brand}”被明确提及，累计约 {mention_duration:.1f} 秒。"
        elif subtitle_mentions > 0:
            analysis = f"旧版链路仅在字幕中检测到品牌“{cleaned_brand}”相关文字，未识别到明确口播时长。"
        else:
            analysis = f"旧版链路未检测到品牌“{cleaned_brand}”的明确提及。"

        return {
            "score": score,
            "level": level,
            "analysis": analysis,
            "visible_duration_seconds": None,
            "mention_duration_seconds": round(mention_duration, 1),
            "related_duration_seconds": round(related_duration, 1),
            "evidence": evidence,
        }

    async def review_video(
        self,
        video_url: str,
        platform: str,
        brand_id: str,
        competitors: list[str] = None,
        forbidden_words: list[str] = None,
    ) -> dict:
        """
        完整视频审核流程

        Args:
            video_url: 视频 URL
            platform: 投放平台
            brand_id: 品牌 ID
            competitors: 竞品列表
            forbidden_words: 违禁词列表

        Returns:
            审核结果
        """
        competitors = competitors or []
        forbidden_words = forbidden_words or []
        all_violations = []

        # 1. ASR 语音转文字 + 违禁词检测
        if self.asr_service:
            transcript = await self.asr_service.transcribe(video_url)
            speech_violations = await self.detect_forbidden_words_in_speech(
                transcript, forbidden_words
            )
            all_violations.extend(speech_violations)

        # 2. CV 物体检测 + 竞品 Logo 检测
        if self.cv_service:
            frames = await self.cv_service.detect_objects(video_url)
            logo_violations = await self.detect_competitor_logos(frames, competitors)
            all_violations.extend(logo_violations)

        # 3. OCR 字幕提取 + 违禁词检测
        if self.ocr_service:
            subtitles = await self.ocr_service.extract_subtitles(video_url)
            subtitle_violations = await self.detect_forbidden_words_in_subtitle(
                subtitles, forbidden_words
            )
            all_violations.extend(subtitle_violations)

        # 4. 计算分数
        score = self.calculate_score(all_violations)

        # 5. 生成摘要
        if not all_violations:
            summary = "视频内容合规，未发现违规项"
        else:
            summary = f"发现 {len(all_violations)} 处违规"

        return {
            "score": score,
            "summary": summary,
            "violations": all_violations,
        }
