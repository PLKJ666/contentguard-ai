"""
XHS 批量图文单篇处理服务。
"""
import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.xhs import (
    XHSBatchItem,
    XHSBatchJob,
    XHSBrandPack,
    XHSBriefPack,
    XHSDirectionItem,
    XHSProject,
    XHSProjectVariant,
    XHSRiskPack,
    XHSRulePack,
)
from app.services.ai_service import AIServiceFactory

logger = logging.getLogger(__name__)

DEFAULT_BANNED_TERMS = [
    "最好",
    "第一",
    "绝对",
    "100%",
    "顶级",
    "永久",
    "根治",
    "立竿见影",
]

MATCH_STOPWORDS = {
    "一个",
    "一款",
    "一种",
    "这个",
    "那个",
    "这款",
    "产品",
    "品牌",
    "内容",
    "文案",
    "卖点",
    "方向",
    "项目",
    "版本",
    "核心",
    "主打",
    "适合",
    "可以",
    "需要",
    "进行",
    "用户",
    "人群",
    "使用",
    "体验",
    "效果",
    "推荐",
    "分享",
    "小红书",
}

AI_REWRITE_STYLE_PHRASES = [
    "关键一环",
    "实力在线",
    "表现出色",
    "日常管理参考",
    "更适合这类需求人群",
    "作为系列补充也是不错的选择",
    "更方便日常坚持",
]

MINIMAL_EDIT_LITERAL_REPLACEMENTS = [
    ("状态管理诉求", "想调整状态"),
    ("科学管理", "慢慢调整"),
    ("成为肠道健康领域的实力派", "在肠道健康领域有一定讨论度"),
    ("采用的灭活AKK菌工艺，比活菌更安全有效", "采用灭活AKK菌工艺"),
    ("比活菌更安全有效", "采用灭活AKK菌工艺"),
    ("安心有效", ""),
    ("安全有效", ""),
    ("实力不容小觑", ""),
    ("更适合作为日常管理的参考", ""),
    ("作为系列补充", ""),
    ("贴心陪伴", ""),
    ("方便日常坚持", ""),
    ("关键一环", ""),
    ("实力在线", ""),
    ("表现出色", ""),
    ("日常管理参考", ""),
    ("更适合这类需求人群", ""),
    ("日常坚持打卡", ""),
    ("找到适合的方向", "按自己的情况选就行"),
]

FORBIDDEN_TOKEN_PATTERNS = [
    re.compile(r"(?:严禁(?:提及|出现|使用)?|禁止出现|禁用|绝对禁用|禁写)([^。；\n]+)"),
]

FORBIDDEN_CONTEXT_MARKERS = (
    "严禁",
    "禁止",
    "禁用",
    "绝对禁用",
    "绝对违禁",
    "违禁词",
    "违规表述",
    "审核红线",
    "文献/背书违规表述",
    "不得",
    "不可",
)

XHS_AI_MAX_ATTEMPTS = 3
COMPLIANCE_ISSUE_CATEGORIES = {"compliance", "legal", "risk", "forbidden_phrase"}
MANUAL_DECISION_OPTION_LIBRARY: tuple[dict[str, Any], ...] = (
    {
        "id": "compliance_first",
        "title": "优先过审交付",
        "summary": "先删掉冲突卖点和高风险表达，尽快拿到一版可交付终稿。",
        "tradeoffs": [
            "会主动放弃和方向硬约束冲突的卖点。",
            "允许比原稿改动更大，原稿感可能下降。",
        ],
        "prompt_hint": "本次人工选择为“优先过审交付”。遇到方向禁用、项目必带、原稿感三者冲突时，先保证合规可交付；允许适度重组结构，但不要写成品牌说明文。",
    },
    {
        "id": "selling_points_first",
        "title": "优先保主卖点",
        "summary": "在不碰硬禁用的前提下，尽量把主卖点和版本主次讲完整。",
        "tradeoffs": [
            "允许牺牲部分原稿结构和语气保真。",
            "如果卖点天然冲突，仍可能需要再选一次。",
        ],
        "prompt_hint": "本次人工选择为“优先保主卖点”。在不触碰 direction 硬禁用的前提下，优先把主版本核心卖点讲完整，原稿结构与语气退居第二。",
    },
    {
        "id": "style_first",
        "title": "优先保原稿感",
        "summary": "尽量保住原稿结构、口语和平台感，只做必要的合规压弱。",
        "tradeoffs": [
            "允许减少部分非硬性卖点覆盖。",
            "信息完整度可能不如卖点优先方案。",
        ],
        "prompt_hint": "本次人工选择为“优先保原稿感”。在不触碰 direction 硬禁用的前提下，优先保留原稿标题钩子、段落顺序、口语和小红书感；非硬性卖点可适当让位。",
    },
)


@dataclass
class XHSVariantContext:
    name: str = ""
    selling_points: list[str] = field(default_factory=list)
    appearance_notes: str = ""
    notes: str = ""


@dataclass
class XHSRewriteContext:
    project_name: str = ""
    product_name: str = ""
    project_brief: str = ""
    shared_requirements: list[str] = field(default_factory=list)
    direction_name: str = ""
    content_style: str = ""
    direction_brief: str = ""
    extra_requirements: list[str] = field(default_factory=list)
    direction_notes: str = ""
    main_variant: Optional[XHSVariantContext] = None
    secondary_variants: list[XHSVariantContext] = field(default_factory=list)
    brief_required_points: list[str] = field(default_factory=list)
    brief_recommended_phrasings: list[str] = field(default_factory=list)
    brief_forbidden_phrasings: list[str] = field(default_factory=list)
    banned_terms: list[str] = field(default_factory=list)
    replace_hints: list[str] = field(default_factory=list)
    risk_clues: list[str] = field(default_factory=list)
    replace_map: dict[str, str] = field(default_factory=dict)
    format_rules: dict[str, Any] = field(default_factory=dict)
    structure_rules: dict[str, Any] = field(default_factory=dict)
    brand_facts: list[str] = field(default_factory=list)
    product_facts: list[str] = field(default_factory=list)
    optional_blocks: list[str] = field(default_factory=list)

    @property
    def required_selling_points(self) -> list[str]:
        points: list[str] = []
        if self.main_variant:
            points.extend(self.main_variant.selling_points)
        points.extend(self.brief_required_points)
        return _sanitize_required_selling_points(_dedupe_strings(points)[:8], self)

    @property
    def all_banned_terms(self) -> list[str]:
        return _dedupe_strings(DEFAULT_BANNED_TERMS + self.banned_terms + self.brief_forbidden_phrasings)


def _looks_like_xhs_meta_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    if re.match(r"^#\d+\s", normalized) and any(token in normalized for token in ("自定义角度", "需人工", "方向", "角度")):
        return True
    return normalized.startswith(("原文：", "终稿："))


def _looks_like_hashtag_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized or re.match(r"^#\d+\s", normalized):
        return False
    tags = re.findall(r"#[^\s#]+", normalized)
    if not tags:
        return False
    residue = re.sub(r"#[^\s#]+", "", normalized).strip(" /|、，,")
    return not residue


