"""
任务 API
实现完整的审核任务流程
"""

import asyncio
import base64
import binascii
import io
import json
import logging
import re
import zipfile
from urllib.parse import quote
from uuid import uuid4
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import get_db, AsyncSessionLocal
from app.models.user import User, UserRole
from app.models.task import Task, TaskStage, TaskStatus
from app.models.project import Project
from app.models.organization import Brand, Agency, Creator
from app.api.deps import (
    get_current_user,
    get_current_agency,
    get_current_creator,
    get_current_brand,
)
from app.schemas.task import (
    TaskCreateRequest,
    TaskResponse,
    TaskListResponse,
    TaskSummary,
    ReviewTaskListResponse,
    TaskScriptUploadRequest,
    TaskVideoUploadRequest,
    TaskReviewRequest,
    ScriptAIRewriteRequest,
    AppealRequest,
    AppealCountRequest,
    AppealCountActionRequest,
    CreatorGuidanceBoardRequest,
    CreatorInfo,
    AgencyInfo,
    ProjectInfo,
)
from app.services.task_service import (
    create_task,
    get_task_by_id,
    check_task_permission,
    upload_script,
    upload_video,
    complete_ai_review,
    agency_review,
    brand_review,
    submit_appeal,
    increase_appeal_count,
    list_tasks_for_creator,
    list_tasks_for_agency,
    list_tasks_for_brand,
    list_pending_reviews_for_agency,
    list_pending_reviews_for_brand,
    AI_SOFT_DISAGREE_THRESHOLD,
)
from app.api.sse import notify_new_task, notify_task_updated, notify_review_decision
from app.services.message_service import create_message
from app.services.local_file_storage import is_local_file_storage_enabled, save_bytes
from app.services.oss import download_from_tos, ensure_signed_url, get_file_url
from app.models.brief import Brief
from app.schemas.review import ScriptReviewRequest, Platform

logger = logging.getLogger(__name__)

# AI 审核后台任务超时（秒），超时后自动回退到上传阶段
SCRIPT_AI_REVIEW_TIMEOUT = 300  # 5 分钟
VIDEO_AI_REVIEW_TIMEOUT = 1200  # 20 分钟，视频抽帧/视觉分析/大模型合并审核耗时明显更长
SCRIPT_TEXT_PLACEHOLDERS = {
    "视频合作内容",
    "合作内容",
    "脚本内容",
    "营销脚本",
    "文案内容",
    "视频口播内容",
}


def _get_ai_review_timeout(review_type: str) -> int:
    return VIDEO_AI_REVIEW_TIMEOUT if review_type == "video" else SCRIPT_AI_REVIEW_TIMEOUT


def _has_meaningful_script_text(value: str | None) -> bool:
    normalized = re.sub(r"\s+", "", value or "")
    if not normalized:
        return False
    if normalized in SCRIPT_TEXT_PLACEHOLDERS:
        return False
    return len(normalized) >= 20


def _normalize_severity(value: str | None) -> str:
    """统一风险等级，兼容中文/英文返回。"""
    mapping = {
        "high": "high",
        "medium": "medium",
        "low": "low",
        "高": "high",
        "中": "medium",
        "低": "low",
        "严重": "high",
        "中等": "medium",
        "轻微": "low",
    }
    return mapping.get((value or "").strip().lower(), "low")


def _extract_rewrite_keywords(*texts: str) -> list[str]:
    """提取用于定位原文片段的关键词。"""
    keywords: list[str] = []
    seen: set[str] = set()
    for text in texts:
        for token in re.findall(r"[A-Za-z0-9+#._-]{2,}|[\u4e00-\u9fff]{2,}", text or ""):
            token = token.strip()
            if len(token) < 2 or token in seen:
                continue
            seen.add(token)
            keywords.append(token)
    return keywords


def _normalize_prompt_text(text: str | None) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _build_prompt_outline(
    text: str | None,
    *,
    max_items: int = 18,
    max_chars: int = 2200,
) -> str:
    normalized = _normalize_prompt_text(text)
    if not normalized:
        return "（无）"

    segments = [
        segment.strip(" ，,；;")
        for segment in re.split(r"(?<=[。！？!?；;])\s*", normalized)
        if segment.strip(" ，,；;")
    ]
    if not segments:
        segments = [normalized]

    outline: list[str] = []
    total_chars = 0
    for index, segment in enumerate(segments, start=1):
        clipped = segment[:160].strip()
        if len(segment) > 160:
            clipped += "…"
        line = f"[{index}] {clipped}"
        projected = total_chars + len(line)
        if outline and (len(outline) >= max_items or projected > max_chars):
            break
        outline.append(line)
        total_chars = projected

    remainder = max(0, len(segments) - len(outline))
    if remainder:
        outline.append(f"... 其余 {remainder} 段已省略")
    return "\n".join(outline)


def _build_prompt_excerpt(text: str | None, *, max_chars: int = 1800) -> str:
    normalized = _normalize_prompt_text(text)
    if not normalized:
        return "（无）"
    if len(normalized) <= max_chars:
        return normalized

    half = max_chars // 2
    head = normalized[:half].rstrip()
    tail = normalized[-half:].lstrip()
    return f"{head}\n...\n{tail}"


def _build_brief_context_for_prompt(brief_data: dict | None, *, max_chars: int = 1200) -> str:
    if not isinstance(brief_data, dict):
        return "（未提供）"

    parts: list[str] = []

    product_name = _normalize_prompt_text(
        brief_data.get("product_name") or brief_data.get("product_description")
    )
    if product_name:
        parts.append(f"产品名称：{product_name}")

    target_audience = _normalize_prompt_text(brief_data.get("target_audience"))
    if target_audience:
        parts.append(f"目标人群：{target_audience}")

    brand_tone = _normalize_prompt_text(brief_data.get("brand_tone"))
    if brand_tone:
        parts.append(f"品牌调性：{brand_tone}")

    selling_points = brief_data.get("selling_points") or []
    selling_point_lines: list[str] = []
    for item in selling_points[:8]:
        if isinstance(item, dict):
            content = _normalize_prompt_text(item.get("content"))
            priority = _normalize_prompt_text(item.get("priority")) or "recommended"
            if content:
                selling_point_lines.append(f"- [{priority}] {content}")
        else:
            content = _normalize_prompt_text(item)
            if content:
                selling_point_lines.append(f"- [recommended] {content}")
    if selling_point_lines:
        parts.append("卖点：\n" + "\n".join(selling_point_lines))

    rubric = brief_data.get("creative_rubric") or {}
    rubric_lines: list[str] = []
    if isinstance(rubric, dict):
        for dim_key in ("tone", "audience", "content_style", "structure"):
            dim = rubric.get(dim_key) or {}
            if not isinstance(dim, dict):
                continue
            name = _normalize_prompt_text(dim.get("name") or dim.get("target"))
            do_items = [
                _normalize_prompt_text(item)
                for item in (dim.get("do_items") or dim.get("do") or [])[:3]
                if _normalize_prompt_text(item)
            ]
            dont_items = [
                _normalize_prompt_text(item)
                for item in (dim.get("dont_items") or dim.get("dont") or [])[:3]
                if _normalize_prompt_text(item)
            ]
            if not (name or do_items or dont_items):
                continue
            line = f"- {dim_key}"
            if name:
                line += f"（{name}）"
            if do_items:
                line += f" DO: {' / '.join(do_items)}"
            if dont_items:
                line += f" DONT: {' / '.join(dont_items)}"
            rubric_lines.append(line)
    if rubric_lines:
        parts.append("创意规则：\n" + "\n".join(rubric_lines))

    result = "\n".join(parts).strip()
    if not result:
        return "（未提供）"
    if len(result) <= max_chars:
        return result
    return result[:max_chars].rstrip() + "…"


def _split_brief_requirements_text(text: str | None) -> tuple[str, str]:
    raw = _normalize_prompt_text(text)
    if not raw:
        return "", ""

    target_audience = ""
    content_lines: list[str] = []
    for original_line in raw.splitlines():
        line = original_line.strip()
        if not line:
            continue
        if line.startswith("目标人群："):
            target_audience = line.replace("目标人群：", "", 1).strip()
            continue
        if line.startswith("内容要求："):
            content_lines.append(line.replace("内容要求：", "", 1).strip())
            continue
        content_lines.append(line)

    return target_audience, "\n".join(item for item in content_lines if item)


def _build_brief_model_summary(brief: Brief | None) -> str:
    if not brief:
        return ""

    parts: list[str] = []
    if brief.product_name:
        parts.append(f"产品名称：{brief.product_name}")

    target_audience, content_requirements = _split_brief_requirements_text(
        brief.other_requirements
    )
    if target_audience:
        parts.append(f"目标人群：{target_audience}")

    if brief.brand_tone:
        parts.append(f"品牌调性：{brief.brand_tone}")
    if content_requirements:
        parts.append(f"要求：{content_requirements}")
    elif brief.other_requirements:
        parts.append(f"要求：{brief.other_requirements}")

    return "；".join(parts)


def _is_scaffold_rewrite_line(line: str) -> bool:
    """过滤脚本表头、参考链接等不适合作为改前片段的行。"""
    normalized = re.sub(r"\s+", "", (line or ""))
    if not normalized:
        return True
    if normalized.startswith("参考画面"):
        return True
    if "v.douyin.com" in normalized or normalized.startswith("http"):
        return True

    header_prefixes = (
        "脚本内容",
        "时间（预估）",
        "时间(预估)",
        "参考图",
        "备注",
        "达人ID：",
        "合作形式：",
        "发布日期：",
        "封面：",
    )
    if any(normalized.startswith(prefix) for prefix in header_prefixes):
        return True
    return False


def _build_corrected_script_message(corrected_script: str) -> str:
    """生成修正稿通知文案，附带简短预览。"""
    normalized = re.sub(r"\s+", " ", (corrected_script or "")).strip()
    if not normalized:
        return "代理商已提交修正稿，点击消息可查看完整版本。"

    preview = normalized[:120]
    if len(normalized) > 120:
        preview += "..."
    return f"代理商已提交修正稿，点击消息可查看完整版本。\n\n修正稿预览：{preview}"


def _pick_fallback_rewrite_line(lines: list[str], issue_text: str) -> str:
    """当关键词定位失败时，挑一行最接近可替换的正文。"""
    content_lines = [line for line in lines if not _is_scaffold_rewrite_line(line)]
    if not content_lines:
        return ""

    if any(token in issue_text for token in ("卖点", "花字", "提神", "场景", "职场")):
        for line in content_lines:
            if "\t" in line or re.search(r"\b\d+\s*S\b", line, re.IGNORECASE):
                return line

    return content_lines[0]


def _expand_match_to_human_span(text: str, start: int, end: int) -> str:
    """把命中的局部词扩展为适合人工修改的完整句/行。"""
    if not text:
        return ""

    line_start = text.rfind("\n", 0, start)
    line_start = 0 if line_start == -1 else line_start + 1
    line_end = text.find("\n", end)
    line_end = len(text) if line_end == -1 else line_end
    line = text[line_start:line_end].strip()
    if 8 <= len(line) <= 180:
        return line

    sent_start_candidates = [text.rfind(p, 0, start) for p in "。！？!?；;\n"]
    sent_start = max(sent_start_candidates)
    sent_start = 0 if sent_start == -1 else sent_start + 1
    sent_end_candidates = [text.find(p, end) for p in "。！？!?；;\n"]
    sent_end_candidates = [p for p in sent_end_candidates if p != -1]
    sent_end = min(sent_end_candidates) + 1 if sent_end_candidates else len(text)
    sentence = text[sent_start:sent_end].strip()
    if sentence:
        return sentence

    return text[start:end].strip()


def _locate_rewrite_source_span(
    full_script: str,
    violation_content: str,
    suggestion: str,
    segment: str | None = None,
) -> str:
    """
    在原稿中定位最适合展示“改前”的完整句/段。

    优先规则：
    1. 命中 segment/violation_content 原文
    2. 用关键词找最相关的行
    3. 回退到传入 segment
    """
    script = (full_script or "").strip()
    if not script:
        return (segment or violation_content or "").strip()

    segment_value = (segment or "").strip()
    violation_value = (violation_content or "").strip()

    # 前端历史上可能把整篇脚本误传到 segment，这会把整篇内容都当成“改前”送去重写。
    # 这里主动丢弃这种异常 segment，优先使用真实违规片段和关键词定位。
    if segment_value and (
        segment_value == script
        or len(segment_value) >= max(180, int(len(script) * 0.7))
    ):
        segment_value = ""

    for candidate in [violation_value, segment_value]:
        value = (candidate or "").strip()
        if value and value in script:
            idx = script.index(value)
            return _expand_match_to_human_span(script, idx, idx + len(value))

    keywords = _extract_rewrite_keywords(violation_content, suggestion, segment_value)
    lines = [line.strip() for line in script.splitlines() if line.strip()]
    best_line = ""
    best_score = 0
    for line in lines:
        if _is_scaffold_rewrite_line(line):
            continue
        score = sum(1 for keyword in keywords if keyword in line)
        if score > best_score:
            best_score = score
            best_line = line
    if best_line:
        return best_line

    if segment_value:
        return segment_value
    fallback_line = _pick_fallback_rewrite_line(lines, f"{violation_content} {suggestion}")
    if fallback_line:
        return fallback_line
    return lines[0] if lines else script[:120]


async def _generate_human_rewrite(
    ai_client,
    text_model: str,
    full_script: str,
    source_span: str,
    violation_content: str,
    suggestion: str,
    brand_context: str = "",
) -> str:
    """生成更像人工编辑的整句/整段改写。"""
    brand_info = f"\n品牌/产品上下文：{brand_context}" if brand_context else ""
    prompt = f"""你是一个非常懂品牌内容、平台表达和用户感受的中文内容编辑。
你的任务不是机械替词，而是像人工审稿一样，把下面这段话改得更自然、更有人话、更有传播感，同时解决审核问题。{brand_info}

## 全文脚本（用于理解风格与上下文）
{full_script}

## 本次需要修改的原文片段（改前）
{source_span}

## 审核指出的问题
{violation_content}

## 修改方向
{suggestion}

## 你的改写目标
1. 返回“完整改写后的这个片段”，不是关键词、短语或半句
2. 保留原作者语气、节奏、情绪和平台感
3. 改写要像真人编辑过的，读起来顺、自然、有用
4. 不要只做合规替词，要顺手把表达生硬、说教、没感觉的问题一起修顺
5. 如果原文里有多个信息点，尽量保留，不要无故删掉
6. 除非必须删除，否则长度不要明显短于原文
7. 结果必须能直接整体替换“改前”片段

只返回改写后的片段文本，不要解释，不要加引号，不要加前缀。"""

    response = await ai_client.chat_completion(
        messages=[{"role": "user", "content": prompt}],
        model=text_model,
        temperature=0.35,
        max_tokens=800,
    )
    return response.content.strip().strip("「」\"'")


def _build_video_analysis_text(
    speech_text: str,
    subtitle_text: str,
    approved_script: str,
) -> tuple[str, str]:
    """
    组合视频审核文本上下文。

    视频里容易漏掉贴片字幕、OCR 文字或 ASR 没听清的内容，
    因此优先合并口播 + OCR；都没有时再退回到审核通过脚本。
    """
    speech = (speech_text or "").strip()
    subtitle = (subtitle_text or "").strip()
    script = (approved_script or "").strip()

    parts: list[str] = []
    sources: list[str] = []

    if speech:
        parts.append(f"【ASR口播】\n{speech}")
        sources.append("asr")
    if subtitle and subtitle != speech:
        parts.append(f"【OCR字幕与贴片】\n{subtitle}")
        sources.append("ocr")
    if not parts and script:
        parts.append(f"【已审核通过脚本】\n{script}")
        sources.append("script")

    return "\n\n".join(parts), "+".join(sources) if sources else "none"


def _repair_truncated_json(text: str) -> str:
    repaired = str(text or "").strip()
    if not repaired:
        return repaired

    stack: list[str] = []
    in_string = False
    escape = False
    for char in repaired:
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            stack.append("}")
        elif char == "[":
            stack.append("]")
        elif char in ("}", "]") and stack and stack[-1] == char:
            stack.pop()

    repaired = repaired.rstrip()
    if repaired.endswith(","):
        repaired = repaired[:-1].rstrip()
    if in_string:
        repaired += '"'
    while stack:
        repaired += stack.pop()
    return repaired


def _robust_json_parse(text: str) -> dict:
    """
    健壮的 JSON 解析：处理 AI 返回的不规范 JSON。

    处理以下常见问题：
    1. markdown code fence
    2. 字符串值内部的未转义换行符
    3. 字符串值内部的未转义双引号（如中文引用 "xxx"）
    """
    original = text
    text = text.strip()
    # 去除 markdown fence
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text.rsplit("\n", 1)[0] if "\n" in text else text[:-3]
    text = text.strip()

    # 提取 { ... } 块
    start = text.find("{")
    end = text.rfind("}")
    if (
        start != -1
        and end != -1
        and end > start
        and text.count("{") == text.count("}")
    ):
        text = text[start : end + 1]

    # 先直接尝试解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 暴力替换换行为空格后尝试
    sanitized = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    try:
        return json.loads(sanitized)
    except json.JSONDecodeError:
        pass

    repaired = _repair_truncated_json(sanitized)
    if repaired and repaired != sanitized:
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            pass

    # 终极方案：通过 JSON key marker 提取字段值
    # 适用于 AI 学习返回的简单 {type, pattern, reason} 结构
    try:
        return _extract_json_by_keys(sanitized, ["type", "pattern", "reason"])
    except (ValueError, IndexError):
        pass

    # 真的解析不了，记录原文并抛出
    logger.error(
        f"_robust_json_parse 最终失败，原文前 500 字符: {repr(original[:500])}"
    )
    raise json.JSONDecodeError("无法解析 AI 返回的 JSON", original[:200], 0)


def _extract_json_by_keys(text: str, keys: list[str]) -> dict:
    """
    通过 JSON key marker 提取字段值。

    策略：找到 "key": " 标记，然后向前查找该值的结尾引号。
    结尾引号的判定：" 后面紧跟 , 或 } 或空白+, 或空白+}。
    这样即使值内部有未转义的 " 也不会被误判为结尾。
    """
    result = {}
    for key in keys:
        # 查找 "key" : "
        pattern = re.compile(rf'"{re.escape(key)}"\s*:\s*"')
        match = pattern.search(text)
        if not match:
            continue

        value_start = match.end()
        # 从 value_start 向后找真正的结尾引号
        pos = value_start
        while pos < len(text):
            if text[pos] == "\\" and pos + 1 < len(text):
                pos += 2  # 跳过转义序列
                continue
            if text[pos] == '"':
                # 检查这个 " 后面是否是 , 或 } (可能隔着空白)
                rest = text[pos + 1 :].lstrip()
                if rest.startswith(",") or rest.startswith("}") or len(rest) == 0:
                    result[key] = text[value_start:pos]
                    # 还原转义
                    result[key] = result[key].replace('\\"', '"')
                    break
            pos += 1

    if not result:
        raise ValueError("无法从文本中提取任何字段")
    return result


def _empty_audio_track_analysis() -> dict:
    return {
        "transcript": "",
        "tone_summary": "",
        "creator_guidance": {
            "summary": "",
            "must_fix": [],
            "voiceover_plan": [],
            "bgm_plan": [],
        },
        "delivery_signals": {
            "tone": "",
            "emotion": "",
            "energy_level": "",
            "pacing": "",
            "persuasiveness": "",
            "brand_fit": "",
            "summary": "",
        },
        "bgm": {
            "present": False,
            "style": "",
            "intensity": "",
            "fit": "",
            "lyrics_risk": False,
            "summary": "",
        },
        "environment": {
            "has_noise": False,
            "noise_types": [],
            "clarity_score": None,
            "summary": "",
        },
        "violations": [],
    }


def _normalize_text_list(value) -> list[str]:
    if isinstance(value, str):
        normalized = value.strip()
        return [normalized] if normalized else []
    if isinstance(value, list):
        return [
            str(item).strip()
            for item in value
            if str(item).strip()
        ]
    return []


def _normalize_audio_track_analysis(payload: dict | None) -> dict:
    normalized = _empty_audio_track_analysis()
    if not isinstance(payload, dict):
        return normalized

    normalized["transcript"] = str(payload.get("transcript") or "").strip()
    normalized["tone_summary"] = str(payload.get("tone_summary") or "").strip()

    creator_guidance = payload.get("creator_guidance") or {}
    if isinstance(creator_guidance, dict):
        normalized["creator_guidance"]["summary"] = str(
            creator_guidance.get("summary") or ""
        ).strip()
        normalized["creator_guidance"]["must_fix"] = _normalize_text_list(
            creator_guidance.get("must_fix")
        )
        voiceover_plan = creator_guidance.get("voiceover_plan") or []
        if isinstance(voiceover_plan, list):
            normalized["creator_guidance"]["voiceover_plan"] = [
                {
                    "segment": str(item.get("segment") or "").strip(),
                    "goal": str(item.get("goal") or "").strip(),
                    "emotion": str(item.get("emotion") or "").strip(),
                    "pacing": str(item.get("pacing") or "").strip(),
                    "instruction": str(item.get("instruction") or "").strip(),
                    "emphasis_words": _normalize_text_list(item.get("emphasis_words")),
                }
                for item in voiceover_plan
                if isinstance(item, dict) and (
                    str(item.get("segment") or "").strip()
                    or str(item.get("instruction") or "").strip()
                )
            ]
        bgm_plan = creator_guidance.get("bgm_plan") or []
        if isinstance(bgm_plan, list):
            normalized["creator_guidance"]["bgm_plan"] = [
                {
                    "segment": str(item.get("segment") or "").strip(),
                    "style": str(item.get("style") or "").strip(),
                    "action": str(item.get("action") or "").strip(),
                    "cue_point": str(item.get("cue_point") or "").strip(),
                    "instruction": str(item.get("instruction") or "").strip(),
                }
                for item in bgm_plan
                if isinstance(item, dict) and (
                    str(item.get("segment") or "").strip()
                    or str(item.get("instruction") or "").strip()
                )
            ]

    delivery = payload.get("delivery_signals") or {}
    if isinstance(delivery, dict):
        normalized["delivery_signals"].update({
            "tone": str(delivery.get("tone") or "").strip(),
            "emotion": str(delivery.get("emotion") or "").strip(),
            "energy_level": str(delivery.get("energy_level") or "").strip(),
            "pacing": str(delivery.get("pacing") or "").strip(),
            "persuasiveness": str(delivery.get("persuasiveness") or "").strip(),
            "brand_fit": str(delivery.get("brand_fit") or "").strip(),
            "summary": str(delivery.get("summary") or "").strip(),
        })

    bgm = payload.get("bgm") or {}
    if isinstance(bgm, dict):
        normalized["bgm"].update({
            "present": bool(bgm.get("present", False)),
            "style": str(bgm.get("style") or "").strip(),
            "intensity": str(bgm.get("intensity") or "").strip(),
            "fit": str(bgm.get("fit") or "").strip(),
            "lyrics_risk": bool(bgm.get("lyrics_risk", False)),
            "summary": str(bgm.get("summary") or "").strip(),
        })

    environment = payload.get("environment") or {}
    if isinstance(environment, dict):
        clarity_score = environment.get("clarity_score")
        if clarity_score is not None:
            try:
                clarity_score = max(0, min(100, int(clarity_score)))
            except (TypeError, ValueError):
                clarity_score = None
        normalized["environment"].update({
            "has_noise": bool(environment.get("has_noise", False)),
            "noise_types": _normalize_text_list(environment.get("noise_types")),
            "clarity_score": clarity_score,
            "summary": str(environment.get("summary") or "").strip(),
        })

    violations = payload.get("violations") or []
    if isinstance(violations, list):
        normalized["violations"] = [
            {
                "type": str(item.get("type") or "音频问题").strip(),
                "content": str(item.get("content") or "").strip(),
                "severity": _normalize_severity(item.get("severity")),
                "suggestion": str(item.get("suggestion") or "").strip(),
            }
            for item in violations
            if isinstance(item, dict) and str(item.get("content") or "").strip()
        ]

    return normalized


def _looks_like_no_voice_claim(text: str | None) -> bool:
    normalized = re.sub(r"\s+", "", str(text or "")).lower()
    if not normalized:
        return False
    markers = (
        "未检测到有效的人声",
        "未检测到有效人声",
        "缺乏有效的人声",
        "缺乏有效人声",
        "纯bgm",
        "提取失败",
        "无人声",
        "没有口播",
        "未识别到口播",
    )
    return any(marker in normalized for marker in markers)


def _looks_like_transcript_summary(text: str | None) -> bool:
    normalized = re.sub(r"\s+", "", str(text or "")).lower()
    if not normalized:
        return False
    markers = (
        "达人口播",
        "视频口播",
        "口播了",
        "整体按脚本执行",
        "转写缺失",
        "后半段转写",
        "前半段转写",
        "主要讲述",
        "主要介绍",
        "概括",
    )
    return any(marker in normalized for marker in markers)


def _build_audio_bgm_summary(bgm: dict | None, environment: dict | None) -> str:
    bgm = bgm or {}
    environment = environment or {}
    fragments: list[str] = []
    if bgm.get("present"):
        bgm_bits = [str(bgm.get("style") or "").strip(), str(bgm.get("intensity") or "").strip()]
        bgm_text = " / ".join(bit for bit in bgm_bits if bit)
        if bgm_text:
            fragments.append(f"已识别到 {bgm_text} 的背景音乐")
        else:
            fragments.append("已识别到背景音乐")
        fit = str(bgm.get("fit") or "").strip()
        if fit:
            fragments.append(f"和内容{fit}")
        if bgm.get("lyrics_risk") is True:
            fragments.append("存在歌词抢信息风险")

    if environment.get("has_noise") is True:
        noise_types = _normalize_text_list(environment.get("noise_types"))
        if noise_types:
            fragments.append(f"环境音问题主要是{ '、'.join(noise_types[:3]) }")
        else:
            fragments.append("存在环境噪音")
    elif environment.get("clarity_score") is not None:
        fragments.append(f"音质清晰度约 {environment.get('clarity_score')} 分")

    return "，".join(fragment for fragment in fragments if fragment).strip("，")


def _repair_audio_track_analysis_with_transcript(
    audio_analysis: dict | None,
    speech_text: str | None,
) -> dict:
    repaired = _normalize_audio_track_analysis(audio_analysis)
    speech = str(speech_text or "").strip()
    existing_transcript = str(repaired.get("transcript") or "").strip()
    if speech and (
        not existing_transcript
        or _looks_like_transcript_summary(existing_transcript)
    ):
        repaired["transcript"] = speech

    transcript = str(repaired.get("transcript") or "").strip()
    transcript_strength = len(re.sub(r"\s+", "", transcript))

    if not repaired["delivery_signals"].get("summary") and repaired.get("tone_summary"):
        repaired["delivery_signals"]["summary"] = repaired["tone_summary"]

    creator_summary = str(repaired["creator_guidance"].get("summary") or "").strip()
    if len(creator_summary) < 8:
        repaired["creator_guidance"]["summary"] = (
            repaired["creator_guidance"]["must_fix"][0]
            if repaired["creator_guidance"].get("must_fix")
            else repaired["delivery_signals"].get("summary")
            or repaired.get("tone_summary")
            or creator_summary
        )

    if repaired["bgm"].get("present") and not repaired["bgm"].get("summary"):
        repaired["bgm"]["summary"] = _build_audio_bgm_summary(
            repaired.get("bgm"),
            repaired.get("environment"),
        )
    if (
        repaired["environment"].get("summary") == ""
        and repaired["environment"].get("clarity_score") is not None
        and repaired["environment"].get("has_noise") is False
    ):
        repaired["environment"]["summary"] = (
            f"未识别到明显噪音，音质清晰度约 {repaired['environment']['clarity_score']} 分。"
        )

    if transcript_strength < 12:
        return repaired

    no_voice_claimed = any(
        _looks_like_no_voice_claim(item)
        for item in (
            repaired.get("tone_summary"),
            repaired.get("delivery_signals", {}).get("summary"),
            *[issue.get("content") for issue in repaired.get("violations", []) if isinstance(issue, dict)],
        )
    )
    if not no_voice_claimed:
        return repaired

    if _looks_like_no_voice_claim(repaired.get("tone_summary")):
        repaired["tone_summary"] = ""
    if _looks_like_no_voice_claim(repaired.get("delivery_signals", {}).get("summary")):
        repaired["delivery_signals"]["summary"] = ""

    for key in ("tone", "emotion", "pacing"):
        if repaired["delivery_signals"].get(key) == "未知":
            repaired["delivery_signals"][key] = ""
    for key in ("energy_level", "persuasiveness", "brand_fit"):
        if repaired["delivery_signals"].get(key) in {"低", "极低", "未知"}:
            repaired["delivery_signals"][key] = ""

    repaired["violations"] = [
        issue
        for issue in repaired.get("violations", [])
        if not _looks_like_no_voice_claim(issue.get("content") if isinstance(issue, dict) else "")
    ]
    return repaired


def _merge_audio_track_analysis(base: dict | None, override: dict | None) -> dict:
    """合并两次音轨分析，保留首次音频理解产出的达人执行建议。"""
    merged = _normalize_audio_track_analysis(base)
    incoming = _normalize_audio_track_analysis(override)

    if incoming.get("transcript"):
        merged["transcript"] = incoming["transcript"]
    if incoming.get("tone_summary"):
        merged["tone_summary"] = incoming["tone_summary"]

    for section in ("delivery_signals", "bgm", "environment"):
        for key, value in incoming.get(section, {}).items():
            if value not in ("", None, [], False):
                merged[section][key] = value

    if incoming.get("violations"):
        merged["violations"] = incoming["violations"]

    incoming_guidance = incoming.get("creator_guidance") or {}
    merged_guidance = merged.get("creator_guidance") or {}
    if incoming_guidance.get("summary"):
        merged_guidance["summary"] = incoming_guidance["summary"]
    if incoming_guidance.get("must_fix"):
        merged_guidance["must_fix"] = incoming_guidance["must_fix"]
    if incoming_guidance.get("voiceover_plan"):
        merged_guidance["voiceover_plan"] = incoming_guidance["voiceover_plan"]
    if incoming_guidance.get("bgm_plan"):
        merged_guidance["bgm_plan"] = incoming_guidance["bgm_plan"]
    merged["creator_guidance"] = merged_guidance

    return merged


def _format_mmss(seconds: int) -> str:
    seconds = max(0, int(seconds))
    mins = seconds // 60
    secs = seconds % 60
    return f"{mins}:{secs:02d}"


def _format_time_range(start_sec: int | None, end_sec: int | None) -> str:
    start = max(0, int(start_sec or 0))
    end = max(start, int(end_sec if end_sec is not None else start + 8))
    return f"{_format_mmss(start)} - {_format_mmss(end)}"