def _build_xhs_source_snapshot(source_text: str, fallback_title: str = "") -> dict[str, Any]:
    lines = [line.strip() for line in source_text.replace("\r\n", "\n").replace("\r", "\n").splitlines() if line.strip()]
    meta_lines: list[str] = []
    body_lines: list[str] = []
    hashtags: list[str] = []
    title = ""
    explicit_title = False

    for line in lines:
        if _looks_like_xhs_meta_line(line):
            meta_lines.append(line)
            continue
        if line.startswith(("标题：", "标题:")):
            explicit_title = True
            title = _sanitize_title(line.split("：", 1)[1] if "：" in line else line.split(":", 1)[1])
            continue
        if _looks_like_hashtag_line(line):
            hashtags = _dedupe_strings(hashtags + _sanitize_hashtags(re.findall(r"#[^\s#]+", line), 20), limit=12)
            continue
        body_lines.append(line)

    if not explicit_title and body_lines:
        first_line = body_lines[0]
        if len(first_line) <= 32 and not re.search(r"[。！？；]", first_line) and len(body_lines) > 1:
            title = _sanitize_title(first_line)
            body_lines = body_lines[1:]

    if not title:
        title = _sanitize_title(fallback_title or (body_lines[0] if body_lines else ""))

    body = _sanitize_body("\n".join(body_lines))
    style_clues: list[str] = []
    if len(body_lines) >= 4:
        style_clues.append(f"原稿约 {len(body_lines)} 段，优先保留分段节奏")
    if any(any(marker in line for marker in ("👉", "✨", "✅", "❗", "【", "】")) for line in body_lines):
        style_clues.append("原稿有提示符/分点结构，优先保留")
    if re.search(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", f"{title}\n{body}"):
        style_clues.append("原稿有 emoji 或强口语表达，优先保留平台感")
    if hashtags:
        style_clues.append("原稿自带 hashtags，优先保留并只做必要增删")
    if body_lines and any(token in body_lines[-1] for token in ("总结", "记住", "认清", "别", "一句")):
        style_clues.append("原稿结尾有总结/提醒句，优先保留")

    return {
        "title": title,
        "body": body or _sanitize_body(source_text),
        "hashtags": _sanitize_hashtags(hashtags, 12),
        "meta_lines": meta_lines,
        "style_clues": style_clues,
    }


def _split_nonempty_lines(text: str) -> list[str]:
    return [line.strip() for line in (text or "").replace("\r\n", "\n").replace("\r", "\n").splitlines() if line.strip()]


def _build_segment_payload(title: str, body: str, hashtags: list[str]) -> dict[str, Any]:
    lines = _split_nonempty_lines(body)
    return {
        "title": title,
        "segments": [
            {
                "index": index,
                "text": line,
                "marker": "bullet" if line.startswith(("👉", "✅", "✨", "【")) else "plain",
            }
            for index, line in enumerate(lines, start=1)
        ],
        "hashtags": hashtags,
    }


def _context_text_blobs(context: XHSRewriteContext) -> list[str]:
    texts = [
        context.project_brief,
        context.direction_brief,
        context.direction_notes,
        *context.shared_requirements,
        *context.extra_requirements,
        *context.brief_forbidden_phrasings,
        *context.banned_terms,
    ]
    if context.main_variant:
        texts.append(context.main_variant.notes)
    texts.extend(variant.notes for variant in context.secondary_variants)
    return [text.strip() for text in texts if text and text.strip()]


def _preferred_variant_full_name(context: XHSRewriteContext, variant: Optional[XHSVariantContext]) -> str:
    if not variant or not variant.name:
        return ""
    normalized_name = variant.name.strip()
    if "innerhealth茵澳斯" in context.product_name and "AKK" in context.product_name:
        if "金标" in normalized_name:
            return "innerhealth茵澳斯 AKK 金标"
        if "银标" in normalized_name:
            return "innerhealth茵澳斯 AKK 银标"
    return normalized_name


def _variant_aliases(context: XHSRewriteContext, variant: Optional[XHSVariantContext]) -> list[str]:
    if not variant or not variant.name:
        return []
    aliases = [
        _preferred_variant_full_name(context, variant),
        _preferred_variant_full_name(context, variant).replace(" ", ""),
        variant.name.strip(),
    ]
    if "金标" in variant.name:
        aliases.append("金标")
    if "银标" in variant.name:
        aliases.append("银标")
    return _dedupe_strings([alias for alias in aliases if alias])


def _extract_forbidden_tokens(*texts: str) -> list[str]:
    tokens: list[str] = []
    for text in texts:
        if not text:
            continue
        for pattern in FORBIDDEN_TOKEN_PATTERNS:
            for raw_clause in pattern.findall(text):
                clause = str(raw_clause).strip()
                clause = re.sub(r"(?:词汇|表达|说法|标签|语境|等高风险词|等词)$", "", clause)
                parts = re.split(r"[、,，/；;及和或]|以及|与|并", clause)
                for part in parts:
                    token = part.strip(" []【】“”\"'：:。；;，,")
                    if len(token) < 2:
                        continue
                    if token.startswith(("出现", "提及", "使用", "写")):
                        continue
                    tokens.append(token)
    return _dedupe_strings(tokens, limit=16)


def _apply_minimal_edit_replacements(text: str) -> str:
    softened = text or ""
    for source, target in MINIMAL_EDIT_LITERAL_REPLACEMENTS:
        softened = softened.replace(source, target)
    softened = re.sub(r"[，,]{2,}", "，", softened)
    softened = re.sub(r"[。！!]{2,}", "。", softened)
    softened = re.sub(r"([，,])([。！？!])", r"\2", softened)
    softened = re.sub(r"[，,]\s*[，,]", "，", softened)
    softened = re.sub(r"\s{2,}", " ", softened)
    return softened.strip(" \n")


def _sanitize_required_selling_points(points: list[str], context: XHSRewriteContext) -> list[str]:
    forbidden_tokens = _extract_forbidden_tokens(*_context_text_blobs(context))
    sanitized_points: list[str] = []
    for point in points:
        cleaned = _apply_minimal_edit_replacements(point)
        for token in forbidden_tokens:
            if token in {"安全", "安心", "温和"}:
                cleaned = cleaned.replace(token, "")
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ，,。；;")
        if cleaned and _required_point_conflicts_with_direction(cleaned, context):
            continue
        if cleaned:
            sanitized_points.append(cleaned)
    return _dedupe_strings(sanitized_points, limit=8)


def _context_lines(context: XHSRewriteContext) -> list[str]:
    lines: list[str] = []
    for text in _context_text_blobs(context):
        lines.extend(_split_nonempty_lines(text))
    return lines


def _is_forbidden_context_line(line: str) -> bool:
    return any(marker in line for marker in FORBIDDEN_CONTEXT_MARKERS)


def _forbidden_context_segments(context: XHSRewriteContext) -> list[str]:
    segments: list[str] = []
    in_forbidden_section = False
    for line in _context_lines(context):
        normalized = line.strip()
        if not normalized:
            continue
        heading_like = bool(re.match(r"^(?:#{1,6}|\d+[\.\)）、])", normalized))
        if _is_forbidden_context_line(normalized):
            in_forbidden_section = True
            segments.append(normalized)
            continue
        if heading_like:
            in_forbidden_section = False
        if in_forbidden_section:
            segments.append(normalized)
    return _dedupe_strings(segments, limit=48)


def _required_point_conflicts_with_direction(point: str, context: XHSRewriteContext) -> bool:
    normalized_point = _normalize_match_text(point)
    if not normalized_point:
        return False

    keywords = [keyword for keyword in _extract_match_keywords(point, limit=10) if len(_normalize_match_text(keyword)) >= 2]
    for line in _forbidden_context_segments(context):
        normalized_line = _normalize_match_text(line)
        if not normalized_line:
            continue
        if len(normalized_point) >= 4 and normalized_point in normalized_line:
            return True
        if any(_normalize_match_text(keyword) in normalized_line for keyword in keywords):
            return True
    return False


def _context_requires_standalone_metabolism(context: XHSRewriteContext) -> bool:
    combined = "\n".join(_context_text_blobs(context))
    return "调节代谢" in combined and any(
        keyword in combined
        for keyword in ("分句", "单独成句", "不与产品名", "避免相邻", "去关联", "不相邻", "绝不能与产品")
    )


def _context_requires_main_variant_first(context: XHSRewriteContext) -> bool:
    if not context.main_variant:
        return False
    combined = "\n".join(_context_text_blobs(context))
    return any(keyword in combined for keyword in ("首提必须全称", "第一处产品提及", "主版本先讲"))


def _build_editor_guardrails(context: XHSRewriteContext) -> list[str]:
    guardrails: list[str] = []
    preferred_main_name = _preferred_variant_full_name(context, context.main_variant)
    if preferred_main_name and _context_requires_main_variant_first(context):
        guardrails.append(f"第一处产品提及优先写全称“{preferred_main_name}”")
    if context.secondary_variants:
        guardrails.append("secondary_variants 只带一句短句即可，不要展开成长说明或并列介绍")
    if _context_requires_standalone_metabolism(context):
        guardrails.append("如果写“调节代谢”，必须单独成句，且不要和产品名或 AKK 紧挨着")
    forbidden_tokens = _extract_forbidden_tokens(*_context_text_blobs(context))
    if forbidden_tokens:
        guardrails.append(f"本方向额外禁用词：{'、'.join(forbidden_tokens[:8])}")
    return guardrails


def _line_has_product_mention(line: str, context: XHSRewriteContext) -> bool:
    aliases: list[str] = []
    if context.product_name:
        aliases.extend([context.product_name, context.product_name.replace(" ", "")])
    aliases.extend(_variant_aliases(context, context.main_variant))
    for variant in context.secondary_variants:
        aliases.extend(_variant_aliases(context, variant))
    aliases.extend(["茵澳斯AKK金标", "茵澳斯AKK银标", "AKK金标", "AKK银标"])
    return any(alias and alias in line for alias in _dedupe_strings(aliases))


def _compress_secondary_variant_line(line: str) -> str:
    line = line.strip()
    if not line:
        return line
    sentence_match = re.match(r"^(.+?[！!。])", line)
    if not sentence_match:
        return line
    first_sentence = sentence_match.group(1)
    if "微调" in line or "小基数" in line:
        return f"{first_sentence}小基数或微调需求也可以看看这款。"
    return first_sentence


def _split_dense_intro_line(line: str) -> list[str]:
    if len(line) < 60 or not any(token in line for token in ("TGA", "EFSA", "Nature", "顶刊", "研究成果")):
        return [line]
    expanded = line.replace("！👀 ", "！👀\n").replace("。", "。\n")
    return _split_nonempty_lines(expanded)


def _postprocess_xhs_editor_output(
    *,
    title: str,
    body: str,
    hashtags: list[str],
    context: XHSRewriteContext,
    source_note: dict[str, Any],
    max_hashtags: int,
) -> tuple[str, str, list[str]]:
    preferred_main_name = _preferred_variant_full_name(context, context.main_variant)
    preferred_secondary_names = {
        alias.replace(" ", ""): alias
        for variant in context.secondary_variants
        if (alias := _preferred_variant_full_name(context, variant))
    }
    source_body = str(source_note.get("body") or "")

    adjusted_title = _sanitize_title(_apply_minimal_edit_replacements(title))
    adjusted_body = _apply_minimal_edit_replacements(body)

    if preferred_main_name:
        adjusted_body = adjusted_body.replace(preferred_main_name.replace(" ", ""), preferred_main_name)
    for compact_name, spaced_name in preferred_secondary_names.items():
        adjusted_body = adjusted_body.replace(compact_name, spaced_name)

    lines = _split_nonempty_lines(adjusted_body)
    output_lines: list[str] = []
    for index, line in enumerate(lines):
        current = _apply_minimal_edit_replacements(line)
        if not current:
            continue
        if index == 0:
            dense_parts = _split_dense_intro_line(current)
            if len(dense_parts) > 1:
                for dense_part in dense_parts:
                    normalized_part = re.sub(r"\s+", " ", dense_part).strip(" ")
                    normalized_part = re.sub(r"[，,]([。！？!])", r"\1", normalized_part)
                    normalized_part = re.sub(r"[。]{2,}", "。", normalized_part)
                    normalized_part = re.sub(r"[！!]{2,}", "！", normalized_part)
                    normalized_part = re.sub(r"采用的?灭活AKK菌工艺[，,。 ]+采用的?灭活AKK菌工艺", "采用灭活AKK菌工艺", normalized_part)
                    normalized_part = re.sub(r"(采用灭活AKK菌工艺)[，,。 ]+\1", r"\1", normalized_part)
                    normalized_part = normalized_part.strip("，,")
                    if normalized_part:
                        output_lines.append(normalized_part)
                continue
        if _context_requires_standalone_metabolism(context) and "调节代谢" in current:
            previous_line = output_lines[-1] if output_lines else ""
            next_line = lines[index + 1] if index + 1 < len(lines) else ""
            if (
                _line_has_product_mention(current, context)
                or _line_has_product_mention(previous_line, context)
                or _line_has_product_mention(next_line, context)
            ) and "调节代谢" not in source_body:
                continue
        if context.secondary_variants and any(alias in current for variant in context.secondary_variants for alias in _variant_aliases(context, variant)):
            if len(current) > 56 or current.count("。") + current.count("！") + current.count("!") >= 3:
                current = _compress_secondary_variant_line(current)
        current = re.sub(r"\s+", " ", current).strip(" ")
        current = re.sub(r"[，,]([。！？!])", r"\1", current)
        current = re.sub(r"[。]{2,}", "。", current)
        current = re.sub(r"[！!]{2,}", "！", current)
        current = re.sub(r"采用的?灭活AKK菌工艺[，,。 ]+采用的?灭活AKK菌工艺", "采用灭活AKK菌工艺", current)
        current = re.sub(r"(采用灭活AKK菌工艺)[，,。 ]+\1", r"\1", current)
        current = current.strip("，,")
        if current:
            output_lines.append(current)

    if _context_requires_standalone_metabolism(context) and not any("调节代谢" in line for line in output_lines):
        output_lines.append("调节代谢这件事，也得慢慢来。")

    adjusted_hashtags = _sanitize_hashtags(hashtags or source_note.get("hashtags") or [], max_hashtags)
    return adjusted_title, _sanitize_body("\n".join(output_lines)), adjusted_hashtags


def _char_ngram_set(text: str, n: int = 2) -> set[str]:
    normalized = _normalize_match_text(text)
    if len(normalized) < n:
        return {normalized} if normalized else set()
    return {normalized[index : index + n] for index in range(len(normalized) - n + 1)}


def _text_overlap_ratio(source: str, target: str) -> float:
    source_ngrams = _char_ngram_set(source)
    target_ngrams = _char_ngram_set(target)
    if not source_ngrams or not target_ngrams:
        return 0.0
    return len(source_ngrams & target_ngrams) / max(1, len(source_ngrams))


def _extract_json_block(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    raise json.JSONDecodeError("missing json block", text[:200], 0)


def _extract_json_payload(text: str) -> str:
    object_start = text.find("{")
    array_start = text.find("[")
    starts = [index for index in (object_start, array_start) if index != -1]
    if not starts:
        raise json.JSONDecodeError("missing json payload", text[:200], 0)

    start = min(starts)
    if start == array_start and (object_start == -1 or array_start < object_start):
        end = text.rfind("]")
    else:
        end = text.rfind("}")

    if end != -1 and end > start:
        return text[start : end + 1]
    raise json.JSONDecodeError("missing json payload", text[:200], 0)


def _robust_json_load(text: str) -> Any:
    original = text
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    candidates = [text]
    try:
        candidates.append(_extract_json_payload(text))
    except json.JSONDecodeError:
        pass
    candidates.append(text.replace("\r\n", " ").replace("\n", " ").replace("\r", " "))

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            return parsed
        except Exception:
            continue

    logger.error("XHS AI JSON load failed: %s", repr(original[:500]))
    raise json.JSONDecodeError("无法解析 AI 返回 JSON", original[:200], 0)


def _robust_json_parse(text: str) -> dict[str, Any]:
    parsed = _robust_json_load(text)
    if isinstance(parsed, dict):
        return parsed
    raise json.JSONDecodeError("AI 返回 JSON 不是对象", text[:200], 0)


def _dedupe_strings(values: list[str], limit: Optional[int] = None) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        items.append(normalized)
        if limit and len(items) >= limit:
            break
    return items


def _split_freeform_text(value: Optional[str], limit: Optional[int] = None) -> list[str]:
    if not value:
        return []
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    parts = [
        part.strip(" -•·\t")
        for part in re.split(r"[\n;；]+", normalized)
        if part.strip(" -•·\t")
    ]
    return _dedupe_strings(parts, limit=limit)


def _stringify_mapping(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return " / ".join(str(item).strip() for item in value if str(item).strip())
    if isinstance(value, dict):
        parts = []
        for key in ("value", "content", "text", "description", "note", "summary", "name"):
            current = value.get(key)
            if current:
                parts.append(str(current).strip())
        return " / ".join(_dedupe_strings(parts, limit=3))
    return ""


def _summarize_structured_entries(entries: Any, limit: int = 8) -> list[str]:
    if not isinstance(entries, list):
        return []

    output: list[str] = []
    for entry in entries:
        if isinstance(entry, str):
            summary = entry.strip()
        elif isinstance(entry, dict):
            label_parts = []
            for key in ("name", "title", "label", "fact", "summary", "description", "note"):
                current = entry.get(key)
                if current:
                    label_parts.append(str(current).strip())
            if not label_parts:
                for key, current in entry.items():
                    rendered = _stringify_mapping(current)
                    if rendered:
                        label_parts.append(f"{key}: {rendered}")
            summary = " | ".join(_dedupe_strings(label_parts, limit=3))
        else:
            summary = str(entry).strip()

        if summary:
            output.append(summary)
        if len(output) >= limit:
            break

    return _dedupe_strings(output, limit=limit)


def _sanitize_title(title: str) -> str:
    return re.sub(r"\s+", " ", title.strip())[:60]


def _sanitize_body(body: str) -> str:
    lines = [line.rstrip() for line in body.replace("\r\n", "\n").splitlines()]
    lines = [line for line in lines if line.strip()]
    return "\n".join(lines).strip()


def _sanitize_hashtags(hashtags: list[Any], max_count: int) -> list[str]:
    output: list[str] = []
    for item in hashtags:
        tag = str(item).strip()
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = f"#{tag}"
        tag = re.sub(r"\s+", "", tag)
        if tag not in output:
            output.append(tag)
        if len(output) >= max_count:
            break
    return output


def _build_copy_ready_text(title: str, body: str, hashtags: list[str]) -> str:
    parts = [title, body]
    if hashtags:
        parts.append(" ".join(hashtags))
    return "\n\n".join(part for part in parts if part)


def _local_verify_text(title: str, body: str) -> dict[str, Any]:
    combined = f"{title}\n{body}".strip()
    hits = [term for term in DEFAULT_BANNED_TERMS if term in combined]
    return {
        "pass": not hits,
        "confidence": 0.9 if not hits else 0.75,
        "issues": [{"term": term, "reason": "命中默认高风险词"} for term in hits],
        "needs_safe_rewrite": bool(hits),
        "summary": "通过本地规则校验" if not hits else f"命中 {len(hits)} 个默认高风险词",
    }


def _safe_rewrite(text: str) -> str:
    sanitized = text
    for term in DEFAULT_BANNED_TERMS:
        sanitized = sanitized.replace(term, "")
    sanitized = re.sub(r"\s{2,}", " ", sanitized)
    sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
    return sanitized.strip()


def _fallback_editor_output(
    source_text: str,
    round_num: int,
    issues: Optional[list[dict[str, Any]]] = None,
    fallback_title: str = "",
) -> dict[str, Any]:
    snapshot = _build_xhs_source_snapshot(source_text, fallback_title=fallback_title)
    title = _sanitize_title(snapshot.get("title") or fallback_title or f"改写稿 round {round_num}")
    body = _sanitize_body(str(snapshot.get("body") or source_text))
    hashtags = _sanitize_hashtags(snapshot.get("hashtags") or [], 10)
    if issues:
        body = _safe_rewrite(body)
        title = _sanitize_title(_safe_rewrite(title))
    return {
        "title": title,
        "body": body or source_text.strip(),
        "hashtags": hashtags,
        "strategy": "fallback",
    }


def _normalize_split_source_text(source_text: str) -> str:
    normalized = source_text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[ \t]+\n", "\n", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def _split_notes_by_rule(source_text: str) -> list[str]:
    normalized = _normalize_split_source_text(source_text)
    if not normalized:
        return []

    chunks = [chunk.strip() for chunk in re.split(r"\n\s*\n+", normalized) if chunk.strip()]
    if len(chunks) > 1:
        return chunks

    fallback = [
        chunk.strip()
        for chunk in re.split(r"(?=^#{1,3}\s)|(?=^---+$)|(?=^===+$)", normalized, flags=re.MULTILINE)
        if chunk.strip()
    ]
    return fallback or [normalized]


def _guess_title_from_text(source_text: str, index: int) -> str:
    first_line = next((line.strip() for line in source_text.splitlines() if line.strip()), "")
    if not first_line:
        return f"笔记 {index}"
    cleaned = re.sub(r"^[#\-\d\.\)\s]+", "", first_line)
    return cleaned[:60] or f"笔记 {index}"


def _build_rule_split_result(source_text: str) -> list[dict[str, Any]]:
    chunks = _split_notes_by_rule(source_text)
    if not chunks:
        return []

    split_by = "rule" if len(chunks) > 1 else "weak_rule"
    confidence = 0.92 if split_by == "rule" else 0.68
    return [
        {
            "content": chunk,
            "title_guess": _guess_title_from_text(chunk, index),
            "split_by": split_by,
            "boundary_confidence": confidence,
            "model_meta": {
                "split_strategy": split_by,
                "boundary_confidence": confidence,
            },
        }
        for index, chunk in enumerate(chunks, start=1)
    ]


def _should_try_ai_split(source_text: str, rule_notes: list[dict[str, Any]]) -> bool:
    if not rule_notes:
        return False
    if len(rule_notes) <= 1:
        return True
    if len(source_text) >= 1200:
        return True
    return any(len(str(note.get("content") or "")) >= 900 for note in rule_notes)


async def _run_split_ai(
    tenant_id: str,
    db: AsyncSession,
    source_text: str,
) -> tuple[list[dict[str, Any]], int]:
    client = await AIServiceFactory.get_client(tenant_id, db)
    config = await AIServiceFactory.get_config(tenant_id, db)
    if not client or not config:
        return [], 0

    models = config.models or {}
    model = models.get("xhs_split") or models.get("text")
    if not model:
        return [], 0

    prompt = f"""你是小红书长文本拆分助手。请把输入拆成多篇图文笔记，只输出 JSON：
{{
  "notes": [
    {{
      "title_guess": "候选标题",
      "content": "该篇完整正文",
      "boundary_confidence": 0.93
    }}
  ]
}}

要求：
- 不能改写原文语义，只能按篇拆分和轻微清洗空行
- 如果只有一篇，也必须返回 notes 数组
- 每篇的 content 必须是完整可读文本
- boundary_confidence 取 0 到 1

source_text:
{source_text}
"""
    response = await client.chat_completion(
        messages=[{"role": "user", "content": prompt}],
        model=model,
        temperature=min(config.temperature, 0.3),
        max_tokens=max(config.max_tokens, 1800),
    )

    payload = _robust_json_load(response.content)
    if isinstance(payload, dict):
        raw_notes = payload.get("notes") or []
    elif isinstance(payload, list):
        raw_notes = payload
    else:
        raw_notes = []

    parsed_notes: list[dict[str, Any]] = []
    for index, raw_note in enumerate(raw_notes, start=1):
        if not isinstance(raw_note, dict):
            continue
        content = _normalize_split_source_text(str(raw_note.get("content") or ""))
        if not content:
            continue
        boundary_confidence = raw_note.get("boundary_confidence")
        try:
            boundary_confidence = float(boundary_confidence)
        except (TypeError, ValueError):
            boundary_confidence = 0.75
        boundary_confidence = max(0.0, min(boundary_confidence, 1.0))

        parsed_notes.append(
            {
                "content": content,
                "title_guess": str(raw_note.get("title_guess") or "").strip() or _guess_title_from_text(content, index),
                "split_by": "ai_assisted",
                "boundary_confidence": boundary_confidence,
                "model_meta": {
                    "split_strategy": "ai_assisted",
                    "boundary_confidence": boundary_confidence,
                    "boundary_model": model,
                },
            }
        )

    return parsed_notes, int(response.usage.get("total_tokens", 0))


async def split_xhs_source_text(
    tenant_id: str,
    db: AsyncSession,
    source_text: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    normalized = _normalize_split_source_text(source_text)
    rule_notes = _build_rule_split_result(normalized)
    split_meta = {
        "split_strategy": rule_notes[0]["split_by"] if rule_notes else "empty",
        "split_model": None,
        "split_tokens": 0,
        "rule_split_count": len(rule_notes),
    }

    if not _should_try_ai_split(normalized, rule_notes):
        return rule_notes, split_meta

    try:
        ai_notes, split_tokens = await _run_split_ai(tenant_id=tenant_id, db=db, source_text=normalized)
    except Exception as exc:
        logger.warning("XHS split AI failed, fallback to rules: %s", exc)
        return rule_notes, {**split_meta, "split_fallback_reason": str(exc)}

    if not ai_notes:
        return rule_notes, {**split_meta, "split_fallback_reason": "empty_ai_split_result"}

    split_meta.update(
        {
            "split_strategy": "ai_assisted",
            "split_model": ai_notes[0].get("model_meta", {}).get("boundary_model"),
            "split_tokens": split_tokens,
            "ai_split_count": len(ai_notes),
        }
    )
    return ai_notes, split_meta


def _build_variant_context(variant: Optional[XHSProjectVariant]) -> Optional[XHSVariantContext]:
    if not variant:
        return None
    return XHSVariantContext(
        name=(variant.name or "").strip(),
        selling_points=_split_freeform_text(variant.selling_points, limit=6),
        appearance_notes=(variant.appearance_notes or "").strip(),
        notes=(variant.notes or "").strip(),
    )


async def _load_xhs_rewrite_context(
    tenant_id: str,
    db: AsyncSession,
    job: XHSBatchJob,
) -> XHSRewriteContext:
    context = XHSRewriteContext()

    if job.direction_id:
        direction_result = await db.execute(
            select(XHSDirectionItem).where(
                XHSDirectionItem.id == job.direction_id,
                XHSDirectionItem.tenant_id == tenant_id,
            )
        )
        direction = direction_result.scalar_one_or_none()
    else:
        direction = None

    if direction:
        context.direction_name = (direction.name or "").strip()
        context.content_style = (direction.content_style or "").strip()
        context.direction_brief = (direction.direction_brief or "").strip()
        context.extra_requirements = _split_freeform_text(direction.extra_requirements, limit=8)
        context.direction_notes = (direction.notes or "").strip()

        project_result = await db.execute(
            select(XHSProject).where(
                XHSProject.id == direction.project_id,
                XHSProject.tenant_id == tenant_id,
            )
        )
        project = project_result.scalar_one_or_none()
        if project:
            context.project_name = (project.name or "").strip()
            context.product_name = (project.product_name or "").strip()
            context.project_brief = (project.project_brief or "").strip()
            context.shared_requirements = _split_freeform_text(project.shared_requirements, limit=8)

        variant_ids = _dedupe_strings(
            [direction.main_variant_id or ""] + list(direction.secondary_variant_ids_json or [])
        )
        variants_by_id: dict[str, XHSProjectVariant] = {}
        if variant_ids:
            variants_result = await db.execute(
                select(XHSProjectVariant).where(
                    XHSProjectVariant.id.in_(variant_ids),
                    XHSProjectVariant.tenant_id == tenant_id,
                )
            )
            variants_by_id = {variant.id: variant for variant in variants_result.scalars().all()}

        context.main_variant = _build_variant_context(
            variants_by_id.get(direction.main_variant_id or "")
        )
        context.secondary_variants = [
            variant_context
            for variant_id in direction.secondary_variant_ids_json or []
            if (variant_context := _build_variant_context(variants_by_id.get(variant_id)))
        ]

    if job.rule_pack_version:
        rule_pack_result = await db.execute(
            select(XHSRulePack).where(
                XHSRulePack.tenant_id == tenant_id,
                XHSRulePack.category_id == job.category_id,
                XHSRulePack.version == job.rule_pack_version,
            )
        )
        rule_pack = rule_pack_result.scalar_one_or_none()
        if rule_pack and isinstance(rule_pack.pack_json, dict):
            pack_json = rule_pack.pack_json
            context.banned_terms = _dedupe_strings(
                [str(item).strip() for item in pack_json.get("banned_terms", []) if str(item).strip()],
                limit=12,
            )
            if isinstance(pack_json.get("replace_map"), dict):
                context.replace_map = {
                    str(key).strip(): str(value).strip()
                    for key, value in pack_json["replace_map"].items()
                    if str(key).strip() and str(value).strip()
                }
            if isinstance(pack_json.get("format_rules"), dict):
                context.format_rules = pack_json["format_rules"]
            if isinstance(pack_json.get("structure_rules"), dict):
                context.structure_rules = pack_json["structure_rules"]

    if job.risk_pack_version:
        risk_pack_result = await db.execute(
            select(XHSRiskPack).where(
                XHSRiskPack.tenant_id == tenant_id,
                XHSRiskPack.category_id == job.category_id,
                XHSRiskPack.version == job.risk_pack_version,
            )
        )
        risk_pack = risk_pack_result.scalar_one_or_none()
        if risk_pack and isinstance(risk_pack.pack_json, dict):
            context.risk_clues = _summarize_structured_entries(risk_pack.pack_json.get("risk_clues"), limit=8)
            context.replace_hints = _summarize_structured_entries(risk_pack.pack_json.get("replace_hints"), limit=8)

    if job.brand_pack_version:
        brand_pack_result = await db.execute(
            select(XHSBrandPack).where(
                XHSBrandPack.tenant_id == tenant_id,
                XHSBrandPack.category_id == job.category_id,
                XHSBrandPack.version == job.brand_pack_version,
            )
        )
        brand_pack = brand_pack_result.scalar_one_or_none()
        if brand_pack and isinstance(brand_pack.pack_json, dict):
            context.brand_facts = _summarize_structured_entries(brand_pack.pack_json.get("brand_facts"), limit=8)
            context.product_facts = _summarize_structured_entries(brand_pack.pack_json.get("products"), limit=8)
            context.optional_blocks = _summarize_structured_entries(brand_pack.pack_json.get("optional_blocks"), limit=6)

    if job.brief_pack_id:
        brief_pack_result = await db.execute(
            select(XHSBriefPack).where(
                XHSBriefPack.id == job.brief_pack_id,
                XHSBriefPack.tenant_id == tenant_id,
            )
        )
        brief_pack = brief_pack_result.scalar_one_or_none()
        if brief_pack and isinstance(brief_pack.pack_json, dict):
            pack_json = brief_pack.pack_json
            context.brief_required_points = _dedupe_strings(
                [
                    _stringify_mapping(item)
                    for item in pack_json.get("selling_point_priority", [])
                ],
                limit=8,
            )
            context.brief_recommended_phrasings = _dedupe_strings(
                [str(item).strip() for item in pack_json.get("recommended_phrasings", []) if str(item).strip()],
                limit=8,
            )
            context.brief_forbidden_phrasings = _dedupe_strings(
                [str(item).strip() for item in pack_json.get("forbidden_phrasings", []) if str(item).strip()],
                limit=8,
            )

    return context


def _context_to_prompt_payload(context: XHSRewriteContext) -> dict[str, Any]:
    payload: dict[str, Any] = {}

    def put(key: str, value: Any) -> None:
        if value in (None, "", [], {}, ()):
            return
        payload[key] = value

    put("project_name", context.project_name)
    put("product_name", context.product_name)
    put("project_brief", context.project_brief)
    put(
        "requirement_precedence",
        "如 project/shared_requirements、variant selling_points、brief required points 与 direction 硬约束或禁用规则冲突，以 direction 为准；冲突项不算必带卖点。",
    )
    put("shared_requirements", context.shared_requirements)
    put("direction_name", context.direction_name)
    put("content_style", context.content_style)
    put("direction_brief", context.direction_brief)
    put("extra_requirements", context.extra_requirements)
    put("direction_notes", context.direction_notes)

    if context.main_variant:
        put(
            "main_variant",
            {
                "name": context.main_variant.name,
                "selling_points": _sanitize_required_selling_points(context.main_variant.selling_points, context),
                "appearance_notes": context.main_variant.appearance_notes,
                "notes": context.main_variant.notes,
            },
        )
    if context.secondary_variants:
        put(
            "secondary_variants",
            [
                {
                    "name": variant.name,
                    "selling_points": _sanitize_required_selling_points(variant.selling_points, context),
                    "appearance_notes": variant.appearance_notes,
                    "notes": variant.notes,
                }
                for variant in context.secondary_variants
            ],
        )

    put("required_selling_points", context.required_selling_points)
    put("editor_guardrails", _build_editor_guardrails(context))
    put("recommended_phrasings", context.brief_recommended_phrasings)
    put("forbidden_phrasings", context.brief_forbidden_phrasings)
    put("banned_terms", context.banned_terms)
    put("risk_clues", context.risk_clues)
    put("replace_hints", context.replace_hints)
    put("replace_map", context.replace_map)
    put("format_rules", context.format_rules)
    put("structure_rules", context.structure_rules)
    put("brand_facts", context.brand_facts)
    put("product_facts", context.product_facts)
    put("optional_blocks", context.optional_blocks)
    return payload


def _context_to_prompt_text(context: XHSRewriteContext) -> str:
    payload = _context_to_prompt_payload(context)
    if not payload:
        return "{}"
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _normalize_match_text(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", (text or "")).lower()


def _extract_match_keywords(text: str, limit: int = 6) -> list[str]:
    normalized = re.split(r"[，。！？；、,/（）()【】\[\]\n\r\t ]+", text or "")
    candidates: list[str] = []
    for chunk in normalized:
        chunk = chunk.strip().lower()
        if len(chunk) < 2:
            continue
        candidates.append(chunk)
        candidates.extend(
            token.strip().lower()
            for token in re.findall(r"[a-z0-9+#._-]{2,}|[\u4e00-\u9fff]{2,}", chunk)
        )

    filtered = []
    for candidate in candidates:
        if len(candidate) < 2 or candidate in MATCH_STOPWORDS:
            continue
        filtered.append(candidate)

    deduped = _dedupe_strings(filtered)
    deduped.sort(key=len, reverse=True)
    return deduped[:limit]


def _selling_point_matches_text(point: str, combined_text: str) -> bool:
    if not point.strip():
        return False
    normalized_text = _normalize_match_text(combined_text)
    normalized_point = _normalize_match_text(point)
    if normalized_point and len(normalized_point) >= 4 and normalized_point in normalized_text:
        return True

    keywords = _extract_match_keywords(point)
    if not keywords:
        return False

    hits = sum(1 for keyword in keywords if _normalize_match_text(keyword) in normalized_text)
    if len(keywords) == 1:
        return hits >= 1
    if len(keywords) <= 3:
        return hits >= 1
    return hits >= 2


def _infer_issue_category(issue: dict[str, Any]) -> str:
    category = str(issue.get("category") or issue.get("type") or "").strip().lower()
    if category:
        return category

    reason = f"{issue.get('term', '')} {issue.get('reason', '')}".lower()
    if any(keyword in reason for keyword in ("卖点", "版本", "逻辑", "主版本", "核心点")):
        return "selling_point_alignment"
    if any(keyword in reason for keyword in ("方向", "风格", "口吻", "要求", "规则", "跑偏")):
        return "direction_alignment"
    return "compliance"


def _is_retryable_xhs_ai_exception(exc: Exception) -> bool:
    if isinstance(exc, json.JSONDecodeError):
        return True

    name = type(exc).__name__
    message = str(exc).lower()
    if name in {"APIConnectionError", "APITimeoutError", "RateLimitError", "TimeoutException", "ReadTimeout"}:
        return True
    return any(
        marker in message
        for marker in (
            "connection error",
            "event loop is closed",
            "timed out",
            "rate limit",
            "429",
            "temporarily unavailable",
        )
    )


def _normalize_issue(issue: Any) -> dict[str, Any]:
    if isinstance(issue, dict):
        normalized = {
            "term": str(issue.get("term") or issue.get("content") or "").strip(),
            "reason": str(issue.get("reason") or issue.get("message") or issue.get("summary") or "").strip(),
        }
        category = _infer_issue_category(issue)
        if category:
            normalized["category"] = category
        return normalized
    return {
        "term": "",
        "reason": str(issue).strip(),
        "category": "compliance",
    }


def _dedupe_issues(issues: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for issue in issues:
        item = _normalize_issue(issue)
        key = (
            str(item.get("category") or ""),
            str(item.get("term") or ""),
            str(item.get("reason") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        normalized.append(item)
    return normalized


def _manual_decision_option_by_id(option_id: Optional[str]) -> Optional[dict[str, Any]]:
    normalized_id = str(option_id or "").strip()
    if not normalized_id:
        return None
    return next((dict(option) for option in MANUAL_DECISION_OPTION_LIBRARY if option["id"] == normalized_id), None)


def _selected_manual_decision_option(item: XHSBatchItem) -> Optional[dict[str, Any]]:
    meta = dict(item.model_meta_json or {})
    return _manual_decision_option_by_id(meta.get("selected_decision_option_id"))


def _manual_decision_categories(issues: list[Any]) -> set[str]:
    return {
        _infer_issue_category(_normalize_issue(issue))
        for issue in issues
        if _infer_issue_category(_normalize_issue(issue)) not in COMPLIANCE_ISSUE_CATEGORIES
    }


def _needs_manual_decision(issues: list[Any]) -> bool:
    return bool(_manual_decision_categories(issues))


def _build_manual_decision_payload(issues: list[Any], selected_option_id: Optional[str] = None) -> dict[str, Any]:
    normalized_issues = _dedupe_issues(issues)
    direction_count = sum(1 for issue in normalized_issues if issue.get("category") == "direction_alignment")
    selling_count = sum(1 for issue in normalized_issues if issue.get("category") == "selling_point_alignment")
    has_compliance = any(issue.get("category") in COMPLIANCE_ISSUE_CATEGORIES for issue in normalized_issues)

    recommended_option_id = "compliance_first"
    if selling_count > direction_count and selling_count >= 1:
        recommended_option_id = "selling_points_first"
    elif direction_count > selling_count and direction_count >= 2:
        recommended_option_id = "style_first"

    if selected_option_id and _manual_decision_option_by_id(selected_option_id):
        recommended_option_id = selected_option_id

    highlights = [
        issue.get("reason", "").strip()
        for issue in normalized_issues
        if issue.get("reason")
    ][:3]

    summary_parts = [
        "这条不是单纯改写失败，而是当前规则之间有取舍冲突。",
        "请先选一个优先级，系统会按你的选择继续生成终稿。",
    ]
    if has_compliance:
        summary_parts.append("无论选哪种方案，合规红线都不会放开。")
    if highlights:
        summary_parts.append("当前最卡的点：" + "；".join(highlights))

    options: list[dict[str, Any]] = []
    for option in MANUAL_DECISION_OPTION_LIBRARY:
        options.append(
            {
                "id": option["id"],
                "title": option["title"],
                "summary": option["summary"],
                "tradeoffs": list(option.get("tradeoffs") or []),
                "recommended": option["id"] == recommended_option_id,
            }
        )

    return {
        "decision_summary": " ".join(summary_parts),
        "decision_options": options,
        "recommended_decision_option_id": recommended_option_id,
        "selected_decision_option_id": selected_option_id,
    }


def _evaluate_manual_decision_choice(
    verifier_output: dict[str, Any],
    selected_option: dict[str, Any],
) -> dict[str, Any]:
    normalized_issues = _dedupe_issues(verifier_output.get("issues") or [])
    compliance_issues = [
        issue for issue in normalized_issues if issue.get("category") in COMPLIANCE_ISSUE_CATEGORIES
    ]
    direction_issues = [
        issue for issue in normalized_issues if issue.get("category") == "direction_alignment"
    ]
    selling_issues = [
        issue for issue in normalized_issues if issue.get("category") == "selling_point_alignment"
    ]

    if compliance_issues:
        return {
            "pass": False,
            "blocking_issues": compliance_issues,
            "warning_issues": direction_issues + selling_issues,
        }

    option_id = selected_option["id"]
    if option_id == "selling_points_first" and selling_issues:
        return {
            "pass": False,
            "blocking_issues": selling_issues,
            "warning_issues": direction_issues,
        }
    if option_id == "style_first" and direction_issues:
        return {
            "pass": False,
            "blocking_issues": direction_issues,
            "warning_issues": selling_issues,
        }

    return {
        "pass": True,
        "blocking_issues": [],
        "warning_issues": direction_issues + selling_issues,
    }


def _apply_manual_decision_to_verifier(
    verifier_output: dict[str, Any],
    selected_option: dict[str, Any],
    warning_issues: list[dict[str, Any]],
) -> dict[str, Any]:
    warning_reasons = [issue.get("reason", "").strip() for issue in warning_issues if issue.get("reason")]
    summary_parts = _dedupe_strings(
        [
            str(verifier_output.get("summary") or "").strip(),
            f"已按人工选择“{selected_option['title']}”收敛，剩余问题改为提示项。",
            f"提示：{'；'.join(warning_reasons[:2])}" if warning_reasons else "",
        ]
    )
    adjusted = dict(verifier_output)
    adjusted["pass"] = True
    adjusted["issues"] = []
    adjusted["summary"] = " ".join(summary_parts)
    adjusted["manual_decision_applied"] = True
    adjusted["manual_decision_option_id"] = selected_option["id"]
    adjusted["manual_decision_label"] = selected_option["title"]
    adjusted["manual_decision_warnings"] = warning_issues
    return adjusted


def _build_local_alignment_check(
    title: str,
    body: str,
    context: XHSRewriteContext,
    source_note: Optional[dict[str, Any]] = None,
    hashtags: Optional[list[str]] = None,
) -> dict[str, Any]:
    combined = f"{title}\n{body}\n{' '.join(hashtags or [])}".strip()
    issues: list[dict[str, Any]] = []
    direction_violations: list[str] = []

    compliance_hits = [term for term in context.all_banned_terms if term and term in combined]
    for term in compliance_hits:
        issues.append(
            {
                "term": term,
                "reason": "命中方向/规则禁用表达",
                "category": "compliance",
            }
        )

    source_title = str((source_note or {}).get("title") or "").strip()
    source_body = str((source_note or {}).get("body") or "").strip()
    source_hashtags = _sanitize_hashtags((source_note or {}).get("hashtags") or [], 20)
    source_combined = f"{source_title}\n{source_body}\n{' '.join(source_hashtags)}".strip()
    source_lines = _split_nonempty_lines(source_body)
    output_lines = _split_nonempty_lines(body)
    opening_chunk = "\n".join(output_lines[:2])[:140]
    preferred_main_name = _preferred_variant_full_name(context, context.main_variant)
    main_aliases = _variant_aliases(context, context.main_variant)
    secondary_aliases = [
        alias
        for variant in context.secondary_variants
        for alias in _variant_aliases(context, variant)
    ]

    if source_title and len(source_title) >= 8 and _text_overlap_ratio(source_title, title) < 0.28:
        issues.append(
            {
                "term": source_title,
                "reason": "标题钩子改动过大，不像在原稿上做局部修订",
                "category": "direction_alignment",
            }
        )
        direction_violations.append("标题钩子改动过大")

    if source_lines:
        has_source_bullets = any(line.startswith("👉") for line in source_lines)
        has_output_bullets = any(line.startswith("👉") for line in output_lines)
        if has_source_bullets and not has_output_bullets:
            issues.append(
                {
                    "term": "👉",
                    "reason": "原稿的分点结构被洗掉，缺少小红书原始节奏",
                    "category": "direction_alignment",
                }
            )
            direction_violations.append("原稿分点结构丢失")

        has_source_summary = any(line.startswith("总结一句") for line in source_lines)
        has_output_summary = any(line.startswith("总结一句") for line in output_lines)
        if has_source_summary and not has_output_summary:
            issues.append(
                {
                    "term": "总结一句",
                    "reason": "原稿结尾总结句被洗掉，不像人工局部修稿",
                    "category": "direction_alignment",
                }
            )
            direction_violations.append("原稿结尾总结句丢失")

    if preferred_main_name and _context_requires_main_variant_first(context):
        if not any(alias in opening_chunk for alias in main_aliases):
            issues.append(
                {
                    "term": preferred_main_name,
                    "reason": "主版本出场太晚，开头没有先把 main_variant 立住",
                    "category": "selling_point_alignment",
                }
            )
        for alias in secondary_aliases:
            if alias in opening_chunk and not any(main_alias in opening_chunk for main_alias in main_aliases):
                issues.append(
                    {
                        "term": alias,
                        "reason": "secondary_variants 抢在主版本前面出现，版本主次不清",
                        "category": "selling_point_alignment",
                    }
                )
                break

    if _context_requires_standalone_metabolism(context):
        for index, line in enumerate(output_lines):
            if "调节代谢" not in line:
                continue
            previous_line = output_lines[index - 1] if index > 0 else ""
            next_line = output_lines[index + 1] if index + 1 < len(output_lines) else ""
            if (
                _line_has_product_mention(line, context)
                or _line_has_product_mention(previous_line, context)
                or _line_has_product_mention(next_line, context)
            ):
                issues.append(
                    {
                        "term": "调节代谢",
                        "reason": "“调节代谢”没有做到独立成句且与产品名拉开，仍像在强绑功效",
                        "category": "direction_alignment",
                    }
                )
                direction_violations.append("调节代谢与产品名贴得过近")
                break

    if source_body and len(source_body) >= 80:
        body_overlap = _text_overlap_ratio(source_body, body)
        if body_overlap < 0.42:
            issues.append(
                {
                    "term": "原稿骨架",
                    "reason": "正文改动过大，已经偏向重写，不像逐段删改",
                    "category": "direction_alignment",
                }
            )
            direction_violations.append("正文偏向重写")
        elif len(body) > len(source_body) + max(30, int(len(source_body) * 0.25)) and body_overlap < 0.62:
            issues.append(
                {
                    "term": "新增内容",
                    "reason": "新增解释性内容过多，像重新写稿，不像人工局部修订",
                    "category": "direction_alignment",
                }
            )
            direction_violations.append("新增内容过多")

    for phrase in AI_REWRITE_STYLE_PHRASES:
        if phrase in combined and phrase not in source_combined:
            issues.append(
                {
                    "term": phrase,
                    "reason": "出现明显 AI 修饰腔，更像新写的说明文，不像人工弱化修改",
                    "category": "direction_alignment",
                }
            )
            direction_violations.append(f"出现 AI 套话 {phrase}")

    for phrase in ["安全有效", "安心有效", "实力不容小觑", "贴心陪伴", "方便日常坚持", "状态管理诉求", "科学管理"]:
        if phrase in combined and phrase not in source_combined:
            issues.append(
                {
                    "term": phrase,
                    "reason": "出现说明文/过审腔常见补句，更像 AI 后补，不像人工小修",
                    "category": "direction_alignment",
                }
            )
            direction_violations.append(f"说明文补句 {phrase}")

    required_points = context.required_selling_points
    covered_points = [point for point in required_points if _selling_point_matches_text(point, combined)]
    missing_points = [point for point in required_points if point not in covered_points]
    selling_pass = not required_points or bool(covered_points)
    if required_points and not covered_points:
        issues.append(
            {
                "term": required_points[0],
                "reason": "成稿未覆盖方向单主版本核心卖点",
                "category": "selling_point_alignment",
            }
        )

    summary_parts = []
    if compliance_hits:
        summary_parts.append(f"命中 {len(compliance_hits)} 个禁用表达")
    if required_points:
        summary_parts.append(f"卖点覆盖 {len(covered_points)}/{len(required_points)}")
    if direction_violations:
        summary_parts.append(f"风格保真问题 {len(direction_violations)} 项")

    direction_pass = not direction_violations

    return {
        "pass": not compliance_hits and selling_pass and direction_pass,
        "confidence": 0.9 if not compliance_hits and selling_pass and direction_pass else 0.78,
        "issues": issues,
        "summary": "；".join(summary_parts) if summary_parts else "通过本地方向与卖点校验",
        "direction_alignment": {
            "passed": direction_pass,
            "reason": "保留了原稿结构与平台感" if direction_pass else "原稿感被削弱，更像重写稿",
            "violations": direction_violations,
        },
        "selling_point_alignment": {
            "passed": selling_pass,
            "required_points": required_points,
            "covered_points": covered_points,
            "missing_points": missing_points,
            "reason": "已覆盖至少一个核心卖点" if selling_pass else "未覆盖主版本核心卖点",
        },
    }


def _merge_verifier_outputs(
    verifier_output: dict[str, Any],
    local_check: dict[str, Any],
) -> dict[str, Any]:
    ai_issues = _dedupe_issues(verifier_output.get("issues") or [])
    local_issues = _dedupe_issues(local_check.get("issues") or [])
    merged_issues = _dedupe_issues(ai_issues + local_issues)

    ai_pass = bool(verifier_output.get("pass"))
    local_pass = bool(local_check.get("pass"))
    ai_confidence = float(verifier_output.get("confidence", 0.85) or 0.85)
    local_confidence = float(local_check.get("confidence", 0.8) or 0.8)
    merged_confidence = min(ai_confidence, local_confidence) if not (ai_pass and local_pass) else max(ai_confidence, local_confidence)

    ai_direction = verifier_output.get("direction_alignment") or {}
    local_direction = local_check.get("direction_alignment") or {}
    direction_alignment = {
        **ai_direction,
        **local_direction,
        "passed": bool(ai_direction.get("passed", True)) and bool(local_direction.get("passed", True)),
        "violations": _dedupe_strings(
            [str(item).strip() for item in (ai_direction.get("violations") or []) + (local_direction.get("violations") or []) if str(item).strip()]
        ),
        "reason": "；".join(
            _dedupe_strings(
                [
                    str(ai_direction.get("reason") or "").strip(),
                    str(local_direction.get("reason") or "").strip(),
                ]
            )
        ),
    }

    ai_selling = verifier_output.get("selling_point_alignment") or {}
    local_selling = local_check.get("selling_point_alignment") or {}
    direction_alignment = {key: value for key, value in direction_alignment.items() if value not in ("", [], {}, None)}
    selling_point_alignment = {
        **ai_selling,
        **local_selling,
        "passed": bool(ai_selling.get("passed", True)) and bool(local_selling.get("passed", True)),
        "required_points": _dedupe_strings(
            [str(item).strip() for item in (ai_selling.get("required_points") or []) + (local_selling.get("required_points") or []) if str(item).strip()]
        ),
        "covered_points": _dedupe_strings(
            [str(item).strip() for item in (ai_selling.get("covered_points") or []) + (local_selling.get("covered_points") or []) if str(item).strip()]
        ),
        "missing_points": _dedupe_strings(
            [str(item).strip() for item in (ai_selling.get("missing_points") or []) + (local_selling.get("missing_points") or []) if str(item).strip()]
        ),
        "reason": "；".join(
            _dedupe_strings(
                [
                    str(ai_selling.get("reason") or "").strip(),
                    str(local_selling.get("reason") or "").strip(),
                ]
            )
        ),
    }
    selling_point_alignment = {
        key: value
        for key, value in selling_point_alignment.items()
        if value not in ("", [], {}, None)
    }

    needs_safe_rewrite = bool(
        merged_issues and all(_infer_issue_category(issue) in COMPLIANCE_ISSUE_CATEGORIES for issue in merged_issues)
    )

    summary_parts = _dedupe_strings(
        [
            str(verifier_output.get("summary") or "").strip(),
            str(local_check.get("summary") or "").strip(),
        ]
    )

    return {
        **verifier_output,
        "pass": ai_pass and local_pass,
        "confidence": merged_confidence,
        "issues": merged_issues,
        "summary": "；".join(summary_parts),
        "needs_safe_rewrite": needs_safe_rewrite,
        "direction_alignment": direction_alignment,
        "selling_point_alignment": selling_point_alignment,
        "local_checks": local_check,
    }


def _should_use_safe_rewrite(issues: list[Any]) -> bool:
    if not issues:
        return False
    return all(_infer_issue_category(_normalize_issue(issue)) in COMPLIANCE_ISSUE_CATEGORIES for issue in issues)


def _build_editor_prompt(
    *,
    source_note: dict[str, Any],
    current_draft: dict[str, Any],
    round_num: int,
    issues: list[dict[str, Any]],
    context: XHSRewriteContext,
    max_hashtags: int,
    decision_hint: Optional[str] = None,
) -> str:
    issue_text = json.dumps(issues or [], ensure_ascii=False)
    context_text = _context_to_prompt_text(context)
    guardrails = _build_editor_guardrails(context)
    guardrail_text = "\n".join(f"- {item}" for item in guardrails) if guardrails else "- 无额外补充"
    reference_text = json.dumps(
        {
            **_build_segment_payload(
                str(source_note.get("title") or ""),
                str(source_note.get("body") or ""),
                _sanitize_hashtags(source_note.get("hashtags") or [], max_hashtags),
            ),
            "style_clues": source_note.get("style_clues") or [],
        },
        ensure_ascii=False,
        indent=2,
    )
    current_text = json.dumps(
        _build_segment_payload(
            str(current_draft.get("title") or ""),
            str(current_draft.get("body") or ""),
            _sanitize_hashtags(current_draft.get("hashtags") or [], max_hashtags),
        ),
        ensure_ascii=False,
        indent=2,
    )
    decision_text = f"\n人工决策优先级：\n- {decision_hint}\n" if decision_hint else ""
    return f"""你是小红书笔记审稿编辑，不是另起炉灶的重写作者。请基于 current_draft 做最小必要修改，让成稿既合规，又像原稿作者本人改过一遍。输出 JSON：
{{
  "title": "标题",
  "body": "正文纯文本",
  "hashtags": ["标签1", "标签2"],
  "strategy": "polish|refactor|rewrite"
}}

改稿原则：
- 第一优先级是修复 issues 和 direction_context 中的硬性要求
- 如果 project/shared_requirements、main_variant 卖点、brief_required_points 与 direction_guardrails / 禁用词冲突，以 direction 硬约束为准；冲突项不要硬塞进成稿
- 如果给了人工决策优先级，严格按该优先级取舍，其他目标只能退居第二
- 第二优先级是保留 reference_note 的标题钩子、段落顺序、口语、情绪、平台感
- 能删则删，能替换半句就不要重写整段；能补一小句就不要整篇洗稿
- 如果原稿已经像小红书笔记，就沿着原稿的结构和语气改，不要改成品牌说明文、百科稿、客服口吻
- 参考人工审稿习惯：常见动作是删掉一小截夸张表述、替换一两个风险短语、补一条必要标签，而不是整段改成新稿
- 如果原稿已有可用句子，尽量保留 60% 以上原句/短语，让人一眼能看出是基于原稿做的局部修订
- 除非 issues 明确要求，不要无故新增品牌背景、论文认证、技术原理等大段信息；原稿已有则优先原句微调
- 对“效果太满、结果承诺、过激口号”这类问题，优先做“弱化改写”而不是“整段删空”
- 弱化改写的常用做法：删掉最猛的后半句；把“直接见效/轻松突破/不再担心/轻松搞定”改成“更适合作为日常管理参考/更方便日常坚持/更适合这类需求人群/表达更克制”
- 目标是让读者看得出原句还在，只是被压弱到能过审，而不是被改写成另一篇文案
- 不要生成空泛套话，例如“关键一环”“实力在线”“需要来点科学管理”“日常状态管理”等没有原稿感的句子
- 如果原稿里有 emoji、👉、总结句、提醒句、hashtags，优先保留
- main_variant 是主角；secondary_variants 只能点到为止，不要抢重点或写串版本
- 单篇笔记只需自然讲清 1-2 个最相关核心卖点，不要为了凑点把正文写成说明书
- hashtags 最多 {max_hashtags} 个，优先沿用原稿已有标签，只有缺少必带标签时才补
- 不要输出 markdown 标题、分隔线、表格
- strategy 默认优先 "polish"，只有原结构明显不合格时才用 "refactor"，非必要不要用 "rewrite"

本方向额外硬约束：
{guardrail_text}

逐段修稿规则：
- 必须按 current_draft 的段落顺序修，不要换角度，不要重排成另一套结构
- 每一段优先做 keep / trim / replace_phrase 这三种动作
- 能删掉风险后半句，就不要重写整段
- 非必要不要新增段落；确需新增时，最多只允许补 1 个短段，且要明显服务于合规
- 对带 👉 的段落，优先保留段首格式
- 对“总结一句”这类收尾句，优先保留句式，只压弱里面最猛的表达
- 禁止为了过审而写成品牌说明文、百科摘要、客服口吻
- 禁止新增这类重写腔：关键一环、实力在线、表现出色、日常管理参考、更适合这类需求人群、作为系列补充也是不错的选择

微调示例：
- 原句：单粒含有300亿AKK菌，为你扫清代谢盲区，整体障碍都能轻松突破。
- 推荐改法：单粒含有300亿AKK菌。后半句直接删掉或压短，不要改写成“日常管理参考”。
- 原句：150亿AKK原研菌株与B420、益生元强强联手，精准出击管不住嘴的贪吃党。
- 推荐改法：150亿AKK原研菌株与B420、益生元搭配。小基数或微调需求可以看看这款。
- 原句：总结一句：懒人管理也能轻松搞定！
- 推荐改法：总结一句：认清基数，对号入座就行。

如果 round > 1：
- 继续在 current_draft 基础上微调
- 只针对本轮 issues 下刀，不要回炉重写成另一篇
- 输出应该像真人审稿批注后的小改版，而不是新写一篇

round={round_num}
issues={issue_text}
{decision_text}

direction_context:
{context_text}

reference_note:
{reference_text}

current_draft:
{current_text}
"""


def _build_verifier_prompt(
    *,
    title: str,
    body: str,
    hashtags: list[str],
    context: XHSRewriteContext,
    source_note: dict[str, Any],
) -> str:
    context_text = _context_to_prompt_text(context)
    guardrails = _build_editor_guardrails(context)
    reference_text = json.dumps(
        {
            "title": source_note.get("title") or "",
            "body": source_note.get("body") or "",
            "hashtags": source_note.get("hashtags") or [],
            "style_clues": source_note.get("style_clues") or [],
        },
        ensure_ascii=False,
        indent=2,
    )
    return f"""你是小红书图文复核器。请只输出 JSON：
{{
  "pass": true,
  "confidence": 0.95,
  "issues": [
    {{"term": "问题点", "reason": "原因", "category": "compliance|direction_alignment|selling_point_alignment"}}
  ],
  "needs_safe_rewrite": false,
  "summary": "复核总结",
  "direction_alignment": {{
    "passed": true,
    "reason": "方向是否跑偏",
    "violations": ["若有，列问题"]
  }},
  "selling_point_alignment": {{
    "passed": true,
    "required_points": ["必须覆盖的卖点"],
    "covered_points": ["已覆盖卖点"],
    "missing_points": ["缺失卖点"],
    "reason": "卖点逻辑是否吻合"
  }}
}}

重点检查：
- 合规：绝对化表达、疗效/结果承诺、过激营销表达、禁用说法
- 方向：是否符合 direction_context 的方向定位、口吻、extra_requirements
- 卖点：是否围绕 main_variant 的核心卖点展开，是否遗漏必须覆盖的重点，是否写串版本
- 如果 project/shared_requirements、main_variant 卖点、brief_required_points 与 direction_guardrails / 禁用规则冲突，以 direction 硬约束为准；冲突项不应因未覆盖而判失败
- 仿写保真：是否尽量保留 reference_note 的结构、平台语气、分段节奏和标签风格；如果只是局部修订场景，是否被改成了泛化广告稿/说明文
- 逐段修稿：是否基本保持 reference_note 的段落顺序和段首格式，是否优先删半句/换短语，而不是整段重写
- 弱化是否合理：如果原稿里的强功效/重承诺已经被压弱成中性、克制、可过审表达，应视为合理修订，不要要求保留原来的强刺激说法
- 单篇笔记不要求塞满项目全部认证/背景/卖点；能清楚表达 1-2 个主卖点且主推逻辑没跑偏即可
- 如果发现“小红书感消失、结构被洗掉、语气变官方/公文化”，请归到 direction_alignment
- 如果 direction_context 有额外硬约束，例如“主版本先讲”“调节代谢必须独立成句”“副版本只能点到为止”，请逐条核对

direction_context:
{context_text}

direction_guardrails:
{json.dumps(guardrails, ensure_ascii=False, indent=2)}

reference_note:
{reference_text}

title:
{title}

body:
{body}

hashtags:
{" ".join(hashtags)}
"""


async def _run_editor_ai(
    tenant_id: str,
    db: AsyncSession,
    source_text: str,
    source_note: dict[str, Any],
    current_draft: dict[str, Any],
    round_num: int,
    context: XHSRewriteContext,
    max_hashtags: int,
    issues: Optional[list[dict[str, Any]]] = None,
    decision_hint: Optional[str] = None,
) -> tuple[dict[str, Any], int]:
    client = await AIServiceFactory.get_client(tenant_id, db)
    config = await AIServiceFactory.get_config(tenant_id, db)
    if not client or not config:
        return _fallback_editor_output(
            _build_copy_ready_text(
                str(current_draft.get("title") or source_note.get("title") or ""),
                str(current_draft.get("body") or source_note.get("body") or source_text),
                _sanitize_hashtags(current_draft.get("hashtags") or source_note.get("hashtags") or [], max_hashtags),
            ),
            round_num,
            issues,
            fallback_title=str(current_draft.get("title") or source_note.get("title") or ""),
        ), 0

    models = config.models or {}
    model = models.get("xhs_editor") or models.get("text")
    if not model:
        return _fallback_editor_output(
            _build_copy_ready_text(
                str(current_draft.get("title") or source_note.get("title") or ""),
                str(current_draft.get("body") or source_note.get("body") or source_text),
                _sanitize_hashtags(current_draft.get("hashtags") or source_note.get("hashtags") or [], max_hashtags),
            ),
            round_num,
            issues,
            fallback_title=str(current_draft.get("title") or source_note.get("title") or ""),
        ), 0

    prompt = _build_editor_prompt(
        source_note=source_note,
        current_draft=current_draft,
        round_num=round_num,
        issues=issues or [],
        context=context,
        max_hashtags=max_hashtags,
        decision_hint=decision_hint,
    )
    last_exc: Optional[Exception] = None
    for attempt in range(1, XHS_AI_MAX_ATTEMPTS + 1):
        try:
            response = await client.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                model=model,
                temperature=min(config.temperature, 0.25),
                max_tokens=max(config.max_tokens, 1600),
            )
            return _robust_json_parse(response.content), int(response.usage.get("total_tokens", 0))
        except Exception as exc:
            last_exc = exc
            if attempt >= XHS_AI_MAX_ATTEMPTS:
                break
            if not _is_retryable_xhs_ai_exception(exc):
                break
            logger.warning("XHS editor AI failed, retrying attempt %s/%s: %s", attempt, XHS_AI_MAX_ATTEMPTS, exc)
            await asyncio.sleep(min(0.8 * attempt, 2.0))

    logger.warning("XHS editor AI unavailable, fallback to current draft: %s", last_exc)
    return _fallback_editor_output(
        _build_copy_ready_text(
            str(current_draft.get("title") or source_note.get("title") or ""),
            str(current_draft.get("body") or source_note.get("body") or source_text),
            _sanitize_hashtags(current_draft.get("hashtags") or source_note.get("hashtags") or [], max_hashtags),
        ),
        round_num,
        issues,
        fallback_title=str(current_draft.get("title") or source_note.get("title") or ""),
    ), 0


async def _run_verifier_ai(
    tenant_id: str,
    db: AsyncSession,
    title: str,
    body: str,
    hashtags: list[str],
    context: XHSRewriteContext,
    source_note: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    client = await AIServiceFactory.get_client(tenant_id, db)
    config = await AIServiceFactory.get_config(tenant_id, db)
    if not client or not config:
        return _local_verify_text(title, body), 0

    models = config.models or {}
    model = models.get("xhs_verifier") or models.get("text")
    if not model:
        return _local_verify_text(title, body), 0

    prompt = _build_verifier_prompt(title=title, body=body, hashtags=hashtags, context=context, source_note=source_note)
    last_exc: Optional[Exception] = None
    for attempt in range(1, XHS_AI_MAX_ATTEMPTS + 1):
        try:
            response = await client.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                model=model,
                temperature=0.1,
                max_tokens=max(config.max_tokens, 1200),
            )
            return _robust_json_parse(response.content), int(response.usage.get("total_tokens", 0))
        except Exception as exc:
            last_exc = exc
            if attempt >= XHS_AI_MAX_ATTEMPTS:
                break
            if not _is_retryable_xhs_ai_exception(exc):
                break
            logger.warning("XHS verifier AI failed, retrying attempt %s/%s: %s", attempt, XHS_AI_MAX_ATTEMPTS, exc)
            await asyncio.sleep(min(0.8 * attempt, 2.0))

    logger.warning("XHS verifier AI unavailable, fallback to local verify: %s", last_exc)
    return _local_verify_text(title, body), 0


async def process_xhs_batch_item(
    tenant_id: str,
    db: AsyncSession,
    job: XHSBatchJob,
    item: XHSBatchItem,
    max_rounds: int = 3,
) -> dict[str, Any]:
    total_tokens = 0
    selected_decision_option = _selected_manual_decision_option(item)
    selected_decision_option_id = selected_decision_option["id"] if selected_decision_option else None
    decision_hint = str(selected_decision_option.get("prompt_hint") or "").strip() if selected_decision_option else None
    max_hashtags = int((job.tag_policy_json or {}).get("max_count", 10))
    context = await _load_xhs_rewrite_context(tenant_id=tenant_id, db=db, job=job)
    source_note = _build_xhs_source_snapshot(item.source_text, fallback_title=item.source_title_guess or f"笔记 {item.item_id}")
    current_draft = {
        "title": source_note.get("title") or item.source_title_guess or f"笔记 {item.item_id}",
        "body": source_note.get("body") or _sanitize_body(item.source_text),
        "hashtags": _sanitize_hashtags(source_note.get("hashtags") or [], max_hashtags),
    }

    last_editor: dict[str, Any] = {}
    last_verifier: dict[str, Any] = {}
    issues: list[dict[str, Any]] = [
        {
            "term": "保留原稿结构语气",
            "reason": "当前是仿写/修稿场景，请优先在原稿上做局部删改，保留标题钩子、段落、口语、emoji 和标签，不要整篇重写",
            "category": "direction_alignment",
        },
        {
            "term": "弱化风险表达",
            "reason": "对效果太满、结果承诺、过激口号，优先把最猛半句压弱成中性可过审表达，保留原句骨架，不要删成说明文",
            "category": "direction_alignment",
        },
    ]

    for round_num in range(1, max_rounds + 1):
        editor_output, editor_tokens = await _run_editor_ai(
            tenant_id=tenant_id,
            db=db,
            source_text=item.source_text,
            source_note=source_note,
            current_draft=current_draft,
            round_num=round_num,
            context=context,
            max_hashtags=max_hashtags,
            issues=issues,
            decision_hint=decision_hint,
        )
        total_tokens += editor_tokens

        title = _sanitize_title(
            str(editor_output.get("title") or current_draft.get("title") or item.source_title_guess or f"笔记 {item.item_id}")
        )
        body = _sanitize_body(str(editor_output.get("body") or current_draft.get("body") or item.source_text))
        hashtags = _sanitize_hashtags(
            editor_output.get("hashtags")
            or current_draft.get("hashtags")
            or source_note.get("hashtags")
            or [],
            max_hashtags,
        )
        title, body, hashtags = _postprocess_xhs_editor_output(
            title=title,
            body=body,
            hashtags=hashtags,
            context=context,
            source_note=source_note,
            max_hashtags=max_hashtags,
        )

        verifier_output, verifier_tokens = await _run_verifier_ai(
            tenant_id=tenant_id,
            db=db,
            title=title,
            body=body,
            hashtags=hashtags,
            context=context,
            source_note=source_note,
        )
        total_tokens += verifier_tokens
        merged_verifier = _merge_verifier_outputs(
            verifier_output,
            _build_local_alignment_check(title=title, body=body, context=context, source_note=source_note, hashtags=hashtags),
        )

        last_editor = {
            **editor_output,
            "title": title,
            "body": body,
            "hashtags": hashtags,
        }
        current_draft = {
            "title": title,
            "body": body,
            "hashtags": hashtags,
        }
        last_verifier = merged_verifier
        issues = merged_verifier.get("issues") or []

        if merged_verifier.get("pass"):
            return {
                "round": round_num,
                "editor_output": last_editor,
                "verifier": last_verifier,
                "verifier_pass": True,
                "verifier_confidence": Decimal(str(merged_verifier.get("confidence", 1))).quantize(Decimal("0.0001")),
                "rewrite_fail_reasons": [],
                "safe_rewrite_used": False,
                "safe_rewrite_reason": None,
                "final_title": title,
                "final_body": body,
                "final_hashtags": hashtags,
                "copy_ready_text": _build_copy_ready_text(title, body, hashtags),
                "quality_score": Decimal("88.00"),
                "decision_required": False,
                "decision_summary": None,
                "decision_options": [],
                "recommended_decision_option_id": None,
                "selected_decision_option_id": selected_decision_option_id,
                "item_status": "completed",
                "model_meta": {
                    "pipeline": "xhs_ai_pipeline_v2",
                    "tokens": total_tokens,
                    "decision_summary": None,
                    "decision_options": None,
                    "recommended_decision_option_id": None,
                    "selected_decision_option_id": selected_decision_option_id,
                    "manual_decision_applied": bool(selected_decision_option_id),
                },
                "actual_tokens": total_tokens,
            }

        if selected_decision_option:
            decision_eval = _evaluate_manual_decision_choice(merged_verifier, selected_decision_option)
            if decision_eval["pass"]:
                adjusted_verifier = _apply_manual_decision_to_verifier(
                    merged_verifier,
                    selected_decision_option,
                    decision_eval["warning_issues"],
                )
                return {
                    "round": round_num,
                    "editor_output": last_editor,
                    "verifier": adjusted_verifier,
                    "verifier_pass": True,
                    "verifier_confidence": Decimal(str(adjusted_verifier.get("confidence", 0.88) or 0.88)).quantize(Decimal("0.0001")),
                    "rewrite_fail_reasons": [],
                    "safe_rewrite_used": False,
                    "safe_rewrite_reason": None,
                    "final_title": title,
                    "final_body": body,
                    "final_hashtags": hashtags,
                    "copy_ready_text": _build_copy_ready_text(title, body, hashtags),
                    "quality_score": Decimal("86.00"),
                    "decision_required": False,
                    "decision_summary": None,
                    "decision_options": [],
                    "recommended_decision_option_id": None,
                    "selected_decision_option_id": selected_decision_option_id,
                    "item_status": "completed",
                    "model_meta": {
                        "pipeline": "xhs_ai_pipeline_v2",
                        "tokens": total_tokens,
                        "decision_summary": None,
                        "decision_options": None,
                        "recommended_decision_option_id": None,
                        "selected_decision_option_id": selected_decision_option_id,
                        "manual_decision_applied": True,
                    },
                    "actual_tokens": total_tokens,
                }

    if _needs_manual_decision(issues):
        decision_payload = _build_manual_decision_payload(issues, selected_decision_option_id)
        decision_summary = str(decision_payload["decision_summary"] or "")
        if selected_decision_option:
            decision_summary = f"已按“{selected_decision_option['title']}”再改过一轮，但仍有取舍冲突。{decision_summary}"
        return {
            "round": max_rounds,
            "editor_output": last_editor or _fallback_editor_output(item.source_text, max_rounds, issues),
            "verifier": last_verifier,
            "verifier_pass": False,
            "verifier_confidence": Decimal(str(last_verifier.get("confidence", 0.7) or 0.7)).quantize(Decimal("0.0001")),
            "rewrite_fail_reasons": [
                issue.get("reason", str(issue))
                for issue in _dedupe_issues(issues)
            ] or ["规则存在取舍冲突，请先选择优先级"],
            "safe_rewrite_used": False,
            "safe_rewrite_reason": None,
            "final_title": str(last_editor.get("title") or item.source_title_guess or f"笔记 {item.item_id}"),
            "final_body": str(last_editor.get("body") or item.source_text),
            "final_hashtags": _sanitize_hashtags(last_editor.get("hashtags") or [], max_hashtags),
            "copy_ready_text": _build_copy_ready_text(
                str(last_editor.get("title") or item.source_title_guess or f"笔记 {item.item_id}"),
                str(last_editor.get("body") or item.source_text),
                _sanitize_hashtags(last_editor.get("hashtags") or [], max_hashtags),
            ),
            "quality_score": Decimal("68.00"),
            "decision_required": True,
            "decision_summary": decision_summary,
            "decision_options": decision_payload["decision_options"],
            "recommended_decision_option_id": decision_payload["recommended_decision_option_id"],
            "selected_decision_option_id": selected_decision_option_id,
            "item_status": "needs_decision",
            "model_meta": {
                "pipeline": "xhs_ai_pipeline_v2",
                "tokens": total_tokens,
                "alignment_failed": True,
                "decision_summary": decision_summary,
                "decision_options": decision_payload["decision_options"],
                "recommended_decision_option_id": decision_payload["recommended_decision_option_id"],
                "selected_decision_option_id": selected_decision_option_id,
                "manual_decision_applied": False,
            },
            "actual_tokens": total_tokens,
        }

    if not _should_use_safe_rewrite(issues):
        return {
            "round": max_rounds,
            "editor_output": last_editor or _fallback_editor_output(item.source_text, max_rounds, issues),
            "verifier": last_verifier,
            "verifier_pass": False,
            "verifier_confidence": Decimal(str(last_verifier.get("confidence", 0.7) or 0.7)).quantize(Decimal("0.0001")),
            "rewrite_fail_reasons": [
                issue.get("reason", str(issue))
                for issue in _dedupe_issues(issues)
            ] or ["alignment_not_satisfied"],
            "safe_rewrite_used": False,
            "safe_rewrite_reason": "alignment_not_satisfied",
            "final_title": str(last_editor.get("title") or item.source_title_guess or f"笔记 {item.item_id}"),
            "final_body": str(last_editor.get("body") or item.source_text),
            "final_hashtags": _sanitize_hashtags(last_editor.get("hashtags") or [], max_hashtags),
            "copy_ready_text": _build_copy_ready_text(
                str(last_editor.get("title") or item.source_title_guess or f"笔记 {item.item_id}"),
                str(last_editor.get("body") or item.source_text),
                _sanitize_hashtags(last_editor.get("hashtags") or [], max_hashtags),
            ),
            "quality_score": Decimal("68.00"),
            "decision_required": False,
            "decision_summary": None,
            "decision_options": [],
            "recommended_decision_option_id": None,
            "selected_decision_option_id": selected_decision_option_id,
            "item_status": "failed",
            "model_meta": {
                "pipeline": "xhs_ai_pipeline_v2",
                "tokens": total_tokens,
                "alignment_failed": True,
                "decision_summary": None,
                "decision_options": None,
                "recommended_decision_option_id": None,
                "selected_decision_option_id": selected_decision_option_id,
                "manual_decision_applied": bool(selected_decision_option_id),
            },
            "actual_tokens": total_tokens,
        }

    safe_title = _sanitize_title(_safe_rewrite(str(last_editor.get("title") or item.source_title_guess or "")))
    safe_body = _sanitize_body(_safe_rewrite(str(last_editor.get("body") or item.source_text)))
    safe_hashtags = _sanitize_hashtags(last_editor.get("hashtags") or [], max_hashtags)
    safe_verifier = _merge_verifier_outputs(
        _local_verify_text(safe_title, safe_body),
        _build_local_alignment_check(title=safe_title, body=safe_body, context=context, source_note=source_note, hashtags=safe_hashtags),
    )

    return {
        "round": max_rounds,
        "editor_output": last_editor or _fallback_editor_output(item.source_text, max_rounds, issues),
        "verifier": safe_verifier,
        "verifier_pass": bool(safe_verifier.get("pass")),
        "verifier_confidence": Decimal(str(safe_verifier.get("confidence", 0.8))).quantize(Decimal("0.0001")),
        "rewrite_fail_reasons": [issue.get("reason", str(issue)) for issue in issues] if issues else ["verifier_not_passed"],
        "safe_rewrite_used": True,
        "safe_rewrite_reason": "max_rounds_exceeded",
        "final_title": safe_title or (item.source_title_guess or f"笔记 {item.item_id}"),
        "final_body": safe_body or item.source_text,
        "final_hashtags": safe_hashtags,
        "copy_ready_text": _build_copy_ready_text(safe_title, safe_body or item.source_text, safe_hashtags),
        "quality_score": Decimal("72.00"),
        "decision_required": False,
        "decision_summary": None,
        "decision_options": [],
        "recommended_decision_option_id": None,
        "selected_decision_option_id": selected_decision_option_id,
        "item_status": "completed" if bool(safe_verifier.get("pass")) else "failed",
        "model_meta": {
            "pipeline": "xhs_ai_pipeline_v2",
            "tokens": total_tokens,
            "safe_rewrite": True,
            "decision_summary": None,
            "decision_options": None,
            "recommended_decision_option_id": None,
            "selected_decision_option_id": selected_decision_option_id,
            "manual_decision_applied": bool(selected_decision_option_id),
        },
        "actual_tokens": total_tokens,
    }