def _time_range_from_timestamp(
    timestamp: int | float | None,
    duration: int | None,
    span: int = 8,
) -> tuple[int, int]:
    try:
        start = max(0, int(float(timestamp or 0)))
    except (TypeError, ValueError):
        start = 0
    max_duration = max(start + 3, int(duration or start + span))
    end = min(max_duration, max(start + 3, start + span))
    return start, end


def _infer_candidate_category(text: str) -> str:
    normalized = (text or "").lower()
    if any(keyword in normalized for keyword in ("bgm", "音乐", "鼓点", "切歌", "底乐", "铺底", "音量", "噪音", "回声", "歌词", "环境音", "爆音", "电流声")):
        return "bgm"
    if any(keyword in normalized for keyword in ("结尾", "定位", "卖点", "信息", "品牌", "脚本", "补一句", "收口", "背书", "画面", "字幕", "镜头", "包装", "水印", "素材", "贴片", "产品", "合规", "brief")):
        return "content"
    if any(keyword in normalized for keyword in ("口播", "语速", "连读", "停顿", "嘴瓢", "口误", "语气", "语调", "发音", "人声", "情绪")):
        return "voice"
    return "content"


def _normalize_label_text(label: str) -> str:
    return re.sub(r"\s+", " ", str(label or "")).strip("：:。；，, ")


def _looks_like_internal_where_label(text: str) -> bool:
    normalized = re.sub(r"[\s_]+", "", str(text or "")).lower()
    return normalized in {
        "forbiddenword",
        "brandsafety",
        "efficacyclaim",
        "法规合规",
        "口误",
        "产品不符",
        "画面质量",
        "字幕错误",
        "内容质量",
        "品牌安全",
        "语气问题",
        "bgm问题",
        "噪音问题",
        "清晰度问题",
    }


def _looks_like_time_range_label(text: str) -> bool:
    normalized = _normalize_label_text(text)
    return bool(
        re.search(r"\d{1,2}:\d{2}\s*[-~]\s*\d{1,2}:\d{2}", normalized)
        or re.search(r"\d{1,2}:\d{2}\s*附近", normalized)
    )


def _clean_direct_fix_text(text: str) -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return ""

    replacements = {
        "严重执行事故！必须替换为": "必须替换为",
        "严重执行事故!必须替换为": "必须替换为",
        "请品牌方法务确认是否有对应的临床测试报告支撑该宣称，若无则需删除。": "这句涉及“临床测试”表述，如没有合规依据就直接删除，或改成合规说法。",
        "请品牌方法务确认是否有对应的临床测试报告支撑该宣称，若无则需删除": "这句涉及“临床测试”表述，如没有合规依据就直接删除，或改成合规说法。",
    }
    for old, new in replacements.items():
        cleaned = cleaned.replace(old, new)
    return cleaned.strip()


def _normalize_candidate_direct_fix(problem: str, direct_fix: str, suggested_copy: str, category: str) -> str:
    cleaned_fix = _clean_direct_fix_text(direct_fix)
    copy_text = str(suggested_copy or "").strip()
    if copy_text.startswith("建议补上："):
        copy_text = copy_text.replace("建议补上：", "", 1).strip()

    if copy_text:
        if "完全删除" in str(problem or "") and ("卖点或定位表达" in cleaned_fix or "无效信息" in cleaned_fix):
            return f"把这段补回“{copy_text}”对应的口播或画面，不要整段删掉。"
        if "请在对应时间段补上这句核心信息" in cleaned_fix:
            return f"把这句补上：{copy_text}。"

    if not cleaned_fix:
        return _fallback_direct_fix(problem, category)
    return cleaned_fix


def _humanize_where_to_change(
    label: str,
    category: str,
    *,
    problem: str = "",
    source: str = "",
    timestamp: int | float | None = None,
) -> str:
    text = _normalize_label_text(label)
    source_text = _normalize_label_text(source)
    combined = " ".join(part for part in (text, source_text, problem) if part)
    suffix_map = {
        "voice": "口播",
        "bgm": "BGM",
        "content": "内容",
    }

    nearby_match = re.match(r"^(\d{1,2}:\d{2})\s*附近(.+)$", text)
    if nearby_match:
        inner = _humanize_where_to_change(
            nearby_match.group(2),
            category,
            problem=problem,
            source=source,
        )
        inner = inner.replace("对应时间段", "", 1)
        inner = inner.strip() or suffix_map.get(category, "内容")
        return f"{nearby_match.group(1)} 附近{inner}"

    if _looks_like_time_range_label(text):
        return text

    segment_label_map = {
        "IP引入": "开头引入内容",
        "双IP联动": "开头联动内容",
        "信任背书": "中段信任背书",
        "产品卖点": "中段产品卖点",
        "总结升华": "结尾收口",
    }
    if text in segment_label_map:
        return segment_label_map[text]

    internal_label_map = {
        "forbidden_word": "对应时间段口播文案",
        "brand_safety": "对应时间段产品展示",
        "efficacy_claim": "对应时间段口播或字幕",
        "法规合规": "对应时间段口播或字幕",
        "口误": "对应时间段口播",
        "产品不符": "对应时间段产品展示",
        "画面质量": "对应时间段画面",
        "字幕错误": "对应时间段字幕",
    }
    if text in internal_label_map:
        text = internal_label_map[text]
    elif _looks_like_internal_where_label(text):
        text = ""

    if not text:
        if "字幕" in combined:
            text = "对应时间段字幕"
        elif any(keyword in combined for keyword in ("画面", "镜头", "包装", "水印", "素材", "产品展示", "贴片")) or source_text == "画面":
            text = "对应时间段画面"
        elif category == "bgm":
            text = "对应时间段 BGM"
        elif category == "voice" or source_text == "语音":
            text = "对应时间段口播"
        else:
            text = "对应时间段内容"
    elif (
        category == "content"
        and len(text) >= 8
        and not any(keyword in text for keyword in ("口播", "字幕", "画面", "产品", "内容", "引入", "卖点", "背书", "收口", "BGM"))
    ):
        text = "对应时间段内容补充"

    generic_labels = {
        "开场",
        "前段",
        "前半",
        "第一段",
        "中段",
        "中间",
        "第二段",
        "转场",
        "后段",
        "结尾",
        "最后",
        "第三段",
    }
    if text in generic_labels:
        text = f"{text}{suffix_map.get(category, '内容')}"

    if timestamp is not None:
        try:
            mmss = _format_mmss(int(float(timestamp)))
        except (TypeError, ValueError):
            mmss = ""
        if mmss:
            if text.startswith("对应时间段"):
                return text.replace("对应时间段", f"{mmss} 附近", 1)
            if "附近" not in text and not _looks_like_time_range_label(text):
                return f"{mmss} 附近{text}"

    return text or "对应时间段内容"


def _format_where_to_change(label: str, category: str) -> str:
    text = _normalize_label_text(label)
    if not text:
        defaults = {
            "voice": "对应时间段口播",
            "bgm": "对应时间段 BGM",
            "content": "对应时间段内容",
        }
        return defaults.get(category, "对应时间段内容")

    suffix_map = {
        "voice": "口播",
        "bgm": "BGM",
        "content": "内容",
    }
    generic_labels = {
        "开场",
        "前段",
        "前半",
        "第一段",
        "中段",
        "中间",
        "第二段",
        "转场",
        "后段",
        "结尾",
        "最后",
        "第三段",
    }
    if text in generic_labels:
        return f"{text}{suffix_map.get(category, '内容')}"
    return text


def _fallback_direct_fix(problem: str, category: str) -> str:
    normalized = re.sub(r"\s+", "", str(problem or ""))
    if category == "voice":
        if "直接讲产品" in normalized or "进入太快" in normalized:
            return "开头先说生活场景或人物状态，再自然带出产品，不要第一句就进产品。"
        if any(token in normalized for token in ("连读", "听不清", "语速快", "太快", "嘴瓢")):
            return "把关键词单独顿开，语速放慢半拍，重要词完整说清。"
        if any(token in normalized for token in ("停顿", "节奏", "口播")):
            return "把重点词前后留出停顿，语气收稳，不要一口气带过。"
        return "把这一段口播改成更自然的短句表达，重点词单独说清。"

    if category == "bgm":
        if any(token in normalized for token in ("太满", "盖住", "抢人声", "听不清", "压低")):
            return "把这段音乐压低，让重点口播完整露出来。"
        if any(token in normalized for token in ("突然", "跳", "切换", "不稳", "拉满")):
            return "把这段音乐衔接放平，避免情绪突然拉满或突然掉下去。"
        if "歌词" in normalized:
            return "把这段换成无歌词铺底，避免歌词和口播抢信息。"
        return "按这段画面和口播重新调整音乐节奏、音量和转场。"

    if any(token in normalized for token in ("定位", "记忆点", "收口", "结尾")):
        return "在结尾补一句明确定位，让观众记住为什么选它。"
    if any(token in normalized for token in ("卖点", "研发", "成分", "信息", "不清")):
        return "把这一句改成更完整的卖点表达，关键词拆开说清。"
    if any(token in normalized for token in ("缺少", "遗漏", "没讲", "缺失")):
        return "在对应时间段补上这句关键信息，避免卖点断层。"
    return "删掉无效信息，把这一段改成更清楚的卖点或定位表达。"


def _build_voice_problem(goal: str, instruction: str, fallback: str) -> str:
    text = " ".join(part for part in (instruction, goal, fallback) if part).strip()
    normalized = re.sub(r"\s+", "", text)
    if "不要直接讲产品" in normalized or ("先讲" in normalized and "产品" in normalized):
        return "开头直接讲产品，进入太快"
    if any(token in normalized for token in ("关键词", "卖点", "说清", "说稳")):
        return "这一段关键信息没有说清，重点词不够稳"
    if any(token in normalized for token in ("停顿", "节奏", "语速")):
        return "这一段口播节奏偏赶，重点不够突出"
    return text or "这一段口播表达还不够顺"


def _build_bgm_problem(style: str, instruction: str, fallback: str) -> str:
    text = " ".join(part for part in (instruction, style, fallback) if part).strip()
    normalized = re.sub(r"\s+", "", text)
    if any(token in normalized for token in ("压低", "让出来", "让口播出来", "盖住", "人声")):
        return "这段音乐偏满，重点口播容易被盖住"
    if any(token in normalized for token in ("平稳", "不要突然", "突然", "拉满")):
        return "音乐起伏有点急，情绪转折不够顺"
    if "歌词" in normalized:
        return "这段背景音乐有歌词风险，容易和口播抢信息"
    return text or "这段背景音乐需要调整"


def _build_violation_fix(violation: dict, category: str) -> str:
    suggestion = str(violation.get("suggestion") or "").strip()
    if suggestion:
        return suggestion

    script_text = str(violation.get("script_text") or "").strip()
    actual_text = str(violation.get("actual_text") or "").strip()
    if script_text and actual_text and script_text != actual_text:
        return f"把“{actual_text}”改回“{script_text}”，这一句按通过脚本口径说。"

    return _fallback_direct_fix(str(violation.get("content") or ""), category)


def _parse_timestamp_seconds(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return max(0, int(value))

    text = str(value).strip()
    if not text:
        return None

    match = re.search(r"(\d{1,2}):(\d{2})", text)
    if match:
        return int(match.group(1)) * 60 + int(match.group(2))

    if text.isdigit():
        return max(0, int(text))

    return None


def _bucket_range_from_label(label: str, duration: int | None, index: int = 0, total: int = 1) -> tuple[int, int]:
    duration_value = max(15, int(duration or 45))
    third = max(8, duration_value // 3)
    text = (label or "").strip()

    match = re.findall(r"(\d{1,2}):(\d{2})", text)
    if len(match) >= 2:
        start = int(match[0][0]) * 60 + int(match[0][1])
        end = int(match[1][0]) * 60 + int(match[1][1])
        return start, max(start + 3, end)

    if any(token in text for token in ("开场", "前段", "第一段", "前半")):
        return 0, min(duration_value, third)
    if any(token in text for token in ("中段", "第二段", "中间", "转场")):
        start = min(duration_value, third)
        return start, min(duration_value, start + third)
    if any(token in text for token in ("结尾", "后段", "第三段", "最后")):
        start = max(0, duration_value - third)
        return start, duration_value

    slot = max(1, duration_value // max(1, total))
    start = min(duration_value, index * slot)
    end = duration_value if index == total - 1 else min(duration_value, start + slot)
    return start, max(start + 3, end)


def _review_candidate_payload(
    *,
    candidate_id: str,
    category: str,
    start_sec: int,
    end_sec: int,
    priority: str,
    problem: str,
    direct_fix: str,
    where_to_change: str,
    suggested_copy: str = "",
    bgm_action: str = "",
    evidence: str = "",
) -> dict | None:
    normalized_problem = str(problem or "").strip()
    normalized_fix = str(direct_fix or "").strip()
    normalized_where = str(where_to_change or "").strip()
    if not normalized_problem or not normalized_fix or not normalized_where:
        return None

    start = max(0, int(start_sec))
    end = max(start, int(end_sec))
    return {
        "id": candidate_id,
        "category": category if category in {"voice", "bgm", "content"} else "content",
        "start_sec": start,
        "end_sec": end,
        "time_range": _format_time_range(start, end),
        "priority": priority if priority in {"high", "medium", "low"} else "medium",
        "problem": normalized_problem,
        "direct_fix": normalized_fix,
        "where_to_change": normalized_where,
        "suggested_copy": str(suggested_copy or "").strip(),
        "bgm_action": str(bgm_action or "").strip(),
        "evidence": str(evidence or "").strip(),
    }


def _dedupe_review_candidates(candidates: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    seen: set[tuple[str, str, str, str]] = set()
    priority_order = {"high": 0, "medium": 1, "low": 2}
    for item in sorted(
        candidates,
        key=lambda candidate: (
            candidate.get("start_sec", 0),
            priority_order.get(candidate.get("priority", "medium"), 1),
            candidate.get("category", ""),
        ),
    ):
        key = (
            item.get("category", ""),
            item.get("time_range", ""),
            item.get("problem", ""),
            item.get("direct_fix", ""),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _merge_review_candidate_pool(
    existing_candidates: list[dict] | None,
    selected_candidates: list[dict],
) -> list[dict]:
    selected_by_id = {
        str(item.get("id") or ""): item
        for item in selected_candidates
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    }
    merged: list[dict] = []
    seen_ids: set[str] = set()

    for candidate in existing_candidates or []:
        normalized = _normalize_review_candidate_payload(candidate)
        if not normalized:
            continue
        candidate_id = str(normalized.get("id") or "").strip()
        if not candidate_id or candidate_id in seen_ids:
            continue
        merged.append(selected_by_id.get(candidate_id, normalized))
        seen_ids.add(candidate_id)

    for candidate in selected_candidates:
        candidate_id = str(candidate.get("id") or "").strip()
        if not candidate_id or candidate_id in seen_ids:
            continue
        merged.append(candidate)
        seen_ids.add(candidate_id)

    return merged


def _normalize_review_candidate_payload(candidate: dict | None) -> dict | None:
    if not isinstance(candidate, dict):
        return None
    start = candidate.get("start_sec", 0)
    end = candidate.get("end_sec", start)
    try:
        start = max(0, int(start))
    except (TypeError, ValueError):
        start = 0
    try:
        end = max(start, int(end))
    except (TypeError, ValueError):
        end = max(start, start + 8)

    raw_problem = str(candidate.get("problem") or "")
    raw_fix = str(candidate.get("direct_fix") or "")
    raw_where = str(candidate.get("where_to_change") or "")
    raw_suggested_copy = str(candidate.get("suggested_copy") or "")
    inferred_category = _infer_candidate_category(
        " ".join(
            part
            for part in (
                str(candidate.get("category") or ""),
                raw_problem,
                raw_fix,
                raw_where,
                raw_suggested_copy,
                str(candidate.get("evidence") or ""),
                str(candidate.get("bgm_action") or ""),
            )
            if part
        )
    )

    return _review_candidate_payload(
        candidate_id=str(candidate.get("id") or f"candidate-{start}-{end}"),
        category=inferred_category,
        start_sec=start,
        end_sec=end,
        priority=str(candidate.get("priority") or "medium"),
        problem=raw_problem,
        direct_fix=_normalize_candidate_direct_fix(
            raw_problem,
            raw_fix,
            raw_suggested_copy,
            inferred_category,
        ),
        where_to_change=_humanize_where_to_change(
            raw_where,
            inferred_category,
            problem=raw_problem,
            timestamp=start,
        ),
        suggested_copy=raw_suggested_copy,
        bgm_action=str(candidate.get("bgm_action") or ""),
        evidence=str(candidate.get("evidence") or ""),
    )


def _build_review_candidates(video_ai_result: dict | None, duration: int | None) -> list[dict]:
    if not isinstance(video_ai_result, dict):
        return []

    existing_candidates: list[dict] = []
    existing = video_ai_result.get("review_candidates")
    if isinstance(existing, list) and existing:
        normalized_existing = [
            item for item in (
                _normalize_review_candidate_payload(candidate)
                for candidate in existing
            ) if item
        ]
        if normalized_existing:
            existing_candidates = _dedupe_review_candidates(normalized_existing)

    result: list[dict] = []
    audio_analysis = _normalize_audio_track_analysis(video_ai_result.get("audio_track_analysis"))
    guidance = audio_analysis.get("creator_guidance") or {}
    voiceover_plan = guidance.get("voiceover_plan") or []
    bgm_plan = guidance.get("bgm_plan") or []
    must_fix = guidance.get("must_fix") or []
    delivery_quality = video_ai_result.get("delivery_quality") or {}
    delivery_signals = audio_analysis.get("delivery_signals") or {}
    bgm = audio_analysis.get("bgm") or {}
    overall_delivery = "；".join(
        str(delivery_quality.get(key) or "").strip()
        for key in ("overall", "engagement", "platform_fit")
        if str(delivery_quality.get(key) or "").strip()
    )

    for index, item in enumerate(voiceover_plan):
        start, end = _bucket_range_from_label(
            str(item.get("segment") or ""),
            duration,
            index=index,
            total=max(1, len(voiceover_plan)),
        )
        emphasis_words = _normalize_text_list(item.get("emphasis_words"))
        problem = _build_voice_problem(
            str(item.get("goal") or "").strip(),
            str(item.get("instruction") or "").strip(),
            audio_analysis.get("tone_summary") or overall_delivery or "",
        )
        result_item = _review_candidate_payload(
            candidate_id=f"voice-plan-{index + 1}",
            category="voice",
            start_sec=start,
            end_sec=end,
            priority="high" if index == 0 else "medium",
            problem=problem,
            direct_fix=str(item.get("instruction") or _fallback_direct_fix(problem, "voice")).strip(),
            where_to_change=_format_where_to_change(str(item.get("segment") or ""), "voice"),
            suggested_copy=(
                f"重点带出：{'、'.join(emphasis_words[:4])}"
                if emphasis_words
                else ""
            ),
            evidence=str(item.get("emotion") or ""),
        )
        if result_item:
            result.append(result_item)

    if not any(item.get("category") == "voice" for item in result):
        voice_problem = (
            str(guidance.get("summary") or "").strip()
            or str(audio_analysis.get("tone_summary") or "").strip()
            or str(delivery_signals.get("summary") or "").strip()
        )
        if voice_problem:
            voice_fix = _clean_direct_fix_text(
                str(must_fix[0]).strip() if must_fix else _fallback_direct_fix(voice_problem, "voice")
            )
            result_item = _review_candidate_payload(
                candidate_id="voice-overall-1",
                category="voice",
                start_sec=0,
                end_sec=max(8, int(duration or 8)),
                priority="medium",
                problem=voice_problem,
                direct_fix=voice_fix,
                where_to_change="整段口播",
                evidence=str(delivery_signals.get("emotion") or delivery_signals.get("tone") or "").strip(),
            )
            if result_item:
                result.append(result_item)

    for index, item in enumerate(bgm_plan):
        start, end = _bucket_range_from_label(
            str(item.get("segment") or ""),
            duration,
            index=index,
            total=max(1, len(bgm_plan)),
        )
        problem = _build_bgm_problem(
            str(item.get("style") or "").strip(),
            str(item.get("instruction") or "").strip(),
            audio_analysis.get("bgm", {}).get("summary") or "",
        )
        result_item = _review_candidate_payload(
            candidate_id=f"bgm-plan-{index + 1}",
            category="bgm",
            start_sec=start,
            end_sec=end,
            priority="medium",
            problem=problem,
            direct_fix=str(item.get("instruction") or _fallback_direct_fix(problem, "bgm")).strip(),
            where_to_change=_format_where_to_change(str(item.get("segment") or ""), "bgm"),
            bgm_action=str(item.get("action") or ""),
            evidence=str(item.get("cue_point") or ""),
        )
        if result_item:
            result.append(result_item)

    if not any(item.get("category") == "bgm" for item in result):
        bgm_problem = _build_bgm_problem(
            str(bgm.get("style") or "").strip(),
            "",
            str(bgm.get("summary") or "").strip(),
        )
        if bgm.get("present") or str(bgm.get("summary") or "").strip():
            result_item = _review_candidate_payload(
                candidate_id="bgm-overall-1",
                category="bgm",
                start_sec=0,
                end_sec=max(8, int(duration or 8)),
                priority="medium",
                problem=bgm_problem,
                direct_fix=_clean_direct_fix_text(
                    _fallback_direct_fix(str(bgm.get("summary") or bgm_problem), "bgm")
                ),
                where_to_change="全片 BGM",
                bgm_action="压低" if "人声" in bgm_problem or "歌词" in bgm_problem else "",
            )
            if result_item:
                result.append(result_item)

    for index, item in enumerate(must_fix):
        category = _infer_candidate_category(str(item))
        start, end = _bucket_range_from_label(
            str(item),
            duration,
            index=index,
            total=max(1, len(must_fix)),
        )
        fix_text = str(item).strip()
        result_item = _review_candidate_payload(
            candidate_id=f"must-fix-{index + 1}",
            category=category,
            start_sec=start,
            end_sec=end,
            priority="high",
            problem=fix_text,
            direct_fix=_fallback_direct_fix(fix_text, category),
            where_to_change=_format_where_to_change(str(item), category),
        )
        if result_item:
            result.append(result_item)

    script_match = video_ai_result.get("script_match") or {}
    for index, segment in enumerate((script_match.get("segments") or [])):
        status = str(segment.get("status") or "").strip()
        if status not in {"missing", "reordered"}:
            continue
        start, end = _bucket_range_from_label(
            str(segment.get("segment_label") or segment.get("script_segment") or ""),
            duration,
            index=index,
            total=max(1, len(script_match.get("segments") or [])),
        )
        result_item = _review_candidate_payload(
            candidate_id=f"script-match-{index + 1}",
            category="content",
            start_sec=start,
            end_sec=end,
            priority="high",
            problem=str(segment.get("note") or "这一段脚本执行不到位").strip(),
            direct_fix=(
                f"把这段补回“{str(segment.get('script_segment') or '').strip()}”对应的口播或画面，不要整段删掉。"
                if status == "missing" and str(segment.get("script_segment") or "").strip()
                else _fallback_direct_fix(
                    str(segment.get("note") or segment.get("script_segment") or ""),
                    "content",
                )
            ),
            where_to_change=_humanize_where_to_change(
                str(segment.get("segment_label") or ""),
                "content",
                problem=str(segment.get("note") or ""),
            ),
            suggested_copy=(
                f"建议补上：{str(segment.get('script_segment') or '').strip()}"
                if str(segment.get("script_segment") or "").strip()
                else ""
            ),
        )
        if result_item:
            result.append(result_item)

    for index, item in enumerate((script_match.get("missing_segments") or [])):
        start, end = _bucket_range_from_label(str(item), duration, index=index, total=max(1, len(script_match.get("missing_segments") or [])))
        result_item = _review_candidate_payload(
            candidate_id=f"missing-segment-{index + 1}",
            category="content",
            start_sec=start,
            end_sec=end,
            priority="high",
            problem=f"缺少关键信息：{str(item).strip()}",
            direct_fix="请在对应时间段补上这句核心信息，避免卖点断层。",
            where_to_change=_format_where_to_change(str(item), "content"),
            suggested_copy=f"建议补上：{str(item).strip()}",
        )
        if result_item:
            result.append(result_item)

    for index, item in enumerate((script_match.get("key_deviations") or [])):
        deviation = str(item).strip()
        if not deviation:
            continue
        start, end = _bucket_range_from_label(
            deviation,
            duration,
            index=index,
            total=max(1, len(script_match.get("key_deviations") or [])),
        )
        result_item = _review_candidate_payload(
            candidate_id=f"key-deviation-{index + 1}",
            category="content",
            start_sec=start,
            end_sec=end,
            priority="medium",
            problem=f"关键信息表达有偏差：{deviation}",
            direct_fix="把这一句改回通过脚本的口径，不要自己换意思或换顺序。",
            where_to_change="对应时间段内容",
        )
        if result_item:
            result.append(result_item)

    subtitle_issues = video_ai_result.get("subtitle_issues") or []
    for index, item in enumerate(subtitle_issues):
        if not isinstance(item, dict):
            continue
        subtitle_problem = str(item.get("content") or "").strip()
        if not subtitle_problem:
            continue

        subtitle_timestamp = _parse_timestamp_seconds(item.get("timestamp"))
        if subtitle_timestamp is not None:
            start, end = _time_range_from_timestamp(subtitle_timestamp, duration, span=6)
            where_to_change = f"{_format_mmss(subtitle_timestamp)} 附近字幕"
        else:
            start, end = _bucket_range_from_label(
                subtitle_problem,
                duration,
                index=index,
                total=max(1, len(subtitle_issues)),
            )
            where_to_change = "对应时间段字幕"

        result_item = _review_candidate_payload(
            candidate_id=f"subtitle-issue-{index + 1}",
            category="content",
            start_sec=start,
            end_sec=end,
            priority="low" if str(item.get("confidence") or "").lower() == "low" else "medium",
            problem=subtitle_problem,
            direct_fix=str(
                item.get("suggestion")
                or "把字幕改成和口播一致，错字、漏字和事实词都要修正。"
            ).strip(),
            where_to_change=where_to_change,
        )
        if result_item:
            result.append(result_item)

    selling_point_coverage = video_ai_result.get("selling_point_coverage") or []
    for index, item in enumerate(selling_point_coverage):
        if not isinstance(item, dict):
            continue
        strength = str(item.get("strength") or "").strip().lower()
        conveyed = bool(item.get("conveyed", True))
        if conveyed and strength not in {"weak", "partial"}:
            continue

        selling_point = str(item.get("content") or "").strip()
        if not selling_point:
            continue

        timestamp = _parse_timestamp_seconds(item.get("timestamp"))
        evidence = str(item.get("evidence") or "").strip()
        if timestamp is not None:
            start, end = _time_range_from_timestamp(timestamp, duration, span=8)
            where_to_change = f"{_format_mmss(timestamp)} 附近内容"
        else:
            start, end = _bucket_range_from_label(
                evidence or selling_point,
                duration,
                index=index,
                total=max(1, len(selling_point_coverage)),
            )
            where_to_change = "对应时间段内容"

        result_item = _review_candidate_payload(
            candidate_id=f"selling-point-{index + 1}",
            category="content",
            start_sec=start,
            end_sec=end,
            priority="medium" if conveyed else "high",
            problem=(
                f"核心卖点提到了但没讲透：{selling_point}"
                if conveyed
                else f"核心卖点没有讲清：{selling_point}"
            ),
            direct_fix=(
                "把这一句从带过改成明确表达，关键词单独说清。"
                if conveyed
                else "在这段补一句明确卖点，不要只带过或只讲感受。"
            ),
            where_to_change=where_to_change,
            suggested_copy=f"建议补上：{selling_point}",
            evidence=evidence,
        )
        if result_item:
            result.append(result_item)

    for index, violation in enumerate((video_ai_result.get("violations") or [])):
        if not isinstance(violation, dict):
            continue
        violation_text = " ".join(
            str(violation.get(key) or "").strip()
            for key in ("type", "content", "suggestion", "source")
            if str(violation.get(key) or "").strip()
        )
        if not violation_text:
            continue

        category = _infer_candidate_category(
            " ".join(
                str(violation.get(key) or "").strip()
                for key in ("type", "content", "suggestion", "source", "dimension")
                if str(violation.get(key) or "").strip()
            )
        )
        if violation.get("timestamp") is not None:
            start, end = _time_range_from_timestamp(violation.get("timestamp"), duration)
        else:
            start, end = _bucket_range_from_label(
                violation_text,
                duration,
                index=index,
                total=max(1, len(video_ai_result.get("violations") or [])),
            )

        where_label = str(violation.get("type") or "").strip() or str(violation.get("source") or "").strip()
        where_label = _humanize_where_to_change(
            where_label,
            category,
            problem=str(violation.get("content") or ""),
            source=str(violation.get("source") or ""),
            timestamp=violation.get("timestamp"),
        )

        script_text = str(violation.get("script_text") or "").strip()
        actual_text = str(violation.get("actual_text") or "").strip()
        result_item = _review_candidate_payload(
            candidate_id=f"violation-{index + 1}",
            category=category,
            start_sec=start,
            end_sec=end,
            priority="high" if _normalize_severity(violation.get("severity")) == "high" else "medium",
            problem=str(violation.get("content") or "这一段表达还有问题").strip(),
            direct_fix=_clean_direct_fix_text(_build_violation_fix(violation, category)),
            where_to_change=where_label or _format_where_to_change("", category),
            suggested_copy=f"建议改成：{script_text}" if script_text else "",
            evidence=actual_text if actual_text and actual_text != script_text else "",
        )
        if result_item:
            result.append(result_item)

    for index, item in enumerate((video_ai_result.get("new_content_analysis") or [])):
        if item.get("compliant", True) and item.get("enhances", True):
            continue
        start, end = _bucket_range_from_label(str(item.get("content") or ""), duration, index=index, total=max(1, len(video_ai_result.get("new_content_analysis") or [])))
        result_item = _review_candidate_payload(
            candidate_id=f"new-content-{index + 1}",
            category="content",
            start_sec=start,
            end_sec=end,
            priority="medium",
            problem=str(item.get("note") or "新增内容没有有效增强表达").strip(),
            direct_fix="请删掉这句无效补充，或改成和产品卖点更相关的表达。",
            where_to_change="对应时间段新增内容",
            suggested_copy=(
                f"原句：{str(item.get('content') or '').strip()}"
                if str(item.get("content") or "").strip()
                else ""
            ),
        )
        if result_item:
            result.append(result_item)

    for index, violation in enumerate((audio_analysis.get("violations") or [])):
        category = _infer_candidate_category(
            f"{violation.get('type', '')} {violation.get('content', '')} {violation.get('suggestion', '')}"
        )
        start, end = _bucket_range_from_label(
            f"{violation.get('type', '')} {violation.get('content', '')}",
            duration,
            index=index,
            total=max(1, len(audio_analysis.get("violations") or [])),
        )
        result_item = _review_candidate_payload(
            candidate_id=f"audio-violation-{index + 1}",
            category=category,
            start_sec=start,
            end_sec=end,
            priority="high" if str(violation.get("severity") or "") == "high" else "medium",
            problem=str(violation.get("content") or "这一段音轨表达还有问题").strip(),
            direct_fix=_clean_direct_fix_text(str(
                violation.get("suggestion")
                or _fallback_direct_fix(str(violation.get("content") or ""), category)
            ).strip()),
            where_to_change=_humanize_where_to_change(
                str(violation.get("type") or ""),
                category,
                problem=str(violation.get("content") or ""),
            ),
        )
        if result_item:
            result.append(result_item)

    return _dedupe_review_candidates([*existing_candidates, *result])


def _normalize_creator_card_text(text: str | None, max_length: int) -> str:
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    normalized = normalized.strip("：:；;，,。!！?？ ")
    if not normalized:
        return ""
    if len(normalized) <= max_length:
        return normalized
    truncated = normalized[: max(1, max_length - 1)].rstrip("：:；;，,。!！?？ ")
    return f"{truncated}…"


def _extract_brief_selling_points(brief: Brief | None) -> list[str]:
    if not brief or not isinstance(brief.selling_points, list):
        return []

    points: list[tuple[int, str]] = []
    priority_order = {"core": 0, "recommended": 1, "reference": 2}
    for item in brief.selling_points:
        if isinstance(item, dict):
            content = _normalize_prompt_text(item.get("content"))
            priority = _normalize_prompt_text(item.get("priority")).lower() or "recommended"
        else:
            content = _normalize_prompt_text(item)
            priority = "recommended"
        if content:
            points.append((priority_order.get(priority, 1), content))

    return [content for _, content in sorted(points, key=lambda item: (item[0], item[1]))[:6]]


def _build_visual_brief_reference_context(brief: Brief | None) -> dict:
    selling_points = _extract_brief_selling_points(brief)
    brand_rules: list[str] = []
    if brief and brief.brand_tone:
        brand_rules.append(_normalize_creator_card_text(f"品牌调性：{brief.brand_tone}", 48))
    if brief and brief.other_requirements:
        brand_rules.append(_normalize_creator_card_text(f"其他要求：{brief.other_requirements}", 52))

    rubric = brief.creative_rubric if brief and isinstance(brief.creative_rubric, dict) else {}
    if isinstance(rubric, dict):
        for key in ("tone", "content_style", "structure"):
            dim = rubric.get(key)
            if not isinstance(dim, dict):
                continue
            target = _normalize_prompt_text(dim.get("target") or dim.get("name"))
            if target:
                brand_rules.append(_normalize_creator_card_text(f"{key}：{target}", 42))

    must_keep_terms = []
    if brief and brief.product_name:
        must_keep_terms.append(str(brief.product_name).strip())
    must_keep_terms.extend(selling_points[:4])

    return {
        "brief_core_message": _build_brief_model_summary(brief),
        "key_selling_points": selling_points,
        "brand_rules": [item for item in brand_rules if item][:4],
        "must_keep_terms": [item for item in must_keep_terms if item][:6],
        "forbidden_visual_styles": ["后台面板感", "表格感", "密集小字", "竖排文字"],
        "brand_colors": [],
    }


def _build_multimodal_signals(video_ai_result: dict | None) -> dict:
    audio_analysis = _normalize_audio_track_analysis(
        video_ai_result.get("audio_track_analysis") if isinstance(video_ai_result, dict) else None
    )
    delivery = audio_analysis.get("delivery_signals") or {}
    bgm = audio_analysis.get("bgm") or {}
    environment = audio_analysis.get("environment") or {}
    return {
        "voice": {
            "tone": str(delivery.get("tone") or "").strip(),
            "emotion": str(delivery.get("emotion") or "").strip(),
            "energy_level": str(delivery.get("energy_level") or "").strip(),
            "pacing": str(delivery.get("pacing") or "").strip(),
            "summary": str(delivery.get("summary") or "").strip(),
        },
        "bgm": {
            "style": str(bgm.get("style") or "").strip(),
            "intensity": str(bgm.get("intensity") or "").strip(),
            "fit": str(bgm.get("fit") or "").strip(),
            "summary": str(bgm.get("summary") or "").strip(),
        },
        "environment": {
            "has_noise": bool(environment.get("has_noise")),
            "noise_types": _normalize_text_list(environment.get("noise_types")),
            "clarity_score": environment.get("clarity_score"),
            "summary": str(environment.get("summary") or "").strip(),
        },
    }


def _build_video_review_context(
    *,
    candidates: list[dict],
    video_ai_result: dict | None,
) -> dict:
    transcript = _normalize_prompt_text(
        video_ai_result.get("speech_transcript") if isinstance(video_ai_result, dict) else ""
    )
    multimodal_signals = _build_multimodal_signals(video_ai_result)
    categories = []
    category_labels = {"voice": "口播", "bgm": "BGM", "content": "内容补强"}
    for key in ("voice", "bgm", "content"):
        if any(item.get("category") == key for item in candidates):
            categories.append(category_labels[key])

    current_video_summary = _normalize_creator_card_text(
        (
            f"当前视频已识别 {len(candidates)} 处待调整问题，主要集中在"
            f"{'、'.join(categories) if categories else '执行表达'}。"
        ),
        60,
    )
    current_script_summary = _normalize_creator_card_text(transcript, 80) if transcript else ""
    current_main_issues = [
        _normalize_creator_card_text(candidate.get("problem"), 42)
        for candidate in candidates[:4]
        if _normalize_creator_card_text(candidate.get("problem"), 42)
    ]

    timeline_observations = []
    for candidate in candidates[:6]:
        category = candidate.get("category", "content")
        main_visual = {
            "voice": "人物口播",
            "bgm": "音乐节奏",
            "content": "产品/画面信息",
        }.get(category, "画面信息")
        timeline_observations.append({
            "time_range": candidate.get("time_range", ""),
            "current_state": _normalize_creator_card_text(
                candidate.get("evidence") or candidate.get("problem") or "",
                52,
            ),
            "main_visual": main_visual,
            "main_message": _normalize_creator_card_text(
                candidate.get("where_to_change") or candidate.get("direct_fix") or "",
                36,
            ),
        })

    return {
        "current_video_summary": current_video_summary,
        "current_script_summary": current_script_summary,
        "current_strengths": [],
        "current_main_issues": current_main_issues,
        "timeline_observations": timeline_observations,
        "multimodal_signals": multimodal_signals,
    }


def _build_review_diagnosis(candidates: list[dict]) -> dict:
    diagnosis_blocks = []
    for candidate in candidates:
        diagnosis_blocks.append({
            "block_id": str(candidate.get("id") or f"block-{len(diagnosis_blocks) + 1}"),
            "time_range": str(candidate.get("time_range") or "").strip(),
            "current_state": _normalize_creator_card_text(
                candidate.get("evidence") or candidate.get("where_to_change") or candidate.get("problem") or "",
                48,
            ),
            "expected_state": _normalize_creator_card_text(
                candidate.get("direct_fix") or candidate.get("suggested_copy") or "",
                48,
            ),
            "main_gap": _normalize_creator_card_text(candidate.get("problem") or "", 42),
            "priority": candidate.get("priority") if candidate.get("priority") in {"high", "medium", "low"} else "medium",
            "source_candidate_ids": [str(candidate.get("id") or "")],
        })
    return {"diagnosis_blocks": diagnosis_blocks}


def _build_timeline_blocks(
    *,
    candidates: list[dict],
    video_ai_result: dict | None,
    selling_points: list[str],
) -> list[dict]:
    multimodal_signals = _build_multimodal_signals(video_ai_result)
    voice_signal = multimodal_signals.get("voice") or {}
    bgm_signal = multimodal_signals.get("bgm") or {}
    emotion_values = _normalize_text_list(voice_signal.get("emotion"))[:3]
    blocks: list[dict] = []
    for candidate in candidates:
        category = candidate.get("category", "content")
        direct_fix = _normalize_creator_card_text(candidate.get("direct_fix") or "", 52)
        suggested_copy = _normalize_creator_card_text(candidate.get("suggested_copy") or "", 42)
        blocks.append({
            "block_id": str(candidate.get("id") or f"timeline-{len(blocks) + 1}"),
            "time_range": str(candidate.get("time_range") or "").strip(),
            "segment_title": _normalize_creator_card_text(
                candidate.get("where_to_change") or "修改建议",
                16,
            ) or "修改建议",
            "current_problem": _normalize_creator_card_text(candidate.get("problem") or "", 48),
            "content_task": direct_fix,
            "voice_direction": (
                direct_fix
                if category == "voice"
                else _normalize_creator_card_text(voice_signal.get("summary") or suggested_copy, 40)
            ),
            "bgm_direction": (
                _normalize_creator_card_text(
                    candidate.get("bgm_action") or candidate.get("direct_fix") or "",
                    40,
                )
                if category == "bgm"
                else _normalize_creator_card_text(bgm_signal.get("summary") or "", 40)
            ),
            "emotion": emotion_values,
            "must_keep_selling_points": selling_points[:3],
            "visual_anchor": {
                "voice": "人物口播气泡 / 情绪标记",
                "bgm": "音乐波形 / 节奏箭头",
                "content": "产品特写 / 关键信息贴纸",
            }.get(category, "画面标注"),
            "source_candidate_ids": [str(candidate.get("id") or "")],
        })
    return blocks


def _build_transition_blocks(timeline_blocks: list[dict]) -> list[dict]:
    transitions: list[dict] = []
    for previous, current in zip(timeline_blocks, timeline_blocks[1:]):
        previous_time = str(previous.get("time_range") or "").strip()
        current_title = _normalize_creator_card_text(current.get("segment_title") or "", 18)
        transitions.append({
            "time_range": previous_time,
            "instruction": _normalize_creator_card_text(
                f"上一段收住后，顺着切到“{current_title or '下一段重点'}”。",
                36,
            ),
        })
    return transitions[:3]


def _build_page_plan(timeline_blocks: list[dict]) -> dict:
    return _build_page_plan_with_layout(timeline_blocks, layout_variant="portrait")


def _build_page_plan_with_layout(
    timeline_blocks: list[dict],
    *,
    layout_variant: str = "portrait",
) -> dict:
    block_count = max(1, len(timeline_blocks))
    page_count = max(1, (block_count + 1) // 2)
    return {
        "page_count": page_count,
        "max_main_blocks_per_page": 2,
        "max_info_blocks_per_segment": 3,
        "ratio": "16:9" if layout_variant == "landscape" else "4:5",
        "layout_variant": layout_variant,
    }


def _build_creator_visual_brief(
    *,
    task_id: str,
    task_name: str,
    project_name: str,
    candidates: list[dict],
    video_ai_result: dict | None,
    brief: Brief | None,
    layout_variant: str = "portrait",
    style_variant: str = "",
    feedback_instruction: str = "",
) -> dict:
    reference_context = _build_visual_brief_reference_context(brief)
    selling_points = reference_context.get("key_selling_points") or []
    timeline_blocks = _build_timeline_blocks(
        candidates=candidates,
        video_ai_result=video_ai_result,
        selling_points=selling_points,
    )
    return {
        "meta": {
            "task_id": task_id,
            "task_name": task_name,
            "project_name": project_name,
            "product_name": (brief.product_name if brief else "") or "",
            "page_title": _build_creator_card_title(task_name, project_name).replace("修改图", "修改指导图"),
            "objective": "把现有视频审核结果整理成适合发给达人的修改指导图",
            "audience": "达人、剪辑、代理商",
        },
        "current_video_context": _build_video_review_context(
            candidates=candidates,
            video_ai_result=video_ai_result,
        ),
        "reference_context": reference_context,
        "diagnosis_context": _build_review_diagnosis(candidates),
        "timeline_blocks": timeline_blocks,
        "transition_blocks": _build_transition_blocks(timeline_blocks),
        "product_assets": {
            "packshot_urls": [],
            "reference_image_urls": [],
            "optional_icons": [],
        },
        "page_plan": _build_page_plan_with_layout(
            timeline_blocks,
            layout_variant=layout_variant,
        ),
        "visual_preferences": {
            "layout_variant": layout_variant,
            "style_variant": style_variant or "editorial_comic_guidance",
            "feedback_instruction": feedback_instruction,
        },
        "hard_constraints": [
            "不能改时间段",
            "不能改产品名",
            "不能改核心卖点",
            "不能改段落顺序",
            "必须是横排中文",
            "优先让达人看懂怎么改",
        ],
    }


def _build_creator_image_generation(
    *,
    creator_visual_brief: dict,
    previous_generation: dict | None,
    layout_variant: str = "",
    style_variant: str = "",
    feedback_instruction: str = "",
    feedback_type: str = "other",
    target_page: int | None = None,
) -> dict:
    previous = previous_generation if isinstance(previous_generation, dict) else {}
    previous_iteration = previous.get("iteration_no")
    try:
        previous_iteration = int(previous_iteration)
    except (TypeError, ValueError):
        previous_iteration = 0

    feedback_history = previous.get("feedback_history")
    if not isinstance(feedback_history, list):
        feedback_history = []

    next_iteration = previous_iteration + 1
    selected_layout = layout_variant or str(previous.get("layout_variant") or "portrait")
    selected_style = style_variant or str(previous.get("style_variant") or "editorial_comic_guidance")
    normalized_feedback = _normalize_prompt_text(feedback_instruction)
    if normalized_feedback:
        feedback_history = [
            *feedback_history,
            {
                "iteration_no": next_iteration,
                "target_page": target_page,
                "target_block_ids": [],
                "feedback_type": feedback_type or "other",
                "instruction": normalized_feedback,
                "created_at": datetime.utcnow().isoformat(),
            },
        ]

    return {
        "generation_id": str(previous.get("generation_id") or f"guidance-{uuid4().hex[:12]}"),
        "brief_version": "v0.1",
        "prompt_version": "v0.1",
        "iteration_no": next_iteration,
        "input_brief": creator_visual_brief,
        "generated_pages": previous.get("generated_pages") if isinstance(previous.get("generated_pages"), list) else [],
        "layout_variant": selected_layout,
        "style_variant": selected_style,
        "status": "regenerating" if target_page and previous.get("generated_pages") else "draft",
        "feedback_history": feedback_history,
        "fallback_reason": "",
    }


def _paginate_timeline_blocks(
    timeline_blocks: list[dict],
    *,
    page_size: int = 2,
) -> list[list[dict]]:
    if not timeline_blocks:
        return [[]]
    return [
        timeline_blocks[index:index + page_size]
        for index in range(0, len(timeline_blocks), page_size)
    ]


def _build_creator_image_prompt(
    *,
    creator_visual_brief: dict,
    page_index: int,
    total_pages: int,
    page_blocks: list[dict],
) -> str:
    meta = creator_visual_brief.get("meta") or {}
    reference_context = creator_visual_brief.get("reference_context") or {}
    visual_preferences = creator_visual_brief.get("visual_preferences") or {}
    transition_blocks = creator_visual_brief.get("transition_blocks") or []

    block_lines: list[str] = []
    for block in page_blocks:
        emotions = "、".join(_normalize_text_list(block.get("emotion"))) or "自然"
        selling_points = "、".join(_normalize_text_list(block.get("must_keep_selling_points"))) or "无"
        block_lines.append(
            "\n".join([
                f"- 时间段：{block.get('time_range') or ''}",
                f"  小标题：{block.get('segment_title') or ''}",
                f"  当前问题：{block.get('current_problem') or ''}",
                f"  直接改法：{block.get('content_task') or ''}",
                f"  口播方向：{block.get('voice_direction') or ''}",
                f"  BGM方向：{block.get('bgm_direction') or ''}",
                f"  情绪：{emotions}",
                f"  必须保留卖点：{selling_points}",
                f"  视觉锚点：{block.get('visual_anchor') or ''}",
            ])
        )

    transition_lines = [
        _normalize_prompt_text(item.get("instruction"))
        for item in transition_blocks[:2]
        if _normalize_prompt_text(item.get("instruction"))
    ]
    must_keep_terms = "、".join(_normalize_text_list(reference_context.get("must_keep_terms"))) or "无"
    brief_message = _normalize_prompt_text(reference_context.get("brief_core_message")) or "无"
    brand_rules = "；".join(_normalize_text_list(reference_context.get("brand_rules"))) or "无"
    feedback_instruction = _normalize_prompt_text(visual_preferences.get("feedback_instruction")) or "无"
    layout_variant = visual_preferences.get("layout_variant") or creator_visual_brief.get("page_plan", {}).get("layout_variant") or "portrait"
    style_variant = visual_preferences.get("style_variant") or "editorial_comic_guidance"

    return f"""你是一名擅长营销内容指导图的视觉设计师，请直接生成一张中文“视频修改指导图”。

要求：
1. 这不是审核报告，也不是后台面板，而是发给达人和剪辑的修改指导图。
2. 所有中文必须横排，可读性优先。
3. 页面要有参考图那种分镜感、漫画感、时间轴感，但不要表格感。
4. 必须显著展示时间段和直接改法。
5. 不能改动产品名、卖点、时间段和段落顺序。
6. 如果用户给了反馈，优先满足反馈。

页面信息：
- 页码：第 {page_index} / {total_pages} 页
- 项目：{meta.get("project_name") or ""}
- 标题：{meta.get("page_title") or ""}
- 产品：{meta.get("product_name") or ""}
- 版式：{"横版 16:9" if layout_variant == "landscape" else "竖版 4:5"}
- 风格：{style_variant}
- Brief 要点：{brief_message}
- 品牌规则：{brand_rules}
- 必须保留词：{must_keep_terms}
- 用户反馈：{feedback_instruction}

本页时间段内容：
{chr(10).join(block_lines)}

过渡提示：
{"；".join(transition_lines) if transition_lines else "按时间顺序自然衔接即可"}

视觉要求：
- 像导演给达人的修改说明页
- 可用插图、气泡、箭头、贴纸、产品锚点
- 不要后台 UI，不要竖排，不要密集小字
- 让人一眼看懂“哪里有问题、怎么改”
"""


def _guess_image_extension(content_type: str) -> str:
    normalized = str(content_type or "").strip().lower()
    mapping = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    return mapping.get(normalized, "png")


def _upload_generated_image_bytes(
    *,
    file_key: str,
    content: bytes,
    content_type: str,
) -> str:
    if is_local_file_storage_enabled():
        save_bytes(file_key, content)
        return get_file_url(file_key)

    if not settings.TOS_ACCESS_KEY_ID or not settings.TOS_SECRET_ACCESS_KEY:
        return ""

    import tos as tos_sdk

    region = settings.TOS_REGION
    endpoint = settings.TOS_ENDPOINT or f"tos-cn-{region}.volces.com"
    client = tos_sdk.TosClientV2(
        ak=settings.TOS_ACCESS_KEY_ID,
        sk=settings.TOS_SECRET_ACCESS_KEY,
        endpoint=f"https://{endpoint}",
        region=region,
    )
    client.put_object(
        bucket=settings.TOS_BUCKET_NAME,
        key=file_key,
        content=content,
        content_type=content_type,
    )
    return get_file_url(file_key)


def _persist_generated_image_asset(
    *,
    image_source: str,
    task_id: str,
    generation_id: str,
    page_index: int,
) -> str:
    source = str(image_source or "").strip()
    if not source or not source.startswith("data:image/"):
        return source

    header, _, payload = source.partition(",")
    if not payload or ";base64" not in header:
        return source

    content_type = header[5:].split(";", 1)[0].strip().lower() or "image/png"
    try:
        normalized_payload = payload.strip()
        padding = (-len(normalized_payload)) % 4
        if padding:
            normalized_payload += "=" * padding
        image_bytes = base64.b64decode(normalized_payload)
    except (ValueError, binascii.Error):
        logger.warning("达人修改图 data URL 解码失败，保留原始内容 task=%s page=%s", task_id, page_index)
        return source

    extension = _guess_image_extension(content_type)
    file_key = (
        f"generated/creator-guidance/{task_id}/{generation_id}/"
        f"page-{page_index}.{extension}"
    )
    try:
        stored_url = _upload_generated_image_bytes(
            file_key=file_key,
            content=image_bytes,
            content_type=content_type,
        )
    except Exception as exc:
        logger.warning("达人修改图图片落盘失败，保留 data URL: %s", exc)
        return source

    return stored_url or source


async def _generate_creator_guidance_images(
    *,
    ai_client,
    image_model: str,
    creator_visual_brief: dict,
    creator_image_generation: dict,
    task_id: str,
    target_page: int | None = None,
) -> dict:
    if not ai_client or not image_model:
        creator_image_generation["status"] = "failed"
        creator_image_generation["fallback_reason"] = "未配置可用的图片生成模型"
        return creator_image_generation

    timeline_blocks = creator_visual_brief.get("timeline_blocks") or []
    pages = _paginate_timeline_blocks(timeline_blocks, page_size=2)
    layout_variant = creator_image_generation.get("layout_variant") or "portrait"
    size = "1536x1024" if layout_variant == "landscape" else "1024x1536"
    existing_pages = creator_image_generation.get("generated_pages")
    if not isinstance(existing_pages, list):
        existing_pages = []
    existing_page_map = {
        int(page.get("page_index")): page
        for page in existing_pages
        if isinstance(page, dict) and str(page.get("page_index") or "").isdigit()
    }
    if target_page is not None:
        page_numbers = [target_page]
    else:
        page_numbers = list(range(1, len(pages) + 1))

    generated_page_map: dict[int, dict] = dict(existing_page_map)
    try:
        for page_index in page_numbers:
            if page_index < 1 or page_index > len(pages):
                continue
            page_blocks = pages[page_index - 1]
            prompt = _build_creator_image_prompt(
                creator_visual_brief=creator_visual_brief,
                page_index=page_index,
                total_pages=len(pages),
                page_blocks=page_blocks,
            )
            result = await ai_client.image_generation(
                prompt=prompt,
                model=image_model,
                size=size,
                quality="medium",
                n=1,
            )
            if not result.images:
                continue
            page_summary = "；".join(
                str(block.get("segment_title") or "").strip()
                for block in page_blocks
                if str(block.get("segment_title") or "").strip()
            )
            image_url = _persist_generated_image_asset(
                image_source=result.images[0],
                task_id=task_id,
                generation_id=str(creator_image_generation.get("generation_id") or "guidance"),
                page_index=page_index,
            )
            generated_page_map[page_index] = {
                "page_index": page_index,
                "image_url": image_url,
                "image_width": 1536 if layout_variant == "landscape" else 1024,
                "image_height": 1024 if layout_variant == "landscape" else 1536,
                "page_summary": _normalize_creator_card_text(page_summary, 42),
            }
    except Exception as exc:
        logger.warning("生成达人修改图图片失败，回退文字版: %s", exc)
        creator_image_generation["status"] = "failed"
        creator_image_generation["fallback_reason"] = str(exc)
        creator_image_generation["generated_pages"] = []
        return creator_image_generation

    generated_pages = [
        generated_page_map[index]
        for index in sorted(generated_page_map)
        if 1 <= index <= len(pages)
    ]
    creator_image_generation["generated_pages"] = generated_pages
    if generated_pages:
        creator_image_generation["status"] = "reviewing"
        creator_image_generation["fallback_reason"] = ""
    else:
        creator_image_generation["status"] = "failed"
        creator_image_generation["fallback_reason"] = "图片生成结果为空"
    return creator_image_generation


def _build_creator_card_title(task_name: str, project_name: str) -> str:
    source = _normalize_creator_card_text(project_name or task_name, 18)
    return f"{source} 修改图" if source else "本次视频修改图"


def _build_creator_card_summary(candidates: list[dict]) -> str:
    total = len(candidates)
    if total <= 0:
        return "按时间顺序处理即可。"

    labels: list[str] = []
    category_labels = {
        "voice": "口播",
        "bgm": "BGM",
        "content": "内容补强",
    }
    for key in ("voice", "bgm", "content"):
        if any(item.get("category") == key for item in candidates):
            labels.append(category_labels[key])

    scope = "、".join(labels) if labels else "本次内容"
    return _normalize_creator_card_text(
        f"本次共 {total} 处修改，按时间顺序处理{scope}即可。",
        34,
    ) or "按时间顺序处理即可。"


def _build_creator_card_priority(candidate: dict) -> str:
    where = _normalize_creator_card_text(
        candidate.get("where_to_change") or candidate.get("time_range") or "",
        12,
    )
    fix = _normalize_creator_card_text(candidate.get("direct_fix") or candidate.get("problem") or "", 24)
    if where and fix:
        return _normalize_creator_card_text(f"{where}：{fix}", 32)
    return fix or where or "按时间顺序处理"


def _normalize_creator_card_item(
    item: dict | None,
    fallback_item: dict,
) -> dict:
    current = item if isinstance(item, dict) else {}
    time_range = str(current.get("time_range") or fallback_item.get("time_range") or "").strip()
    title = _normalize_creator_card_text(
        current.get("title") or fallback_item.get("title") or "修改建议",
        14,
    ) or "修改建议"
    problem = _normalize_creator_card_text(
        current.get("problem") or fallback_item.get("problem") or "",
        48,
    )
    fix = _normalize_creator_card_text(
        current.get("fix") or fallback_item.get("fix") or "",
        52,
    )
    example = _normalize_creator_card_text(
        current.get("example") or fallback_item.get("example") or "",
        42,
    )

    return {
        "time_range": time_range,
        "title": title,
        "problem": problem,
        "fix": fix,
        "example": example,
    }


def _normalize_creator_card_content(
    *,
    task_name: str,
    project_name: str,
    candidates: list[dict],
    parsed: dict | None,
    fallback: dict,
) -> dict:
    fallback_sections = fallback.get("sections") or {}
    parsed_sections = parsed.get("sections") if isinstance(parsed, dict) else {}
    normalized_sections: dict[str, list[dict]] = {}

    for key in ("voice", "bgm", "content"):
        fallback_items = [
            item for item in (fallback_sections.get(key) or [])
            if isinstance(item, dict) and str(item.get("time_range") or "").strip()
        ]
        parsed_items = [
            item for item in ((parsed_sections or {}).get(key) or [])
            if isinstance(item, dict) and str(item.get("time_range") or "").strip()
        ]
        fallback_by_time = {
            str(item.get("time_range") or "").strip(): item
            for item in fallback_items
        }

        merged_items: list[dict] = []
        seen_times: set[str] = set()

        for item in parsed_items:
            time_range = str(item.get("time_range") or "").strip()
            fallback_item = fallback_by_time.get(time_range)
            if not fallback_item or time_range in seen_times:
                continue
            merged_items.append(_normalize_creator_card_item(item, fallback_item))
            seen_times.add(time_range)

        for fallback_item in fallback_items:
            time_range = str(fallback_item.get("time_range") or "").strip()
            if time_range in seen_times:
                continue
            merged_items.append(_normalize_creator_card_item(None, fallback_item))
            seen_times.add(time_range)

        normalized_sections[key] = merged_items

    parsed_priorities = []
    if isinstance(parsed, dict):
        parsed_priorities = [
            _normalize_creator_card_text(item, 32)
            for item in (parsed.get("priorities") or [])
            if _normalize_creator_card_text(item, 32)
        ]

    fallback_priorities = [
        _build_creator_card_priority(candidate)
        for candidate in candidates[:3]
        if _build_creator_card_priority(candidate)
    ]
    priorities = (parsed_priorities or fallback_priorities)[:3]

    return {
        "title": _build_creator_card_title(task_name, project_name),
        "summary": _build_creator_card_summary(candidates),
        "priorities": priorities,
        "sections": normalized_sections,
    }


def _build_creator_card_content_fallback(
    task_name: str,
    project_name: str,
    candidates: list[dict],
) -> dict:
    grouped = {"voice": [], "bgm": [], "content": []}
    for candidate in candidates:
        grouped.get(candidate.get("category", "content"), grouped["content"]).append(candidate)

    sections: dict[str, list[dict]] = {"voice": [], "bgm": [], "content": []}
    priorities = [
        _build_creator_card_priority(candidate)
        for candidate in candidates[:3]
        if _build_creator_card_priority(candidate)
    ]

    for key in sections:
        for index, candidate in enumerate(grouped.get(key, []), start=1):
            example = ""
            if key == "bgm" and candidate.get("bgm_action"):
                example = f"操作建议：{candidate.get('bgm_action', '')}".strip()
            elif candidate.get("suggested_copy"):
                example = str(candidate.get("suggested_copy") or "").strip()
            sections[key].append({
                "time_range": candidate.get("time_range", ""),
                "title": _normalize_creator_card_text(
                    candidate.get("where_to_change", f"第 {index} 条建议"),
                    14,
                ),
                "problem": _normalize_creator_card_text(candidate.get("problem", ""), 48),
                "fix": _normalize_creator_card_text(candidate.get("direct_fix", ""), 52),
                "example": _normalize_creator_card_text(example.strip(), 42),
            })

    return {
        "title": _build_creator_card_title(task_name, project_name),
        "summary": _build_creator_card_summary(candidates),
        "priorities": priorities[:3],
        "sections": sections,
    }


async def _generate_creator_card_content(
    *,
    ai_client,
    text_model: str,
    task_name: str,
    project_name: str,
    candidates: list[dict],
) -> dict:
    fallback = _build_creator_card_content_fallback(task_name, project_name, candidates)
    if not ai_client or not candidates:
        return fallback

    prompt = f"""你是品牌项目组的资深导演，请把代理商已经勾选好的修改项整理成一份适合发给达人和剪辑的“修改图文案”。

要求：
1. 只允许使用输入里已经给出的时间段和问题，不要新增问题，不要改动时间。
2. 输出必须按三个分区组织：口播修改、BGM 修改、内容补强。
3. 每条内容要写得像执行单，直接、专业、易懂，不要写后台分析术语。
4. 每条内容控制在短句，适合做成图卡片。
5. 标题控制在 12 个中文词以内，总摘要控制在 30 个中文词以内。
6. 每条的小标题尽量控制在 8 个中文词以内；problem / fix / example 都要短，不要写成长段分析。
5. 所有输出必须是中文。

项目信息：
- 项目名：{project_name or "未命名项目"}
- 任务名：{task_name or "未命名任务"}

已选候选项：
{json.dumps(candidates, ensure_ascii=False)}

请以 JSON 返回：
{{
  "title": "修改图标题",
  "summary": "一段总览摘要",
  "priorities": ["优先修改点1", "优先修改点2"],
  "sections": {{
    "voice": [
      {{
        "time_range": "0:00 - 0:15",
        "title": "小标题",
        "problem": "问题描述",
        "fix": "直接修改建议",
        "example": "可选示例"
      }}
    ],
    "bgm": [],
    "content": []
  }}
}}"""

    try:
        response = await ai_client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model=text_model,
            temperature=0.2,
            max_tokens=1800,
        )
        parsed = _robust_json_parse(response.content)
        if not isinstance(parsed, dict):
            return fallback

        sections = parsed.get("sections") or {}
        normalized_sections = {}
        for key in ("voice", "bgm", "content"):
            normalized_items = []
            for item in (sections.get(key) or []):
                if not isinstance(item, dict):
                    continue
                time_range = str(item.get("time_range") or "").strip()
                if time_range not in {candidate.get("time_range") for candidate in candidates if candidate.get("category") == key}:
                    continue
                normalized_items.append({
                    "time_range": time_range,
                    "title": str(item.get("title") or "修改建议").strip(),
                    "problem": str(item.get("problem") or "").strip(),
                    "fix": str(item.get("fix") or "").strip(),
                    "example": str(item.get("example") or "").strip(),
                })
            normalized_sections[key] = normalized_items

        if not any(normalized_sections.values()):
            return fallback
        return _normalize_creator_card_content(
            task_name=task_name,
            project_name=project_name,
            candidates=candidates,
            parsed={
                "title": parsed.get("title"),
                "summary": parsed.get("summary"),
                "priorities": parsed.get("priorities"),
                "sections": normalized_sections,
            },
            fallback=fallback,
        )
    except Exception as exc:
        logger.warning("生成达人修改图文案失败，回退本地模板: %s", exc)
        return fallback


def _build_video_ai_result_payload(video_ai_result: dict | None, duration: int | None) -> dict | None:
    if not isinstance(video_ai_result, dict):
        return video_ai_result
    payload = dict(video_ai_result)
    payload["audio_track_analysis"] = _repair_audio_track_analysis_with_transcript(
        payload.get("audio_track_analysis"),
        payload.get("speech_transcript"),
    )
    payload["review_candidates"] = _build_review_candidates(payload, duration)
    return payload


def _resolve_project_ai_scope_id(project: Project | None) -> str:
    if not project:
        return ""
    return str(project.config_scope_id or project.brand_id or "").strip()


def _guess_image_extension_from_url(url: str) -> str:
    normalized = str(url or "").lower()
    if ".webp" in normalized:
        return "webp"
    if ".jpg" in normalized or ".jpeg" in normalized:
        return "jpg"
    if ".gif" in normalized:
        return "gif"
    return "png"


def _build_creator_guidance_export_basename(
    *,
    project_name: str = "",
    creator_name: str = "",
    iteration_no: int | None = None,
) -> str:
    parts: list[str] = []
    normalized_project_name = _normalize_creator_card_text(project_name, 24)
    normalized_creator_name = _normalize_creator_card_text(creator_name, 18)
    if normalized_project_name:
        parts.append(normalized_project_name)
    if normalized_creator_name:
        parts.append(normalized_creator_name)
    parts.append("达人修改图")
    if iteration_no and iteration_no > 0:
        parts.append(f"第{iteration_no}轮")
    return "-".join(parts) or "达人修改图"


async def _download_generated_image_bytes(url: str) -> bytes | None:
    direct_bytes = download_from_tos(url)
    if direct_bytes:
        return direct_bytes

    signed_url = ensure_signed_url(url, expire_seconds=600)
    if not signed_url:
        return None

    try:
        import httpx

        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(signed_url)
            response.raise_for_status()
            return response.content
    except Exception as exc:
        logger.warning("下载达人修改图导出源失败: %s", exc)
        return None


async def _build_creator_guidance_export_zip(
    *,
    project_name: str = "",
    creator_name: str = "",
    iteration_no: int | None = None,
    generated_pages: list[dict],
) -> bytes:
    buffer = io.BytesIO()
    archive_name = _build_creator_guidance_export_basename(
        project_name=project_name,
        creator_name=creator_name,
        iteration_no=iteration_no,
    )

    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for page in generated_pages:
            page_index = int(page.get("page_index") or 0)
            image_url = str(page.get("image_url") or "").strip()
            if page_index <= 0 or not image_url:
                continue

            image_bytes = await _download_generated_image_bytes(image_url)
            if not image_bytes:
                continue

            extension = _guess_image_extension_from_url(image_url)
            zip_file.writestr(
                f"{archive_name}-第{page_index}页.{extension}",
                image_bytes,
            )

    return buffer.getvalue()


router = APIRouter(prefix="/tasks", tags=["任务"])


async def _run_ai_review_with_timeout(
    coro_func,
    task_id: str,
    tenant_id: str,
    review_type: str,  # "script" or "video"
):
    """
    带超时保护的 AI 审核包装器

    asyncio.create_task 创建的协程在 uvicorn reload 时会被杀死，
    但如果协程本身卡住（如网络挂起），也需要超时保护。
    超时后自动回退任务到上传阶段。
    """
    timeout_seconds = _get_ai_review_timeout(review_type)
    try:
        await asyncio.wait_for(coro_func(task_id, tenant_id), timeout=timeout_seconds)
    except asyncio.TimeoutError:
        logger.error(
            f"任务 {task_id} {review_type} AI 审核超时 ({timeout_seconds}s)，回退到上传阶段"
        )
        try:
            async with AsyncSessionLocal() as db:
                task = await get_task_by_id(db, task_id)
                if not task:
                    return
                if review_type == "script" and task.stage == TaskStage.SCRIPT_AI_REVIEW:
                    task.stage = TaskStage.SCRIPT_UPLOAD
                    task.script_ai_score = None
                    task.script_ai_result = None
                elif review_type == "video" and task.stage == TaskStage.VIDEO_AI_REVIEW:
                    task.stage = TaskStage.VIDEO_UPLOAD
                    task.video_ai_score = None
                    task.video_ai_result = None
                else:
                    return
                # 通知达人
                creator_result = await db.execute(
                    select(Creator).where(Creator.id == task.creator_id)
                )
                creator_obj = creator_result.scalar_one_or_none()
                if creator_obj:
                    type_label = "脚本" if review_type == "script" else "视频"
                    await create_message(
                        db=db,
                        user_id=creator_obj.user_id,
                        type="system",
                        title=f"{type_label} AI 审核超时",
                        content=f"任务「{task.name}」的 {type_label} AI 审核超时，已回退到上传阶段，请重新提交。",
                        related_task_id=task.id,
                        sender_name="系统",
                    )
                await db.commit()
                logger.info(f"任务 {task_id} 超时回退成功")
        except Exception as e:
            logger.error(f"任务 {task_id} 超时回退失败: {e}")
    except Exception as e:
        # 预防性捕获：_run_xxx 本身已有 try/except，这里兜底
        logger.error(f"任务 {task_id} AI 审核包装器异常: {e}")


async def _run_script_ai_review(task_id: str, tenant_id: str):
    """
    后台执行脚本 AI 审核

    - 获取 Brief 信息（卖点、黑名单词）
    - 调用 review_script 进行审核
    - 保存审核结果并推进任务阶段
    - 发送 SSE 通知
    """
    from app.api.scripts import review_script

    async with AsyncSessionLocal() as db:
        try:
            task = await get_task_by_id(db, task_id)
            if not task or task.stage.value != "script_ai_review":
                logger.warning(f"任务 {task_id} 不在 AI 审核阶段，跳过")
                return

            # 获取项目信息
            project_result = await db.execute(
                select(Project).where(Project.id == task.project_id)
            )
            project = project_result.scalar_one_or_none()
            if not project:
                logger.error(f"任务 {task_id} 对应的项目不存在")
                return

            # 获取 Brief
            brief_result = await db.execute(
                select(Brief).where(Brief.project_id == project.id)
            )
            brief = brief_result.scalar_one_or_none()

            # 构建审核请求（Brief 数据由 review_script 内部从 DB 读取）
            platform = project.platform or "douyin"
            selling_points = brief.selling_points if brief else None
            blacklist_words = brief.blacklist_words if brief else None

            # 文件任务里如果现有文本明显过短或只是占位符，优先回源重新解析原文件。
            script_content = (task.script_text_content or "").strip()
            has_meaningful_text = _has_meaningful_script_text(script_content)
            if task.script_file_url and task.script_file_name and not has_meaningful_text:
                try:
                    from app.services.document_parser import DocumentParser

                    extracted = await DocumentParser.download_and_parse(
                        task.script_file_url, task.script_file_name
                    )
                    extracted_text = (extracted or "").strip()
                    if extracted_text:
                        task.script_text_content = extracted_text
                        script_content = extracted_text
                        has_meaningful_text = _has_meaningful_script_text(script_content)
                        await db.commit()
                        logger.info(
                            f"任务 {task_id} 从文件提取文字并存回，共 {len(extracted_text)} 字"
                        )
                except Exception as e:
                    logger.warning(f"任务 {task_id} 文件文字提取失败: {e}")

            file_context_required = bool(
                task.script_file_url and task.script_file_name and not has_meaningful_text
            )
            script_content = script_content or " "

            request = ScriptReviewRequest(
                content=script_content,
                platform=Platform(platform),
                brand_id=project.brand_id,
                project_id=project.id,
                selling_points=selling_points,
                blacklist_words=blacklist_words,
                file_url=task.script_file_url if file_context_required else None,
                file_name=task.script_file_name if file_context_required else None,
            )

            # 调用审核逻辑（AI 不可用时重试一次）
            result = await review_script(
                request=request,
                x_tenant_id=tenant_id,
                db=db,
            )

            # AI 不可用时重试一次（可能是暂时的网络波动）
            if not result.ai_available:
                logger.warning(f"任务 {task_id} AI 首次调用不可用，5秒后重试...")
                await asyncio.sleep(5)
                # 清除 AI 客户端缓存，防止缓存了失败的连接
                from app.services.ai_service import AIServiceFactory

                AIServiceFactory.invalidate_cache(tenant_id)
                result = await review_script(
                    request=request,
                    x_tenant_id=tenant_id,
                    db=db,
                )

            # AI 仍然不可用 → 回退到上传阶段，避免任务永远卡在 ai_review
            if not result.ai_available:
                logger.error(
                    f"任务 {task_id} AI 审核不可用（重试后仍失败），回退到脚本上传阶段"
                )
                try:
                    task = await get_task_by_id(db, task_id)
                    if task and task.stage == TaskStage.SCRIPT_AI_REVIEW:
                        task.stage = TaskStage.SCRIPT_UPLOAD
                        task.script_ai_result = {
                            "ai_available": False,
                            "ai_auto_rejected": True,
                            "ai_reject_reason": "AI 审核服务暂时不可用，请稍后重新上传脚本",
                        }
                    creator_result = await db.execute(
                        select(Creator).where(Creator.id == task.creator_id)
                    )
                    creator_obj = creator_result.scalar_one_or_none()
                    if creator_obj:
                        await create_message(
                            db=db,
                            user_id=creator_obj.user_id,
                            type="system",
                            title="AI 审核暂时不可用",
                            content=f"任务「{task.name}」的 AI 审核暂时无法完成，已回退到上传阶段，请稍后重新提交。如持续出现此问题，请联系管理员检查 AI 配置。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    await db.commit()
                except Exception:
                    pass
                return

            # ===== 影子重写：为每个违规项预生成修正版本 =====
            # 在保存前并行生成，代理商打开工作台即刻可用，无需等待
            result_dict = result.model_dump()
            violations_list = result_dict.get("violations") or []
            if violations_list and script_content.strip():
                try:
                    from app.services.ai_service import AIServiceFactory as _AIFactory

                    _ai_client = await _AIFactory.get_client(tenant_id, db)
                    _config = await _AIFactory.get_config(tenant_id, db)
                    _text_model = (
                        _config.models.get("text", "gpt-4o") if _config else "gpt-4o"
                    )

                    async def _do_rewrite(violation: dict) -> str:
                        original_segment = _locate_rewrite_source_span(
                            full_script=script_content,
                            violation_content=(violation.get("content", "") or "").strip(),
                            suggestion=(violation.get("suggestion", "") or "").strip(),
                        )
                        try:
                            _text = await _generate_human_rewrite(
                                ai_client=_ai_client,
                                text_model=_text_model,
                                full_script=script_content,
                                source_span=original_segment,
                                violation_content=(violation.get("content", "") or "").strip(),
                                suggestion=(violation.get("suggestion", "") or "").strip(),
                            )
                            if _text.startswith(
                                ("「", '"', "'", "【")
                            ) and _text.endswith(("」", '"', "'", "】")):
                                _text = _text[1:-1]
                            violation["rewrite_from"] = original_segment
                            return _text
                        except Exception:
                            return ""

                    _rewrite_tasks = [_do_rewrite(v) for v in violations_list]
                    _rewrite_results = await asyncio.gather(
                        *_rewrite_tasks, return_exceptions=True
                    )
                    for i, v in enumerate(violations_list):
                        r = _rewrite_results[i]
                        v["rewritten"] = r if isinstance(r, str) and r else ""
                    logger.info(
                        f"任务 {task_id} 影子重写完成，共 {len(violations_list)} 项"
                    )
                except Exception as e:
                    logger.warning(f"任务 {task_id} 影子重写失败（不影响主流程）: {e}")

                # 用包含 rewritten 字段的 violations 替换原始结果
                if (
                    result_dict.get("conclusions")
                    and result_dict["conclusions"].get("violations") is not None
                ):
                    result_dict["conclusions"]["violations"] = violations_list

            # 保存审核结果
            task = await get_task_by_id(db, task_id)
            task = await complete_ai_review(
                db=db,
                task=task,
                review_type="script",
                score=result.score,
                result=result_dict,
            )
            await db.commit()

            ai_auto_rejected = task.script_ai_result and task.script_ai_result.get(
                "ai_auto_rejected"
            )
            logger.info(
                f"任务 {task_id} AI 审核完成，得分: {result.score}，自动驳回: {ai_auto_rejected}"
            )

            if ai_auto_rejected:
                # AI 自动驳回：推进到代理商审核，由代理商通过工作台处理后决定是否打回达人
                try:
                    agency_result = await db.execute(
                        select(Agency).where(Agency.id == task.agency_id)
                    )
                    agency_obj = agency_result.scalar_one_or_none()
                    if agency_obj:
                        reject_reason = task.script_ai_result.get(
                            "ai_reject_reason", ""
                        )
                        await notify_task_updated(
                            task_id=task.id,
                            user_ids=[agency_obj.user_id],
                            data={
                                "action": "ai_auto_rejected",
                                "stage": task.stage.value,
                                "score": result.score,
                            },
                        )
                        await create_message(
                            db=db,
                            user_id=agency_obj.user_id,
                            type="task",
                            title="脚本 AI 审核：发现严重问题",
                            content=f"任务「{task.name}」AI 审核发现严重违规（{result.score} 分），请在工作台处理后决定是否打回达人。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                        await db.commit()
                except Exception:
                    pass
            else:
                # 正常通过：SSE 通知达人和代理商 + 消息通知代理商
                try:
                    user_ids = []
                    creator_result = await db.execute(
                        select(Creator).where(Creator.id == task.creator_id)
                    )
                    creator_obj = creator_result.scalar_one_or_none()
                    if creator_obj:
                        user_ids.append(creator_obj.user_id)

                    agency_result = await db.execute(
                        select(Agency).where(Agency.id == task.agency_id)
                    )
                    agency_obj = agency_result.scalar_one_or_none()
                    if agency_obj:
                        user_ids.append(agency_obj.user_id)

                    if user_ids:
                        await notify_task_updated(
                            task_id=task.id,
                            user_ids=user_ids,
                            data={
                                "action": "ai_review_completed",
                                "stage": task.stage.value,
                                "score": result.score,
                            },
                        )
                except Exception:
                    pass

                try:
                    # 通知达人 AI 审核已通过
                    if creator_obj:
                        await create_message(
                            db=db,
                            user_id=creator_obj.user_id,
                            type="task",
                            title="脚本通过 AI 审核",
                            content=f"任务「{task.name}」已通过 AI 审核（{result.score} 分），已进入代理商审核环节。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    # 通知代理商有新脚本待审核
                    ag_result = await db.execute(
                        select(Agency).where(Agency.id == task.agency_id)
                    )
                    ag_obj = ag_result.scalar_one_or_none()
                    if ag_obj:
                        await create_message(
                            db=db,
                            user_id=ag_obj.user_id,
                            type="task",
                            title="脚本 AI 审核完成",
                            content=f"任务「{task.name}」AI 审核完成，综合得分 {result.score} 分，请审核。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    await db.commit()
                except Exception:
                    pass

            # AI 不可用时通知品牌方 + 达人
            if not result.ai_available:
                try:
                    # 通知品牌方
                    brand_result = await db.execute(
                        select(Brand).where(Brand.id == project.brand_id)
                    )
                    brand_obj = brand_result.scalar_one_or_none()
                    if brand_obj and brand_obj.user_id:
                        await create_message(
                            db=db,
                            user_id=brand_obj.user_id,
                            type="task",
                            title="AI 审核服务不可用",
                            content=f"任务「{task.name}」的 AI 审核无法执行（AI 服务未配置或不可用），请前往「AI 配置」完成设置。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    # 通知达人
                    creator_result2 = await db.execute(
                        select(Creator).where(Creator.id == task.creator_id)
                    )
                    creator_obj2 = creator_result2.scalar_one_or_none()
                    if creator_obj2:
                        await create_message(
                            db=db,
                            user_id=creator_obj2.user_id,
                            type="task",
                            title="AI 审核暂时不可用",
                            content=f"任务「{task.name}」的 AI 审核服务当前不可用，请等待管理员配置后重试。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    await db.commit()
                except Exception:
                    pass

        except Exception as e:
            logger.error(f"任务 {task_id} AI 审核失败: {e}", exc_info=True)
            await db.rollback()
            # AI 审核失败时回退 stage 并清除旧 AI 数据，避免任务永远卡在 ai_review
            try:
                task_obj = await get_task_by_id(db, task_id)
                if task_obj:
                    if task_obj.stage.value == "script_ai_review":
                        task_obj.stage = TaskStage.SCRIPT_UPLOAD
                        task_obj.script_ai_score = None
                        task_obj.script_ai_result = None
                    elif task_obj.stage.value == "video_ai_review":
                        task_obj.stage = TaskStage.VIDEO_UPLOAD
                        task_obj.video_ai_score = None
                        task_obj.video_ai_result = None
                    await db.commit()
                    logger.info(
                        f"任务 {task_id} AI 审核失败，已回退到上传阶段并清除旧审核数据"
                    )
            except Exception as rollback_err:
                logger.error(f"任务 {task_id} 回退阶段失败: {rollback_err}")
            # AI 审核异常时通知品牌方
            try:
                brand_result = await db.execute(
                    select(Brand).where(Brand.id == tenant_id)
                )
                brand_obj = brand_result.scalar_one_or_none()
                if brand_obj and brand_obj.user_id:
                    await create_message(
                        db=db,
                        user_id=brand_obj.user_id,
                        type="task",
                        title="AI 审核异常",
                        content=f"任务 AI 审核过程中出错，审核结果可能不完整，请检查 AI 服务配置。错误信息：{str(e)[:100]}",
                        related_task_id=task_id,
                        sender_name="系统",
                    )
                    await db.commit()
            except Exception:
                pass


async def _extract_audio_from_video(video_path: str) -> str | None:
    """用 ffmpeg 从视频提取兼顾 ASR 与音频理解的音轨。"""
    import tempfile

    audio_path = tempfile.mktemp(suffix=".mp3")
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-i",
        video_path,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-ar",
        "24000",
        "-ac",
        "2",
        # 兼顾口播识别与 BGM/环境声分析，保留适度立体声与频响信息。
        "-b:a",
        "64k",
        audio_path,
        "-y",
        "-loglevel",
        "error",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        logger.warning(f"ffmpeg 提取音频失败: {stderr.decode()[:200]}")
        return None
    return audio_path


async def _run_asr_transcription(
    ai_client, audio_path: str, audio_model: str
) -> str | None:
    """调用 ASR 模型将音频转成文字"""
    try:
        response = await ai_client.audio_transcription(
            audio_file_path=audio_path,
            model=audio_model,
            language="zh",
        )
        return response.content
    except Exception as e:
        logger.warning(f"ASR 转录失败: {e}")
        return None


async def _run_asr_transcription_with_fallback(
    ai_client,
    audio_path: str,
    preferred_model: str,
) -> tuple[str, str | None]:
    tried: list[str] = []
    candidates = [
        preferred_model,
        "whisper-1",
        "gpt-4o-mini-transcribe",
        "gpt-4o-transcribe",
    ]

    for model_name in candidates:
        normalized_model = str(model_name or "").strip()
        if not normalized_model or normalized_model in tried:
            continue
        tried.append(normalized_model)
        text = await _run_asr_transcription(ai_client, audio_path, normalized_model)
        if text:
            return text, normalized_model

    return "", tried[-1] if tried else None


def _clean_multimodal_transcript_text(text: str | None) -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return ""

    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()

    if cleaned.startswith("{"):
        try:
            parsed = _robust_json_parse(cleaned)
        except json.JSONDecodeError:
            try:
                parsed = _extract_json_by_keys(cleaned, ["transcript"])
            except (ValueError, IndexError):
                parsed = {}
        if parsed.get("transcript"):
            cleaned = str(parsed.get("transcript") or "").strip()

    cleaned = re.sub(
        r"^(转写结果|转录结果|识别结果|transcript|transcription)\s*[:：]\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned.strip().strip('"').strip()


async def _run_audio_transcript_via_multimodal(
    ai_client,
    audio_path: str,
    audio_model: str,
) -> str:
    """用支持音频输入的多模态模型兜底提取口播正文，避开坏掉的 transcription 网关。"""
    prompt = """你是语音转写助手。请直接听音频并完成以下任务：

1. 只转写能明确听到的人声口播，不要总结，不要分析，不要改写。
2. 如果有少量听不清的词，可以跳过或用最保守的近似表达，不要编造。
3. 只输出转写正文本身，不要输出 JSON、标题、说明、markdown、前后缀。
4. 如果几乎没有可辨识的人声口播，只输出空字符串。"""

    try:
        response = await ai_client.audio_analysis(
            audio_file_path=audio_path,
            prompt=prompt,
            model=audio_model,
            temperature=0,
            max_tokens=1800,
        )
    except Exception as exc:
        logger.info(
            "多模态音频转写失败，model=%s, error=%s",
            audio_model,
            exc,
        )
        return ""

    transcript = _clean_multimodal_transcript_text(response.content)
    return transcript if len(re.sub(r"\s+", "", transcript)) >= 6 else ""


async def _run_audio_track_analysis(
    ai_client,
    audio_path: str,
    audio_model: str,
    approved_script: str,
    subtitle_text: str,
    brief_product: str,
    speech_text: str = "",
) -> dict:
    """让支持音频输入的模型同时识别口播、语气和 BGM。"""
    approved_script_outline = _build_prompt_outline(approved_script, max_items=14, max_chars=1600)
    subtitle_outline = _build_prompt_outline(subtitle_text, max_items=12, max_chars=1200)
    brief_context = _build_prompt_excerpt(brief_product, max_chars=900)
    speech_outline = _build_prompt_outline(speech_text, max_items=20, max_chars=1400)

    prompt = f"""你是视频音轨审核助手，同时也是给达人和剪辑师下执行单的导演。你的任务不是泛泛点评，而是先识别事实，再输出能直接执行的修改建议。

你必须按这个顺序思考，但不要输出思考过程：
1. 如果 <external_transcript> 已经提供了可靠口播，就不要再重复输出整段转写。
2. 再判断口播表达问题：进入是否太快、语气是否像硬广、关键词是否被连读、节奏是否太赶或太平。
3. 再判断 BGM：有无盖住人声、情绪是否过满、风格是否不匹配、歌词是否抢信息。
4. 最后判断环境音：底噪、回声、爆音、音量忽高忽低、清晰度。

你输出时必须遵守这些规则：
- 只写可以明确确认的问题，不要猜。
- `creator_guidance` 要像执行单，不要写后台分析腔，不要写空话。
- 同一个问题不要在 `must_fix`、`voiceover_plan`、`violations` 里重复换说法。
- `instruction` 必须直接回答“怎么改”，不能只复述问题。
- `emphasis_words` 必须写具体词，不要写“更自然”“更走心”这种抽象词。
- 时间段优先写 `0:00-0:12` 这种范围；听不出精确时间时，才写“前段/中段/后段”。
- 如果没有明显 BGM 或环境问题，对应字段留空，不要为了凑字段硬写。

<approved_script_outline>
{approved_script_outline if approved_script else "（无已通过脚本）"}
</approved_script_outline>

<subtitle_outline>
{subtitle_outline if subtitle_text else "（无字幕文本）"}
</subtitle_outline>

<external_transcript>
{speech_outline if speech_text else "（无可靠外部转写）"}
</external_transcript>

<product_context>
{brief_context if brief_context else "（未提供品牌/产品上下文）"}
</product_context>

以 JSON 返回，不要输出 markdown，不要额外解释：
{{
  "transcript": "如果 <external_transcript> 为空，则写简短口播概括；如果已提供可靠转写，这里返回空字符串",
  "tone_summary": "一句话总结这条音轨整体感觉",
  "creator_guidance": {{
    "summary": "给达人的一句话总要求，直接点明最大问题和修改方向",
    "must_fix": [
      "必须先改的硬问题，按重要性排序，最多 4 条"
    ],
    "voiceover_plan": [
      {{
        "segment": "优先写 0:00-0:12；不确定时写前段/中段/后段",
        "goal": "这段配音想传达什么",
        "emotion": "赞叹/走心/坚定/委屈感等",
        "pacing": "偏慢/适中/轻快/停顿要多",
        "instruction": "直接写给达人或剪辑师的话，要能立刻执行，例如先删什么、补什么、哪里放慢、哪句改成场景句",
        "emphasis_words": ["这一段必须加重的词，最多 4 个"]
      }}
    ],
    "bgm_plan": [
      {{
        "segment": "优先写 0:00-0:12；不确定时写前段/转场/后段",
        "style": "国风大鼓/温暖钢琴/轻治愈纯音乐等",
        "action": "保留/替换/弱化/戛然而止/转场切歌",
        "cue_point": "卡在哪个画面或文案点；不确定可留空",
        "instruction": "直接写给剪辑师的执行建议，例如压低、换纯音乐、转场切歌、把最后一句让出来"
      }}
    ]
  }},
  "delivery_signals": {{
    "tone": "语气风格",
    "emotion": "情绪状态",
    "energy_level": "高/中/低",
    "pacing": "节奏快慢与停顿情况",
    "persuasiveness": "是否有感染力与购买推动力",
    "brand_fit": "与品牌/带货场景匹配度",
    "summary": "主播声音与表达的综合评价"
  }},
  "bgm": {{
    "present": true,
    "style": "BGM 风格，没有则空字符串",
    "intensity": "强/中/弱/无",
    "fit": "与视频内容是否匹配",
    "lyrics_risk": false,
    "summary": "BGM 综合评价"
  }},
  "environment": {{
    "has_noise": false,
    "noise_types": ["回声", "底噪"],
    "clarity_score": 85,
    "summary": "音质清晰度评价"
  }},
  "violations": [
    {{
      "type": "语气问题/BGM问题/噪音问题/清晰度问题",
      "content": "明确问题描述，写事实，不写空话",
      "severity": "高/中/低",
      "suggestion": "具体修改建议，必须能执行"
    }}
  ]
}}"""
    try:
        response = await ai_client.audio_analysis(
            audio_file_path=audio_path,
            prompt=prompt,
            model=audio_model,
            temperature=0.1,
            max_tokens=2500,
        )
        return _normalize_audio_track_analysis(_robust_json_parse(response.content))
    except Exception as exc:
        logger.info(f"音轨理解不可用或模型不支持音频输入，model={audio_model}, error={exc}")
        return _empty_audio_track_analysis()


async def _run_bgm_environment_analysis(
    ai_client,
    audio_path: str,
    audio_model: str,
) -> dict:
    """用更聚焦的 prompt 单独识别 BGM 与环境声，避免被转写/口播任务干扰。"""
    prompt = """你是音频审核助手。请只分析这条音频里的 BGM 和环境声，不要分析画面，不要分析脚本，不要评价内容对错。

必须遵守：
1. 先判断是否存在持续性的背景音乐、鼓点、铺底氛围音或转场音乐。
2. 如果存在，说明风格、强弱、是否压人声、是否有歌词抢信息、哪些时间段最明显。
3. 再判断是否存在环境噪音、回声、电流声、压缩失真。
4. 最多返回 2 条最关键的 BGM 修改建议；没有问题就返回空数组。
5. 只返回 JSON，不要 markdown，不要解释。

返回：
{
  "bgm": {
    "present": true,
    "style": "具体风格，没有就写空字符串",
    "intensity": "强/中/弱/无",
    "fit": "匹配/一般/不匹配/无",
    "lyrics_risk": false,
    "summary": "一句话结论"
  },
  "bgm_segments": [
    {
      "time_range": "0:00-0:12",
      "issue": "具体问题，没有就留空",
      "suggestion": "具体修改建议，没有就留空",
      "action": "保留/压低/替换/切歌/弱化"
    }
  ],
  "environment": {
    "has_noise": false,
    "noise_types": [],
    "clarity_score": 85,
    "summary": "一句话结论"
  }
}"""

    try:
        response = await ai_client.audio_analysis(
            audio_file_path=audio_path,
            prompt=prompt,
            model=audio_model,
            temperature=0,
            max_tokens=900,
        )
        parsed = _robust_json_parse(response.content)
    except Exception as exc:
        logger.info("BGM/环境声识别失败，model=%s, error=%s", audio_model, exc)
        return _empty_audio_track_analysis()

    normalized = _normalize_audio_track_analysis(parsed)
    bgm_segments = parsed.get("bgm_segments") or []
    if isinstance(bgm_segments, list):
        normalized["creator_guidance"]["bgm_plan"] = [
            {
                "segment": str(item.get("time_range") or "").strip(),
                "style": normalized["bgm"].get("style", ""),
                "action": str(item.get("action") or "").strip(),
                "cue_point": "",
                "instruction": str(item.get("suggestion") or "").strip(),
            }
            for item in bgm_segments
            if isinstance(item, dict)
            and (
                str(item.get("time_range") or "").strip()
                or str(item.get("suggestion") or "").strip()
            )
        ][:2]

        for item in bgm_segments[:2]:
            if not isinstance(item, dict):
                continue
            issue = str(item.get("issue") or "").strip()
            suggestion = str(item.get("suggestion") or "").strip()
            if issue:
                normalized["violations"].append(
                    {
                        "type": "BGM问题",
                        "content": issue,
                        "severity": "medium",
                        "suggestion": suggestion,
                    }
                )

    return normalized


def _supports_combined_audio_model(ai_client, audio_model: str) -> bool:
    support_checker = getattr(ai_client, "_supports_audio_understanding", None)
    if callable(support_checker):
        try:
            return bool(support_checker(audio_model))
        except Exception:
            return False
    return False


async def _extract_video_frames(video_path: str) -> tuple[list[tuple[str, float]], str]:
    """
    从视频提取关键帧

    策略：场景检测（画面变化 > 30%）+ 每 10 秒至少 1 帧兜底
    输出：JPEG 85% 质量（原始分辨率不缩放，体积比 PNG 减少约 93%）

    Returns: (frames, output_dir) — frames 是 [(path, timestamp), ...]
    """
    import tempfile
    import os
    import re

    MAX_FRAMES = 8  # 最多 8 帧，减少 Vision AI 输入量

    output_dir = tempfile.mkdtemp(prefix="vframes_")

    # 场景检测 + 10 秒兜底 + 缩放到720p + showinfo 输出时间戳
    filter_str = (
        "select='gt(scene\\,0.3)+gte(t-prev_selected_t\\,10)"
        "+isnan(prev_selected_t)',scale=-2:720,showinfo"
    )

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-i",
        video_path,
        "-vf",
        filter_str,
        "-vsync",
        "vfn",
        "-qscale:v",
        "2",
        f"{output_dir}/frame_%04d.jpg",
        "-y",
        "-loglevel",
        "info",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    # 从 showinfo 输出中解析时间戳
    timestamps: list[float] = []
    for line in stderr.decode(errors="replace").split("\n"):
        match = re.search(r"pts_time:\s*([\d.]+)", line)
        if match:
            timestamps.append(float(match.group(1)))

    # 匹配帧文件与时间戳
    frames: list[tuple[str, float]] = []
    frame_files = sorted(
        f
        for f in os.listdir(output_dir)
        if f.startswith("frame_") and f.endswith(".jpg")
    )
    for i, fname in enumerate(frame_files):
        ts = timestamps[i] if i < len(timestamps) else i * 10.0
        frames.append((os.path.join(output_dir, fname), ts))

    # 兜底：场景检测没提取到帧 → 每 3 秒 1 帧
    if not frames:
        proc2 = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-i",
            video_path,
            "-vf",
            "fps=1/3,scale=-2:720",
            "-qscale:v",
            "2",
            f"{output_dir}/fb_%04d.jpg",
            "-y",
            "-loglevel",
            "error",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc2.communicate()
        fb_files = sorted(
            f
            for f in os.listdir(output_dir)
            if f.startswith("fb_") and f.endswith(".jpg")
        )
        for i, fname in enumerate(fb_files):
            frames.append((os.path.join(output_dir, fname), i * 3.0))

    # 限制最大帧数：均匀采样
    if len(frames) > MAX_FRAMES:
        indices = [
            int(i * (len(frames) - 1) / (MAX_FRAMES - 1)) for i in range(MAX_FRAMES)
        ]
        frames = [frames[i] for i in indices]

    logger.info(f"视频抽帧完成: {len(frames)} 帧 (720p)")
    return frames, output_dir


def _frame_to_data_uri(path: str) -> str:
    """将本地图片文件转为 base64 data URI"""
    import base64

    ext = path.rsplit(".", 1)[-1].lower()
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return f"data:{mime};base64,{b64}"


async def _visual_review(
    ai_client,
    frames: list[tuple[str, float]],
    model: str,
    competitors: list[dict],
    brief_product: str,
) -> dict:
    """
    视觉审核：竞品识别 + 品牌安全 + 字幕 OCR + 产品展示 + 画面质量

    Returns: {"subtitle_text": str, "violations": list[dict]}
    """
    import json

    if not frames:
        return {"subtitle_text": "", "violations": []}

    # 构建竞品信息
    comp_lines: list[str] = []
    for c in competitors:
        kws = ", ".join(c.get("keywords", []))
        comp_lines.append(f"  - {c['name']}（关键词：{kws}）")
        if c.get("logo_url"):
            comp_lines.append(f"    logo 参考图：{c['logo_url']}")
    comp_info = "\n".join(comp_lines) if comp_lines else "（未配置竞品信息）"

    prompt_text = f"""你是视频画面合规审核助手。以下是视频的关键帧截图，请逐帧分析。

<competitors>
{comp_info}
</competitors>

<product_info>
{brief_product if brief_product else "（未提供产品信息）"}
</product_info>

请完成以下审核任务：

1. **字幕/文字提取**：提取每一帧中出现的所有字幕、贴片文字、产品标签文字，按时间顺序拼接成完整的字幕文本

2. **竞品识别**（维度: 品牌安全）：
   - 检查画面中是否出现竞品的 logo、包装、产品
   - 检查画面文字中是否提及竞品品牌名

3. **品牌安全**（维度: 品牌安全）：
   - 检查是否有不当画面（暴力、色情、歧视性内容等）

4. **产品展示**（维度: 内容质量）：
   - 产品出镜是否清晰、正面
   - 展示内容与产品信息描述是否一致

5. **画面质量**（维度: 内容质量）：
   - 是否有模糊、水印、黑屏、画面抖动严重等问题

6. **画面文案合规**（维度: 法规合规/平台规则/品牌安全）：
   - 检查贴片字幕、包装文字、价格/规格/卖点文案里是否有绝对化、功效承诺、产品名错误、误导性表达
   - 画面里出现的品牌名、产品名、关键信息与产品信息不一致时必须单独报出

7. **问题拆分要求**：
   - 如果同时存在场景不符、卖点缺失、黑屏、产品名错误，必须拆成多条 violation
   - 不要用一条笼统的问题描述替代多个独立问题
   - 只要能从关键帧中确定，就应当列出

以 JSON 返回（不要包含 markdown 代码块标记）：
{{
  "subtitle_text": "按时间顺序拼接的完整字幕文本",
  "violations": [
    {{
      "type": "竞品露出/品牌安全/画面质量/产品不符",
      "content": "问题描述",
      "severity": "高/中/低",
      "suggestion": "修改建议",
      "dimension": "品牌安全/内容质量",
      "timestamp": 3.0,
      "fixable": true
    }}
  ]
}}

没有问题时 violations 为空数组。只报告确定的问题，不要猜测。"""

    # 构建多模态消息
    content_parts: list[dict] = [{"type": "text", "text": prompt_text}]
    for frame_path, ts in frames:
        try:
            data_uri = _frame_to_data_uri(frame_path)
            content_parts.append({"type": "text", "text": f"[第 {ts:.1f} 秒]"})
            content_parts.append({"type": "image_url", "image_url": {"url": data_uri}})
        except Exception:
            continue

    # 如果有竞品参考图 URL，也加入
    for c in competitors:
        if c.get("logo_url"):
            content_parts.append(
                {"type": "text", "text": f"[竞品「{c['name']}」参考图]"}
            )
            content_parts.append(
                {"type": "image_url", "image_url": {"url": c["logo_url"]}}
            )

    try:
        response = await ai_client.chat_completion(
            messages=[{"role": "user", "content": content_parts}],
            model=model,
            temperature=0.2,
            max_tokens=4000,
        )

        result_text = response.content.strip()
        if result_text.startswith("```"):
            result_text = result_text.split("\n", 1)[1]
        if result_text.endswith("```"):
            result_text = result_text.rsplit("\n", 1)[0]

        parsed = json.loads(result_text)
        return {
            "subtitle_text": parsed.get("subtitle_text", ""),
            "violations": parsed.get("violations", []),
        }
    except Exception as e:
        logger.warning(f"视觉审核失败: {e}")
        return {"subtitle_text": "", "violations": []}


async def _analyze_video_content(
    ai_client,
    speech_text: str,
    approved_script: str,
    subtitle_text: str,
    brief_data: dict,
    model: str,
) -> dict:
    """
    视频内容综合分析

    1. 卖点传达（语义匹配，不要求和脚本一字不差）
    2. 新增内容合规（达人自己加的话是否违规、是否有趣）
    3. 口播质量（感染力、购买欲、平台适配）
    4. 真正的口误（产品名/数据说错，不标记正常改编）
    5. 字幕准确性（字幕 vs 语音 vs 脚本）
    """
    import json

    script_outline = _build_prompt_outline(approved_script, max_items=20, max_chars=2400)
    speech_outline = _build_prompt_outline(speech_text, max_items=20, max_chars=2400)
    subtitle_outline = _build_prompt_outline(subtitle_text, max_items=14, max_chars=1400)
    brief_context = _build_brief_context_for_prompt(brief_data, max_chars=1300)
    script_excerpt = _build_prompt_excerpt(approved_script, max_chars=1600)
    speech_excerpt = _build_prompt_excerpt(speech_text, max_chars=1600)

    prompt = f"""你是视频内容审核助手。你的任务不是给情绪化点评，而是先做事实对齐，再做审核判断。

你必须按这个顺序思考，但不要输出思考过程：
1. 先对齐三份证据：审核通过脚本、ASR 口播、字幕文本。
2. 只基于证据明确判断：卖点是否讲到、事实词是否说错、字幕是否写错、脚本段落是否缺失。
3. 最后才输出整体表达评价。

你必须遵守这些规则：
- 优先依据事实差异下结论，不要把主观感受写成事实错误。
- `violations` 只写事实性错误：产品名、品牌名、价格、数据、关键功效表述说错。
- `subtitle_issues` 只写字幕层问题，不要把纯口播问题重复写进来。
- 卖点覆盖不要只判断“提到没提到”，要区分“讲清楚 / 一笔带过 / 没讲到”。
- 如果能从字幕或口播中定位到时间，优先写 `0:16` 这种时间；没有证据时再留空。
- 如果没有审核通过脚本，`script_match` 返回 null，不要猜。
- 不要为了凑字段硬写问题；没有就是空数组。

<brief_context>
{brief_context}
</brief_context>

<approved_script_outline>
{script_outline if approved_script else "（无法获取审核通过的脚本）"}
</approved_script_outline>

<speech_transcript_outline>
{speech_outline if speech_text else "（未提取到口播）"}
</speech_transcript_outline>

<subtitle_outline>
{subtitle_outline if subtitle_text else "（未提取到字幕）"}
</subtitle_outline>

<approved_script_excerpt>
{script_excerpt if approved_script else "（无）"}
</approved_script_excerpt>

<speech_excerpt>
{speech_excerpt if speech_text else "（无）"}
</speech_excerpt>

以 JSON 返回（不要包含 markdown 代码块标记，不要额外解释）：
{{
  "selling_point_coverage": [
    {{
      "content": "卖点原文",
      "priority": "core/recommended",
      "conveyed": true,
      "strength": "clear/weak/missing",
      "evidence": "视频中如何传达的",
      "timestamp": "0:16"
    }}
  ],
  "new_content": [
    {{"content": "新增内容", "compliant": true, "enhances": true, "note": "说明", "timestamp": "0:28"}}
  ],
  "delivery_quality": {{
    "score": 75,
    "engagement": "评价感染力",
    "purchase_intent": "评价购买欲",
    "platform_fit": "评价平台适配度",
    "overall": "总体评价"
  }},
  "violations": [
    {{
      "type": "口误",
      "content": "问题描述，只写事实错误",
      "severity": "高/中/低",
      "suggestion": "修改建议，直接告诉审核员或达人怎么修",
      "dimension": "内容质量",
      "fixable": true,
      "script_text": "脚本原文",
      "actual_text": "实际说的",
      "timestamp": "0:16",
      "confidence": "high/medium/low"
    }}
  ],
  "subtitle_issues": [
    {{
      "type": "字幕错字/字幕与口播不一致/字幕事实词错误",
      "content": "字幕问题描述",
      "severity": "低",
      "suggestion": "修改建议",
      "timestamp": "0:22",
      "confidence": "high/medium/low"
    }}
  ],
  "script_match": {{
    "overall_score": 85,
    "overall_assessment": "整体执行评价",
    "suggestion_for_reviewer": "给审核员的建议",
    "segments": [
      {{
        "script_segment": "脚本段落摘要",
        "segment_label": "开场引入/产品介绍/卖点论证/使用演示/促销信息/结尾定位",
        "status": "matched/adapted/missing/reordered",
        "video_evidence": "视频中对应内容",
        "note": "说明",
        "timestamp": "0:00-0:12"
      }}
    ],
    "structure_preserved": true,
    "missing_segments": ["遗漏的段落类型"],
    "key_deviations": ["主要偏离"]
  }}
}}

补充要求：
- `selling_point_coverage` 中，如果只是提到了但没有讲透，`conveyed` 仍可为 true，但 `strength` 必须写 `weak`。
- `violations` 和 `subtitle_issues` 的 `confidence` 只在你能明确判断时写 `high`；不确定就写 `medium` 或 `low`。
- `script_match.segments` 最多保留 8 段，按视频实际顺序输出。
- 没有问题时对应字段为空数组。没有审核通过脚本时 `script_match` 为 null。"""

    try:
        response = await ai_client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model=model,
            temperature=0.15,
            max_tokens=5000,
        )

        result_text = response.content.strip()
        if result_text.startswith("```"):
            result_text = result_text.split("\n", 1)[1]
        if result_text.endswith("```"):
            result_text = result_text.rsplit("\n", 1)[0]

        return json.loads(result_text)
    except Exception as e:
        logger.warning(f"视频内容分析失败: {e}")
        return {
            "violations": [],
            "selling_point_coverage": [],
            "delivery_quality": {},
            "new_content": [],
            "subtitle_issues": [],
            "script_match": None,
        }


async def _run_video_ai_review(task_id: str, tenant_id: str):
    """
    后台执行视频 AI 审核

    流程：
    1. 下载视频 → 并行: ASR 转录 + 关键帧提取
    2. 对 ASR 文本做合规审核（审实际说的内容）
    3. 视觉审核（竞品 logo / 品牌安全 / 字幕 OCR / 画面质量）
    4. 内容综合分析（卖点传达 / 新增内容合规 / 口播质量 / 字幕校对）
    5. 合并所有结果
    """
    import tempfile
    import os
    import shutil
    from app.services.ai_service import AIServiceFactory
    from app.services.document_parser import DocumentParser
    from app.api.rules import get_competitors_for_brand

    async with AsyncSessionLocal() as db:
        try:
            await asyncio.sleep(1)

            task = await get_task_by_id(db, task_id)
            if not task or task.stage.value != "video_ai_review":
                logger.warning(f"任务 {task_id} 不在视频 AI 审核阶段，跳过")
                return

            # 获取项目信息
            project_result = await db.execute(
                select(Project).where(Project.id == task.project_id)
            )
            project = project_result.scalar_one_or_none()
            if not project:
                logger.error(f"任务 {task_id} 对应的项目不存在")
                return

            # 获取 Brief
            brief_result = await db.execute(
                select(Brief).where(Brief.project_id == project.id)
            )
            brief = brief_result.scalar_one_or_none()

            platform = project.platform or "douyin"
            selling_points = brief.selling_points if brief else None
            blacklist_words = brief.blacklist_words if brief else None

            # 获取 AI 客户端
            ai_client = await AIServiceFactory.get_client(tenant_id, db)
            config = await AIServiceFactory.get_config(tenant_id, db)

            if not ai_client:
                # 重试一次
                logger.warning(f"任务 {task_id} AI 服务不可用，5秒后重试...")
                await asyncio.sleep(5)
                AIServiceFactory.invalidate_cache(tenant_id)
                ai_client = await AIServiceFactory.get_client(tenant_id, db)
                config = await AIServiceFactory.get_config(tenant_id, db)

            if not ai_client:
                logger.error(
                    f"任务 {task_id} AI 服务不可用（重试后仍失败），回退到视频上传阶段"
                )
                try:
                    task = await get_task_by_id(db, task_id)
                    if task and task.stage == TaskStage.VIDEO_AI_REVIEW:
                        task.stage = TaskStage.VIDEO_UPLOAD
                        task.video_ai_result = {
                            "ai_available": False,
                            "ai_auto_rejected": True,
                            "ai_reject_reason": "AI 审核服务暂时不可用，请稍后重新上传视频",
                        }
                    creator_result = await db.execute(
                        select(Creator).where(Creator.id == task.creator_id)
                    )
                    creator_obj = creator_result.scalar_one_or_none()
                    if creator_obj:
                        await create_message(
                            db=db,
                            user_id=creator_obj.user_id,
                            type="system",
                            title="AI 审核暂时不可用",
                            content=f"任务「{task.name}」的视频 AI 审核暂时无法完成，已回退到上传阶段，请稍后重新提交。如持续出现此问题，请联系管理员检查 AI 配置。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    await db.commit()
                except Exception:
                    pass
                return

            text_model = config.models.get("text", "gpt-4o") if config else "gpt-4o"
            audio_model = (
                config.models.get("audio", "whisper-1") if config else "whisper-1"
            )
            vision_model = (
                config.models.get("vision", text_model) if config else text_model
            )

            video_temp_path = None
            audio_temp_path = None
            frames_dir = None

            try:
                # ===== 下载视频 =====
                if not task.video_file_url:
                    raise ValueError("视频文件 URL 为空")

                # 优先用 TOS SDK 直接下载（AK/SK 认证头，兼容所有桶策略）
                from app.services.oss import download_from_tos

                video_data = await asyncio.to_thread(
                    download_from_tos, task.video_file_url
                )

                if video_data is None:
                    # 非 TOS URL 或 SDK 失败，回退 HTTP 直接下载
                    import httpx

                    async with httpx.AsyncClient() as http_client:
                        resp = await http_client.get(
                            task.video_file_url, timeout=120, follow_redirects=True
                        )
                    if resp.status_code != 200:
                        raise ValueError(f"视频下载失败: HTTP {resp.status_code}")
                    video_data = resp.content

                ext = (
                    (task.video_file_name or "video.mp4").rsplit(".", 1)[-1]
                    if task.video_file_name
                    else "mp4"
                )
                video_temp_path = tempfile.mktemp(suffix=f".{ext}")
                with open(video_temp_path, "wb") as f:
                    f.write(video_data)

                # ===== 预取 DB 数据（供并行任务使用）=====
                competitors = await get_competitors_for_brand(
                    tenant_id, project.brand_id, db
                )
                brief_product = _build_brief_model_summary(brief)

                combined_audio_model = _supports_combined_audio_model(
                    ai_client, audio_model
                )

                # ===== Step 1: 音轨提取 + 视觉审核 + 脚本下载（三路并行）=====

                async def _audio_pipeline():
                    """提取音轨并尽量拿到 ASR 文本，避免音轨理解失败后整条链路断掉。"""
                    _audio_path = await _extract_audio_from_video(video_temp_path)
                    if not _audio_path:
                        return None, "", False

                    _text = ""
                    _asr_model = None
                    if combined_audio_model:
                        _text = await _run_audio_transcript_via_multimodal(
                            ai_client,
                            _audio_path,
                            audio_model,
                        )
                        if _text:
                            _asr_model = f"{audio_model}:multimodal"

                    if not _text:
                        preferred_asr_model = audio_model if not combined_audio_model else "whisper-1"
                        _text, _asr_model = await _run_asr_transcription_with_fallback(
                            ai_client,
                            _audio_path,
                            preferred_asr_model,
                        )
                    logger.info(
                        f"任务 {task_id} ASR 转录完成，文本长度: {len(_text)}，模型: {_asr_model or 'none'}"
                    )
                    return _audio_path, _text, bool(_text)

                async def _visual_pipeline():
                    """抽帧 → 视觉审核（含 OCR 字幕提取）"""
                    _frames, _fdir = await _extract_video_frames(video_temp_path)
                    logger.info(f"任务 {task_id} 抽帧完成: {len(_frames)} 帧")
                    _visual: dict = {"subtitle_text": "", "violations": []}
                    if _frames:
                        _visual = await _visual_review(
                            ai_client,
                            _frames,
                            vision_model,
                            competitors=competitors,
                            brief_product=brief_product,
                        )
                        logger.info(
                            f"任务 {task_id} 视觉审核完成，"
                            f"发现 {len(_visual.get('violations', []))} 个问题"
                        )
                    return _frames, _fdir, _visual

                async def _script_pipeline():
                    """下载已审核通过的脚本"""
                    if task.script_file_url and task.script_file_name:
                        try:
                            return (
                                await DocumentParser.download_and_parse(
                                    task.script_file_url, task.script_file_name
                                )
                                or ""
                            )
                        except Exception:
                            return ""
                    return ""

                (
                    (audio_temp_path, speech_text, asr_success),
                    (frames, frames_dir, visual_result),
                    approved_script,
                ) = await asyncio.gather(
                    _audio_pipeline(),
                    _visual_pipeline(),
                    _script_pipeline(),
                )

                subtitle_text = visual_result.get("subtitle_text", "")
                audio_track_analysis = _empty_audio_track_analysis()
                if audio_temp_path and combined_audio_model:
                    audio_track_analysis = await _run_audio_track_analysis(
                        ai_client=ai_client,
                        audio_path=audio_temp_path,
                        audio_model=audio_model,
                        approved_script=approved_script,
                        subtitle_text=subtitle_text,
                        brief_product=brief_product,
                        speech_text=speech_text,
                    )
                    bgm_environment_analysis = await _run_bgm_environment_analysis(
                        ai_client=ai_client,
                        audio_path=audio_temp_path,
                        audio_model=audio_model,
                    )
                    audio_track_analysis = _merge_audio_track_analysis(
                        audio_track_analysis,
                        bgm_environment_analysis,
                    )
                    if speech_text and not audio_track_analysis.get("transcript"):
                        audio_track_analysis["transcript"] = speech_text
                    if (
                        not speech_text
                        and audio_track_analysis.get("transcript")
                    ):
                        speech_text = audio_track_analysis["transcript"]
                        asr_success = True
                audio_track_analysis = _repair_audio_track_analysis_with_transcript(
                    audio_track_analysis,
                    speech_text,
                )

                # 文本优先级：ASR 语音 > OCR 字幕 > 已通过脚本
                analysis_text, text_source = _build_video_analysis_text(
                    speech_text=speech_text,
                    subtitle_text=subtitle_text,
                    approved_script=approved_script,
                )
                if text_source != "asr":
                    logger.info(
                        f"任务 {task_id} 文本来源: {text_source}（ASR={'成功' if asr_success else '失败'}, OCR={len(subtitle_text)}字, 脚本={len(approved_script)}字）"
                    )

                # ===== Step 2: 合规审核 + 内容分析（合并为单次 AI 调用）=====
                _default_content = {
                    "violations": [],
                    "selling_point_coverage": [],
                    "delivery_quality": {},
                    "new_content": [],
                    "subtitle_issues": [],
                    "script_match": None,
                    "brand_exposure": None,
                    "audio_track_analysis": _empty_audio_track_analysis(),
                }
                compliance_result = None
                content_analysis = _default_content

                if analysis_text:
                    from app.api.scripts import (
                        _build_structured_prompt,
                        _parse_ai_response,
                        _get_brief_context,
                        _get_brand_learned_rules,
                        _normalize_selling_points,
                    )
                    from app.api.rules import (
                        get_whitelist_for_brand,
                        get_forbidden_words_for_tenant,
                        get_active_platform_rules,
                    )
                    from app.schemas.review import ScriptReviewResponse

                    # 预取审核所需数据（review_script 内部会重复查询，这里一次搞定）
                    brief_data = await _get_brief_context(
                        brand_id=project.brand_id,
                        db=db,
                        project_id=project.id,
                        request_selling_points=selling_points,
                        request_blacklist_words=blacklist_words,
                    )
                    whitelist = await get_whitelist_for_brand(
                        tenant_id, project.brand_id, db
                    )
                    all_tenant_words = await get_forbidden_words_for_tenant(
                        tenant_id, db
                    )
                    efficacy_words = [
                        w["word"]
                        for w in all_tenant_words
                        if w.get("category") == "功效词"
                    ]
                    forbidden_words = [
                        w for w in all_tenant_words if w.get("category") != "功效词"
                    ]
                    db_platform_rules = await get_active_platform_rules(
                        tenant_id,
                        project.brand_id,
                        platform,
                        db,
                    )
                    learned_rules = await _get_brand_learned_rules(
                        project.config_scope_id or project.brand_id,
                        db,
                    )

                    rules_data = {
                        "forbidden_words": forbidden_words,
                        "efficacy_words": efficacy_words,
                        "competitors": competitors,
                        "whitelist": whitelist,
                        "platform_rules": db_platform_rules or {},
                    }

                    # 构建合规审核 prompt + 追加视频内容分析指令
                    base_prompt = _build_structured_prompt(
                        content=analysis_text,
                        platform=platform,
                        brief_data=brief_data,
                        rules_data=rules_data,
                        learned_rules=learned_rules,
                        review_mode="video",
                    )

                    # 视频专属分析指令（追加到合规 prompt 后面）
                    video_extra = f"""

<additional_video_context>
<approved_script>
{approved_script[:5000] if approved_script else "（无法获取审核通过的脚本）"}
</approved_script>
<subtitle_text>
{subtitle_text[:3000] if subtitle_text else "（未提取到字幕）"}
</subtitle_text>
<audio_track_analysis>
{json.dumps(audio_track_analysis, ensure_ascii=False)[:4000]}
</audio_track_analysis>
</additional_video_context>

<video_analysis_tasks>
除了上述合规审核外，还需在同一次 JSON 响应中增加 "video_content_analysis" 字段（与 conclusions 同级），完成以下分析：

1. **口误检测**：对比 <approved_script> 和 <video_content>，只标记产品名/品牌名/数据/价格说错等事实性错误。不标记口语化改编、语序调整、同义词替换。
2. **字幕准确性**：字幕和口播是否一致，字幕有无错别字。
3. **口播质量**：感染力、购买欲、平台适配度，0-100 评分。要结合 <audio_track_analysis> 的语调、情绪、节奏信息。
4. **音轨质量**：判断主播语气是否过平、过硬广、停顿或节奏问题；判断 BGM 是否喧宾夺主、风格不符、歌词抢信息；判断是否有明显噪音、回声、爆音、音量不稳。
5. **新增内容**：达人说了但脚本里没有的内容，是否合规、是否增强效果。
6. **脚本执行度**：按意群对比脚本和口播，逐段标记 matched/adapted/missing/reordered，整体 0-100 分。如无审核通过脚本则返回 null。

在你的 JSON 响应中新增：
"video_content_analysis": {{
  "delivery_quality": {{"score": 75, "engagement": "感染力", "purchase_intent": "购买欲", "platform_fit": "平台适配", "overall": "总评"}},
  "audio_track_analysis": {{
    "tone_summary": "音轨总评",
    "creator_guidance": {{
      "summary": "给达人的一句话总要求",
      "must_fix": ["必须先改的点"],
      "voiceover_plan": [
        {{
          "segment": "前段/中段/后段",
          "goal": "这段想传达什么",
          "emotion": "情绪",
          "pacing": "节奏",
          "instruction": "直接写给达人或剪辑师的话",
          "emphasis_words": ["要加重的词"]
        }}
      ],
      "bgm_plan": [
        {{
          "segment": "前段/转场/后段",
          "style": "BGM 风格",
          "action": "保留/替换/弱化/切歌",
          "cue_point": "卡点",
          "instruction": "直接写给剪辑师的执行建议"
        }}
      ]
    }},
    "delivery_signals": {{"tone": "语气", "emotion": "情绪", "energy_level": "高/中/低", "pacing": "节奏", "persuasiveness": "带货感染力", "brand_fit": "与品牌调性匹配度", "summary": "主播表达总结"}},
    "bgm": {{"present": true, "style": "轻快/舒缓/无", "intensity": "强/中/弱/无", "fit": "与内容匹配度", "lyrics_risk": false, "summary": "BGM 评价"}},
    "environment": {{"has_noise": false, "noise_types": [], "clarity_score": 90, "summary": "音质评价"}},
    "violations": [{{"type": "语气问题/BGM问题/噪音问题", "content": "问题", "severity": "高/中/低", "suggestion": "建议"}}]
  }},
  "speech_violations": [{{"type": "口误", "content": "问题", "severity": "高/中/低", "suggestion": "建议", "script_text": "脚本原文", "actual_text": "实际说的"}}],
  "subtitle_issues": [{{"type": "字幕错误", "content": "问题", "severity": "低", "suggestion": "建议"}}],
  "new_content": [{{"content": "新增内容", "compliant": true, "enhances": true, "note": "说明"}}],
  "script_match": {{"overall_score": 85, "overall_assessment": "评价", "suggestion_for_reviewer": "建议", "segments": [{{"script_segment": "段落", "segment_label": "类型", "status": "matched", "video_evidence": "视频内容", "note": ""}}], "structure_preserved": true, "missing_segments": [], "key_deviations": []}},
  "brand_exposure": {{"score": 80, "level": "high/medium/low", "analysis": "品牌曝光分析", "visible_duration_seconds": 3.5, "mention_duration_seconds": 2.0, "related_duration_seconds": 6.0, "evidence": ["证据1", "证据2"]}}
}}

补充要求：
- 要同时参考 <video_content>、<approved_script>、<subtitle_text>，不要只依赖单一来源
- 如果发现多个问题，必须拆成多条返回，不能只挑最严重的一条
- 对未准确口播产品名、核心卖点缺失、字幕漏字/错字、画面贴片问题，都要分别返回
- 必须检测品牌/产品明确出镜时长、明确提及品牌名称时长、品牌相关介绍时长；如果无法精确到小数，可给近似秒数，但不要留空
- 如果 <video_content> 或 <subtitle_text> 已经能看出口播内容，不要在 `audio_track_analysis` 里写“未检测到有效人声”“纯BGM”“提取失败”这类结论
</video_analysis_tasks>"""

                    combined_prompt = base_prompt + video_extra

                    # 单次 AI 调用（合规 + 内容分析）
                    try:
                        response = await ai_client.chat_completion(
                            messages=[{"role": "user", "content": combined_prompt}],
                            model=text_model,
                            temperature=0.2,
                            max_tokens=10000,
                        )

                        response_text = response.content.strip()
                        if response_text.startswith("```"):
                            response_text = response_text.split("\n", 1)[1]
                        if response_text.endswith("```"):
                            response_text = response_text.rsplit("\n", 1)[0]

                        ai_result = _robust_json_parse(response_text)

                        # 解析合规审核结果
                        (
                            chain_of_thought,
                            conclusions,
                            violations,
                            sp_matches,
                            dimensions,
                            content_type_det,
                            brand_exposure,
                        ) = _parse_ai_response(ai_result, brief_data=brief_data)

                        compliance_result = ScriptReviewResponse(
                            score=conclusions.overall_score,
                            summary=conclusions.overall_summary,
                            content_type=content_type_det,
                            chain_of_thought=chain_of_thought,
                            conclusions=conclusions,
                            dimensions=dimensions,
                            violations=violations,
                            selling_point_matches=sp_matches,
                            brand_exposure=brand_exposure,
                            ai_available=True,
                        )

                        # 提取视频内容分析结果
                        vca = ai_result.get("video_content_analysis", {})
                        content_analysis = {
                            "violations": vca.get("speech_violations", []),
                            "selling_point_coverage": [],
                            "delivery_quality": vca.get("delivery_quality", {}),
                            "new_content": vca.get("new_content", []),
                            "subtitle_issues": vca.get("subtitle_issues", []),
                            "script_match": vca.get("script_match"),
                            "brand_exposure": vca.get("brand_exposure"),
                            "audio_track_analysis": _repair_audio_track_analysis_with_transcript(
                                _merge_audio_track_analysis(
                                    audio_track_analysis,
                                    vca.get("audio_track_analysis"),
                                ),
                                speech_text,
                            ),
                        }

                        logger.info(
                            f"任务 {task_id} 合规+内容分析完成（单次调用），得分: {compliance_result.score}"
                        )

                    except Exception as e:
                        logger.error(f"任务 {task_id} 合并审核调用失败: {e}")
                        compliance_result = None
                        content_analysis = _default_content
                content_analysis["audio_track_analysis"] = _merge_audio_track_analysis(
                    audio_track_analysis,
                    content_analysis.get("audio_track_analysis"),
                )
                content_analysis["audio_track_analysis"] = _repair_audio_track_analysis_with_transcript(
                    content_analysis.get("audio_track_analysis"),
                    speech_text,
                )

                # ===== Step 5: 合并所有结果 =====
                all_violations: list[dict] = []

                # 合规审核违规
                if compliance_result:
                    all_violations.extend(
                        [v.model_dump() for v in compliance_result.violations]
                    )

                # 视觉审核违规
                for vv in visual_result.get("violations", []):
                    severity = _normalize_severity(vv.get("severity"))
                    all_violations.append(
                        {
                            "type": vv.get("type", "品牌安全"),
                            "content": vv.get("content", ""),
                            "severity": severity,
                            "suggestion": vv.get("suggestion", ""),
                            "dimension": vv.get("dimension", "品牌安全"),
                            "fixable": vv.get("fixable", True),
                            "timestamp": vv.get("timestamp"),
                            "source": "画面",
                        }
                    )

                # 口误/事实错误
                for cv in content_analysis.get("violations", []):
                    severity = _normalize_severity(cv.get("severity"))
                    all_violations.append(
                        {
                            "type": cv.get("type", "口误"),
                            "content": cv.get("content", ""),
                            "severity": severity,
                            "suggestion": cv.get("suggestion", ""),
                            "dimension": cv.get("dimension", "内容质量"),
                            "fixable": cv.get("fixable", True),
                            "source": "语音",
                            "script_text": cv.get("script_text", ""),
                            "actual_text": cv.get("actual_text", ""),
                        }
                    )

                # 音轨问题（语气/BGM/环境声）
                for av in content_analysis.get("audio_track_analysis", {}).get("violations", []):
                    severity = _normalize_severity(av.get("severity"))
                    all_violations.append(
                        {
                            "type": av.get("type", "音频问题"),
                            "content": av.get("content", ""),
                            "severity": severity,
                            "suggestion": av.get("suggestion", ""),
                            "dimension": "内容质量",
                            "fixable": True,
                            "source": "音频",
                        }
                    )

                # 字幕问题
                for si in content_analysis.get("subtitle_issues", []):
                    severity = _normalize_severity(si.get("severity"))
                    all_violations.append(
                        {
                            "type": "字幕错误",
                            "content": si.get("content", ""),
                            "severity": severity,
                            "suggestion": si.get("suggestion", ""),
                            "dimension": "内容质量",
                            "fixable": True,
                            "source": "字幕",
                        }
                    )

                # 新增内容中不合规的
                for nc in content_analysis.get("new_content", []):
                    if not nc.get("compliant", True):
                        all_violations.append(
                            {
                                "type": "口误",
                                "content": f"达人新增内容不合规：{nc.get('content', '')}",
                                "severity": "中",
                                "suggestion": nc.get("note", "请删除或修改此段内容"),
                                "dimension": "内容质量",
                                "fixable": True,
                                "source": "语音",
                            }
                        )

                # 计算最终分数
                base_score = compliance_result.score if compliance_result else 50

                for vv in visual_result.get("violations", []):
                    sev = _normalize_severity(vv.get("severity"))
                    if sev == "high":
                        base_score = max(0, base_score - 15)
                    elif sev == "medium":
                        base_score = max(0, base_score - 8)
                    else:
                        base_score = max(0, base_score - 3)

                for cv in content_analysis.get("violations", []) + content_analysis.get(
                    "subtitle_issues", []
                ):
                    sev = _normalize_severity(cv.get("severity"))
                    if sev == "high":
                        base_score = max(0, base_score - 15)
                    elif sev == "medium":
                        base_score = max(0, base_score - 5)
                    else:
                        base_score = max(0, base_score - 2)

                for av in content_analysis.get("audio_track_analysis", {}).get("violations", []):
                    sev = _normalize_severity(av.get("severity"))
                    if sev == "high":
                        base_score = max(0, base_score - 12)
                    elif sev == "medium":
                        base_score = max(0, base_score - 4)
                    else:
                        base_score = max(0, base_score - 2)

                for nc in content_analysis.get("new_content", []):
                    if not nc.get("compliant", True):
                        base_score = max(0, base_score - 10)

                video_score = base_score

                # 构建最终结果
                video_result = {
                    "score": video_score,
                    "summary": compliance_result.summary
                    if compliance_result
                    else "视频审核完成",
                    "violations": all_violations,
                    "soft_warnings": (
                        [w.model_dump() for w in compliance_result.soft_warnings]
                        if compliance_result
                        else []
                    ),
                    "dimensions": (
                        compliance_result.dimensions.model_dump()
                        if compliance_result and compliance_result.dimensions
                        else None
                    ),
                    "selling_point_matches": (
                        [
                            sp.model_dump()
                            for sp in compliance_result.selling_point_matches
                        ]
                        if compliance_result
                        else []
                    ),
                    "brand_exposure": (
                        content_analysis.get("brand_exposure")
                        or (
                            compliance_result.brand_exposure.model_dump()
                            if compliance_result and compliance_result.brand_exposure
                            else None
                        )
                    ),
                    "ai_available": True,
                    "speech_transcript": speech_text if asr_success else None,
                    "asr_available": asr_success,
                    "text_source": text_source,
                    "subtitle_text": subtitle_text,
                    "subtitle_issues": content_analysis.get("subtitle_issues"),
                    "delivery_quality": content_analysis.get("delivery_quality"),
                    "audio_track_analysis": content_analysis.get("audio_track_analysis"),
                    "selling_point_coverage": content_analysis.get(
                        "selling_point_coverage"
                    ),
                    "new_content_analysis": content_analysis.get("new_content"),
                    "script_match": content_analysis.get("script_match")
                    if approved_script
                    else None,
                    "frames_analyzed": len(frames),
                }
                if compliance_result and compliance_result.chain_of_thought:
                    video_result["chain_of_thought"] = (
                        compliance_result.chain_of_thought.model_dump()
                    )
                if compliance_result and compliance_result.conclusions:
                    video_result["conclusions"] = (
                        compliance_result.conclusions.model_dump()
                    )
                video_result = _build_video_ai_result_payload(
                    video_result,
                    task.video_duration,
                ) or video_result

            finally:
                # 清理所有临时文件
                for path in [video_temp_path, audio_temp_path]:
                    if path:
                        try:
                            os.unlink(path)
                        except Exception:
                            pass
                if frames_dir:
                    try:
                        shutil.rmtree(frames_dir, ignore_errors=True)
                    except Exception:
                        pass

            task = await get_task_by_id(db, task_id)
            task = await complete_ai_review(
                db=db,
                task=task,
                review_type="video",
                score=video_score,
                result=video_result,
            )
            await db.commit()

            ai_auto_rejected = task.video_ai_result and task.video_ai_result.get(
                "ai_auto_rejected"
            )
            logger.info(
                f"任务 {task_id} 视频 AI 审核完成，得分: {video_score}，自动驳回: {ai_auto_rejected}"
            )

            if ai_auto_rejected:
                # AI 标记严重问题：推进到代理商审核，由代理商决定是否打回达人
                try:
                    agency_result = await db.execute(
                        select(Agency).where(Agency.id == task.agency_id)
                    )
                    agency_obj = agency_result.scalar_one_or_none()
                    if agency_obj:
                        await notify_task_updated(
                            task_id=task.id,
                            user_ids=[agency_obj.user_id],
                            data={
                                "action": "ai_auto_rejected",
                                "stage": task.stage.value,
                                "score": video_score,
                            },
                        )
                        await create_message(
                            db=db,
                            user_id=agency_obj.user_id,
                            type="task",
                            title="视频 AI 审核：发现严重问题",
                            content=f"任务「{task.name}」AI 审核发现严重违规（{video_score} 分），请在工作台处理后决定是否打回达人。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                        await db.commit()
                except Exception:
                    pass
            else:
                # 正常通过：SSE 通知达人和代理商 + 消息通知代理商
                try:
                    user_ids = []
                    creator_result = await db.execute(
                        select(Creator).where(Creator.id == task.creator_id)
                    )
                    creator_obj = creator_result.scalar_one_or_none()
                    if creator_obj:
                        user_ids.append(creator_obj.user_id)

                    agency_result = await db.execute(
                        select(Agency).where(Agency.id == task.agency_id)
                    )
                    agency_obj = agency_result.scalar_one_or_none()
                    if agency_obj:
                        user_ids.append(agency_obj.user_id)

                    if user_ids:
                        await notify_task_updated(
                            task_id=task.id,
                            user_ids=user_ids,
                            data={
                                "action": "ai_review_completed",
                                "stage": task.stage.value,
                                "score": video_score,
                            },
                        )
                except Exception:
                    pass

                try:
                    # 通知达人视频 AI 审核已通过
                    if creator_obj:
                        await create_message(
                            db=db,
                            user_id=creator_obj.user_id,
                            type="task",
                            title="视频通过 AI 审核",
                            content=f"任务「{task.name}」视频已通过 AI 审核（{video_score} 分），已进入代理商审核环节。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    # 通知代理商有新视频待审核
                    ag_result = await db.execute(
                        select(Agency).where(Agency.id == task.agency_id)
                    )
                    ag_obj = ag_result.scalar_one_or_none()
                    if ag_obj:
                        await create_message(
                            db=db,
                            user_id=ag_obj.user_id,
                            type="task",
                            title="视频 AI 审核完成",
                            content=f"任务「{task.name}」视频 AI 审核完成，得分 {video_score} 分，请审核。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    await db.commit()
                except Exception:
                    pass

            # AI 不可用时通知品牌方和达人
            if not video_result.get("ai_available", True):
                try:
                    brand_result = await db.execute(
                        select(Brand).where(Brand.id == project.brand_id)
                    )
                    brand_obj = brand_result.scalar_one_or_none()
                    if brand_obj and brand_obj.user_id:
                        await create_message(
                            db=db,
                            user_id=brand_obj.user_id,
                            type="system",
                            title="视频 AI 审核服务不可用",
                            content=f"任务「{task.name}」的视频 AI 审核服务当前不可用，请前往「AI 配置」检查设置。任务已直接进入人工审核阶段。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    creator_result2 = await db.execute(
                        select(Creator).where(Creator.id == task.creator_id)
                    )
                    creator_obj2 = creator_result2.scalar_one_or_none()
                    if creator_obj2:
                        await create_message(
                            db=db,
                            user_id=creator_obj2.user_id,
                            type="system",
                            title="视频 AI 审核暂时不可用",
                            content=f"任务「{task.name}」的 AI 审核暂时不可用，您的视频已直接进入人工审核阶段，请耐心等待。",
                            related_task_id=task.id,
                            sender_name="系统",
                        )
                    await db.commit()
                except Exception:
                    pass

        except Exception as e:
            logger.error(f"任务 {task_id} 视频 AI 审核失败: {e}", exc_info=True)
            await db.rollback()
            # 视频 AI 审核失败时回退 stage 并清除旧 AI 数据，避免任务永远卡住
            try:
                task_obj = await get_task_by_id(db, task_id)
                if task_obj and task_obj.stage.value == "video_ai_review":
                    task_obj.stage = TaskStage.VIDEO_UPLOAD
                    task_obj.video_ai_score = None
                    task_obj.video_ai_result = None
                    await db.commit()
                    logger.info(
                        f"任务 {task_id} 视频 AI 审核失败，已回退到视频上传阶段并清除旧审核数据"
                    )
            except Exception as rollback_err:
                logger.error(f"任务 {task_id} 回退阶段失败: {rollback_err}")
            # AI 审核异常时通知品牌方
            try:
                brand_result = await db.execute(
                    select(Brand).where(Brand.id == tenant_id)
                )
                brand_obj = brand_result.scalar_one_or_none()
                if brand_obj and brand_obj.user_id:
                    await create_message(
                        db=db,
                        user_id=brand_obj.user_id,
                        type="task",
                        title="视频 AI 审核异常",
                        content=f"任务视频 AI 审核过程中出错，审核结果可能不完整，请检查 AI 服务配置。错误信息：{str(e)[:100]}",
                        related_task_id=task_id,
                        sender_name="系统",
                    )
                    await db.commit()
            except Exception:
                pass


def _task_to_response(task: Task) -> TaskResponse:
    """将数据库模型转换为响应模型"""
    # 优先从 Brief 获取产品名称（AI 审核专用），否则回退到品牌方设置的公司名
    brand_name = None
    if task.project and task.project.brief and task.project.brief.product_name:
        brand_name = task.project.brief.product_name
    elif task.project and task.project.brand:
        brand_name = task.project.brand.name
    elif task.project and task.project.brand_display_name:
        brand_name = task.project.brand_display_name

    creator_name = task.creator.name if task.creator else (task.creator_display_name or "未填写")
    creator_id = task.creator.id if task.creator else None
    creator_avatar = task.creator.avatar if task.creator else None
    creator_platform = getattr(task, "creator_platform", None)
    creator_remark = getattr(task, "creator_remark", None)

    return TaskResponse(
        id=task.id,
        name=task.name,
        sequence=task.sequence,
        stage=task.stage,
        project=ProjectInfo(
            id=task.project.id,
            name=task.project.name,
            brand_name=brand_name,
            client_display_name=getattr(task.project, "client_display_name", None),
            brand_display_name=getattr(task.project, "brand_display_name", None),
            project_remark=getattr(task.project, "project_remark", None),
            platform=getattr(task.project, "platform", None),
        ),
        agency=AgencyInfo(
            id=task.agency.id,
            name=task.agency.name,
        ),
        creator=CreatorInfo(
            id=creator_id,
            name=creator_name,
            avatar=creator_avatar,
            platform=creator_platform,
            remark=creator_remark,
        ),
        script_file_url=task.script_file_url,
        script_file_name=task.script_file_name,
        script_text_content=task.script_text_content,
        script_uploaded_at=task.script_uploaded_at,
        script_ai_score=task.script_ai_score,
        script_ai_result=task.script_ai_result,
        script_agency_corrected=task.script_agency_corrected,
        script_agency_corrected_file_url=task.script_agency_corrected_file_url,
        script_agency_corrected_file_name=task.script_agency_corrected_file_name,
        script_agency_corrected_file_type=task.script_agency_corrected_file_type,
        script_agency_status=task.script_agency_status,
        script_agency_comment=task.script_agency_comment,
        script_agency_reviewed_at=task.script_agency_reviewed_at,
        script_brand_status=task.script_brand_status,
        script_brand_comment=task.script_brand_comment,
        script_brand_reviewed_at=task.script_brand_reviewed_at,
        video_file_url=task.video_file_url,
        video_file_name=task.video_file_name,
        video_duration=task.video_duration,
        video_thumbnail_url=task.video_thumbnail_url,
        video_uploaded_at=task.video_uploaded_at,
        video_ai_score=task.video_ai_score,
        video_ai_result=_build_video_ai_result_payload(
            task.video_ai_result,
            task.video_duration,
        ),
        video_agency_status=task.video_agency_status,
        video_agency_comment=task.video_agency_comment,
        video_agency_reviewed_at=task.video_agency_reviewed_at,
        video_brand_status=task.video_brand_status,
        video_brand_comment=task.video_brand_comment,
        video_brand_reviewed_at=task.video_brand_reviewed_at,
        appeal_count=task.appeal_count,
        is_appeal=task.is_appeal,
        appeal_reason=task.appeal_reason,
        appeal_request_status=task.appeal_request_status,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _task_to_summary(task: Task) -> TaskSummary:
    """将任务转换为摘要"""
    creator_name = task.creator.name if task.creator else (task.creator_display_name or "未填写")
    creator_avatar = task.creator.avatar if task.creator else None
    return TaskSummary(
        id=task.id,
        name=task.name,
        stage=task.stage,
        creator_name=creator_name,
        creator_avatar=creator_avatar,
        project_name=task.project.name,
        is_appeal=task.is_appeal,
        appeal_reason=task.appeal_reason,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


# ===== 任务创建 =====


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_new_task(
    request: TaskCreateRequest,
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """
    创建任务（代理商操作）

    - 代理商为指定达人创建任务
    - 同一项目同一达人可以创建多个任务
    - 任务名称自动生成为 "{项目名} 任务N"
    """
    # 验证项目是否存在
    result = await db.execute(select(Project).where(Project.id == request.project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="项目不存在",
        )

    # 验证达人是否存在
    result = await db.execute(select(Creator).where(Creator.id == request.creator_id))
    creator = result.scalar_one_or_none()
    if not creator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="达人不存在",
        )

    # 创建任务
    task = await create_task(
        db=db,
        project_id=request.project_id,
        agency_id=agency.id,
        creator_id=request.creator_id,
        name=request.name,
    )

    await db.commit()

    # 重新加载关联
    task = await get_task_by_id(db, task.id)

    # 提取通知所需的值（commit 后 ORM 对象会过期，提前缓存）
    _task_id = task.id
    _task_name = task.name
    _project_id = task.project.id
    _project_name = task.project.name
    _project_brand_id = task.project.brand_id
    _agency_name = agency.name
    _creator_user_id = creator.user_id
    _creator_name = creator.name or creator.id

    # 创建消息 + SSE 通知达人有新任务
    try:
        await create_message(
            db=db,
            user_id=_creator_user_id,
            type="new_task",
            title="新任务分配",
            content=f"您有新的任务「{_task_name}」，来自项目「{_project_name}」",
            related_task_id=_task_id,
            related_project_id=_project_id,
            sender_name=_agency_name,
        )
        await db.commit()
    except Exception as e:
        logger.warning(f"创建达人通知消息失败: {e}")

    # 通知品牌方：代理商给项目添加了达人
    try:
        brand_result = await db.execute(
            select(Brand).where(Brand.id == _project_brand_id)
        )
        brand = brand_result.scalar_one_or_none()
        if brand and brand.user_id:
            await create_message(
                db=db,
                user_id=brand.user_id,
                type="new_task",
                title="达人加入项目",
                content=f"代理商「{_agency_name}」将达人「{_creator_name}」加入项目「{_project_name}」，任务：{_task_name}",
                related_task_id=_task_id,
                related_project_id=_project_id,
                sender_name=_agency_name,
            )
            await db.commit()
        else:
            logger.warning(f"品牌方不存在或无 user_id: brand_id={_project_brand_id}")
    except Exception as e:
        logger.warning(f"创建品牌方通知消息失败: {e}")

    try:
        await notify_new_task(
            task_id=_task_id,
            creator_user_id=_creator_user_id,
            task_name=_task_name,
            project_name=_project_name,
        )
    except Exception as e:
        logger.warning(f"SSE 通知失败: {e}")

    return _task_to_response(task)


# ===== 任务查询 =====


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    stage: Optional[TaskStage] = Query(None),
    project_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    查询任务列表

    - 达人: 查看分配给自己的任务
    - 代理商: 查看自己创建的任务
    - 品牌方: 查看自己项目下的所有任务
    """
    if current_user.role == UserRole.CREATOR:
        result = await db.execute(
            select(Creator).where(Creator.user_id == current_user.id)
        )
        creator = result.scalar_one_or_none()
        if not creator:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="达人信息不存在",
            )
        tasks, total = await list_tasks_for_creator(
            db, creator.id, page, page_size, stage
        )

    elif current_user.role == UserRole.AGENCY:
        result = await db.execute(
            select(Agency).where(Agency.user_id == current_user.id)
        )
        agency = result.scalar_one_or_none()
        if not agency:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="代理商信息不存在",
            )
        tasks, total = await list_tasks_for_agency(
            db, agency.id, page, page_size, stage, project_id
        )

    elif current_user.role == UserRole.BRAND:
        result = await db.execute(select(Brand).where(Brand.user_id == current_user.id))
        brand = result.scalar_one_or_none()
        if not brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="品牌方信息不存在",
            )
        tasks, total = await list_tasks_for_brand(
            db, brand.id, page, page_size, stage, project_id
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权限访问",
        )

    return TaskListResponse(
        items=[_task_to_response(t) for t in tasks],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/pending", response_model=ReviewTaskListResponse)
async def list_pending_reviews(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取待审核任务列表

    - 代理商: 获取待代理商审核的任务
    - 品牌方: 获取待品牌方终审的任务
    """
    if current_user.role == UserRole.AGENCY:
        result = await db.execute(
            select(Agency).where(Agency.user_id == current_user.id)
        )
        agency = result.scalar_one_or_none()
        if not agency:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="代理商信息不存在",
            )
        tasks, total = await list_pending_reviews_for_agency(
            db, agency.id, page, page_size
        )

    elif current_user.role == UserRole.BRAND:
        result = await db.execute(select(Brand).where(Brand.user_id == current_user.id))
        brand = result.scalar_one_or_none()
        if not brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="品牌方信息不存在",
            )
        tasks, total = await list_pending_reviews_for_brand(
            db, brand.id, page, page_size
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅代理商和品牌方可查看待审核任务",
        )

    return ReviewTaskListResponse(
        items=[_task_to_summary(t) for t in tasks],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    查询任务详情
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    # 权限检查
    has_permission = await check_task_permission(task, current_user, db)
    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权访问此任务",
        )

    return _task_to_response(task)


# ===== 文件上传 =====


@router.post("/{task_id}/script", response_model=TaskResponse)
async def upload_task_script(
    task_id: str,
    request: TaskScriptUploadRequest,
    creator: Creator = Depends(get_current_creator),
    db: AsyncSession = Depends(get_db),
):
    """
    上传/更新脚本（达人操作）

    - 只能在 script_upload 阶段上传
    - 上传后自动进入 AI 审核
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    if task.creator_id != creator.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能上传自己任务的脚本",
        )

    try:
        task = await upload_script(
            db=db,
            task=task,
            file_url=request.file_url,
            file_name=request.file_name,
            text_content=request.text_content,
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # 重新加载关联
    task = await get_task_by_id(db, task.id)

    # 通知代理商脚本已上传（消息 + SSE）
    try:
        result = await db.execute(select(Agency).where(Agency.id == task.agency_id))
        agency_obj = result.scalar_one_or_none()
        if agency_obj:
            await create_message(
                db=db,
                user_id=agency_obj.user_id,
                type="task",
                title="达人已上传脚本",
                content=f"任务「{task.name}」的脚本已上传，等待 AI 审核。",
                related_task_id=task.id,
                sender_name=creator.name,
            )
            await db.commit()
            await notify_task_updated(
                task_id=task.id,
                user_ids=[agency_obj.user_id],
                data={"action": "script_uploaded", "stage": task.stage.value},
            )
    except Exception:
        pass

    # 获取 tenant_id（配置空间 ID）并触发 AI 审核
    try:
        project_result = await db.execute(
            select(Project).where(Project.id == task.project_id)
        )
        project = project_result.scalar_one_or_none()
        if project:
            ai_scope_id = _resolve_project_ai_scope_id(project)
            if not ai_scope_id:
                raise ValueError("任务缺少可用的 AI 配置空间")
            if settings.USE_CELERY:
                from app.tasks.review import script_ai_review_task

                script_ai_review_task.delay(task.id, ai_scope_id)
                logger.info(f"已触发任务 {task.id} 的 Celery AI 审核")
            else:
                asyncio.create_task(
                    _run_ai_review_with_timeout(
                        _run_script_ai_review, task.id, ai_scope_id, "script"
                    )
                )
                logger.info(
                    f"已触发任务 {task.id} 的后台 AI 审核（超时 {_get_ai_review_timeout('script')}s）"
                )
    except Exception as e:
        logger.error(f"触发 AI 审核失败: {e}")

    return _task_to_response(task)


@router.post("/{task_id}/video", response_model=TaskResponse)
async def upload_task_video(
    task_id: str,
    request: TaskVideoUploadRequest,
    creator: Creator = Depends(get_current_creator),
    db: AsyncSession = Depends(get_db),
):
    """
    上传/更新视频（达人操作）

    - 只能在 video_upload 阶段上传
    - 上传后自动进入 AI 审核
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    if task.creator_id != creator.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能上传自己任务的视频",
        )

    try:
        task = await upload_video(
            db=db,
            task=task,
            file_url=request.file_url,
            file_name=request.file_name,
            duration=request.duration,
            thumbnail_url=request.thumbnail_url,
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # 重新加载关联
    task = await get_task_by_id(db, task.id)

    # 通知代理商视频已上传（消息 + SSE）
    try:
        result = await db.execute(select(Agency).where(Agency.id == task.agency_id))
        agency_obj = result.scalar_one_or_none()
        if agency_obj:
            await create_message(
                db=db,
                user_id=agency_obj.user_id,
                type="task",
                title="达人已上传视频",
                content=f"任务「{task.name}」的视频已上传，等待 AI 审核。",
                related_task_id=task.id,
                sender_name=creator.name,
            )
            await db.commit()
            await notify_task_updated(
                task_id=task.id,
                user_ids=[agency_obj.user_id],
                data={"action": "video_uploaded", "stage": task.stage.value},
            )
    except Exception:
        pass

    # 获取 tenant_id（配置空间 ID）并触发视频 AI 审核
    try:
        project_result = await db.execute(
            select(Project).where(Project.id == task.project_id)
        )
        project = project_result.scalar_one_or_none()
        if project:
            ai_scope_id = _resolve_project_ai_scope_id(project)
            if not ai_scope_id:
                raise ValueError("任务缺少可用的 AI 配置空间")
            if settings.USE_CELERY:
                from app.tasks.review import video_ai_review_task

                video_ai_review_task.delay(task.id, ai_scope_id)
                logger.info(f"已触发任务 {task.id} 的 Celery 视频 AI 审核")
            else:
                asyncio.create_task(
                    _run_ai_review_with_timeout(
                        _run_video_ai_review, task.id, ai_scope_id, "video"
                    )
                )
                logger.info(
                    f"已触发任务 {task.id} 的后台视频 AI 审核（超时 {_get_ai_review_timeout('video')}s）"
                )
    except Exception as e:
        logger.error(f"触发视频 AI 审核失败: {e}")

    return _task_to_response(task)


# ===== 审核操作 =====


@router.post("/{task_id}/script/review", response_model=TaskResponse)
async def review_script(
    task_id: str,
    request: TaskReviewRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    审核脚本

    - 代理商: 在 script_agency_review 阶段审核
    - 品牌方: 在 script_brand_review 阶段审核
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    try:
        if current_user.role in {UserRole.AGENCY, UserRole.OPERATOR}:
            if task.stage != TaskStage.SCRIPT_AGENCY_REVIEW:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="当前阶段不在代理商审核中",
                )

            has_permission = await check_task_permission(task, current_user, db)
            if not has_permission:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="无权审核此任务",
                )

            task = await agency_review(
                db=db,
                task=task,
                reviewer_id=current_user.id,
                action=request.action,
                skip_brand_review=current_user.role == UserRole.OPERATOR,
                comment=request.comment,
                corrected_script=request.corrected_script,
                corrected_file_url=request.corrected_file_url,
                corrected_file_name=request.corrected_file_name,
                corrected_file_type=request.corrected_file_type,
            )

        elif current_user.role == UserRole.BRAND:
            if task.stage != TaskStage.SCRIPT_BRAND_REVIEW:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="当前阶段不在品牌方审核中",
                )

            result = await db.execute(
                select(Brand).where(Brand.user_id == current_user.id)
            )
            brand = result.scalar_one_or_none()
            if not brand:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="无权审核此任务",
                )

            # 验证任务属于该品牌
            if task.project.brand_id != brand.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="无权审核此任务",
                )

            # 品牌方只能 pass 或 reject
            if request.action == "force_pass":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="品牌方审核不支持此操作",
                )

            task = await brand_review(
                db=db,
                task=task,
                reviewer_id=current_user.id,
                action=request.action,
                comment=request.comment,
            )

        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="仅代理商、代运营和品牌方可审核",
            )

        await db.commit()

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # 重新加载关联并立即返回响应
    task = await get_task_by_id(db, task.id)
    response = _task_to_response(task)

    # 消息/SSE/学习全部放到后台执行，不阻塞 HTTP 响应
    _bg_task_id = task.id
    _bg_task_name = task.name
    _bg_task_stage = task.stage.value
    _bg_creator_id = task.creator_id
    _bg_agency_id = task.agency_id
    _bg_brand_id = task.project.brand_id if task.project else ""
    _bg_tenant_scope_id = (
        (task.project.config_scope_id or task.project.brand_id) if task.project else ""
    )
    _bg_tenant_scope_id = (
        (task.project.config_scope_id or task.project.brand_id) if task.project else ""
    )
    _bg_action = request.action
    _bg_comment = request.comment
    _bg_reviewer_name = current_user.name
    _bg_reviewer_role = current_user.role
    _bg_ai_result = task.script_ai_result
    _bg_corrected_script = task.script_agency_corrected

    async def _script_review_post_tasks():
        async with AsyncSessionLocal() as bg_db:
            try:
                # 通知达人
                result = await bg_db.execute(
                    select(Creator).where(Creator.id == _bg_creator_id)
                )
                creator_obj = result.scalar_one_or_none()
                if creator_obj:
                    reviewer_type = (
                        "agency"
                        if _bg_reviewer_role in {UserRole.AGENCY, UserRole.OPERATOR}
                        else "brand"
                    )
                    action_text = {
                        "pass": "通过",
                        "reject": "驳回",
                        "force_pass": "通过（跳过品牌终审）",
                    }.get(_bg_action, _bg_action)
                    await create_message(
                        db=bg_db,
                        user_id=creator_obj.user_id,
                        type="pass" if _bg_action == "force_pass" else _bg_action,
                        title=f"脚本审核{action_text}",
                        content=f"您的任务「{_bg_task_name}」脚本已被{action_text}，进入视频拍摄阶段"
                        if _bg_action == "force_pass"
                        else f"您的任务「{_bg_task_name}」脚本已被{action_text}"
                        + (f"，评语：{_bg_comment}" if _bg_comment else ""),
                        related_task_id=_bg_task_id,
                        sender_name=_bg_reviewer_name,
                    )
                    await bg_db.commit()
                    await notify_review_decision(
                        task_id=_bg_task_id,
                        creator_user_id=creator_obj.user_id,
                        review_type="script",
                        reviewer_type=reviewer_type,
                        action="pass" if _bg_action == "force_pass" else _bg_action,
                        comment=_bg_comment,
                    )
                    await notify_task_updated(
                        task_id=_bg_task_id,
                        user_ids=[creator_obj.user_id],
                        data={
                            "action": f"script_{_bg_action}",
                            "stage": _bg_task_stage,
                        },
                    )
                    if (
                        _bg_reviewer_role in {UserRole.AGENCY, UserRole.OPERATOR}
                        and _bg_action in ("pass", "force_pass")
                        and _bg_corrected_script
                    ):
                        await create_message(
                            db=bg_db,
                            user_id=creator_obj.user_id,
                            type="script_corrected",
                            title="代理商已提交修正稿",
                            content=_build_corrected_script_message(_bg_corrected_script),
                            related_task_id=_bg_task_id,
                            sender_name=_bg_reviewer_name,
                        )
                        await bg_db.commit()

                # 代理商通过且进入品牌终审 → 通知品牌方
                if _bg_reviewer_role in {UserRole.AGENCY, UserRole.OPERATOR} and _bg_action in (
                    "pass",
                    "force_pass",
                ):
                    should_notify_brand = _bg_task_stage == TaskStage.SCRIPT_BRAND_REVIEW.value
                    should_inform_skip = _bg_action == "force_pass"
                    if should_notify_brand or should_inform_skip:
                        brand_result = await bg_db.execute(
                            select(Brand).where(Brand.id == _bg_brand_id)
                        )
                        brand_obj = brand_result.scalar_one_or_none()
                        if brand_obj:
                            if should_inform_skip:
                                await create_message(
                                    db=bg_db,
                                    user_id=brand_obj.user_id,
                                    type="task",
                                    title="脚本已通过（跳过终审）",
                                    content=f"任务「{_bg_task_name}」脚本已由代理商审核通过并跳过品牌终审，直接进入视频拍摄阶段。您仍可查看脚本内容。",
                                    related_task_id=_bg_task_id,
                                    sender_name=_bg_reviewer_name,
                                )
                            elif should_notify_brand:
                                await create_message(
                                    db=bg_db,
                                    user_id=brand_obj.user_id,
                                    type="task",
                                    title="新脚本待审核",
                                    content=f"任务「{_bg_task_name}」脚本已通过代理商审核，请进行品牌终审。",
                                    related_task_id=_bg_task_id,
                                    sender_name=_bg_reviewer_name,
                                )
                            await bg_db.commit()
                            await notify_task_updated(
                                task_id=_bg_task_id,
                                user_ids=[brand_obj.user_id],
                                data={
                                    "action": "script_pending_brand_review"
                                    if should_notify_brand
                                    else "script_skip_brand_review",
                                    "stage": _bg_task_stage,
                                },
                            )

                # 品牌方审核 → 通知代理商结果
                if _bg_reviewer_role == UserRole.BRAND:
                    ag_result = await bg_db.execute(
                        select(Agency).where(Agency.id == _bg_agency_id)
                    )
                    ag_obj = ag_result.scalar_one_or_none()
                    if ag_obj:
                        action_text = {"pass": "通过", "reject": "驳回"}.get(
                            _bg_action, _bg_action
                        )
                        await create_message(
                            db=bg_db,
                            user_id=ag_obj.user_id,
                            type="task",
                            title=f"脚本品牌终审{action_text}",
                            content=f"任务「{_bg_task_name}」脚本品牌终审已{action_text}"
                            + (f"，评语：{_bg_comment}" if _bg_comment else ""),
                            related_task_id=_bg_task_id,
                            sender_name=_bg_reviewer_name,
                        )
                        await bg_db.commit()
                        await notify_task_updated(
                            task_id=_bg_task_id,
                            user_ids=[ag_obj.user_id],
                            data={
                                "action": f"script_brand_{_bg_action}",
                                "stage": _bg_task_stage,
                            },
                        )
            except Exception as e:
                logger.warning(f"脚本审核后台通知失败: task={_bg_task_id}, error={e}")

            # 学习触发
            try:
                logger.info(
                    f"脚本审核学习判断: task={_bg_task_id}, action={_bg_action}, "
                    f"reviewer_role={_bg_reviewer_role}, has_ai_result={bool(_bg_ai_result)}, "
                    f"ai_auto_rejected={_bg_ai_result.get('ai_auto_rejected', 'N/A') if _bg_ai_result else 'N/A'}, "
                    f"ai_score={_bg_ai_result.get('score', 'N/A') if _bg_ai_result else 'N/A'}"
                )
                if _bg_ai_result:
                    _tenant_id = _bg_tenant_scope_id
                    if _bg_action == "reject":
                        reviewer_role = (
                            "agency"
                            if _bg_reviewer_role in {UserRole.AGENCY, UserRole.OPERATOR}
                            else "brand"
                        )
                        await _trigger_tighten_learning(
                            task_id=_bg_task_id,
                            comment=_bg_comment,
                            tenant_id=_tenant_id,
                            reviewer_role=reviewer_role,
                            review_type="script",
                        )
                        logger.info(f"已触发脚本收紧学习: task={_bg_task_id}")
                    elif (
                        _bg_action in ("pass", "force_pass")
                        and _bg_reviewer_role in {UserRole.AGENCY, UserRole.OPERATOR}
                    ):
                        ai_auto_rejected = _bg_ai_result.get("ai_auto_rejected", False)
                        ai_score = _bg_ai_result.get("score", 100)
                        conclusions = _bg_ai_result.get("conclusions")
                        violations = []
                        if conclusions and isinstance(conclusions, dict):
                            violations = conclusions.get("violations", [])
                        if not violations:
                            violations = _bg_ai_result.get("violations", [])
                        logger.info(
                            f"脚本覆盖学习条件: task={_bg_task_id}, ai_auto_rejected={ai_auto_rejected}, "
                            f"violations_count={len(violations)}"
                        )
                        if ai_auto_rejected or violations:
                            await _trigger_brand_learning(
                                task_id=_bg_task_id,
                                comment=_bg_comment,
                                tenant_id=_tenant_id,
                                review_type="script",
                            )
                            logger.info(f"已触发脚本覆盖学习: task={_bg_task_id}")
                        elif (
                            ai_score < AI_SOFT_DISAGREE_THRESHOLD
                            and _bg_task_stage == "video_upload"
                        ):
                            await _trigger_soft_widen_learning(
                                task_id=_bg_task_id,
                                comment=_bg_comment,
                                tenant_id=_tenant_id,
                                review_type="script",
                            )
                            logger.info(f"已触发脚本低分通过学习: task={_bg_task_id}")
                    elif _bg_action == "pass" and _bg_reviewer_role == UserRole.BRAND:
                        if not _bg_ai_result.get("ai_auto_rejected"):
                            ai_score = _bg_ai_result.get("score", 100)
                            if ai_score < AI_SOFT_DISAGREE_THRESHOLD:
                                await _trigger_soft_widen_learning(
                                    task_id=_bg_task_id,
                                    comment=_bg_comment,
                                    tenant_id=_tenant_id,
                                    review_type="script",
                                )
                                logger.info(
                                    f"已触发脚本低分通过学习(品牌方): task={_bg_task_id}"
                                )
                else:
                    logger.warning(
                        f"脚本审核学习跳过: task={_bg_task_id}, script_ai_result 为空"
                    )
            except Exception as e:
                logger.warning(f"脚本审核学习触发失败: task={_bg_task_id}, error={e}")

    asyncio.create_task(_script_review_post_tasks())

    return response


@router.post("/{task_id}/video/review", response_model=TaskResponse)
async def review_video(
    task_id: str,
    request: TaskReviewRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    审核视频

    - 代理商: 在 video_agency_review 阶段审核
    - 品牌方: 在 video_brand_review 阶段审核
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    try:
        if current_user.role in {UserRole.AGENCY, UserRole.OPERATOR}:
            if task.stage != TaskStage.VIDEO_AGENCY_REVIEW:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="当前阶段不在代理商审核中",
                )

            has_permission = await check_task_permission(task, current_user, db)
            if not has_permission:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="无权审核此任务",
                )

            # 视频审核不支持跳过品牌终审
            if request.action == "force_pass":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="视频审核不支持跳过品牌终审，所有视频必须经过品牌方审核",
                )

            task = await agency_review(
                db=db,
                task=task,
                reviewer_id=current_user.id,
                action=request.action,
                skip_brand_review=current_user.role == UserRole.OPERATOR,
                comment=request.comment,
            )

        elif current_user.role == UserRole.BRAND:
            if task.stage != TaskStage.VIDEO_BRAND_REVIEW:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="当前阶段不在品牌方审核中",
                )

            result = await db.execute(
                select(Brand).where(Brand.user_id == current_user.id)
            )
            brand = result.scalar_one_or_none()
            if not brand:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="无权审核此任务",
                )

            # 验证任务属于该品牌
            if task.project.brand_id != brand.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="无权审核此任务",
                )

            # 品牌方只能 pass 或 reject
            if request.action == "force_pass":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="品牌方审核不支持此操作",
                )

            task = await brand_review(
                db=db,
                task=task,
                reviewer_id=current_user.id,
                action=request.action,
                comment=request.comment,
            )

        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="仅代理商、代运营和品牌方可审核",
            )

        await db.commit()

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # 重新加载关联并立即返回响应
    task = await get_task_by_id(db, task.id)
    response = _task_to_response(task)

    # 消息/SSE/学习全部放到后台执行，不阻塞 HTTP 响应
    _bg_task_id = task.id
    _bg_task_name = task.name
    _bg_task_stage = task.stage.value
    _bg_creator_id = task.creator_id
    _bg_agency_id = task.agency_id
    _bg_brand_id = task.project.brand_id if task.project else ""
    _bg_action = request.action
    _bg_comment = request.comment
    _bg_reviewer_name = current_user.name
    _bg_reviewer_role = current_user.role
    _bg_ai_result = task.video_ai_result

    async def _video_review_post_tasks():
        async with AsyncSessionLocal() as bg_db:
            try:
                # 通知达人
                result = await bg_db.execute(
                    select(Creator).where(Creator.id == _bg_creator_id)
                )
                creator_obj = result.scalar_one_or_none()
                if creator_obj:
                    reviewer_type = (
                        "agency"
                        if _bg_reviewer_role in {UserRole.AGENCY, UserRole.OPERATOR}
                        else "brand"
                    )
                    action_text = {"pass": "通过", "reject": "驳回"}.get(
                        _bg_action, _bg_action
                    )
                    await create_message(
                        db=bg_db,
                        user_id=creator_obj.user_id,
                        type=_bg_action,
                        title=f"视频审核{action_text}",
                        content=f"您的任务「{_bg_task_name}」视频已被{action_text}"
                        + (f"，评语：{_bg_comment}" if _bg_comment else ""),
                        related_task_id=_bg_task_id,
                        sender_name=_bg_reviewer_name,
                    )
                    await bg_db.commit()
                    await notify_review_decision(
                        task_id=_bg_task_id,
                        creator_user_id=creator_obj.user_id,
                        review_type="video",
                        reviewer_type=reviewer_type,
                        action=_bg_action,
                        comment=_bg_comment,
                    )
                    await notify_task_updated(
                        task_id=_bg_task_id,
                        user_ids=[creator_obj.user_id],
                        data={"action": f"video_{_bg_action}", "stage": _bg_task_stage},
                    )

                # 代理商通过且进入品牌终审 → 通知品牌方
                if (
                    _bg_reviewer_role in {UserRole.AGENCY, UserRole.OPERATOR}
                    and _bg_action == "pass"
                    and _bg_task_stage == TaskStage.VIDEO_BRAND_REVIEW.value
                ):
                    brand_result = await bg_db.execute(
                        select(Brand).where(Brand.id == _bg_brand_id)
                    )
                    brand_obj = brand_result.scalar_one_or_none()
                    if brand_obj:
                        await create_message(
                            db=bg_db,
                            user_id=brand_obj.user_id,
                            type="task",
                            title="新视频待审核",
                            content=f"任务「{_bg_task_name}」视频已通过代理商审核，请进行品牌终审。",
                            related_task_id=_bg_task_id,
                            sender_name=_bg_reviewer_name,
                        )
                        await bg_db.commit()
                        await notify_task_updated(
                            task_id=_bg_task_id,
                            user_ids=[brand_obj.user_id],
                            data={
                                "action": "video_pending_brand_review",
                                "stage": _bg_task_stage,
                            },
                        )

                # 品牌方审核 → 通知代理商结果
                if _bg_reviewer_role == UserRole.BRAND:
                    ag_result = await bg_db.execute(
                        select(Agency).where(Agency.id == _bg_agency_id)
                    )
                    ag_obj = ag_result.scalar_one_or_none()
                    if ag_obj:
                        action_text = {"pass": "通过", "reject": "驳回"}.get(
                            _bg_action, _bg_action
                        )
                        await create_message(
                            db=bg_db,
                            user_id=ag_obj.user_id,
                            type="task",
                            title=f"视频品牌终审{action_text}",
                            content=f"任务「{_bg_task_name}」视频品牌终审已{action_text}"
                            + (f"，评语：{_bg_comment}" if _bg_comment else ""),
                            related_task_id=_bg_task_id,
                            sender_name=_bg_reviewer_name,
                        )
                        await bg_db.commit()
                        await notify_task_updated(
                            task_id=_bg_task_id,
                            user_ids=[ag_obj.user_id],
                            data={
                                "action": f"video_brand_{_bg_action}",
                                "stage": _bg_task_stage,
                            },
                        )
            except Exception as e:
                logger.warning(f"视频审核后台通知失败: task={_bg_task_id}, error={e}")

            # 学习触发
            try:
                logger.info(
                    f"视频审核学习判断: task={_bg_task_id}, action={_bg_action}, "
                    f"reviewer_role={_bg_reviewer_role}, has_ai_result={bool(_bg_ai_result)}, "
                    f"ai_auto_rejected={_bg_ai_result.get('ai_auto_rejected', 'N/A') if _bg_ai_result else 'N/A'}, "
                    f"ai_score={_bg_ai_result.get('score', 'N/A') if _bg_ai_result else 'N/A'}"
                )
                if _bg_ai_result:
                    _tenant_id = _bg_tenant_scope_id
                    if _bg_action == "reject":
                        reviewer_role = (
                            "agency"
                            if _bg_reviewer_role in {UserRole.AGENCY, UserRole.OPERATOR}
                            else "brand"
                        )
                        await _trigger_tighten_learning(
                            task_id=_bg_task_id,
                            comment=_bg_comment,
                            tenant_id=_tenant_id,
                            reviewer_role=reviewer_role,
                            review_type="video",
                        )
                        logger.info(f"已触发视频收紧学习: task={_bg_task_id}")
                    elif _bg_action == "pass" and _bg_reviewer_role in {UserRole.AGENCY, UserRole.OPERATOR}:
                        ai_auto_rejected = _bg_ai_result.get("ai_auto_rejected", False)
                        ai_score = _bg_ai_result.get("score", 100)
                        conclusions = _bg_ai_result.get("conclusions")
                        violations = []
                        if conclusions and isinstance(conclusions, dict):
                            violations = conclusions.get("violations", [])
                        if not violations:
                            violations = _bg_ai_result.get("violations", [])
                        logger.info(
                            f"视频覆盖学习条件: task={_bg_task_id}, ai_auto_rejected={ai_auto_rejected}, "
                            f"violations_count={len(violations)}"
                        )
                        if ai_auto_rejected or violations:
                            await _trigger_brand_learning(
                                task_id=_bg_task_id,
                                comment=_bg_comment,
                                tenant_id=_tenant_id,
                                review_type="video",
                            )
                            logger.info(f"已触发视频覆盖学习: task={_bg_task_id}")
                        elif (
                            ai_score < AI_SOFT_DISAGREE_THRESHOLD
                            and _bg_task_stage == "completed"
                        ):
                            await _trigger_soft_widen_learning(
                                task_id=_bg_task_id,
                                comment=_bg_comment,
                                tenant_id=_tenant_id,
                                review_type="video",
                            )
                            logger.info(f"已触发视频低分通过学习: task={_bg_task_id}")
                    elif _bg_action == "pass" and _bg_reviewer_role == UserRole.BRAND:
                        if not _bg_ai_result.get("ai_auto_rejected"):
                            ai_score = _bg_ai_result.get("score", 100)
                            if ai_score < AI_SOFT_DISAGREE_THRESHOLD:
                                await _trigger_soft_widen_learning(
                                    task_id=_bg_task_id,
                                    comment=_bg_comment,
                                    tenant_id=_tenant_id,
                                    review_type="video",
                                )
                                logger.info(
                                    f"已触发视频低分通过学习(品牌方): task={_bg_task_id}"
                                )
                else:
                    logger.warning(
                        f"视频审核学习跳过: task={_bg_task_id}, video_ai_result 为空"
                    )
            except Exception as e:
                logger.warning(f"视频审核学习触发失败: task={_bg_task_id}, error={e}")

    asyncio.create_task(_video_review_post_tasks())

    return response


@router.post("/{task_id}/video/guidance-board", response_model=TaskResponse)
async def generate_video_guidance_board(
    task_id: str,
    request: CreatorGuidanceBoardRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    代理商或代运营生成达人修改图。
    """
    from app.services.ai_service import AIServiceFactory

    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    if current_user.role not in {UserRole.AGENCY, UserRole.OPERATOR}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅代理商或代运营可生成达人修改图",
        )

    has_permission = await check_task_permission(task, current_user, db)
    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权访问此任务",
        )

    if not task.video_ai_result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前任务还没有视频审核结果",
        )

    normalized_candidates = [
        item
        for item in (
            _normalize_review_candidate_payload(candidate.model_dump())
            for candidate in request.candidates
        )
        if item
    ]
    normalized_candidates = _dedupe_review_candidates(normalized_candidates)
    layout_variant = request.layout_variant or "portrait"
    style_variant = str(request.style_variant or "").strip()
    feedback_instruction = str(request.feedback_instruction or "").strip()
    feedback_type = request.feedback_type or "other"
    target_page = request.target_page

    if not normalized_candidates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少选择一条修改建议",
        )

    project_result = await db.execute(
        select(Project).where(Project.id == task.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="项目不存在",
        )

    brief_result = await db.execute(
        select(Brief).where(Brief.project_id == project.id)
    )
    brief = brief_result.scalar_one_or_none()

    ai_scope_id = _resolve_project_ai_scope_id(project)
    try:
        ai_client = await AIServiceFactory.get_client(ai_scope_id, db) if ai_scope_id else None
        config = await AIServiceFactory.get_config(ai_scope_id, db) if ai_scope_id else None
    except Exception:
        ai_client = None
        config = None

    text_model = config.models.get("text", "gpt-4o") if config else "gpt-4o"
    image_model = ""
    if config and isinstance(config.models, dict):
        image_model = str(config.models.get("image") or "").strip()
    if not image_model:
        image_model = "gpt-image-1"
    creator_card_content = await _generate_creator_card_content(
        ai_client=ai_client,
        text_model=text_model,
        task_name=task.name,
        project_name=project.name,
        candidates=normalized_candidates,
    )
    creator_visual_brief = _build_creator_visual_brief(
        task_id=task.id,
        task_name=task.name,
        project_name=project.name,
        candidates=normalized_candidates,
        video_ai_result=task.video_ai_result,
        brief=brief,
        layout_variant=layout_variant,
        style_variant=style_variant,
        feedback_instruction=feedback_instruction,
    )

    updated_video_ai_result = _build_video_ai_result_payload(
        task.video_ai_result,
        task.video_duration,
    ) or {}
    previous_generation = updated_video_ai_result.get("creator_image_generation")
    updated_video_ai_result["review_candidates"] = _merge_review_candidate_pool(
        updated_video_ai_result.get("review_candidates"),
        normalized_candidates,
    )
    updated_video_ai_result["creator_guidance_selected_candidate_ids"] = [
        item["id"] for item in normalized_candidates
    ]
    updated_video_ai_result["creator_card_content"] = creator_card_content
    updated_video_ai_result["creator_visual_brief"] = creator_visual_brief
    creator_image_generation = _build_creator_image_generation(
        creator_visual_brief=creator_visual_brief,
        previous_generation=previous_generation,
        layout_variant=layout_variant,
        style_variant=style_variant,
        feedback_instruction=feedback_instruction,
        feedback_type=feedback_type,
        target_page=target_page,
    )
    updated_video_ai_result["creator_image_generation"] = await _generate_creator_guidance_images(
        ai_client=ai_client,
        image_model=image_model,
        creator_visual_brief=creator_visual_brief,
        creator_image_generation=creator_image_generation,
        task_id=task.id,
        target_page=target_page,
    )
    task.video_ai_result = updated_video_ai_result
    await db.commit()

    task = await get_task_by_id(db, task_id)
    return _task_to_response(task)


@router.get("/{task_id}/video/guidance-board/export")
async def export_video_guidance_board(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    导出达人修改图 AI 图片 ZIP。
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    if current_user.role not in {UserRole.AGENCY, UserRole.OPERATOR}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅代理商或代运营可导出达人修改图",
        )

    has_permission = await check_task_permission(task, current_user, db)
    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权访问此任务",
        )

    video_ai_result = _build_video_ai_result_payload(task.video_ai_result, task.video_duration) or {}
    creator_image_generation = video_ai_result.get("creator_image_generation") or {}
    generated_pages = creator_image_generation.get("generated_pages") or []
    if not isinstance(generated_pages, list) or not generated_pages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前还没有可导出的达人修改图图片",
        )

    iteration_no = creator_image_generation.get("iteration_no")
    try:
        iteration_no = int(iteration_no)
    except (TypeError, ValueError):
        iteration_no = None

    creator_name = ""
    if task.creator and task.creator.name:
        creator_name = task.creator.name
    elif getattr(task, "creator_display_name", None):
        creator_name = str(task.creator_display_name or "").strip()

    zip_bytes = await _build_creator_guidance_export_zip(
        project_name=task.project.name if task.project else task.name,
        creator_name=creator_name,
        iteration_no=iteration_no,
        generated_pages=generated_pages,
    )
    if not zip_bytes:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="达人修改图导出失败，请稍后重试",
        )

    file_name = (
        f"{_build_creator_guidance_export_basename(
            project_name=task.project.name if task.project else task.name,
            creator_name=creator_name,
            iteration_no=iteration_no,
        )}.zip"
    )
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(file_name, safe='')}",
    }
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers=headers,
    )


# ===== 申诉操作 =====


@router.post("/{task_id}/appeal", response_model=TaskResponse)
async def submit_task_appeal(
    task_id: str,
    request: AppealRequest,
    creator: Creator = Depends(get_current_creator),
    db: AsyncSession = Depends(get_db),
):
    """
    提交申诉（达人操作）

    - 只能在 rejected 阶段申诉
    - 需要有剩余申诉次数
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    if task.creator_id != creator.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能申诉自己的任务",
        )

    try:
        task = await submit_appeal(
            db=db,
            task=task,
            reason=request.reason,
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # 重新加载关联
    task = await get_task_by_id(db, task.id)

    # 通知代理商有新申诉（消息 + SSE）
    try:
        result = await db.execute(select(Agency).where(Agency.id == task.agency_id))
        agency_obj = result.scalar_one_or_none()
        if agency_obj:
            await create_message(
                db=db,
                user_id=agency_obj.user_id,
                type="task",
                title="达人提交申诉",
                content=f"任务「{task.name}」的达人提交了申诉：{request.reason}",
                related_task_id=task.id,
                sender_name=creator.name,
            )
            await db.commit()
            await notify_task_updated(
                task_id=task.id,
                user_ids=[agency_obj.user_id],
                data={"action": "appeal_submitted", "stage": task.stage.value},
            )
    except Exception:
        pass

    return _task_to_response(task)


@router.post("/{task_id}/appeal-count", response_model=TaskResponse)
async def increase_task_appeal_count(
    task_id: str,
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """
    增加申诉次数（代理商操作）

    - 每次调用增加 1 次申诉次数
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    if task.agency_id != agency.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能操作自己的任务",
        )

    task = await increase_appeal_count(db, task)
    task.appeal_request_status = "approved"

    # 通知达人：申诉次数已增加
    try:
        creator_result = await db.execute(
            select(Creator).where(Creator.id == task.creator_id)
        )
        creator_obj = creator_result.scalar_one_or_none()
        if creator_obj:
            await create_message(
                db=db,
                user_id=creator_obj.user_id,
                type="appeal_quota_approved",
                title="申诉次数申请通过",
                content=f"您申请增加「{task.name}」的申诉次数已被批准，当前可用申诉次数 +1",
                related_task_id=task.id,
                sender_name=agency.name,
            )
            await notify_task_updated(
                task_id=task.id,
                user_ids=[creator_obj.user_id],
                data={"action": "appeal_count_increased"},
            )
    except Exception:
        pass

    await db.commit()

    # 重新加载关联
    task = await get_task_by_id(db, task.id)

    return _task_to_response(task)


@router.post("/{task_id}/request-appeal-count", response_model=TaskResponse)
async def request_appeal_count_increase(
    task_id: str,
    creator: Creator = Depends(get_current_creator),
    db: AsyncSession = Depends(get_db),
):
    """
    申请增加申诉次数（达人操作）

    - 向代理商发送消息通知，请求增加申诉次数
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    if task.creator_id != creator.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能操作自己的任务",
        )

    # 防重复：pending 状态不允许再次申请
    if task.appeal_request_status == "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="申请正在处理中，请等待代理商回复",
        )

    # 设置申请状态
    task.appeal_request_status = "pending"

    # 发消息通知代理商
    try:
        result = await db.execute(select(Agency).where(Agency.id == task.agency_id))
        agency_obj = result.scalar_one_or_none()
        if agency_obj:
            await create_message(
                db=db,
                user_id=agency_obj.user_id,
                type="appeal_quota_request",
                title="申诉次数申请",
                content=f"达人「{creator.name}」申请为任务「{task.name}」增加申诉次数，当前剩余 {task.appeal_count} 次。",
                related_task_id=task.id,
                sender_name=creator.name,
                action_status="pending",
            )
            await db.commit()
            await notify_task_updated(
                task_id=task.id,
                user_ids=[agency_obj.user_id],
                data={"action": "appeal_count_requested"},
            )
    except Exception:
        pass

    return _task_to_response(task)


@router.post("/{task_id}/reject-appeal-count", response_model=TaskResponse)
async def reject_appeal_count_request(
    task_id: str,
    agency: Agency = Depends(get_current_agency),
    db: AsyncSession = Depends(get_db),
):
    """
    拒绝申诉次数申请（代理商操作）

    - 拒绝达人的申诉次数增加请求，并通知达人
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )

    if task.agency_id != agency.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能操作自己的任务",
        )

    task.appeal_request_status = "rejected"

    # 通知达人：申诉次数申请被拒
    try:
        creator_result = await db.execute(
            select(Creator).where(Creator.id == task.creator_id)
        )
        creator_obj = creator_result.scalar_one_or_none()
        if creator_obj:
            await create_message(
                db=db,
                user_id=creator_obj.user_id,
                type="appeal_quota_rejected",
                title="申诉次数申请被拒",
                content=f"您申请增加「{task.name}」的申诉次数已被拒绝",
                related_task_id=task.id,
                sender_name=agency.name,
            )
            await notify_task_updated(
                task_id=task.id,
                user_ids=[creator_obj.user_id],
                data={"action": "appeal_count_rejected"},
            )
    except Exception:
        pass

    await db.commit()

    # 重新加载关联
    task = await get_task_by_id(db, task.id)

    return _task_to_response(task)


async def _trigger_brand_learning(
    task_id: str,
    comment: str | None,
    tenant_id: str,
    review_type: str = "script",
):
    """
    后台异步触发品牌学习分析（覆盖学习）

    当人类通过了 AI 标记有问题的内容时自动调用，
    AI 分析为什么人类推翻了审核结果，提取可泛化的学习规则存入品牌学习档案。

    触发条件（自动检测，无需依赖特定按钮）：
    - AI 自动驳回 + 达人申诉 + 人工通过
    - AI 标记了违规项 + 人工通过
    - 代理商强制通过

    review_type: "script" 或 "video"，决定使用哪个 AI 审核结果
    """
    import json
    from app.models.brand_learning import BrandLearnedRule
    from app.services.ai_service import AIServiceFactory
    from app.services.auth import generate_id
    from app.services.document_parser import DocumentParser

    logger.info(f"覆盖学习开始: task={task_id}, tenant={tenant_id}, type={review_type}")

    async with AsyncSessionLocal() as db:
        try:
            # 获取任务
            task_result = await db.execute(select(Task).where(Task.id == task_id))
            task = task_result.scalar_one_or_none()
            if not task:
                logger.warning(f"覆盖学习跳过: task={task_id} 不存在")
                return

            # 获取项目和品牌
            project_result = await db.execute(
                select(Project).where(Project.id == task.project_id)
            )
            project = project_result.scalar_one_or_none()
            if not project:
                logger.warning(f"覆盖学习跳过: task={task_id} 关联项目不存在")
                return

            tenant_scope_id = project.config_scope_id or project.brand_id
            brand_id = project.brand_id
            if not tenant_scope_id:
                logger.warning(f"覆盖学习跳过: task={task_id} 缺少规则配置空间")
                return

            # 根据 review_type 获取对应的 AI 审核结果
            if review_type == "video":
                ai_result = task.video_ai_result
            else:
                ai_result = task.script_ai_result
            # 兜底：如果指定类型无结果，尝试另一个
            if not ai_result:
                ai_result = (
                    task.video_ai_result
                    if review_type == "script"
                    else task.script_ai_result
                )
            if not ai_result:
                logger.warning(
                    f"覆盖学习跳过: task={task_id} 无 AI 审核结果 (review_type={review_type})"
                )
                return

            # 获取脚本内容
            script_content = ""
            if task.script_file_url and task.script_file_name:
                try:
                    script_content = (
                        await DocumentParser.download_and_parse(
                            task.script_file_url, task.script_file_name
                        )
                        or ""
                    )
                except Exception:
                    pass

            # 获取 Brief 摘要
            brief_summary = ""
            try:
                from app.models.brief import Brief as BriefModel

                brief_result = await db.execute(
                    select(BriefModel).where(BriefModel.project_id == project.id)
                )
                brief = brief_result.scalar_one_or_none()
                if brief:
                    parts = []
                    base_summary = _build_brief_model_summary(brief)
                    if base_summary:
                        parts.append(base_summary)
                    if brief.selling_points:
                        sp_text = ", ".join(
                            sp.get("content", "") for sp in brief.selling_points[:5]
                        )
                        parts.append(f"卖点：{sp_text}")
                    brief_summary = "；".join(parts)
            except Exception:
                pass

            # 提取违规信息（兼容 v1/v2 格式）
            violations = []
            conclusions = ai_result.get("conclusions")
            if conclusions and isinstance(conclusions, dict):
                violations = conclusions.get("violations", [])
            if not violations:
                violations = ai_result.get("violations", [])

            # ai_auto_rejected 但无具体违规项时（如纯低分驳回），构造一个虚拟违规项
            # 确保学习函数不会提前退出
            if not violations and ai_result.get("ai_auto_rejected"):
                reject_reason = ai_result.get("ai_reject_reason", "AI 自动驳回（低分）")
                violations = [{"dimension": "auto_reject", "content": reject_reason}]

            if not violations:
                logger.info(f"覆盖学习跳过: task={task_id} 无违规项")
                return

            # AI 学习分析
            ai_client = await AIServiceFactory.get_client(tenant_id, db)
            if not ai_client:
                logger.warning(
                    f"覆盖学习跳过: task={task_id} AI 服务不可用 (tenant={tenant_id})"
                )
                return

            config = await AIServiceFactory.get_config(tenant_id, db)
            text_model = config.models.get("text", "gpt-4o") if config else "gpt-4o"

            violations_text = json.dumps(violations, ensure_ascii=False, indent=2)
            comment_text = comment or "未填写"

            prompt = f"""以下是一次审核覆盖记录：

AI 原始审核结果中的违规项：
{violations_text}

脚本内容：
{script_content[:3000] if script_content else "（无法获取）"}

Brief 要求：{brief_summary or "（无法获取）"}

人工审核决策：通过（覆盖了 AI 的审核意见）
审核类型：{"视频审核" if review_type == "video" else "脚本审核"}
审核员 comment：{comment_text}

请分析人类为什么推翻了 AI 的判断，提取一条可泛化的学习规则。

以 JSON 返回：
{{
  "type": "允许表达/调性偏好/误判/风格偏好",
  "pattern": "什么情况下不应标记（要可泛化，不要只针对这一个词/句）",
  "reason": "为什么不应标记（从品牌定位和平台特性角度解释）"
}}

type 说明：
- 允许表达: 该表达方式在此品牌语境下是可接受的
- 调性偏好: 品牌偏好的语言调性
- 误判: AI 误判了这类表达
- 风格偏好: 品牌偏好的内容风格

要求：
- pattern 必须是可泛化的规则，不要只针对具体的词/句
- reason 要从品牌定位和平台特性角度解释
- 请只返回 JSON，不要包含其他内容"""

            # system message 明确分析场景，避免模型安全策略误拦
            learning_system_msg = (
                "你是一个专业的内容合规审核分析助手。你的任务是分析人类审核员推翻 AI 审核结论的原因，"
                "从中提取可泛化的学习规则，帮助改进 AI 审核的准确性。这是正当的合规优化工作。请直接返回 JSON 结果。"
            )

            # 最多重试 2 次（某些模型偶尔返回空内容）
            result_text = ""
            for _attempt in range(2):
                response = await ai_client.chat_completion(
                    messages=[
                        {"role": "system", "content": learning_system_msg},
                        {"role": "user", "content": prompt},
                    ],
                    model=text_model,
                    temperature=0.3,
                    max_tokens=4096,
                )
                result_text = response.content.strip()
                if result_text:
                    break
                logger.warning(
                    f"覆盖学习 AI 返回空内容 (attempt {_attempt + 1}): task={task_id}, "
                    f"finish_reason={response.finish_reason}, usage={response.usage}, model={response.model}"
                )

            logger.info(
                f"覆盖学习 AI 原始返回: task={task_id}, text={result_text[:500]}"
            )
            if not result_text:
                logger.error(f"覆盖学习失败: task={task_id}, AI 多次返回空内容")
                return
            learned = _robust_json_parse(result_text)

            # 校验必要字段：pattern 为空则不创建规则
            if not learned.get("pattern", "").strip():
                logger.warning(
                    f"覆盖学习跳过: task={task_id} AI 返回的 pattern 为空, learned={learned}"
                )
                return

            # 存入数据库
            rule = BrandLearnedRule(
                id=generate_id("LR"),
                tenant_id=tenant_scope_id,
                brand_id=brand_id,
                type=learned.get("type", "false_positive"),
                pattern=learned["pattern"].strip(),
                reason=learned.get("reason", "").strip(),
                source_task=task_id,
                created_by="ai_learning",
            )
            db.add(rule)
            await db.flush()

            # 通知品牌方
            try:
                if brand_id:
                    brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
                    brand_obj = brand_result.scalar_one_or_none()
                    if brand_obj and brand_obj.user_id:
                        await create_message(
                            db=db,
                            user_id=brand_obj.user_id,
                            type="system",
                            title="AI 新增学习规则",
                            content=f"AI 从任务 {task_id} 的审核覆盖中学习到新规则：{learned['pattern']}。如果您不认可此规则，可以在「学习档案管理」中删除。",
                            related_task_id=task_id,
                            sender_name="系统",
                        )
            except Exception as e:
                logger.warning(f"通知品牌方新学习规则失败: {e}")

            await db.commit()
            logger.info(f"品牌学习规则已生成: task={task_id}, rule={rule.id}")

        except Exception as e:
            logger.error(
                f"品牌学习分析失败: task={task_id}, error={e}, AI原文={result_text[:300] if 'result_text' in dir() else '(未获取)'}"
            )


async def _trigger_tighten_learning(
    task_id: str,
    comment: str | None,
    tenant_id: str,
    reviewer_role: str,
    review_type: str = "script",
):
    """
    后台异步触发收紧学习

    当 AI 审核通过但人类审核驳回时调用，AI 分析为什么内容不合格，
    提取收紧规则存入品牌学习档案。
    """
    import json
    from app.models.brand_learning import BrandLearnedRule
    from app.services.ai_service import AIServiceFactory
    from app.services.auth import generate_id
    from app.services.document_parser import DocumentParser

    logger.info(
        f"收紧学习开始: task={task_id}, tenant={tenant_id}, type={review_type}, reviewer={reviewer_role}"
    )

    async with AsyncSessionLocal() as db:
        try:
            task_result = await db.execute(select(Task).where(Task.id == task_id))
            task = task_result.scalar_one_or_none()
            if not task:
                logger.warning(f"收紧学习跳过: task={task_id} 不存在")
                return

            project_result = await db.execute(
                select(Project).where(Project.id == task.project_id)
            )
            project = project_result.scalar_one_or_none()
            if not project:
                logger.warning(f"收紧学习跳过: task={task_id} 关联项目不存在")
                return

            tenant_scope_id = project.config_scope_id or project.brand_id
            brand_id = project.brand_id
            if not tenant_scope_id:
                logger.warning(f"收紧学习跳过: task={task_id} 缺少规则配置空间")
                return

            # 根据 review_type 获取对应的 AI 审核结果
            if review_type == "video":
                ai_result = task.video_ai_result
            else:
                ai_result = task.script_ai_result
            if not ai_result:
                ai_result = (
                    task.video_ai_result
                    if review_type == "script"
                    else task.script_ai_result
                )
            if not ai_result:
                logger.warning(
                    f"收紧学习跳过: task={task_id} 无 AI 审核结果 (review_type={review_type})"
                )
                return

            ai_score = ai_result.get("score", 0)
            ai_also_rejected = ai_score < 60

            # 获取脚本内容
            script_content = ""
            if task.script_file_url and task.script_file_name:
                try:
                    script_content = (
                        await DocumentParser.download_and_parse(
                            task.script_file_url, task.script_file_name
                        )
                        or ""
                    )
                except Exception:
                    pass

            # 获取 Brief 摘要
            brief_summary = ""
            try:
                from app.models.brief import Brief as BriefModel

                brief_result = await db.execute(
                    select(BriefModel).where(BriefModel.project_id == project.id)
                )
                brief = brief_result.scalar_one_or_none()
                if brief:
                    parts = []
                    base_summary = _build_brief_model_summary(brief)
                    if base_summary:
                        parts.append(base_summary)
                    if brief.selling_points:
                        sp_text = ", ".join(
                            sp.get("content", "") for sp in brief.selling_points[:5]
                        )
                        parts.append(f"卖点：{sp_text}")
                    brief_summary = "；".join(parts)
            except Exception:
                pass

            # AI 收紧分析
            ai_client = await AIServiceFactory.get_client(tenant_id, db)
            if not ai_client:
                logger.warning(
                    f"收紧学习跳过: task={task_id} AI 服务不可用 (tenant={tenant_id})"
                )
                return

            config = await AIServiceFactory.get_config(tenant_id, db)
            text_model = config.models.get("text", "gpt-4o") if config else "gpt-4o"

            ai_summary = ai_result.get("summary", "")
            comment_text = comment or "未填写"
            reviewer_label = "代理商" if reviewer_role == "agency" else "品牌方"

            ai_verdict = (
                f"不通过（总分 {ai_score}）"
                if ai_also_rejected
                else f"通过（总分 {ai_score}）"
            )
            analysis_hint = (
                f"AI 和{reviewer_label}都认为内容有问题。请结合{reviewer_label}评语，分析{reviewer_label}最关注的问题是什么，提取一条可泛化的规则，让 AI 在未来审核时重点关注该类问题。"
                if ai_also_rejected
                else f"AI 认为内容合规，但{reviewer_label}驳回了。请分析{reviewer_label}驳回的可能原因，提取一条可泛化的收紧规则，让 AI 在未来审核时更严格。"
            )

            prompt = f"""以下是一次审核驳回记录：

AI 审核判定：{ai_verdict}
AI 审核摘要：{ai_summary}

脚本内容：
{script_content[:3000] if script_content else "（无法获取）"}

Brief 要求：{brief_summary or "（无法获取）"}

{reviewer_label}决策：reject（驳回）
{reviewer_label}评语：{comment_text}

{analysis_hint}

以 JSON 返回：
{{
  "type": "调性偏严/缺少要素/品牌不符/质量不达标",
  "pattern": "什么情况下应该标记或扣分（要可泛化）",
  "reason": "为什么需要更严格（从品牌定位和内容质量角度解释）"
}}

type 说明：
- 调性偏严: 内容调性不符合品牌要求，需要更严格的调性审核
- 缺少要素: 内容遗漏了品牌方关注的要素
- 品牌不符: 内容与品牌形象不匹配
- 质量不达标: 内容质量未达到品牌方标准

要求：
- pattern 必须是可泛化的规则，不要只针对具体的词/句
- reason 要从品牌定位和内容质量角度解释
- 请只返回 JSON，不要包含其他内容"""

            learning_system_msg = (
                "你是一个专业的内容合规审核分析助手。你的任务是分析人类审核员驳回 AI 通过的内容的原因，"
                "从中提取可泛化的收紧规则，帮助改进 AI 审核的准确性。这是正当的合规优化工作。请直接返回 JSON 结果。"
            )

            result_text = ""
            for _attempt in range(2):
                response = await ai_client.chat_completion(
                    messages=[
                        {"role": "system", "content": learning_system_msg},
                        {"role": "user", "content": prompt},
                    ],
                    model=text_model,
                    temperature=0.3,
                    max_tokens=4096,
                )
                result_text = response.content.strip()
                if result_text:
                    break
                logger.warning(
                    f"收紧学习 AI 返回空内容 (attempt {_attempt + 1}): task={task_id}, "
                    f"finish_reason={response.finish_reason}, usage={response.usage}, model={response.model}"
                )

            logger.info(
                f"收紧学习 AI 原始返回: task={task_id}, text={result_text[:500]}"
            )
            if not result_text:
                logger.error(f"收紧学习失败: task={task_id}, AI 多次返回空内容")
                return
            learned = _robust_json_parse(result_text)

            # 校验必要字段：pattern 为空则不创建规则
            if not learned.get("pattern", "").strip():
                logger.warning(
                    f"收紧学习跳过: task={task_id} AI 返回的 pattern 为空, learned={learned}"
                )
                return

            rule = BrandLearnedRule(
                id=generate_id("LR"),
                tenant_id=tenant_scope_id,
                brand_id=brand_id,
                type=learned.get("type", "quality_concern"),
                pattern=learned["pattern"].strip(),
                reason=learned.get("reason", "").strip(),
                source_task=task_id,
                created_by="ai_learning",
            )
            db.add(rule)
            await db.flush()

            # 通知品牌方
            try:
                if brand_id:
                    brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
                    brand_obj = brand_result.scalar_one_or_none()
                    if brand_obj and brand_obj.user_id:
                        await create_message(
                            db=db,
                            user_id=brand_obj.user_id,
                            type="system",
                            title="AI 新增收紧规则",
                            content=f"AI 从任务 {task_id} 的驳回记录中学习到新规则：{learned['pattern']}。如果您不认可此规则，可以在「学习档案管理」中删除。",
                            related_task_id=task_id,
                            sender_name="系统",
                        )
            except Exception as e:
                logger.warning(f"通知品牌方收紧规则失败: {e}")

            await db.commit()
            logger.info(f"收紧学习规则已生成: task={task_id}, rule={rule.id}")

        except Exception as e:
            logger.error(
                f"收紧学习分析失败: task={task_id}, error={e}, AI原文={result_text[:300] if 'result_text' in dir() else '(未获取)'}"
            )


async def _trigger_soft_widen_learning(
    task_id: str, comment: str | None, tenant_id: str, review_type: str
):
    """
    后台异步触发低分通过学习

    当 AI 打分 < 60（未达自动驳回线 40）但代理商和品牌方都通过时调用，
    AI 分析哪些维度评价偏严，提取放宽规则存入品牌学习档案。
    """
    import json
    from app.models.brand_learning import BrandLearnedRule
    from app.services.ai_service import AIServiceFactory
    from app.services.auth import generate_id
    from app.services.document_parser import DocumentParser

    logger.info(
        f"低分通过学习开始: task={task_id}, tenant={tenant_id}, type={review_type}"
    )

    async with AsyncSessionLocal() as db:
        try:
            task_result = await db.execute(select(Task).where(Task.id == task_id))
            task = task_result.scalar_one_or_none()
            if not task:
                logger.warning(f"低分通过学习跳过: task={task_id} 不存在")
                return

            project_result = await db.execute(
                select(Project).where(Project.id == task.project_id)
            )
            project = project_result.scalar_one_or_none()
            if not project:
                logger.warning(f"低分通过学习跳过: task={task_id} 关联项目不存在")
                return

            tenant_scope_id = project.config_scope_id or project.brand_id
            brand_id = project.brand_id
            if not tenant_scope_id:
                logger.warning(f"低分通过学习跳过: task={task_id} 缺少规则配置空间")
                return

            # 根据 review_type 取对应的 AI 结果
            ai_result = (
                task.script_ai_result
                if review_type == "script"
                else task.video_ai_result
            )
            if not ai_result:
                logger.warning(
                    f"低分通过学习跳过: task={task_id} 无 AI 审核结果 (review_type={review_type})"
                )
                return

            ai_score = ai_result.get("score", 100)

            # 获取脚本内容
            script_content = ""
            if task.script_file_url and task.script_file_name:
                try:
                    script_content = (
                        await DocumentParser.download_and_parse(
                            task.script_file_url, task.script_file_name
                        )
                        or ""
                    )
                except Exception:
                    pass

            # 获取 Brief 摘要
            brief_summary = ""
            try:
                from app.models.brief import Brief as BriefModel

                brief_result = await db.execute(
                    select(BriefModel).where(BriefModel.project_id == project.id)
                )
                brief = brief_result.scalar_one_or_none()
                if brief:
                    parts = []
                    base_summary = _build_brief_model_summary(brief)
                    if base_summary:
                        parts.append(base_summary)
                    if brief.selling_points:
                        sp_text = ", ".join(
                            sp.get("content", "") for sp in brief.selling_points[:5]
                        )
                        parts.append(f"卖点：{sp_text}")
                    brief_summary = "；".join(parts)
            except Exception:
                pass

            # 提取低分维度（conclusions 中 score < 70 的维度）
            low_score_dims = []
            conclusions = ai_result.get("conclusions")
            if conclusions and isinstance(conclusions, dict):
                for dim_key, dim_val in conclusions.items():
                    if isinstance(dim_val, dict) and dim_val.get("score", 100) < 70:
                        low_score_dims.append(
                            {
                                "dimension": dim_key,
                                "score": dim_val.get("score"),
                                "summary": dim_val.get("summary", ""),
                                "details": dim_val.get("details", [])[:3],
                            }
                        )

            # 兜底：conclusions 缺少维度分数结构但整体分数确实偏低时，
            # 构造一个基于整体分数的合成条目，确保学习不被跳过
            if not low_score_dims and ai_score < 70:
                summary = ai_result.get("summary", "")
                low_score_dims.append(
                    {
                        "dimension": "overall",
                        "score": ai_score,
                        "summary": summary or f"AI 综合评分 {ai_score} 分",
                        "details": [],
                    }
                )

            if not low_score_dims:
                logger.info(f"低分通过学习跳过: task={task_id} 无低分维度")
                return

            # AI 学习分析
            ai_client = await AIServiceFactory.get_client(tenant_id, db)
            if not ai_client:
                logger.warning(
                    f"低分通过学习跳过: task={task_id} AI 服务不可用 (tenant={tenant_id})"
                )
                return

            config = await AIServiceFactory.get_config(tenant_id, db)
            text_model = config.models.get("text", "gpt-4o") if config else "gpt-4o"

            dims_text = json.dumps(low_score_dims, ensure_ascii=False, indent=2)
            comment_text = comment or "未填写"
            review_label = "脚本" if review_type == "script" else "视频"

            prompt = f"""以下是一次 AI 低分通过记录：

AI 对{review_label}的审核总分：{ai_score}（低于 60 分阈值）
但代理商和品牌方审核都通过了该内容。

AI 打低分的维度详情：
{dims_text}

{review_label}内容：
{script_content[:3000] if script_content else "（无法获取）"}

Brief 要求：{brief_summary or "（无法获取）"}

审核方评语：{comment_text}

请分析 AI 在哪些维度评价偏严，以及为什么人类认为这些内容是可以接受的。提取一条可泛化的放宽规则。

以 JSON 返回：
{{
  "type": "允许表达/调性偏好/误判/风格偏好",
  "pattern": "什么情况下 AI 不应打低分（要可泛化，不要只针对这一个案例）",
  "reason": "为什么人类认为可以接受（从品牌定位和内容特性角度解释）"
}}

type 说明：
- 允许表达: 该表达方式在此品牌语境下是可接受的
- 调性偏好: 品牌偏好的语言调性，AI 不应因此扣分
- 误判: AI 误判了这类内容
- 风格偏好: 品牌偏好的内容风格

要求：
- 重点分析低分维度中人类和 AI 判断分歧最大的点
- pattern 必须是可泛化的规则，不要只针对具体的词/句
- reason 要从品牌定位和内容特性角度解释
- 请只返回 JSON，不要包含其他内容"""

            learning_system_msg = (
                "你是一个专业的内容合规审核分析助手。你的任务是分析 AI 审核评分偏严的原因，"
                "找出人类审核员认为可以接受但 AI 打低分的维度，提取可泛化的放宽规则。这是正当的合规优化工作。请直接返回 JSON 结果。"
            )

            result_text = ""
            for _attempt in range(2):
                response = await ai_client.chat_completion(
                    messages=[
                        {"role": "system", "content": learning_system_msg},
                        {"role": "user", "content": prompt},
                    ],
                    model=text_model,
                    temperature=0.3,
                    max_tokens=4096,
                )
                result_text = response.content.strip()
                if result_text:
                    break
                logger.warning(
                    f"低分通过学习 AI 返回空内容 (attempt {_attempt + 1}): task={task_id}, "
                    f"finish_reason={response.finish_reason}, usage={response.usage}, model={response.model}"
                )

            logger.info(
                f"低分通过学习 AI 原始返回: task={task_id}, text={result_text[:500]}"
            )
            if not result_text:
                logger.error(f"低分通过学习失败: task={task_id}, AI 多次返回空内容")
                return

            learned = _robust_json_parse(result_text)

            # 校验必要字段：pattern 为空则不创建规则
            if not learned.get("pattern", "").strip():
                logger.warning(
                    f"低分通过学习跳过: task={task_id} AI 返回的 pattern 为空, learned={learned}"
                )
                return

            rule = BrandLearnedRule(
                id=generate_id("LR"),
                tenant_id=tenant_scope_id,
                brand_id=brand_id,
                type=learned.get("type", "false_positive"),
                pattern=learned["pattern"].strip(),
                reason=learned.get("reason", "").strip(),
                source_task=task_id,
                created_by="ai_soft_learning",
            )
            db.add(rule)
            await db.flush()

            # 通知品牌方
            try:
                if brand_id:
                    brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
                    brand_obj = brand_result.scalar_one_or_none()
                    if brand_obj and brand_obj.user_id:
                        await create_message(
                            db=db,
                            user_id=brand_obj.user_id,
                            type="system",
                            title="AI 低分通过学习",
                            content=f"AI 从任务 {task_id} 的{review_label}审核中发现评分偏严（{ai_score}分），已学习放宽规则：{learned['pattern']}。如果您不认可此规则，可以在「学习档案管理」中删除。",
                            related_task_id=task_id,
                            sender_name="系统",
                        )
            except Exception as e:
                logger.warning(f"通知品牌方低分通过学习规则失败: {e}")

            await db.commit()
            logger.info(
                f"低分通过学习规则已生成: task={task_id}, rule={rule.id}, review_type={review_type}"
            )

        except Exception as e:
            logger.error(
                f"低分通过学习分析失败: task={task_id}, error={e}, AI原文={result_text[:300] if 'result_text' in dir() else '(未获取)'}"
            )


# ─── 影子写手：AI 重写违规片段 ───
@router.post("/{task_id}/script/ai-rewrite")
async def ai_rewrite_segment(
    task_id: str,
    request: ScriptAIRewriteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    影子写手：用 AI 最小化重写违规片段。
    只有代理商或代运营可以调用（在 script_agency_review 阶段）。
    返回重写后的文本。
    """
    from app.services.ai_service import AIServiceFactory

    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    if current_user.role not in {UserRole.AGENCY, UserRole.OPERATOR}:
        raise HTTPException(status_code=403, detail="仅代理商或代运营可操作")
    if task.stage != TaskStage.SCRIPT_AGENCY_REVIEW:
        raise HTTPException(status_code=400, detail="当前阶段不在代理商审核中")
    has_permission = await check_task_permission(task, current_user, db)
    if not has_permission:
        raise HTTPException(status_code=403, detail="无权访问此任务")

    # 获取项目的配置空间 ID 作为 tenant
    project_result = await db.execute(
        select(Project).where(Project.id == task.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    ai_scope_id = _resolve_project_ai_scope_id(project)
    try:
        ai_client = await AIServiceFactory.get_client(ai_scope_id, db) if ai_scope_id else None
        config = await AIServiceFactory.get_config(ai_scope_id, db) if ai_scope_id else None
    except Exception:
        ai_client = None
        config = None

    if not ai_client:
        raise HTTPException(status_code=503, detail="AI 服务不可用")

    text_model = config.models.get("text", "gpt-4o") if config else "gpt-4o"

    source_span = _locate_rewrite_source_span(
        full_script=request.full_script,
        violation_content=request.violation_content,
        suggestion=request.suggestion,
        segment=request.segment,
    )

    # 批量模式：逐项生成更接近人工修改的完整改写
    if request.violations:
        violation_ids = [v.id for v in request.violations]
        tasks = []
        sources = []
        for item in request.violations:
            item_source = _locate_rewrite_source_span(
                full_script=request.full_script,
                violation_content=item.violation_content,
                suggestion=item.suggestion,
                segment=request.segment,
            )
            sources.append(item_source)
            tasks.append(
                _generate_human_rewrite(
                    ai_client=ai_client,
                    text_model=text_model,
                    full_script=request.full_script,
                    source_span=item_source,
                    violation_content=item.violation_content,
                    suggestion=item.suggestion,
                    brand_context=request.brand_context or "",
                )
            )
    else:
        violation_ids = None
        tasks = [
            _generate_human_rewrite(
                ai_client=ai_client,
                text_model=text_model,
                full_script=request.full_script,
                source_span=source_span,
                violation_content=request.violation_content,
                suggestion=request.suggestion,
                brand_context=request.brand_context or "",
            )
        ]
        sources = [source_span]

    try:
        replacements = []
        rewritten_results = await asyncio.gather(*tasks, return_exceptions=True)
        for idx, rewritten in enumerate(rewritten_results):
            if isinstance(rewritten, Exception):
                continue
            from_part = (sources[idx] or "").strip()
            to_part = (rewritten or "").strip()
            if from_part and to_part and from_part != to_part:
                replacements.append({"from": from_part, "to": to_part})

        if not replacements:
            raise ValueError("未生成任何有效改写")

        if violation_ids:
            return {
                "replacements": replacements,
                "original": sources[0] if sources else request.segment,
                "violation_ids": violation_ids,
            }
        return {"replacements": replacements, "original": sources[0] if sources else request.segment}
    except Exception as e:
        logger.error(f"AI 重写失败: {e}")
        raise HTTPException(status_code=500, detail="AI 重写失败，请重试")


# ──────────────────────────────────────────────────────────────────────────────
# 文件原地修改（脚本文件直接替换内容后下载）
# ──────────────────────────────────────────────────────────────────────────────

from pydantic import BaseModel as _PydanticBase


class ApplyFixesRequest(_PydanticBase):
    replacements: List[dict]  # [{from: str, to: str}, ...]


@router.post("/{task_id}/script/apply-fixes-to-file")
async def apply_fixes_to_file(
    task_id: str,
    request: ApplyFixesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    对原始脚本文件做原地文字替换，返回修改后的文件供下载。
    支持 xlsx / docx / txt。
    replacements: [{from: "旧文本", to: "新文本"}, ...]
    """
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    has_permission = await check_task_permission(task, current_user, db)
    if not has_permission:
        raise HTTPException(status_code=403, detail="无权访问此任务")

    if not task.script_file_url or not task.script_file_name:
        raise HTTPException(status_code=400, detail="该任务没有文件上传的脚本")

    file_name: str = task.script_file_name
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if ext not in ("xlsx", "xls", "docx", "doc", "txt"):
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext}")

    replacements = request.replacements  # List[dict] with keys "from"/"to"
    if not replacements:
        raise HTTPException(status_code=400, detail="未提供替换规则")

    # 下载原始文件
    from app.services.document_parser import DocumentParser

    try:
        file_content = await DocumentParser._download_via_tos_sdk(task.script_file_url)
        if file_content is None:
            file_content = await DocumentParser._download_via_signed_url(
                task.script_file_url
            )
    except Exception as e:
        logger.error(f"下载原始脚本文件失败: {e}")
        raise HTTPException(status_code=500, detail="下载原始文件失败")

    # 在线程池中执行文件修改（CPU 密集）
    import asyncio as _asyncio

    def _apply_fixes_sync(
        content: bytes, ext: str, replacements: list
    ) -> tuple[bytes, int]:
        """
        在 ZIP/XML 层直接做文字替换。
        xlsx/docx 本质是 ZIP 压缩包，直接替换 XML 中的文字节点，
        图片、合并单元格、颜色、字体等格式完全不受影响。
        """
        import io as _io
        import zipfile
        import xml.sax.saxutils as _sax

        if ext == "txt":
            text = content.decode("utf-8", errors="replace")
            replacement_count = 0
            for r in replacements:
                from_raw = r.get("from", "")
                to_raw = r.get("to", "")
                if not from_raw or from_raw == to_raw:
                    continue
                replacement_count += text.count(from_raw)
                text = text.replace(from_raw, to_raw)
            return text.encode("utf-8"), replacement_count

        # xlsx / docx / xls(视为zip) / doc(视为zip)
        # 确定需要做替换的 XML 成员文件
        if ext in ("xlsx", "xls"):
            # 字符串值集中在 sharedStrings.xml；行内字符串在 worksheet xml
            text_files = lambda name: (
                name == "xl/sharedStrings.xml"
                or (name.startswith("xl/worksheets/") and name.endswith(".xml"))
            )
        else:  # docx / doc
            # 正文在 word/document.xml，页眉页脚也可能包含文字
            text_files = lambda name: (
                name == "word/document.xml"
                or (
                    name.startswith("word/")
                    and name.endswith(".xml")
                    and any(
                        k in name for k in ("header", "footer", "endnote", "footnote")
                    )
                )
            )

        def _do_replace(xml_text: str) -> tuple[str, int]:
            replaced = 0
            for r in replacements:
                from_raw = r.get("from", "")
                to_raw = r.get("to", "")
                if not from_raw or from_raw == to_raw:
                    continue
                # 直接替换（XML 中中文通常直接存储，不转义）
                replaced += xml_text.count(from_raw)
                xml_text = xml_text.replace(from_raw, to_raw)
                # 也替换 XML 实体编码版本（&amp; 等）
                from_esc = _sax.escape(from_raw)
                if from_esc != from_raw:
                    replaced += xml_text.count(from_esc)
                    xml_text = xml_text.replace(from_esc, _sax.escape(to_raw))
            return xml_text, replaced

        in_buf = _io.BytesIO(content)
        out_buf = _io.BytesIO()
        replacement_count = 0
        try:
            with (
                zipfile.ZipFile(in_buf, "r") as zin,
                zipfile.ZipFile(out_buf, "w", compression=zipfile.ZIP_DEFLATED) as zout,
            ):
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    if text_files(item.filename):
                        try:
                            xml_str = data.decode("utf-8")
                            xml_str, replaced = _do_replace(xml_str)
                            replacement_count += replaced
                            data = xml_str.encode("utf-8")
                        except Exception:
                            pass  # 解码失败则保持原样
                    # 保持原始压缩信息（文件名、时间戳等）
                    zout.writestr(item, data)
        except zipfile.BadZipFile:
            # 不是有效 ZIP（如真正的旧格式 .xls/.doc 二进制）
            logger.warning("文件不是有效 ZIP（可能是旧版 .xls/.doc），无法替换")
            if ext in ("xls", "doc"):
                raise ValueError("legacy_binary_office")
            raise ValueError("invalid_zip")

        out_buf.seek(0)
        return out_buf.read(), replacement_count

    try:
        modified_bytes, replacement_count = await _asyncio.to_thread(
            _apply_fixes_sync, file_content, ext, replacements
        )
    except ValueError as e:
        if str(e) == "legacy_binary_office":
            raise HTTPException(
                status_code=400,
                detail="旧版 .doc/.xls 二进制文件不支持自动替换，请转存为 .docx/.xlsx 后重试",
            )
        if str(e) == "invalid_zip":
            raise HTTPException(
                status_code=400, detail="文件格式异常，无法执行自动替换"
            )
        raise
    except Exception as e:
        logger.error(f"文件修改失败: {e}")
        raise HTTPException(status_code=500, detail="文件修改失败")

    # 输出文件名：原文件名前缀 + _corrected
    base_name = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
    output_name = f"{base_name}_corrected.{ext}"

    content_types = {
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc": "application/msword",
        "txt": "text/plain; charset=utf-8",
    }
    mime = content_types.get(ext, "application/octet-stream")

    import io as _io
    from urllib.parse import quote

    # RFC 5987 编码：支持中文文件名
    encoded_name = quote(output_name, safe="")
    content_disposition = f"attachment; filename*=UTF-8''{encoded_name}"
    is_modified = replacement_count > 0
    return StreamingResponse(
        _io.BytesIO(modified_bytes),
        media_type=mime,
        headers={
            "Content-Disposition": content_disposition,
            "X-Replacement-Count": str(replacement_count),
            "X-Content-Modified": "true" if is_modified else "false",
            "Access-Control-Expose-Headers": "Content-Disposition,X-Replacement-Count,X-Content-Modified",
        },
    )
