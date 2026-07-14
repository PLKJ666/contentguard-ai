"""
XHS 批量图文配置与任务 API。

当前阶段提供：
- 配置资产 CRUD / publish
- BriefPack parse
- 保存前基础冲突校验
- 批量任务创建 / 查询

不在这里提前实现 P2/P3 的 AI 编排与异步执行。
"""
import ast
from collections import Counter
import asyncio
from decimal import Decimal
import json
import logging
from pathlib import PurePosixPath
import re
from typing import Optional, TypeVar
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
import httpx
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.organization import Agency
from app.models.operator import Operator
from app.models.user import User, UserRole
from app.models.xhs import (
    XHSBatchItem,
    XHSBatchJob,
    XHSBrandPack,
    XHSBriefPack,
    XHSDirectionItem,
    XHSExportLog,
    XHSProject,
    XHSProjectVariant,
    XHSRulePack,
    XHSRiskPack,
)
from app.services.document_parser import DocumentParser
from app.services.ai_service import AIServiceFactory
from app.services.xhs_export_service import build_feishu_export_result
from app.services.xhs_batch_service import _build_manual_decision_payload, split_xhs_source_text
from app.schemas.xhs_batch import (
    BrandPackPayload,
    BriefPackPayload,
    RiskPackPayload,
    RulePackPayload,
    XHSBatchCreateRequest,
    XHSBatchDecisionSubmitRequest,
    XHSBatchEstimateResponse,
    XHSBatchItemResponse,
    XHSBatchItemListResponse,
    XHSBatchJobResponse,
    XHSBatchRunMode,
    XHSBatchStatus,
    XHSExportLogResponse,
    XHSExportStatus,
    XHSBrandPackCreateRequest,
    XHSBrandPackResponse,
    XHSBrandPackUpdateRequest,
    XHSRulePackCreateRequest,
    XHSRulePackResponse,
    XHSRulePackUpdateRequest,
    XHSBriefPackParseRequest,
    XHSBriefPackParseResponse,
    XHSBriefPackCreateRequest,
    XHSBriefPackResponse,
    XHSBriefPackUpdateRequest,
    XHSConfigConflict,
    XHSConfigValidationResponse,
    XHSFeishuExportRequest,
    XHSFeishuExportResponse,
    XHSFeishuExportStatusResponse,
    XHSInputType,
    XHSExportType,
    XHSPackStatus,
    XHSRiskPackCreateRequest,
    XHSRiskPackResponse,
    XHSRiskPackUpdateRequest,
)
from app.schemas.xhs_project import (
    XHSDirectionCreateRequest,
    XHSDirectionResponse,
    XHSDirectionStatus,
    XHSDirectionUpdateRequest,
    XHSProjectBriefParseRequest,
    XHSProjectBriefParseResponse,
    XHSProjectBriefParseResult,
    XHSProjectCreateRequest,
    XHSProjectResponse,
    XHSProjectStatus,
    XHSProjectUpdateRequest,
    XHSVariantBriefParseRequest,
    XHSVariantBriefParseResponse,
    XHSVariantBriefParseResult,
    XHSProjectVariantCreateRequest,
    XHSProjectVariantResponse,
    XHSProjectVariantUpdateRequest,
)
from app.services.auth import generate_id
from app.services.oss import get_file_url

router = APIRouter(prefix="/xhs", tags=["xhs"])

PackModelT = TypeVar("PackModelT", XHSRulePack, XHSBrandPack, XHSBriefPack, XHSRiskPack)
SUPPORTED_PARSE_EXTENSIONS = {"pdf", "doc", "docx", "xls", "xlsx", "txt"}
logger = logging.getLogger(__name__)
XHS_BRIEF_PARSE_MAX_ATTEMPTS = 4


async def get_current_xhs_user_id(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> str:
    if current_user.role == UserRole.AGENCY:
        result = await db.execute(select(Agency).where(Agency.user_id == current_user.id))
        agency = result.scalar_one_or_none()
        if not agency or not agency.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="代理商账号不存在或已停用")
        return agency.user_id

    if current_user.role == UserRole.OPERATOR:
        result = await db.execute(select(Operator).where(Operator.user_id == current_user.id))
        operator = result.scalar_one_or_none()
        if not operator or not operator.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="代运营账号不存在或已停用")
        return operator.user_id

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅代理商或代运营可访问小红书改写")


def _build_pack_query(model: type[PackModelT], tenant_id: str, category_id: Optional[str], status_value: Optional[XHSPackStatus]) -> Select[tuple[PackModelT]]:
    query = select(model).where(model.tenant_id == tenant_id).order_by(model.updated_at.desc())  # type: ignore[attr-defined]
    if category_id:
        query = query.where(model.category_id == category_id)  # type: ignore[attr-defined]
    if status_value:
        query = query.where(model.status == status_value.value)  # type: ignore[attr-defined]
    return query


def _build_validation(conflicts: list[XHSConfigConflict]) -> XHSConfigValidationResponse:
    return XHSConfigValidationResponse(
        valid=not any(conflict.severity == "error" for conflict in conflicts),
        conflicts=conflicts,
    )


def _normalize_phrase(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _validate_brand_pack_payload(payload: BrandPackPayload) -> XHSConfigValidationResponse:
    conflicts: list[XHSConfigConflict] = []
    fact_graph = payload.fact_graph or {"nodes": [], "relations": []}
    nodes = fact_graph.get("nodes", []) or []
    relations = fact_graph.get("relations", []) or []

    node_ids = [str(node.get("id", "")).strip() for node in nodes if node.get("id")]
    duplicated_ids = [node_id for node_id, count in Counter(node_ids).items() if count > 1]
    for node_id in duplicated_ids:
        conflicts.append(XHSConfigConflict(field="fact_graph.nodes", message=f"FactNode id 重复: {node_id}"))

    node_id_set = set(node_ids)
    for index, relation in enumerate(relations):
        source_id = str(relation.get("source_id", "")).strip()
        target_id = str(relation.get("target_id", "")).strip()
        if source_id and source_id not in node_id_set:
            conflicts.append(
                XHSConfigConflict(
                    field=f"fact_graph.relations[{index}].source_id",
                    message=f"relation 引用了不存在的 source_id: {source_id}",
                )
            )
        if target_id and target_id not in node_id_set:
            conflicts.append(
                XHSConfigConflict(
                    field=f"fact_graph.relations[{index}].target_id",
                    message=f"relation 引用了不存在的 target_id: {target_id}",
                )
            )

    return _build_validation(conflicts)


def _validate_rule_pack_payload(payload: RulePackPayload) -> XHSConfigValidationResponse:
    conflicts: list[XHSConfigConflict] = []

    normalized_banned = [_normalize_phrase(term) for term in payload.banned_terms if term.strip()]
    duplicate_banned = [term for term, count in Counter(normalized_banned).items() if term and count > 1]
    for term in duplicate_banned:
        conflicts.append(
            XHSConfigConflict(
                field="banned_terms",
                message=f"重复的禁用表达: {term}",
                severity="warning",
            )
        )

    risk_pattern_ids = [str(item.get("id", "")).strip() for item in payload.risk_patterns if item.get("id")]
    duplicate_pattern_ids = [item_id for item_id, count in Counter(risk_pattern_ids).items() if item_id and count > 1]
    for item_id in duplicate_pattern_ids:
        conflicts.append(
            XHSConfigConflict(
                field="risk_patterns",
                message=f"重复的 risk_pattern id: {item_id}",
            )
        )

    for index, pattern in enumerate(payload.risk_patterns):
        pattern_text = str(pattern.get("pattern") or "").strip()
        severity = str(pattern.get("severity") or "").strip().lower()
        if not pattern_text:
            conflicts.append(
                XHSConfigConflict(
                    field=f"risk_patterns[{index}].pattern",
                    message="risk_pattern 缺少 pattern",
                )
            )
            continue
        try:
            re.compile(pattern_text)
        except re.error as exc:
            conflicts.append(
                XHSConfigConflict(
                    field=f"risk_patterns[{index}].pattern",
                    message=f"risk_pattern 正则非法: {exc}",
                )
            )
        if severity and severity not in {"low", "medium", "high"}:
            conflicts.append(
                XHSConfigConflict(
                    field=f"risk_patterns[{index}].severity",
                    message=f"未知 severity: {severity}",
                    severity="warning",
                )
            )

    for source, target in payload.replace_map.items():
        if _normalize_phrase(source) == _normalize_phrase(target):
            conflicts.append(
                XHSConfigConflict(
                    field="replace_map",
                    message=f"替换前后相同: {source}",
                    severity="warning",
                )
            )

    hashtag_rules = payload.format_rules.get("hashtag") if isinstance(payload.format_rules, dict) else None
    if isinstance(hashtag_rules, dict):
        max_count = hashtag_rules.get("max_count")
        if max_count is not None:
            try:
                parsed_count = int(max_count)
            except (TypeError, ValueError):
                parsed_count = 0
            if parsed_count <= 0:
                conflicts.append(
                    XHSConfigConflict(
                        field="format_rules.hashtag.max_count",
                        message="hashtag.max_count 必须大于 0",
                    )
                )

    preferred_sections = payload.structure_rules.get("preferred_sections") if isinstance(payload.structure_rules, dict) else None
    if isinstance(preferred_sections, list):
        normalized_sections = [_normalize_phrase(str(section)) for section in preferred_sections if str(section).strip()]
        duplicates = [section for section, count in Counter(normalized_sections).items() if section and count > 1]
        for section in duplicates:
            conflicts.append(
                XHSConfigConflict(
                    field="structure_rules.preferred_sections",
                    message=f"重复的 section: {section}",
                    severity="warning",
                )
            )

    return _build_validation(conflicts)


def _validate_brief_pack_payload(payload: BriefPackPayload) -> XHSConfigValidationResponse:
    conflicts: list[XHSConfigConflict] = []

    recommended = {_normalize_phrase(item) for item in payload.recommended_phrasings if item.strip()}
    forbidden = {_normalize_phrase(item) for item in payload.forbidden_phrasings if item.strip()}
    overlap = sorted(item for item in recommended & forbidden if item)
    for phrase in overlap:
        conflicts.append(
            XHSConfigConflict(
                field="phrasing",
                message=f"推荐表达与禁用表达冲突: {phrase}",
            )
        )

    selling_priorities = [str(item.get("priority", "")).strip() for item in payload.selling_point_priority if item.get("priority")]
    duplicate_priority = [priority for priority, count in Counter(selling_priorities).items() if priority and count > 1]
    for priority in duplicate_priority:
        conflicts.append(
            XHSConfigConflict(
                field="selling_point_priority",
                message=f"卖点优先级标识重复: {priority}",
                severity="warning",
            )
        )

    return _build_validation(conflicts)


def _validate_risk_pack_payload(payload: RiskPackPayload) -> XHSConfigValidationResponse:
    conflicts: list[XHSConfigConflict] = []

    clues = [str(item.get("text") or item.get("clue") or "").strip() for item in payload.risk_clues]
    duplicates = [clue for clue, count in Counter(clues).items() if clue and count > 1]
    for clue in duplicates:
        conflicts.append(
            XHSConfigConflict(
                field="risk_clues",
                message=f"重复的风险线索: {clue}",
                severity="warning",
            )
        )

    replace_from = [
        _normalize_phrase(str(item.get("from") or item.get("source") or ""))
        for item in payload.replace_hints
        if str(item.get("from") or item.get("source") or "").strip()
    ]
    repeated_replace = [item for item, count in Counter(replace_from).items() if item and count > 1]
    for item in repeated_replace:
        conflicts.append(
            XHSConfigConflict(
                field="replace_hints",
                message=f"重复的替换来源表达: {item}",
                severity="warning",
            )
        )

    return _build_validation(conflicts)


def _raise_if_invalid(validation: XHSConfigValidationResponse) -> None:
    if not validation.valid:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "配置校验失败",
                "conflicts": [conflict.model_dump() for conflict in validation.conflicts],
            },
        )


def _normalize_optional_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


async def _require_active_pack_version(
    *,
    model: type[PackModelT],
    tenant_id: str,
    category_id: str,
    version: Optional[str],
    field_name: str,
    pack_label: str,
    db: AsyncSession,
) -> Optional[str]:
    normalized_version = _normalize_optional_value(version)
    if not normalized_version:
        return None

    result = await db.execute(
        select(model).where(  # type: ignore[attr-defined]
            model.tenant_id == tenant_id,  # type: ignore[attr-defined]
            model.category_id == category_id,  # type: ignore[attr-defined]
            model.version == normalized_version,  # type: ignore[attr-defined]
            model.status == XHSPackStatus.ACTIVE.value,  # type: ignore[attr-defined]
        )
    )
    pack = result.scalar_one_or_none()
    if not pack:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} 指向的已发布 {pack_label} 不存在，请先发布对应版本后再创建批次",
        )
    return normalized_version


async def _require_active_brief_pack_id(
    *,
    tenant_id: str,
    category_id: str,
    brief_pack_id: Optional[str],
    db: AsyncSession,
) -> Optional[str]:
    normalized_pack_id = _normalize_optional_value(brief_pack_id)
    if not normalized_pack_id:
        return None

    result = await db.execute(
        select(XHSBriefPack).where(
            XHSBriefPack.id == normalized_pack_id,
            XHSBriefPack.tenant_id == tenant_id,
            XHSBriefPack.category_id == category_id,
            XHSBriefPack.status == XHSPackStatus.ACTIVE.value,
        )
    )
    pack = result.scalar_one_or_none()
    if not pack:
        raise HTTPException(
            status_code=400,
            detail="brief_pack_id 指向的已发布 BriefPack 不存在，请先发布对应配置后再创建批次",
        )
    return normalized_pack_id


async def _resolve_batch_pack_selections(
    *,
    request: XHSBatchCreateRequest,
    tenant_id: str,
    db: AsyncSession,
) -> dict[str, Optional[str]]:
    return {
        "rule_pack_version": await _require_active_pack_version(
            model=XHSRulePack,
            tenant_id=tenant_id,
            category_id=request.category_id,
            version=request.rule_pack_version,
            field_name="rule_pack_version",
            pack_label="RulePack",
            db=db,
        ),
        "risk_pack_version": await _require_active_pack_version(
            model=XHSRiskPack,
            tenant_id=tenant_id,
            category_id=request.category_id,
            version=request.risk_pack_version,
            field_name="risk_pack_version",
            pack_label="RiskPack",
            db=db,
        ),
        "brand_pack_version": await _require_active_pack_version(
            model=XHSBrandPack,
            tenant_id=tenant_id,
            category_id=request.category_id,
            version=request.brand_pack_version,
            field_name="brand_pack_version",
            pack_label="BrandPack",
            db=db,
        ),
        "brief_pack_id": await _require_active_brief_pack_id(
            tenant_id=tenant_id,
            category_id=request.category_id,
            brief_pack_id=request.brief_pack_id,
            db=db,
        ),
    }


def _extract_candidate_phrases(lines: list[str], limit: int = 8) -> list[str]:
    phrases: list[str] = []
    for line in lines:
        cleaned = re.sub(r"^[\-\d\.\)\s]+", "", line).strip()
        if 4 <= len(cleaned) <= 40 and cleaned not in phrases:
            phrases.append(cleaned)
        if len(phrases) >= limit:
            break
    return phrases


def _guess_remote_filename(source_ref: str) -> Optional[str]:
    cleaned = source_ref.split("?", 1)[0].rstrip("/")
    name = PurePosixPath(cleaned).name
    if not name or "." not in name:
        return None
    return unquote(name)


def _resolve_file_input_reference(file_id: str) -> tuple[str, Optional[str]]:
    source_ref = file_id.strip()
    if not source_ref:
        return source_ref, None

    file_name = _guess_remote_filename(source_ref)
    if source_ref.startswith("http://") or source_ref.startswith("https://"):
        return source_ref, file_name

    normalized_key = source_ref.lstrip("/")
    return get_file_url(normalized_key), file_name or PurePosixPath(normalized_key).name


async def _try_parse_file_input(file_id: str) -> tuple[Optional[str], dict]:
    source_ref, file_name = _resolve_file_input_reference(file_id)
    if not source_ref or not file_name:
        return None, {"source_ref": source_ref or file_id, "source_file_name": file_name}

    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if ext not in SUPPORTED_PARSE_EXTENSIONS:
        return None, {
            "source_ref": source_ref,
            "source_file_name": file_name,
            "parse_skipped_reason": "unsupported_extension",
        }

    try:
        extracted_text = (await DocumentParser.download_and_parse(source_ref, file_name)).strip()
    except Exception as exc:
        return None, {
            "source_ref": source_ref,
            "source_file_name": file_name,
            "parse_skipped_reason": str(exc),
        }

    if not extracted_text:
        return None, {
            "source_ref": source_ref,
            "source_file_name": file_name,
            "parse_skipped_reason": "empty_extracted_text",
        }

    return extracted_text, {"source_ref": source_ref, "source_file_name": file_name}


async def _try_parse_feishu_input(feishu_url: str) -> tuple[Optional[str], dict]:
    source_ref = feishu_url.strip()
    if not source_ref:
        return None, {"source_ref": feishu_url}

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            response = await client.get(source_ref)
            response.raise_for_status()
    except Exception as exc:
        return None, {"source_ref": source_ref, "parse_skipped_reason": str(exc)}

    content_type = response.headers.get("content-type", "").lower()
    if "text/html" in content_type:
        text = re.sub(r"<[^>]+>", " ", response.text)
        text = re.sub(r"\s+", " ", text).strip()
    else:
        text = response.text.strip()

    if len(text) < 40:
        return None, {"source_ref": source_ref, "parse_skipped_reason": "insufficient_feishu_text"}

    return text, {"source_ref": source_ref, "source_file_name": _guess_remote_filename(source_ref)}


async def _prepare_batch_source(
    *,
    request: XHSBatchCreateRequest,
    tenant_id: str,
    db: AsyncSession,
) -> tuple[str, list[dict], dict]:
    if request.input_type == XHSInputType.TEXT:
        input_ref = request.input_text or ""
        split_notes, split_meta = await split_xhs_source_text(
            tenant_id=tenant_id,
            db=db,
            source_text=input_ref,
        )
        return input_ref, split_notes, split_meta

    if request.input_type == XHSInputType.FILE:
        input_ref = request.file_id or ""
        extracted_text, source_meta = await _try_parse_file_input(input_ref)
        if extracted_text:
            split_notes, split_meta = await split_xhs_source_text(
                tenant_id=tenant_id,
                db=db,
                source_text=extracted_text,
            )
            return input_ref, split_notes, {**split_meta, **source_meta, "parsed_from_file": True}

        source_ref = source_meta.get("source_ref") or input_ref
        split_notes = [{"content": source_ref}]
        return input_ref, split_notes, {**source_meta, "split_strategy": "non_text_single_input", "split_model": None, "split_tokens": 0}

    input_ref = request.feishu_url or ""
    extracted_text, source_meta = await _try_parse_feishu_input(input_ref)
    if extracted_text:
        split_notes, split_meta = await split_xhs_source_text(
            tenant_id=tenant_id,
            db=db,
            source_text=extracted_text,
        )
        return input_ref, split_notes, {**split_meta, **source_meta, "parsed_from_feishu": True}

    split_notes = [{"content": input_ref}]
    return input_ref, split_notes, {**source_meta, "split_strategy": "non_text_single_input", "split_model": None, "split_tokens": 0}


def _build_brief_pack_from_text(text: str) -> BriefPackPayload:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    priority_lines = []
    forbidden_lines = []
    non_forbidden_lines = []

    for line in lines:
        lowered = line.lower()
        if any(keyword in line for keyword in ("禁用", "禁止", "不能", "避免")):
            forbidden_lines.append(line)
        elif any(keyword in lowered for keyword in ("卖点", "亮点", "优势", "核心", "适合")):
            priority_lines.append({"text": line, "priority": f"p{len(priority_lines) + 1}"})
            non_forbidden_lines.append(line)
        else:
            non_forbidden_lines.append(line)

    if not priority_lines:
        priority_lines = [
            {"text": phrase, "priority": f"p{index + 1}"}
            for index, phrase in enumerate(_extract_candidate_phrases(non_forbidden_lines[:20], limit=5))
        ]

    recommended = _extract_candidate_phrases(non_forbidden_lines[:20], limit=6)
    forbidden = _extract_candidate_phrases(forbidden_lines, limit=6)

    return BriefPackPayload(
        brand_facts={"source_summary": lines[:10]},
        sku_facts=[],
        selling_point_priority=priority_lines,
        recommended_phrasings=recommended,
        forbidden_phrasings=forbidden,
        uncertain_fields=[],
    )


def _project_brief_parse_result_from_json(payload: Optional[dict]) -> Optional[XHSProjectBriefParseResult]:
    if not payload:
        return None
    return XHSProjectBriefParseResult.model_validate(payload)


def _normalize_string_list(values: object, limit: int = 12) -> list[str]:
    if not isinstance(values, list):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = str(value or "").strip()
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
        if len(normalized) >= limit:
            break
    return normalized


def _normalize_variant_suggestions(values: object) -> list[dict]:
    if not isinstance(values, list):
        return []

    suggestions: list[dict] = []
    for item in values[:8]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        suggestions.append(
            {
                "name": name,
                "selling_points": _normalize_string_list(item.get("selling_points"), limit=6),
                "appearance_notes": _normalize_optional_value(str(item.get("appearance_notes") or "")),
                "notes": _normalize_optional_value(str(item.get("notes") or "")),
            }
        )
    return suggestions


def _normalize_direction_suggestions(values: object) -> list[dict]:
    if not isinstance(values, list):
        return []

    suggestions: list[dict] = []
    for item in values[:10]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        suggestions.append(
            {
                "name": name,
                "main_variant_name": _normalize_optional_value(str(item.get("main_variant_name") or "")),
                "secondary_variant_names": _normalize_string_list(item.get("secondary_variant_names"), limit=4),
                "content_style": _normalize_optional_value(str(item.get("content_style") or "")),
                "direction_brief": _normalize_optional_value(str(item.get("direction_brief") or "")),
                "extra_requirements": _normalize_string_list(item.get("extra_requirements"), limit=8),
            }
        )
    return suggestions


def _extract_balanced_json_segment(text: str) -> Optional[str]:
    start_index = -1
    for index, char in enumerate(text):
        if char in "{[":
            start_index = index
            break

    if start_index == -1:
        return None

    stack: list[str] = []
    in_string = False
    escaped = False

    for index in range(start_index, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
                continue
            if char == "\\":
                escaped = True
                continue
            if char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char in "{[":
            stack.append(char)
            continue
        if char in "}]":
            if not stack:
                continue
            expected = "}" if stack[-1] == "{" else "]"
            if char != expected:
                continue
            stack.pop()
            if not stack:
                return text[start_index : index + 1].strip()

    return None


def _strip_trailing_commas(text: str) -> str:
    result: list[str] = []
    in_string = False
    escaped = False
    index = 0

    while index < len(text):
        char = text[index]
        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue

        if char == '"':
            in_string = True
            result.append(char)
            index += 1
            continue

        if char == ",":
            lookahead = index + 1
            while lookahead < len(text) and text[lookahead].isspace():
                lookahead += 1
            if lookahead < len(text) and text[lookahead] in "}]":
                index += 1
                continue

        result.append(char)
        index += 1

    return "".join(result)


def _normalize_json_candidate(text: str) -> str:
    normalized = (text or "").replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n").strip()
    fence_match = re.fullmatch(r"```(?:json)?\s*(.*?)```", normalized, re.DOTALL | re.IGNORECASE)
    if fence_match:
        normalized = fence_match.group(1).strip()

    if normalized.lower().startswith("json\n"):
        normalized = normalized.split("\n", 1)[1].strip()

    return _sanitize_json_string(normalized)


def _iter_json_candidates(raw: str) -> list[str]:
    text = (raw or "").strip()
    candidates: list[str] = []

    def add(candidate: Optional[str]) -> None:
        value = (candidate or "").strip()
        if value and value not in candidates:
            candidates.append(value)

    add(text)

    for matched in re.finditer(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE):
        add(matched.group(1))

    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) > 1:
            body = "\n".join(lines[1:])
            if body.rstrip().endswith("```"):
                body = body.rstrip()[:-3]
            add(body)

    add(_extract_balanced_json_segment(text))

    first_brace = min(
        [index for index in (text.find("{"), text.find("[")) if index != -1],
        default=-1,
    )
    if first_brace != -1:
        last_brace = max(text.rfind("}"), text.rfind("]"))
        if last_brace > first_brace:
            add(text[first_brace : last_brace + 1])

    return candidates


def _extract_json_from_response(raw: str) -> str:
    last_error: Optional[Exception] = None

    for candidate in _iter_json_candidates(raw):
        normalized = _normalize_json_candidate(candidate)
        if not normalized:
            continue

        repair_candidates = [normalized]
        balanced = _extract_balanced_json_segment(normalized)
        if balanced and balanced not in repair_candidates:
            repair_candidates.append(balanced)

        trimmed_commas = _strip_trailing_commas(normalized)
        if trimmed_commas not in repair_candidates:
            repair_candidates.append(trimmed_commas)

        if balanced:
            balanced_trimmed = _strip_trailing_commas(balanced)
            if balanced_trimmed not in repair_candidates:
                repair_candidates.append(balanced_trimmed)

        for repair_candidate in repair_candidates:
            try:
                parsed = json.loads(repair_candidate)
                return json.dumps(parsed, ensure_ascii=False)
            except json.JSONDecodeError as exc:
                last_error = exc

            try:
                parsed = ast.literal_eval(repair_candidate)
            except (ValueError, SyntaxError) as exc:
                last_error = exc
                continue

            return json.dumps(parsed, ensure_ascii=False)

    raise json.JSONDecodeError("Unable to extract valid JSON from AI response", raw or "", 0) from last_error


def _sanitize_json_string(text: str) -> str:
    result: list[str] = []
    in_string = False
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and in_string and index + 1 < len(text):
            result.append(char)
            result.append(text[index + 1])
            index += 2
            continue
        if char == '"' and not in_string:
            in_string = True
            result.append(char)
        elif char == '"' and in_string:
            in_string = False
            result.append(char)
        elif in_string and char in "\u201c\u201d\u300c\u300d":
            result.append("'")
        elif not in_string and char in "\u201c\u201d":
            result.append('"')
        else:
            result.append(char)
        index += 1
    return "".join(result)


def _build_json_retry_instruction(
    *,
    task_name: str,
    prompt_instructions: str,
    json_schema: str,
    previous_response: str,
    source_text: Optional[str] = None,
) -> str:
    source_block = f"\n\n原始文档内容：\n{source_text}" if source_text else ""
    previous_block = previous_response.strip()
    if len(previous_block) > 6000:
        previous_block = previous_block[:6000] + "\n...(上次输出已截断)"

    return (
        f"{prompt_instructions}\n\n"
        f"你上一条关于“{task_name}”的回复不是合法 JSON，系统无法解析。\n"
        "现在请你重新输出一个可直接被 json.loads 解析的单个 JSON 对象。\n"
        "硬性要求：\n"
        "- 不要 markdown 代码块\n"
        "- 不要解释、标题、前后缀\n"
        "- 不要注释\n"
        "- 不要尾逗号\n"
        "- 所有 JSON 键名必须使用英文双引号\n"
        "- 字段名必须与模板完全一致，不要新增字段\n"
        "- 如果某字段没有内容，使用空字符串或空数组\n"
        "- 只返回一个 JSON 对象\n"
        f"{source_block}\n\n"
        f"你上一次的原始输出：\n{previous_block}\n\n"
        f"返回 JSON 模板：\n{json_schema}"
    )


async def _extract_xhs_brief_content(
    *,
    source_ref: Optional[str] = None,
    file_name: Optional[str] = None,
    file_url: Optional[str] = None,
    raw_text: Optional[str] = None,
    empty_detail: str = "请先上传 Brief 文件",
) -> tuple[str, list[str]]:
    normalized_raw_text = (raw_text or "").strip()
    if normalized_raw_text:
        return normalized_raw_text, []

    document_url = (file_url or source_ref or "").strip()
    document_name = (file_name or "").strip()
    if not document_url or not document_name:
        raise HTTPException(status_code=400, detail=empty_detail)

    ext = document_name.rsplit(".", 1)[-1].lower() if "." in document_name else ""
    if ext not in SUPPORTED_PARSE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="暂不支持该 Brief 文件格式，请上传 pdf/doc/docx/xls/xlsx/txt")

    try:
        if document_name.lower().endswith(".pdf"):
            images = await DocumentParser.download_and_get_images(document_url, document_name) or []
            if images:
                logger.info("XHS 项目 Brief 识别为图片型 PDF: %s, pages=%s", document_name, len(images))
                return "", images

        extracted_text = (
            await asyncio.wait_for(
                DocumentParser.download_and_parse(document_url, document_name),
                timeout=60.0,
            )
        ).strip()
        if extracted_text:
            return extracted_text, []

        if document_name.lower().endswith((".docx", ".doc", ".xlsx", ".xls")):
            images = await DocumentParser.download_and_get_images(document_url, document_name) or []
            if images:
                logger.info("XHS 项目 Brief 文本为空，改走图片理解: %s, images=%s", document_name, len(images))
                return "", images
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=400, detail="Brief 文件解析超时，请换一个更小的文件后重试") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Brief 文件解析失败: {str(exc)[:200]}") from exc

    raise HTTPException(status_code=400, detail="Brief 文件里没有提取到可解析内容，请检查文件内容")


async def _parse_xhs_project_brief_with_ai(
    *,
    source_ref: str,
    file_name: str,
    file_url: Optional[str],
    category_id: Optional[str],
    tenant_id: str,
    db: AsyncSession,
) -> tuple[str, XHSProjectBriefParseResult, dict]:
    extracted_text, images = await _extract_xhs_brief_content(
        source_ref=source_ref,
        file_name=file_name,
        file_url=file_url,
    )

    if extracted_text and len(extracted_text) > 15000:
        extracted_text = extracted_text[:15000] + "\n...(内容已截断)"

    ai_client = await AIServiceFactory.get_client(tenant_id, db)
    if not ai_client:
        raise HTTPException(
            status_code=400,
            detail="AI 服务未配置，请先到「AI 配置」里填写可用密钥后再解析 Brief",
        )

    config = await AIServiceFactory.get_config(tenant_id, db)
    text_model = "gpt-4o"
    vision_model = "gpt-4o"
    if config and config.models:
        text_model = config.models.get("text") or text_model
        vision_model = config.models.get("vision") or text_model

    project_json_schema = """{
  "product_name": "产品名或系列名",
  "project_brief": "整项目 Brief 的简要总结",
  "shared_requirements": "全项目共用要求总结，可用换行分点",
  "key_points": ["这次项目最重要的点 1", "这次项目最重要的点 2"],
  "variant_suggestions": [
    {
      "name": "金标",
      "selling_points": ["卖点 1", "卖点 2"],
      "appearance_notes": "外观或包装差异",
      "notes": "补充提醒"
    }
  ],
  "direction_suggestions": [
    {
      "name": "帕梅拉金带银非报备",
      "main_variant_name": "金标",
      "secondary_variant_names": ["银标"],
      "content_style": "非报备",
      "direction_brief": "这一方向要怎么讲",
      "extra_requirements": ["限制 1", "限制 2"]
    }
  ]
}"""

    category_hint = f"品类：{category_id}\n" if category_id else ""
    prompt_instructions = f"""你是熟悉小红书种草项目拆解的资深策略运营。
现在要读取一整份项目 Brief，帮代理商先整理出：
1. 这个整项目到底在讲什么
2. 所有方向都共用的硬性要求
3. Brief 里最值得后续拆方向单时反复参考的重点
4. 如果文档里明确提到了不同产品版本/不同宣传方向，也顺手整理出来

{category_hint}请严格输出 JSON，不要输出解释，不要补充 markdown。

输出要求：
- project_brief：2 到 4 句，概括整项目背景、目标和统一口径
- shared_requirements：只写全项目共用要求，不要把单个方向的限制混进去
- key_points：提炼 4 到 10 条最关键的点，短句即可
- variant_suggestions：只有文档里明显存在多个版本/规格/颜色/金标银标时才填写
- direction_suggestions：只有文档里明确写出某些宣传方向、表格行、话术方向时才填写
- 若某项文档中没有，不要编造，返回空字符串或空数组
- JSON 字符串值中不要使用中文引号"""

    use_vision = bool(images) and not extracted_text.strip()
    last_error: Optional[Exception] = None
    last_raw_response = ""

    for attempt in range(XHS_BRIEF_PARSE_MAX_ATTEMPTS):
        try:
            if use_vision:
                prompt_text = (
                    f"{prompt_instructions}\n\n返回 JSON 模板：\n{project_json_schema}"
                    if attempt == 0 or not last_raw_response
                    else _build_json_retry_instruction(
                        task_name="XHS 项目 Brief 解析",
                        prompt_instructions=prompt_instructions,
                        json_schema=project_json_schema,
                        previous_response=last_raw_response,
                    )
                )
                content: list[dict] = [{"type": "text", "text": prompt_text}]
                for image in images:
                    content.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image}"},
                        }
                    )
                response = await ai_client.chat_completion(
                    messages=[{"role": "user", "content": content}],
                    model=vision_model,
                    temperature=0.2 if attempt == 0 else 0.0,
                    max_tokens=4000,
                )
            else:
                prompt_text = (
                    f"{prompt_instructions}\n\nBrief 文档内容：\n{extracted_text}\n\n返回 JSON 模板：\n{project_json_schema}"
                    if attempt == 0 or not last_raw_response
                    else _build_json_retry_instruction(
                        task_name="XHS 项目 Brief 解析",
                        prompt_instructions=prompt_instructions,
                        json_schema=project_json_schema,
                        previous_response=last_raw_response,
                        source_text=extracted_text,
                    )
                )
                response = await ai_client.chat_completion(
                    messages=[
                        {
                            "role": "user",
                            "content": prompt_text,
                        }
                    ],
                    model=text_model,
                    temperature=0.2 if attempt == 0 else 0.0,
                    max_tokens=4000,
                )

            last_raw_response = response.content
            content = _extract_json_from_response(response.content)
            parsed = json.loads(content)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            if not isinstance(parsed, dict):
                raise json.JSONDecodeError("AI 返回不是对象", content, 0)

            result = XHSProjectBriefParseResult(
                product_name=str(parsed.get("product_name") or "").strip(),
                project_brief=str(parsed.get("project_brief") or "").strip(),
                shared_requirements=str(parsed.get("shared_requirements") or "").strip(),
                key_points=_normalize_string_list(parsed.get("key_points"), limit=10),
                variant_suggestions=_normalize_variant_suggestions(parsed.get("variant_suggestions")),
                direction_suggestions=_normalize_direction_suggestions(parsed.get("direction_suggestions")),
            )
            return extracted_text, result, parsed
        except json.JSONDecodeError as exc:
            last_error = exc
            logger.warning("XHS 项目 Brief AI 返回非 JSON, attempt=%s, raw=%s", attempt, response.content[:300])
            continue
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("XHS 项目 Brief AI 解析失败")
            raise HTTPException(status_code=500, detail=f"AI 解析失败: {str(exc)[:200]}") from exc

    logger.error(
        "XHS 项目 Brief AI 返回 JSON 连续 %s 次失败: %s",
        XHS_BRIEF_PARSE_MAX_ATTEMPTS,
        last_error,
    )
    raise HTTPException(status_code=500, detail="AI 解析结果格式错误，请重试")


async def _parse_xhs_variant_brief_with_ai(
    *,
    source_ref: Optional[str],
    file_name: Optional[str],
    file_url: Optional[str],
    raw_text: Optional[str],
    category_id: Optional[str],
    tenant_id: str,
    db: AsyncSession,
) -> tuple[str, XHSVariantBriefParseResult, dict]:
    extracted_text, images = await _extract_xhs_brief_content(
        source_ref=source_ref,
        file_name=file_name,
        file_url=file_url,
        raw_text=raw_text,
        empty_detail="请上传版本 Brief 文件，或直接粘贴版本说明",
    )

    if extracted_text and len(extracted_text) > 12000:
        extracted_text = extracted_text[:12000] + "\n...(内容已截断)"

    ai_client = await AIServiceFactory.get_client(tenant_id, db)
    if not ai_client:
        raise HTTPException(
            status_code=400,
            detail="AI 服务未配置，请先到「AI 配置」里填写可用密钥后再解析 Brief",
        )

    config = await AIServiceFactory.get_config(tenant_id, db)
    text_model = "gpt-4o"
    vision_model = "gpt-4o"
    if config and config.models:
        text_model = config.models.get("text") or text_model
        vision_model = config.models.get("vision") or text_model

    variant_json_schema = """{
  "name": "版本名，例如金标/银标/经典款",
  "selling_points": ["卖点 1", "卖点 2"],
  "appearance_notes": "包装、颜色、规格、外观差异",
  "notes": "使用场景、限制话术、必须补充的提醒"
}"""

    category_hint = f"品类：{category_id}\n" if category_id else ""
    prompt_instructions = f"""你是熟悉小红书种草项目拆解的资深策略运营。
现在要读取一份“单个产品版本”的 Brief、卖点说明或表格片段，帮代理商整理出这个版本最关键的信息。

{category_hint}请严格输出 JSON，不要输出解释，不要补充 markdown。

输出要求：
- name：只写当前这个版本最常用的叫法，尽量短，例如金标、银标、升级版；如果文档没写清楚就根据内容概括一个最短可用名称
- selling_points：提炼 2 到 6 条主打卖点，短句即可，不要写成长段落
- appearance_notes：只写这个版本在包装、颜色、规格、外观上的差异，没有就留空
- notes：写其他代理商后续拆方向时最需要记住的提醒，例如适用场景、限制说法、必须补充的一句话，没有就留空
- 若文档中没有，不要编造，返回空字符串或空数组
- JSON 字符串值中不要使用中文引号"""

    use_vision = bool(images) and not extracted_text.strip()
    last_error: Optional[Exception] = None
    last_raw_response = ""

    for attempt in range(XHS_BRIEF_PARSE_MAX_ATTEMPTS):
        try:
            if use_vision:
                prompt_text = (
                    f"{prompt_instructions}\n\n返回 JSON 模板：\n{variant_json_schema}"
                    if attempt == 0 or not last_raw_response
                    else _build_json_retry_instruction(
                        task_name="XHS 产品版本 Brief 解析",
                        prompt_instructions=prompt_instructions,
                        json_schema=variant_json_schema,
                        previous_response=last_raw_response,
                    )
                )
                content: list[dict] = [{"type": "text", "text": prompt_text}]
                for image in images:
                    content.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image}"},
                        }
                    )
                response = await ai_client.chat_completion(
                    messages=[{"role": "user", "content": content}],
                    model=vision_model,
                    temperature=0.2 if attempt == 0 else 0.0,
                    max_tokens=2000,
                )
            else:
                prompt_text = (
                    f"{prompt_instructions}\n\nBrief 文档内容：\n{extracted_text}\n\n返回 JSON 模板：\n{variant_json_schema}"
                    if attempt == 0 or not last_raw_response
                    else _build_json_retry_instruction(
                        task_name="XHS 产品版本 Brief 解析",
                        prompt_instructions=prompt_instructions,
                        json_schema=variant_json_schema,
                        previous_response=last_raw_response,
                        source_text=extracted_text,
                    )
                )
                response = await ai_client.chat_completion(
                    messages=[
                        {
                            "role": "user",
                            "content": prompt_text,
                        }
                    ],
                    model=text_model,
                    temperature=0.2 if attempt == 0 else 0.0,
                    max_tokens=2000,
                )

            last_raw_response = response.content
            content = _extract_json_from_response(response.content)
            parsed = json.loads(content)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            if not isinstance(parsed, dict):
                raise json.JSONDecodeError("AI 返回不是对象", content, 0)

            result = XHSVariantBriefParseResult(
                name=str(parsed.get("name") or "").strip(),
                selling_points=_normalize_string_list(parsed.get("selling_points"), limit=6),
                appearance_notes=_normalize_optional_value(str(parsed.get("appearance_notes") or "")),
                notes=_normalize_optional_value(str(parsed.get("notes") or "")),
            )
            return extracted_text, result, parsed
        except json.JSONDecodeError as exc:
            last_error = exc
            logger.warning("XHS 产品版本 Brief AI 返回非 JSON, attempt=%s, raw=%s", attempt, response.content[:300])
            continue
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("XHS 产品版本 Brief AI 解析失败")
            raise HTTPException(status_code=500, detail=f"AI 解析失败: {str(exc)[:200]}") from exc

    logger.error(
        "XHS 产品版本 Brief AI 返回 JSON 连续 %s 次失败: %s",
        XHS_BRIEF_PARSE_MAX_ATTEMPTS,
        last_error,
    )
    raise HTTPException(status_code=500, detail="AI 解析结果格式错误，请重试")


async def _dispatch_xhs_batch_job(batch_id: str) -> None:
    await _dispatch_xhs_batch_job_items(batch_id=batch_id, item_ids=None)


async def _dispatch_xhs_batch_job_items(batch_id: str, item_ids: Optional[list[str]]) -> None:
    if settings.USE_CELERY:
        from app.tasks.xhs_batch import process_xhs_batch_job_task

        process_xhs_batch_job_task.delay(batch_id, item_ids)
        return

    from app.tasks.xhs_batch import process_xhs_batch_job_async

    asyncio.create_task(process_xhs_batch_job_async(batch_id, item_ids=item_ids))


def _planned_item_count_for_run(run_mode: str, trial_sample_count: Optional[int], total_items: int) -> int:
    if run_mode == "trial":
        return min(total_items, trial_sample_count or min(3, total_items))
    return total_items


def _estimate_batch_usage(
    *,
    run_mode: str,
    trial_sample_count: Optional[int],
    split_notes: list[dict],
    split_strategy: str,
) -> XHSBatchEstimateResponse:
    estimated_items = _planned_item_count_for_run(run_mode, trial_sample_count, len(split_notes))
    total_chars = sum(len(str(note.get("content") or "")) for note in split_notes)
    avg_chars = int(total_chars / len(split_notes)) if split_notes else 0
    estimated_tokens_per_item = max(800, min(5000, int(avg_chars * 2.5) + 600))
    estimated_tokens = estimated_items * estimated_tokens_per_item
    estimated_cost = (Decimal(estimated_tokens) * Decimal("0.00002")).quantize(Decimal("0.0001"))
    return XHSBatchEstimateResponse(
        estimated_items=estimated_items,
        total_split_items=len(split_notes),
        estimated_tokens=estimated_tokens,
        estimated_cost=estimated_cost,
        split_strategy=split_strategy,
    )


def _build_all_md_content(items: list[XHSBatchItem]) -> str:
    lines = ["# 小红书批量终稿", ""]
    exportable_items = [item for item in items if _is_exportable_batch_item(item)]

    for index, item in enumerate(exportable_items, start=1):
        scene_title = (item.source_title_guess or item.final_title or f"笔记 {index}").strip()
        note_title = (item.final_title or item.source_title_guess or f"笔记 {index}").strip()
        body = (item.final_body or "").strip()
        hashtags = " ".join(item.final_hashtags_json or [])

        lines.append(f"## {index:04d}｜{scene_title}")
        lines.append(f"标题：{note_title}")
        lines.append("")
        if body:
            lines.append(body)
            lines.append("")
        if hashtags:
            lines.append(hashtags)
            lines.append("")
        lines.append("---")
        lines.append("")

    if exportable_items:
        lines = lines[:-2]
    return "\n".join(lines).strip() + "\n"


def _feishu_status_response(log: Optional[XHSExportLog], job: XHSBatchJob) -> XHSFeishuExportStatusResponse:
    if not log:
        return XHSFeishuExportStatusResponse(status=XHSExportStatus.PENDING, docs=[], error=None)

    response_json = log.response_json or {}
    docs = response_json.get("docs") or []
    return XHSFeishuExportStatusResponse(
        status=log.status,
        docs=docs,
        error=log.error or job.export_feishu_error,
    )


async def _get_pack_or_404(model: type[PackModelT], pack_id: str, tenant_id: str, db: AsyncSession) -> PackModelT:
    result = await db.execute(
        select(model).where(model.id == pack_id, model.tenant_id == tenant_id)  # type: ignore[attr-defined]
    )
    pack = result.scalar_one_or_none()
    if not pack:
        raise HTTPException(status_code=404, detail="配置不存在")
    return pack


def _brand_pack_response(pack: XHSBrandPack) -> XHSBrandPackResponse:
    return XHSBrandPackResponse(
        id=pack.id,
        tenant_id=pack.tenant_id,
        category_id=pack.category_id,
        version=pack.version,
        status=pack.status,
        created_by=pack.created_by,
        created_at=pack.created_at,
        updated_at=pack.updated_at,
        brand_name=pack.brand_name,
        is_default=pack.is_default,
        pack=BrandPackPayload.model_validate(pack.pack_json),
    )


def _rule_pack_response(pack: XHSRulePack) -> XHSRulePackResponse:
    return XHSRulePackResponse(
        id=pack.id,
        tenant_id=pack.tenant_id,
        category_id=pack.category_id,
        version=pack.version,
        status=pack.status,
        created_by=pack.created_by,
        created_at=pack.created_at,
        updated_at=pack.updated_at,
        name=pack.name,
        pack=RulePackPayload.model_validate(pack.pack_json),
    )


def _brief_pack_response(pack: XHSBriefPack) -> XHSBriefPackResponse:
    return XHSBriefPackResponse(
        id=pack.id,
        tenant_id=pack.tenant_id,
        category_id=pack.category_id,
        version=pack.version,
        status=pack.status,
        created_by=pack.created_by,
        created_at=pack.created_at,
        updated_at=pack.updated_at,
        brand_name=pack.brand_name,
        source_type=pack.source_type,
        source_ref=pack.source_ref,
        pack=BriefPackPayload.model_validate(pack.pack_json),
    )


def _risk_pack_response(pack: XHSRiskPack) -> XHSRiskPackResponse:
    return XHSRiskPackResponse(
        id=pack.id,
        tenant_id=pack.tenant_id,
        category_id=pack.category_id,
        version=pack.version,
        status=pack.status,
        created_by=pack.created_by,
        created_at=pack.created_at,
        updated_at=pack.updated_at,
        name=pack.name,
        pack=RiskPackPayload.model_validate(pack.pack_json),
    )


def _build_project_query(
    tenant_id: str,
    category_id: Optional[str],
    status_value: Optional[XHSProjectStatus],
) -> Select[tuple[XHSProject]]:
    query = (
        select(XHSProject)
        .options(
            selectinload(XHSProject.variants),
            selectinload(XHSProject.directions).selectinload(XHSDirectionItem.batches),
            selectinload(XHSProject.directions).selectinload(XHSDirectionItem.main_variant),
        )
        .where(XHSProject.tenant_id == tenant_id)
        .order_by(XHSProject.updated_at.desc())
    )
    if category_id:
        query = query.where(XHSProject.category_id == category_id)
    if status_value:
        query = query.where(XHSProject.status == status_value.value)
    return query


async def _get_project_or_404(project_id: str, tenant_id: str, db: AsyncSession) -> XHSProject:
    result = await db.execute(_build_project_query(tenant_id, None, None).where(XHSProject.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


async def _get_project_variant_or_404(variant_id: str, tenant_id: str, db: AsyncSession) -> XHSProjectVariant:
    result = await db.execute(
        select(XHSProjectVariant)
        .options(selectinload(XHSProjectVariant.project))
        .where(XHSProjectVariant.id == variant_id, XHSProjectVariant.tenant_id == tenant_id)
    )
    variant = result.scalar_one_or_none()
    if not variant:
        raise HTTPException(status_code=404, detail="产品版本不存在")
    return variant


async def _get_direction_or_404(direction_id: str, tenant_id: str, db: AsyncSession) -> XHSDirectionItem:
    result = await db.execute(
        select(XHSDirectionItem)
        .options(
            selectinload(XHSDirectionItem.project),
            selectinload(XHSDirectionItem.main_variant),
            selectinload(XHSDirectionItem.batches),
        )
        .where(XHSDirectionItem.id == direction_id, XHSDirectionItem.tenant_id == tenant_id)
    )
    direction = result.scalar_one_or_none()
    if not direction:
        raise HTTPException(status_code=404, detail="方向单不存在")
    return direction


def _project_response(project: XHSProject) -> XHSProjectResponse:
    directions = list(project.directions or [])
    batch_count = sum(len(direction.batches or []) for direction in directions)
    return XHSProjectResponse(
        id=project.id,
        tenant_id=project.tenant_id,
        name=project.name,
        category_id=project.category_id,
        client_name=project.client_name,
        product_name=project.product_name,
        brief_file_ref=project.brief_file_ref,
        brief_file_name=project.brief_file_name,
        brief_parse_result=_project_brief_parse_result_from_json(project.brief_parse_result_json),
        project_brief=project.project_brief,
        shared_requirements=project.shared_requirements,
        remark=project.remark,
        status=project.status,
        created_by=project.created_by,
        variant_count=len(project.variants or []),
        direction_count=len(directions),
        batch_count=batch_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _project_variant_response(variant: XHSProjectVariant) -> XHSProjectVariantResponse:
    return XHSProjectVariantResponse(
        id=variant.id,
        tenant_id=variant.tenant_id,
        project_id=variant.project_id,
        name=variant.name,
        selling_points=variant.selling_points,
        appearance_notes=variant.appearance_notes,
        notes=variant.notes,
        is_primary=variant.is_primary,
        sort_order=variant.sort_order,
        created_by=variant.created_by,
        created_at=variant.created_at,
        updated_at=variant.updated_at,
    )


def _direction_response(direction: XHSDirectionItem) -> XHSDirectionResponse:
    batches = sorted(list(direction.batches or []), key=lambda batch: batch.created_at, reverse=True)
    latest_batch = batches[0] if batches else None
    return XHSDirectionResponse(
        id=direction.id,
        tenant_id=direction.tenant_id,
        project_id=direction.project_id,
        project_name=direction.project.name if direction.project else None,
        name=direction.name,
        status=direction.status,
        main_variant_id=direction.main_variant_id,
        main_variant_name=direction.main_variant.name if direction.main_variant else None,
        secondary_variant_ids=list(direction.secondary_variant_ids_json or []),
        content_style=direction.content_style,
        direction_brief=direction.direction_brief,
        extra_requirements=direction.extra_requirements,
        notes=direction.notes,
        sort_order=direction.sort_order,
        created_by=direction.created_by,
        batch_count=len(batches),
        latest_batch_id=latest_batch.id if latest_batch else None,
        latest_batch_status=latest_batch.status if latest_batch else None,
        created_at=direction.created_at,
        updated_at=direction.updated_at,
    )


def _normalize_id_list(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = str(value or "").strip()
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def _apply_project_request(project: XHSProject, request: XHSProjectCreateRequest | XHSProjectUpdateRequest) -> None:
    updates = request.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if field == "status" and isinstance(value, XHSProjectStatus):
            project.status = value.value
            continue
        if field == "brief_parse_result":
            project.brief_parse_result_json = value if isinstance(value, dict) else (value.model_dump() if value else None)
            continue
        setattr(project, field, value)


async def _validate_variant_ids_for_project(
    *,
    project_id: str,
    tenant_id: str,
    variant_ids: list[str],
    field_label: str,
    db: AsyncSession,
) -> list[str]:
    normalized_ids = _normalize_id_list(variant_ids)
    if not normalized_ids:
        return []

    result = await db.execute(
        select(XHSProjectVariant.id).where(
            XHSProjectVariant.project_id == project_id,
            XHSProjectVariant.tenant_id == tenant_id,
            XHSProjectVariant.id.in_(normalized_ids),
        )
    )
    existing_ids = set(result.scalars().all())
    missing_ids = [variant_id for variant_id in normalized_ids if variant_id not in existing_ids]
    if missing_ids:
        raise HTTPException(status_code=400, detail=f"{field_label} 不存在或不属于当前项目: {', '.join(missing_ids)}")
    return normalized_ids


async def _maybe_set_primary_variant(
    *,
    project_id: str,
    tenant_id: str,
    variant_id: str,
    is_primary: bool,
    db: AsyncSession,
) -> None:
    if not is_primary:
        return

    result = await db.execute(
        select(XHSProjectVariant).where(
            XHSProjectVariant.project_id == project_id,
            XHSProjectVariant.tenant_id == tenant_id,
        )
    )
    for variant in result.scalars().all():
        variant.is_primary = variant.id == variant_id


def _build_batch_query(tenant_id: str) -> Select[tuple[XHSBatchJob]]:
    return (
        select(XHSBatchJob)
        .options(selectinload(XHSBatchJob.direction).selectinload(XHSDirectionItem.project))
        .where(XHSBatchJob.tenant_id == tenant_id)
    )


async def _get_batch_job_or_404(batch_id: str, tenant_id: str, db: AsyncSession) -> XHSBatchJob:
    result = await db.execute(_build_batch_query(tenant_id).where(XHSBatchJob.id == batch_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="批量任务不存在")
    return job


def _batch_job_response(job: XHSBatchJob) -> XHSBatchJobResponse:
    return _batch_job_response_with_counts(job, failed_items=0, decision_items=0, safe_rewrite_items=0)


def _batch_job_response_with_counts(
    job: XHSBatchJob,
    *,
    failed_items: int,
    decision_items: int,
    safe_rewrite_items: int,
) -> XHSBatchJobResponse:
    input_stats_json = job.input_stats_json or {}
    direction = job.direction
    project = direction.project if direction else None
    return XHSBatchJobResponse(
        id=job.id,
        status=job.status,
        category_id=job.category_id,
        direction_id=job.direction_id,
        direction_name=direction.name if direction else None,
        project_id=project.id if project else None,
        project_name=project.name if project else None,
        rule_pack_version=job.rule_pack_version,
        risk_pack_version=job.risk_pack_version,
        brand_pack_version=job.brand_pack_version,
        brief_pack_id=job.brief_pack_id,
        run_mode=job.run_mode,
        trial_sample_count=job.trial_sample_count,
        input_type=job.input_type,
        estimated_tokens=job.estimated_tokens,
        estimated_cost=job.estimated_cost,
        actual_tokens=job.actual_tokens,
        actual_cost=job.actual_cost,
        system_blocked=job.system_blocked,
        system_block_reason=job.system_block_reason,
        total_items=job.total_items,
        done_items=job.done_items,
        running_items=job.running_items,
        failed_items=failed_items,
        decision_items=decision_items,
        safe_rewrite_items=safe_rewrite_items,
        input_stats={
            "raw_chars": int(input_stats_json.get("raw_chars", 0) or 0),
            "split_count": int(input_stats_json.get("split_count", job.total_items or 0) or 0),
            "planned_items": input_stats_json.get("planned_items"),
            "split_strategy": input_stats_json.get("split_strategy"),
            "split_model": input_stats_json.get("split_model"),
            "split_tokens": input_stats_json.get("split_tokens"),
            "rule_split_count": input_stats_json.get("rule_split_count"),
            "ai_split_count": input_stats_json.get("ai_split_count"),
            "source_ref": input_stats_json.get("source_ref"),
            "source_file_name": input_stats_json.get("source_file_name"),
            "parsed_from_file": input_stats_json.get("parsed_from_file"),
            "parsed_from_feishu": input_stats_json.get("parsed_from_feishu"),
            "parse_skipped_reason": input_stats_json.get("parse_skipped_reason"),
        },
        export={
            "all_md_status": job.export_all_md_status,
            "all_md_url": job.export_all_md_url,
            "feishu_status": job.export_feishu_status,
            "feishu_doc_title": job.export_feishu_doc_title,
            "feishu_error": job.export_feishu_error,
        },
        export_all_md_status=job.export_all_md_status,
        export_all_md_url=job.export_all_md_url,
        export_feishu_status=job.export_feishu_status,
        export_feishu_doc_title=job.export_feishu_doc_title,
        export_feishu_error=job.export_feishu_error,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _batch_display_status(status: str, decision_items: int) -> str:
    if decision_items > 0 and status in {
        XHSBatchStatus.PARTIALLY_DONE.value,
        XHSBatchStatus.DONE.value,
        XHSBatchStatus.COMPLETED.value,
    }:
        return XHSBatchStatus.AWAITING_DECISION.value
    return status


def _batch_matches_status(job: XHSBatchJobResponse, status_value: XHSBatchStatus) -> bool:
    display_status = _batch_display_status(job.status, job.decision_items)
    if status_value in {XHSBatchStatus.AWAITING_DECISION, XHSBatchStatus.NEEDS_DECISION}:
        return display_status in {
            XHSBatchStatus.AWAITING_DECISION.value,
            XHSBatchStatus.NEEDS_DECISION.value,
        }
    return display_status == status_value.value


def _batch_job_detail_response(job: XHSBatchJob, items: list[XHSBatchItem]) -> XHSBatchJobResponse:
    base = _batch_job_response(job)
    failed_items = sum(1 for item in items if item.status == XHSBatchStatus.FAILED.value and not _item_requires_manual_decision(item))
    decision_items = sum(1 for item in items if _item_requires_manual_decision(item))
    safe_rewrite_items = sum(1 for item in items if item.safe_rewrite_used)
    input_stats = base.input_stats.model_copy(
        update={
            "split_count": len(items),
            "ai_split_count": sum(1 for item in items if item.split_by == "ai_assisted"),
        }
    )
    export = base.export.model_copy(
        update={
            "all_md_status": job.export_all_md_status,
            "all_md_url": job.export_all_md_url,
            "feishu_status": job.export_feishu_status,
            "feishu_doc_title": job.export_feishu_doc_title,
            "feishu_error": job.export_feishu_error,
        }
    )
    return base.model_copy(
        update={
            "failed_items": failed_items,
            "decision_items": decision_items,
            "safe_rewrite_items": safe_rewrite_items,
            "input_stats": input_stats,
            "export": export,
        }
    )


def _item_decision_meta(item: XHSBatchItem) -> dict:
    meta = dict(item.model_meta_json or {})
    if not meta.get("decision_options") and item.status == XHSBatchStatus.FAILED.value and item.safe_rewrite_reason == "alignment_not_satisfied":
        meta = {
            **meta,
            **_build_manual_decision_payload(
                item.rewrite_fail_reasons_json or [],
                meta.get("selected_decision_option_id"),
            ),
        }
    return {
        "decision_required": bool(meta.get("decision_options")) and item.status in {XHSBatchStatus.NEEDS_DECISION.value, XHSBatchStatus.FAILED.value},
        "decision_summary": meta.get("decision_summary"),
        "decision_options": meta.get("decision_options") or [],
        "recommended_decision_option_id": meta.get("recommended_decision_option_id"),
        "selected_decision_option_id": meta.get("selected_decision_option_id"),
    }


def _item_requires_manual_decision(item: XHSBatchItem) -> bool:
    return bool(_item_decision_meta(item)["decision_required"])


def _batch_item_response(item: XHSBatchItem) -> XHSBatchItemResponse:
    item_index = None
    try:
        item_index = int(str(item.item_id).split("_")[-1])
    except (TypeError, ValueError):
        item_index = None
    decision_meta = _item_decision_meta(item)
    return XHSBatchItemResponse(
        id=item.id,
        batch_id=item.batch_id,
        item_id=item.item_id,
        index=item_index,
        status=item.status,
        round=item.round,
        title=item.final_title or item.source_title_guess,
        source_text=item.source_text,
        source_title_guess=item.source_title_guess,
        final_title=item.final_title,
        final_body=item.final_body,
        final_hashtags=item.final_hashtags_json or [],
        copy_ready_text=item.copy_ready_text,
        quality_score=item.quality_score,
        verifier_pass=item.verifier_pass,
        verifier_confidence=item.verifier_confidence,
        verifier=item.verifier_json or {},
        rewrite_fail_reasons=item.rewrite_fail_reasons_json or [],
        decision_required=bool(decision_meta["decision_required"]),
        decision_summary=decision_meta["decision_summary"],
        decision_options=decision_meta["decision_options"],
        recommended_decision_option_id=decision_meta["recommended_decision_option_id"],
        selected_decision_option_id=decision_meta["selected_decision_option_id"],
        safe_rewrite_used=item.safe_rewrite_used,
        safe_rewrite_reason=item.safe_rewrite_reason,
        duration_ms=item.duration_ms,
    )


def _export_log_response(log: XHSExportLog) -> XHSExportLogResponse:
    return XHSExportLogResponse(
        id=log.id,
        batch_id=log.batch_id,
        type=log.type,
        status=log.status,
        error=log.error,
        created_at=log.created_at,
    )


def _prepare_batch_item_for_rerun(
    item: XHSBatchItem,
    *,
    meta_updates: Optional[dict[str, object]] = None,
    clear_selected_decision: bool = False,
) -> None:
    item.status = XHSBatchStatus.PENDING.value
    item.round = 0
    item.editor_output_json = None
    item.verifier_json = None
    item.verifier_pass = None
    item.verifier_confidence = None
    item.rewrite_fail_reasons_json = None
    item.safe_rewrite_used = False
    item.safe_rewrite_reason = None
    item.final_title = None
    item.final_body = None
    item.final_hashtags_json = None
    item.copy_ready_text = None
    item.quality_score = None
    item.duration_ms = None
    item.started_at = None
    item.finished_at = None

    meta = dict(item.model_meta_json or {})
    for key in (
        "decision_summary",
        "decision_options",
        "recommended_decision_option_id",
        "manual_decision_applied",
    ):
        meta.pop(key, None)
    if clear_selected_decision:
        meta.pop("selected_decision_option_id", None)
    if meta_updates:
        for key, value in meta_updates.items():
            if value is None:
                meta.pop(key, None)
            else:
                meta[key] = value
    item.model_meta_json = meta


def _is_exportable_batch_item(item: XHSBatchItem) -> bool:
    return bool(item.copy_ready_text) and item.verifier_pass is True and item.status == XHSBatchStatus.COMPLETED.value


@router.get("/projects", response_model=list[XHSProjectResponse])
async def list_xhs_projects(
    category_id: Optional[str] = Query(None),
    status_value: Optional[XHSProjectStatus] = Query(None, alias="status"),
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(_build_project_query(x_tenant_id, category_id, status_value))
    return [_project_response(project) for project in result.scalars().all()]


@router.post("/projects/brief/parse", response_model=XHSProjectBriefParseResponse)
async def parse_xhs_project_brief(
    request: XHSProjectBriefParseRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    extracted_text, brief_parse_result, raw_result = await _parse_xhs_project_brief_with_ai(
        source_ref=request.source_ref,
        file_name=request.file_name,
        file_url=request.file_url,
        category_id=request.category_id,
        tenant_id=x_tenant_id,
        db=db,
    )
    return XHSProjectBriefParseResponse(
        source_ref=request.source_ref,
        file_name=request.file_name,
        extracted_text=extracted_text,
        brief_parse_result=brief_parse_result,
        raw_result=raw_result,
    )


@router.post("/variants/brief/parse", response_model=XHSVariantBriefParseResponse)
async def parse_xhs_variant_brief(
    request: XHSVariantBriefParseRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    extracted_text, brief_parse_result, raw_result = await _parse_xhs_variant_brief_with_ai(
        source_ref=request.source_ref,
        file_name=request.file_name,
        file_url=request.file_url,
        raw_text=request.raw_text,
        category_id=request.category_id,
        tenant_id=x_tenant_id,
        db=db,
    )
    return XHSVariantBriefParseResponse(
        source_ref=request.source_ref,
        file_name=request.file_name,
        extracted_text=extracted_text,
        brief_parse_result=brief_parse_result,
        raw_result=raw_result,
    )


@router.post("/projects", response_model=XHSProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_xhs_project(
    request: XHSProjectCreateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    project = XHSProject(
        id=generate_id("XHP"),
        tenant_id=x_tenant_id,
        created_by=current_actor_user_id,
    )
    _apply_project_request(project, request)
    db.add(project)
    await db.commit()
    project = await _get_project_or_404(project.id, x_tenant_id, db)
    return _project_response(project)


@router.get("/projects/{project_id}", response_model=XHSProjectResponse)
async def get_xhs_project(
    project_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_project_or_404(project_id, x_tenant_id, db)
    return _project_response(project)


@router.put("/projects/{project_id}", response_model=XHSProjectResponse)
async def update_xhs_project(
    project_id: str,
    request: XHSProjectUpdateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_project_or_404(project_id, x_tenant_id, db)
    _apply_project_request(project, request)
    await db.commit()
    project = await _get_project_or_404(project_id, x_tenant_id, db)
    return _project_response(project)


@router.get("/projects/{project_id}/variants", response_model=list[XHSProjectVariantResponse])
async def list_xhs_project_variants(
    project_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_project_or_404(project_id, x_tenant_id, db)
    variants = sorted(list(project.variants or []), key=lambda item: (item.sort_order, item.created_at))
    return [_project_variant_response(variant) for variant in variants]


@router.post("/projects/{project_id}/variants", response_model=XHSProjectVariantResponse, status_code=status.HTTP_201_CREATED)
async def create_xhs_project_variant(
    project_id: str,
    request: XHSProjectVariantCreateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    await _get_project_or_404(project_id, x_tenant_id, db)
    variant = XHSProjectVariant(
        id=generate_id("XHV"),
        tenant_id=x_tenant_id,
        project_id=project_id,
        name=request.name,
        selling_points=request.selling_points,
        appearance_notes=request.appearance_notes,
        notes=request.notes,
        is_primary=request.is_primary,
        sort_order=request.sort_order,
        created_by=current_actor_user_id,
    )
    db.add(variant)
    await db.flush()
    await _maybe_set_primary_variant(
        project_id=project_id,
        tenant_id=x_tenant_id,
        variant_id=variant.id,
        is_primary=request.is_primary,
        db=db,
    )
    await db.commit()
    variant = await _get_project_variant_or_404(variant.id, x_tenant_id, db)
    return _project_variant_response(variant)


@router.put("/variants/{variant_id}", response_model=XHSProjectVariantResponse)
async def update_xhs_project_variant(
    variant_id: str,
    request: XHSProjectVariantUpdateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    variant = await _get_project_variant_or_404(variant_id, x_tenant_id, db)
    updates = request.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(variant, field, value)
    await _maybe_set_primary_variant(
        project_id=variant.project_id,
        tenant_id=x_tenant_id,
        variant_id=variant.id,
        is_primary=variant.is_primary,
        db=db,
    )
    await db.commit()
    variant = await _get_project_variant_or_404(variant_id, x_tenant_id, db)
    return _project_variant_response(variant)


@router.get("/projects/{project_id}/directions", response_model=list[XHSDirectionResponse])
async def list_xhs_directions(
    project_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_project_or_404(project_id, x_tenant_id, db)
    directions = sorted(list(project.directions or []), key=lambda item: (item.sort_order, item.created_at))
    return [_direction_response(direction) for direction in directions]


@router.post("/projects/{project_id}/directions", response_model=XHSDirectionResponse, status_code=status.HTTP_201_CREATED)
async def create_xhs_direction(
    project_id: str,
    request: XHSDirectionCreateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    await _get_project_or_404(project_id, x_tenant_id, db)

    main_variant_id: Optional[str] = None
    if request.main_variant_id:
        validated_main_variant_ids = await _validate_variant_ids_for_project(
            project_id=project_id,
            tenant_id=x_tenant_id,
            variant_ids=[request.main_variant_id],
            field_label="主推产品版本",
            db=db,
        )
        main_variant_id = validated_main_variant_ids[0]

    secondary_variant_ids = await _validate_variant_ids_for_project(
        project_id=project_id,
        tenant_id=x_tenant_id,
        variant_ids=request.secondary_variant_ids,
        field_label="搭带产品版本",
        db=db,
    )
    secondary_variant_ids = [variant_id for variant_id in secondary_variant_ids if variant_id != main_variant_id]

    direction = XHSDirectionItem(
        id=generate_id("XHD"),
        tenant_id=x_tenant_id,
        project_id=project_id,
        name=request.name,
        status=request.status.value,
        main_variant_id=main_variant_id,
        secondary_variant_ids_json=secondary_variant_ids,
        content_style=request.content_style,
        direction_brief=request.direction_brief,
        extra_requirements=request.extra_requirements,
        notes=request.notes,
        sort_order=request.sort_order,
        created_by=current_actor_user_id,
    )
    db.add(direction)
    await db.commit()
    direction = await _get_direction_or_404(direction.id, x_tenant_id, db)
    return _direction_response(direction)


@router.get("/directions/{direction_id}", response_model=XHSDirectionResponse)
async def get_xhs_direction(
    direction_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    direction = await _get_direction_or_404(direction_id, x_tenant_id, db)
    return _direction_response(direction)


@router.put("/directions/{direction_id}", response_model=XHSDirectionResponse)
async def update_xhs_direction(
    direction_id: str,
    request: XHSDirectionUpdateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    direction = await _get_direction_or_404(direction_id, x_tenant_id, db)
    updates = request.model_dump(exclude_unset=True)

    if "main_variant_id" in updates:
        main_variant_value = updates.pop("main_variant_id")
        if main_variant_value:
            validated_main_variant_ids = await _validate_variant_ids_for_project(
                project_id=direction.project_id,
                tenant_id=x_tenant_id,
                variant_ids=[main_variant_value],
                field_label="主推产品版本",
                db=db,
            )
            direction.main_variant_id = validated_main_variant_ids[0]
        else:
            direction.main_variant_id = None

    if "secondary_variant_ids" in updates:
        secondary_ids_value = updates.pop("secondary_variant_ids") or []
        validated_secondary_ids = await _validate_variant_ids_for_project(
            project_id=direction.project_id,
            tenant_id=x_tenant_id,
            variant_ids=secondary_ids_value,
            field_label="搭带产品版本",
            db=db,
        )
        direction.secondary_variant_ids_json = [
            variant_id for variant_id in validated_secondary_ids if variant_id != direction.main_variant_id
        ]

    for field, value in updates.items():
        setattr(direction, field, value.value if isinstance(value, XHSDirectionStatus) else value)

    await db.commit()
    direction = await _get_direction_or_404(direction_id, x_tenant_id, db)
    return _direction_response(direction)


@router.get("/config/rule-packs", response_model=list[XHSRulePackResponse])
async def list_rule_packs(
    category_id: Optional[str] = Query(None),
    status_value: Optional[XHSPackStatus] = Query(None, alias="status"),
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(_build_pack_query(XHSRulePack, x_tenant_id, category_id, status_value))
    return [_rule_pack_response(pack) for pack in result.scalars().all()]


@router.post("/config/rule-packs", response_model=XHSRulePackResponse, status_code=status.HTTP_201_CREATED)
async def create_rule_pack(
    request: XHSRulePackCreateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    validation = _validate_rule_pack_payload(request.pack)
    _raise_if_invalid(validation)
    pack = XHSRulePack(
        id=generate_id("XRPK"),
        tenant_id=x_tenant_id,
        category_id=request.category_id,
        name=request.name,
        version=request.version,
        status=request.status.value,
        pack_json=request.pack.model_dump(),
        created_by=current_actor_user_id,
    )
    db.add(pack)
    await db.commit()
    await db.refresh(pack)
    return _rule_pack_response(pack)


@router.get("/config/rule-packs/{pack_id}", response_model=XHSRulePackResponse)
async def get_rule_pack(
    pack_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSRulePack, pack_id, x_tenant_id, db)
    return _rule_pack_response(pack)


@router.put("/config/rule-packs/{pack_id}", response_model=XHSRulePackResponse)
async def update_rule_pack(
    pack_id: str,
    request: XHSRulePackUpdateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSRulePack, pack_id, x_tenant_id, db)
    updates = request.model_dump(exclude_unset=True)
    if "pack" in updates:
        validation = _validate_rule_pack_payload(RulePackPayload.model_validate(updates["pack"]))
        _raise_if_invalid(validation)
    if "pack" in updates:
        updates["pack_json"] = updates.pop("pack")
    for field, value in updates.items():
        setattr(pack, field, value.value if isinstance(value, XHSPackStatus) else value)
    await db.commit()
    await db.refresh(pack)
    return _rule_pack_response(pack)


@router.post("/config/rule-packs/{pack_id}/publish", response_model=XHSRulePackResponse)
async def publish_rule_pack(
    pack_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSRulePack, pack_id, x_tenant_id, db)
    pack.status = XHSPackStatus.ACTIVE.value
    await db.commit()
    await db.refresh(pack)
    return _rule_pack_response(pack)


@router.get("/config/brand-packs", response_model=list[XHSBrandPackResponse])
async def list_brand_packs(
    category_id: Optional[str] = Query(None),
    status_value: Optional[XHSPackStatus] = Query(None, alias="status"),
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(_build_pack_query(XHSBrandPack, x_tenant_id, category_id, status_value))
    return [_brand_pack_response(pack) for pack in result.scalars().all()]


@router.post("/config/brand-packs", response_model=XHSBrandPackResponse, status_code=status.HTTP_201_CREATED)
async def create_brand_pack(
    request: XHSBrandPackCreateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    validation = _validate_brand_pack_payload(request.pack)
    _raise_if_invalid(validation)
    pack = XHSBrandPack(
        id=generate_id("XBP"),
        tenant_id=x_tenant_id,
        brand_name=request.brand_name,
        category_id=request.category_id,
        version=request.version,
        status=request.status.value,
        is_default=request.is_default,
        pack_json=request.pack.model_dump(),
        created_by=current_actor_user_id,
    )
    db.add(pack)
    await db.commit()
    await db.refresh(pack)
    return _brand_pack_response(pack)


@router.get("/config/brand-packs/{pack_id}", response_model=XHSBrandPackResponse)
async def get_brand_pack(
    pack_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSBrandPack, pack_id, x_tenant_id, db)
    return _brand_pack_response(pack)


@router.put("/config/brand-packs/{pack_id}", response_model=XHSBrandPackResponse)
async def update_brand_pack(
    pack_id: str,
    request: XHSBrandPackUpdateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSBrandPack, pack_id, x_tenant_id, db)
    updates = request.model_dump(exclude_unset=True)
    if "pack" in updates:
        validation = _validate_brand_pack_payload(BrandPackPayload.model_validate(updates["pack"]))
        _raise_if_invalid(validation)
    if "pack" in updates:
        updates["pack_json"] = updates.pop("pack")
    for field, value in updates.items():
        setattr(pack, field, value.value if isinstance(value, XHSPackStatus) else value)
    await db.commit()
    await db.refresh(pack)
    return _brand_pack_response(pack)


@router.post("/config/brand-packs/{pack_id}/publish", response_model=XHSBrandPackResponse)
async def publish_brand_pack(
    pack_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSBrandPack, pack_id, x_tenant_id, db)
    pack.status = XHSPackStatus.ACTIVE.value
    await db.commit()
    await db.refresh(pack)
    return _brand_pack_response(pack)


@router.get("/config/brief-packs", response_model=list[XHSBriefPackResponse])
async def list_brief_packs(
    category_id: Optional[str] = Query(None),
    status_value: Optional[XHSPackStatus] = Query(None, alias="status"),
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(_build_pack_query(XHSBriefPack, x_tenant_id, category_id, status_value))
    return [_brief_pack_response(pack) for pack in result.scalars().all()]


@router.post("/config/brief-packs", response_model=XHSBriefPackResponse, status_code=status.HTTP_201_CREATED)
async def create_brief_pack(
    request: XHSBriefPackCreateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    validation = _validate_brief_pack_payload(request.pack)
    _raise_if_invalid(validation)
    pack = XHSBriefPack(
        id=generate_id("XFP"),
        tenant_id=x_tenant_id,
        brand_name=request.brand_name,
        category_id=request.category_id,
        version=request.version,
        status=request.status.value,
        source_type=request.source_type.value,
        source_ref=request.source_ref,
        pack_json=request.pack.model_dump(),
        created_by=current_actor_user_id,
    )
    db.add(pack)
    await db.commit()
    await db.refresh(pack)
    return _brief_pack_response(pack)


@router.get("/config/brief-packs/{pack_id}", response_model=XHSBriefPackResponse)
async def get_brief_pack(
    pack_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSBriefPack, pack_id, x_tenant_id, db)
    return _brief_pack_response(pack)


@router.put("/config/brief-packs/{pack_id}", response_model=XHSBriefPackResponse)
async def update_brief_pack(
    pack_id: str,
    request: XHSBriefPackUpdateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSBriefPack, pack_id, x_tenant_id, db)
    updates = request.model_dump(exclude_unset=True)
    if "pack" in updates:
        validation = _validate_brief_pack_payload(BriefPackPayload.model_validate(updates["pack"]))
        _raise_if_invalid(validation)
    if "pack" in updates:
        updates["pack_json"] = updates.pop("pack")
    for field, value in updates.items():
        if field == "status":
            setattr(pack, field, value.value)
        elif field == "source_type":
            setattr(pack, field, value.value)
        else:
            setattr(pack, field, value)
    await db.commit()
    await db.refresh(pack)
    return _brief_pack_response(pack)


@router.post("/config/brief-packs/{pack_id}/publish", response_model=XHSBriefPackResponse)
async def publish_brief_pack(
    pack_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSBriefPack, pack_id, x_tenant_id, db)
    pack.status = XHSPackStatus.ACTIVE.value
    await db.commit()
    await db.refresh(pack)
    return _brief_pack_response(pack)


@router.post("/config/brief-packs/parse", response_model=XHSBriefPackParseResponse)
async def parse_brief_pack(
    request: XHSBriefPackParseRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    extracted_text = (request.source_text or "").strip()

    if not extracted_text and request.file_url and request.file_name:
        extracted_text = (await DocumentParser.download_and_parse(request.file_url, request.file_name)).strip()

    if not extracted_text:
        raise HTTPException(
            status_code=400,
            detail="parse 需要 source_text，或同时提供 file_url 和 file_name",
        )

    pack = _build_brief_pack_from_text(extracted_text)
    validation = _validate_brief_pack_payload(pack)

    return XHSBriefPackParseResponse(
        source_type=request.source_type,
        source_ref=request.source_ref,
        extracted_text=extracted_text,
        pack=pack,
        validation=validation,
    )


@router.get("/config/risk-packs", response_model=list[XHSRiskPackResponse])
async def list_risk_packs(
    category_id: Optional[str] = Query(None),
    status_value: Optional[XHSPackStatus] = Query(None, alias="status"),
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(_build_pack_query(XHSRiskPack, x_tenant_id, category_id, status_value))
    return [_risk_pack_response(pack) for pack in result.scalars().all()]


@router.post("/config/risk-packs", response_model=XHSRiskPackResponse, status_code=status.HTTP_201_CREATED)
async def create_risk_pack(
    request: XHSRiskPackCreateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    validation = _validate_risk_pack_payload(request.pack)
    _raise_if_invalid(validation)
    pack = XHSRiskPack(
        id=generate_id("XRP"),
        tenant_id=x_tenant_id,
        category_id=request.category_id,
        name=request.name,
        version=request.version,
        status=request.status.value,
        pack_json=request.pack.model_dump(),
        created_by=current_actor_user_id,
    )
    db.add(pack)
    await db.commit()
    await db.refresh(pack)
    return _risk_pack_response(pack)


@router.get("/config/risk-packs/{pack_id}", response_model=XHSRiskPackResponse)
async def get_risk_pack(
    pack_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSRiskPack, pack_id, x_tenant_id, db)
    return _risk_pack_response(pack)


@router.put("/config/risk-packs/{pack_id}", response_model=XHSRiskPackResponse)
async def update_risk_pack(
    pack_id: str,
    request: XHSRiskPackUpdateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSRiskPack, pack_id, x_tenant_id, db)
    updates = request.model_dump(exclude_unset=True)
    if "pack" in updates:
        validation = _validate_risk_pack_payload(RiskPackPayload.model_validate(updates["pack"]))
        _raise_if_invalid(validation)
    if "pack" in updates:
        updates["pack_json"] = updates.pop("pack")
    for field, value in updates.items():
        setattr(pack, field, value.value if isinstance(value, XHSPackStatus) else value)
    await db.commit()
    await db.refresh(pack)
    return _risk_pack_response(pack)


@router.post("/config/risk-packs/{pack_id}/publish", response_model=XHSRiskPackResponse)
async def publish_risk_pack(
    pack_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    pack = await _get_pack_or_404(XHSRiskPack, pack_id, x_tenant_id, db)
    pack.status = XHSPackStatus.ACTIVE.value
    await db.commit()
    await db.refresh(pack)
    return _risk_pack_response(pack)


@router.post("/batches", response_model=XHSBatchJobResponse, status_code=status.HTTP_201_CREATED)
async def create_batch_job(
    request: XHSBatchCreateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    if request.input_type == XHSInputType.TEXT and not request.input_text:
        raise HTTPException(status_code=400, detail="input_type=text 时必须提供 input_text")
    if request.input_type == XHSInputType.FILE and not request.file_id:
        raise HTTPException(status_code=400, detail="input_type=file 时必须提供 file_id")
    if request.input_type == XHSInputType.FEISHU_LINK and not request.feishu_url:
        raise HTTPException(status_code=400, detail="input_type=feishu_link 时必须提供 feishu_url")

    direction: Optional[XHSDirectionItem] = None
    if request.direction_id:
        direction = await _get_direction_or_404(request.direction_id, x_tenant_id, db)
        if direction.project and direction.project.category_id != request.category_id:
            raise HTTPException(status_code=400, detail="方向单所属项目的品类与当前批次品类不一致")

    selected_packs = await _resolve_batch_pack_selections(
        request=request,
        tenant_id=x_tenant_id,
        db=db,
    )

    input_ref, split_notes, split_meta = await _prepare_batch_source(
        request=request,
        tenant_id=x_tenant_id,
        db=db,
    )

    estimate = _estimate_batch_usage(
        run_mode=request.run_mode.value,
        trial_sample_count=request.trial_sample_count,
        split_notes=split_notes,
        split_strategy=str(split_meta.get("split_strategy") or "unknown"),
    )

    job = XHSBatchJob(
        id=generate_id("XBJ"),
        tenant_id=x_tenant_id,
        created_by=current_actor_user_id,
        status=XHSBatchStatus.PENDING.value,
        category_id=request.category_id,
        direction_id=direction.id if direction else None,
        rule_pack_version=selected_packs["rule_pack_version"],
        risk_pack_version=selected_packs["risk_pack_version"],
        brand_pack_version=selected_packs["brand_pack_version"],
        brief_pack_id=selected_packs["brief_pack_id"],
        style_template_id=request.style_template_id,
        run_mode=request.run_mode.value,
        trial_sample_count=request.trial_sample_count,
        input_type=request.input_type.value,
        estimated_tokens=estimate.estimated_tokens,
        estimated_cost=estimate.estimated_cost,
        input_stats_json={
            "source_ref": input_ref,
            "raw_chars": len(request.input_text or "") if request.input_type == XHSInputType.TEXT else 0,
            "split_count": len(split_notes),
            "planned_items": estimate.estimated_items,
            **split_meta,
        },
        tag_policy_json=request.tag_policy,
        export_options_json=request.export_options,
        system_blocked=False,
        total_items=len(split_notes),
        done_items=0,
        running_items=0,
    )
    db.add(job)
    await db.flush()

    for index, note in enumerate(split_notes, start=1):
        source_text = str(note.get("content") or "").strip()
        item = XHSBatchItem(
            id=generate_id("XBI"),
            batch_id=job.id,
            item_id=f"item_{index:03d}",
            source_text=source_text,
            source_title_guess=str(note.get("title_guess") or "")[:60] or f"笔记 {index}",
            split_by=str(note.get("split_by") or ("rule" if request.input_type == XHSInputType.TEXT else "ai_assisted")),
            status=XHSBatchStatus.PENDING.value,
            round=0,
            model_meta_json=note.get("model_meta") or {},
        )
        db.add(item)

    await db.commit()
    job = await _get_batch_job_or_404(job.id, x_tenant_id, db)
    return _batch_job_response(job)


@router.post("/batches/estimate", response_model=XHSBatchEstimateResponse)
async def estimate_batch_job(
    request: XHSBatchCreateRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    if request.input_type == XHSInputType.TEXT and not request.input_text:
        raise HTTPException(status_code=400, detail="input_type=text 时必须提供 input_text")
    if request.input_type == XHSInputType.FILE and not request.file_id:
        raise HTTPException(status_code=400, detail="input_type=file 时必须提供 file_id")
    if request.input_type == XHSInputType.FEISHU_LINK and not request.feishu_url:
        raise HTTPException(status_code=400, detail="input_type=feishu_link 时必须提供 feishu_url")

    if request.direction_id:
        direction = await _get_direction_or_404(request.direction_id, x_tenant_id, db)
        if direction.project and direction.project.category_id != request.category_id:
            raise HTTPException(status_code=400, detail="方向单所属项目的品类与当前批次品类不一致")

    await _resolve_batch_pack_selections(
        request=request,
        tenant_id=x_tenant_id,
        db=db,
    )

    _, split_notes, split_meta = await _prepare_batch_source(
        request=request,
        tenant_id=x_tenant_id,
        db=db,
    )

    return _estimate_batch_usage(
        run_mode=request.run_mode.value,
        trial_sample_count=request.trial_sample_count,
        split_notes=split_notes,
        split_strategy=str(split_meta.get("split_strategy") or "unknown"),
    )


@router.get("/batches", response_model=list[XHSBatchJobResponse])
async def list_batch_jobs(
    status_value: Optional[XHSBatchStatus] = Query(None, alias="status"),
    project_id: Optional[str] = Query(None),
    direction_id: Optional[str] = Query(None),
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    query = _build_batch_query(x_tenant_id).order_by(XHSBatchJob.created_at.desc())
    if direction_id:
        query = query.where(XHSBatchJob.direction_id == direction_id)
    if project_id:
        query = query.join(XHSDirectionItem, XHSBatchJob.direction_id == XHSDirectionItem.id).where(
            XHSDirectionItem.project_id == project_id
        )
    result = await db.execute(query)
    jobs = list(result.scalars().all())
    if not jobs:
        return []

    job_ids = [job.id for job in jobs]
    item_result = await db.execute(select(XHSBatchItem).where(XHSBatchItem.batch_id.in_(job_ids)))
    counts: dict[str, dict[str, int]] = {
        job_id: {"failed_items": 0, "decision_items": 0, "safe_rewrite_items": 0}
        for job_id in job_ids
    }
    for item in item_result.scalars().all():
        job_counts = counts[item.batch_id]
        if item.status == XHSBatchStatus.FAILED.value and not _item_requires_manual_decision(item):
            job_counts["failed_items"] += 1
        if _item_requires_manual_decision(item):
            job_counts["decision_items"] += 1
        if item.safe_rewrite_used:
            job_counts["safe_rewrite_items"] += 1

    responses = [
        _batch_job_response_with_counts(
            job,
            failed_items=counts[job.id]["failed_items"],
            decision_items=counts[job.id]["decision_items"],
            safe_rewrite_items=counts[job.id]["safe_rewrite_items"],
        )
        for job in jobs
    ]
    if status_value:
        responses = [job for job in responses if _batch_matches_status(job, status_value)]
    return responses


@router.get("/batches/{batch_id}", response_model=XHSBatchJobResponse)
async def get_batch_job(
    batch_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_batch_job_or_404(batch_id, x_tenant_id, db)
    items_result = await db.execute(
        select(XHSBatchItem).where(XHSBatchItem.batch_id == batch_id).order_by(XHSBatchItem.item_id.asc())
    )
    items = list(items_result.scalars().all())
    return _batch_job_detail_response(job, items)


@router.get("/batches/{batch_id}/items", response_model=XHSBatchItemListResponse)
async def list_batch_items(
    batch_id: str,
    status_value: Optional[XHSBatchStatus] = Query(None, alias="status"),
    q: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    batch_result = await db.execute(
        select(XHSBatchJob).where(XHSBatchJob.id == batch_id, XHSBatchJob.tenant_id == x_tenant_id)
    )
    batch = batch_result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="批量任务不存在")

    result = await db.execute(
        select(XHSBatchItem).where(XHSBatchItem.batch_id == batch_id).order_by(XHSBatchItem.item_id.asc())
    )
    items = list(result.scalars().all())

    if status_value:
        if status_value in {XHSBatchStatus.NEEDS_DECISION, XHSBatchStatus.AWAITING_DECISION}:
            items = [item for item in items if _item_requires_manual_decision(item)]
        elif status_value == XHSBatchStatus.FAILED:
            items = [item for item in items if item.status == status_value.value and not _item_requires_manual_decision(item)]
        else:
            items = [item for item in items if item.status == status_value.value]
    if q:
        keyword = q.strip().lower()
        if keyword:
            items = [
                item
                for item in items
                if keyword in (item.source_title_guess or "").lower()
                or keyword in (item.final_title or "").lower()
                or keyword in (item.final_body or "").lower()
                or keyword in (item.source_text or "").lower()
            ]

    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    paged_items = items[start:end]
    return XHSBatchItemListResponse(
        items=[_batch_item_response(item) for item in paged_items],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/batches/{batch_id}/exports", response_model=list[XHSExportLogResponse])
async def list_batch_export_logs(
    batch_id: str,
    export_type: Optional[XHSExportType] = Query(None, alias="type"),
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    batch_result = await db.execute(
        select(XHSBatchJob).where(XHSBatchJob.id == batch_id, XHSBatchJob.tenant_id == x_tenant_id)
    )
    batch = batch_result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="批量任务不存在")

    query = select(XHSExportLog).where(XHSExportLog.batch_id == batch_id).order_by(XHSExportLog.created_at.desc())
    if export_type:
        query = query.where(XHSExportLog.type == export_type.value)

    result = await db.execute(query)
    return [_export_log_response(log) for log in result.scalars().all()]


@router.post("/batches/{batch_id}/start", response_model=XHSBatchJobResponse)
async def start_batch_job(
    batch_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_batch_job_or_404(batch_id, x_tenant_id, db)

    if job.status not in {XHSBatchStatus.PENDING.value, XHSBatchStatus.FAILED.value}:
        raise HTTPException(status_code=400, detail="当前状态不可启动")

    job.status = XHSBatchStatus.QUEUED.value
    await db.commit()
    await _dispatch_xhs_batch_job(job.id)
    job = await _get_batch_job_or_404(batch_id, x_tenant_id, db)
    return _batch_job_response(job)


@router.post("/batches/{batch_id}/promote", response_model=XHSBatchJobResponse, status_code=status.HTTP_201_CREATED)
async def promote_batch_job(
    batch_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    source_job = await _get_batch_job_or_404(batch_id, x_tenant_id, db)
    if source_job.run_mode != XHSBatchRunMode.TRIAL.value:
        raise HTTPException(status_code=400, detail="只有 trial 批次可 promote")

    items_result = await db.execute(
        select(XHSBatchItem).where(XHSBatchItem.batch_id == batch_id).order_by(XHSBatchItem.item_id.asc())
    )
    source_items = list(items_result.scalars().all())
    split_notes = [
        {
            "content": item.source_text,
            "title_guess": item.source_title_guess,
            "split_by": item.split_by,
            "model_meta": item.model_meta_json or {},
        }
        for item in source_items
    ]
    estimate = _estimate_batch_usage(
        run_mode=XHSBatchRunMode.FULL.value,
        trial_sample_count=None,
        split_notes=split_notes,
        split_strategy=str((source_job.input_stats_json or {}).get("split_strategy") or "unknown"),
    )

    promoted_job = XHSBatchJob(
        id=generate_id("XBJ"),
        tenant_id=x_tenant_id,
        created_by=current_actor_user_id,
        status=XHSBatchStatus.PENDING.value,
        category_id=source_job.category_id,
        direction_id=source_job.direction_id,
        rule_pack_version=source_job.rule_pack_version,
        risk_pack_version=source_job.risk_pack_version,
        brand_pack_version=source_job.brand_pack_version,
        brief_pack_id=source_job.brief_pack_id,
        style_template_id=source_job.style_template_id,
        run_mode=XHSBatchRunMode.FULL.value,
        trial_sample_count=None,
        input_type=source_job.input_type,
        estimated_tokens=estimate.estimated_tokens,
        estimated_cost=estimate.estimated_cost,
        input_stats_json={
            **(source_job.input_stats_json or {}),
            "planned_items": estimate.estimated_items,
            "promoted_from_batch_id": source_job.id,
        },
        tag_policy_json=source_job.tag_policy_json,
        export_options_json=source_job.export_options_json,
        system_blocked=False,
        total_items=len(split_notes),
        done_items=0,
        running_items=0,
    )
    db.add(promoted_job)
    await db.flush()

    for index, note in enumerate(split_notes, start=1):
        db.add(
            XHSBatchItem(
                id=generate_id("XBI"),
                batch_id=promoted_job.id,
                item_id=f"item_{index:03d}",
                source_text=str(note.get("content") or "").strip(),
                source_title_guess=str(note.get("title_guess") or "")[:60] or f"笔记 {index}",
                split_by=str(note.get("split_by") or "rule"),
                status=XHSBatchStatus.PENDING.value,
                round=0,
                model_meta_json=note.get("model_meta") or {},
            )
        )

    await db.commit()
    promoted_job = await _get_batch_job_or_404(promoted_job.id, x_tenant_id, db)
    await _dispatch_xhs_batch_job(promoted_job.id)
    return _batch_job_response(promoted_job)


@router.post("/batches/{batch_id}/retry", response_model=XHSBatchJobResponse)
async def retry_batch_job(
    batch_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_batch_job_or_404(batch_id, x_tenant_id, db)

    items_result = await db.execute(
        select(XHSBatchItem).where(XHSBatchItem.batch_id == batch_id).order_by(XHSBatchItem.item_id.asc())
    )
    items = list(items_result.scalars().all())
    failed_items = [
        item
        for item in items
        if item.status == XHSBatchStatus.FAILED.value and not _item_requires_manual_decision(item)
    ]
    if not failed_items:
        raise HTTPException(status_code=400, detail="当前批次没有失败条目可重试")

    for item in failed_items:
        _prepare_batch_item_for_rerun(
            item,
            meta_updates={"retry_requested": True},
            clear_selected_decision=True,
        )

    job.status = XHSBatchStatus.PENDING.value
    job.system_blocked = False
    job.system_block_reason = None
    job.running_items = 0
    job.done_items = sum(
        1
        for item in items
        if item.status in {
            XHSBatchStatus.COMPLETED.value,
            XHSBatchStatus.FAILED.value,
            XHSBatchStatus.NEEDS_DECISION.value,
        }
    )
    await db.commit()
    job = await _get_batch_job_or_404(batch_id, x_tenant_id, db)

    await _dispatch_xhs_batch_job_items(job.id, [item.item_id for item in failed_items])
    return _batch_job_response(job)


@router.post("/batches/{batch_id}/items/{item_id}/decision", response_model=XHSBatchItemResponse)
async def submit_batch_item_decision(
    batch_id: str,
    item_id: str,
    request: XHSBatchDecisionSubmitRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_batch_job_or_404(batch_id, x_tenant_id, db)
    item_result = await db.execute(
        select(XHSBatchItem).where(
            XHSBatchItem.batch_id == batch_id,
            XHSBatchItem.item_id == item_id,
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="条目不存在")

    decision_meta = _item_decision_meta(item)
    decision_options = decision_meta["decision_options"] or []
    option = next((opt for opt in decision_options if str(opt.get("id")) == request.option_id), None)
    if not option:
        raise HTTPException(status_code=400, detail="所选方案不存在或已失效，请刷新后重试")
    if not _item_requires_manual_decision(item):
        raise HTTPException(status_code=400, detail="当前条目不处于待决策状态")

    _prepare_batch_item_for_rerun(
        item,
        meta_updates={
            "selected_decision_option_id": request.option_id,
            "retry_requested": True,
        },
        clear_selected_decision=False,
    )
    job.status = XHSBatchStatus.PENDING.value
    job.system_blocked = False
    job.system_block_reason = None
    job.running_items = 0

    items_result = await db.execute(
        select(XHSBatchItem).where(XHSBatchItem.batch_id == batch_id).order_by(XHSBatchItem.item_id.asc())
    )
    items = list(items_result.scalars().all())
    job.done_items = sum(
        1
        for current_item in items
        if current_item.status in {
            XHSBatchStatus.COMPLETED.value,
            XHSBatchStatus.FAILED.value,
            XHSBatchStatus.NEEDS_DECISION.value,
        }
    )
    await db.commit()
    await _dispatch_xhs_batch_job_items(job.id, [item.item_id])

    refreshed_item = (
        await db.execute(
            select(XHSBatchItem).where(
                XHSBatchItem.batch_id == batch_id,
                XHSBatchItem.item_id == item_id,
            )
        )
    ).scalar_one()
    return _batch_item_response(refreshed_item)


@router.get("/batches/{batch_id}/export/all.md", response_class=PlainTextResponse)
async def export_batch_all_md(
    batch_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(XHSBatchJob).where(XHSBatchJob.id == batch_id, XHSBatchJob.tenant_id == x_tenant_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="批量任务不存在")

    items_result = await db.execute(
        select(XHSBatchItem).where(XHSBatchItem.batch_id == batch_id).order_by(XHSBatchItem.item_id.asc())
    )
    items = list(items_result.scalars().all())
    exportable_items = [item for item in items if _is_exportable_batch_item(item)]
    if not exportable_items:
        raise HTTPException(status_code=400, detail="当前批次暂无可导出的终稿")

    markdown = _build_all_md_content(items)
    job.status = XHSBatchStatus.EXPORTED.value if job.status in {XHSBatchStatus.COMPLETED.value, XHSBatchStatus.DONE.value} else job.status
    job.export_all_md_status = "completed"
    job.export_all_md_url = f"/api/v1/xhs/batches/{job.id}/export/all.md"
    export_log = XHSExportLog(
        id=generate_id("XEL"),
        batch_id=job.id,
        type=XHSExportType.ALL_MD.value,
        status=XHSExportStatus.COMPLETED.value,
        request_json={},
        response_json={"url": job.export_all_md_url},
        error=None,
    )
    db.add(export_log)
    await db.commit()

    return PlainTextResponse(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{job.id}_all.md"'},
    )


@router.post("/batches/{batch_id}/export/feishu", response_model=XHSFeishuExportResponse)
async def export_batch_feishu(
    batch_id: str,
    request: XHSFeishuExportRequest,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(XHSBatchJob).where(XHSBatchJob.id == batch_id, XHSBatchJob.tenant_id == x_tenant_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="批量任务不存在")

    items_result = await db.execute(
        select(XHSBatchItem).where(XHSBatchItem.batch_id == batch_id).order_by(XHSBatchItem.item_id.asc())
    )
    items = list(items_result.scalars().all())
    exportable_items = [item for item in items if _is_exportable_batch_item(item)]
    if not exportable_items:
        raise HTTPException(status_code=400, detail="当前批次暂无可导出的终稿")

    markdown = _build_all_md_content(items)
    job.status = XHSBatchStatus.EXPORTING.value
    job.export_all_md_status = XHSExportStatus.COMPLETED.value
    job.export_all_md_url = f"/api/v1/xhs/batches/{job.id}/export/all.md"
    job.export_feishu_status = XHSExportStatus.RUNNING.value
    job.export_feishu_error = None
    await db.flush()

    export_log = XHSExportLog(
        id=generate_id("XEL"),
        batch_id=job.id,
        type=XHSExportType.FEISHU.value,
        status=XHSExportStatus.RUNNING.value,
        request_json=request.model_dump(),
        response_json=None,
        error=None,
    )
    db.add(export_log)
    await db.flush()

    try:
        export_result = build_feishu_export_result(
            batch_id=job.id,
            markdown=markdown,
            folder_token=request.folder_token,
            doc_title=request.doc_title,
        )
        export_log.status = XHSExportStatus.COMPLETED.value
        export_log.response_json = export_result
        job.export_feishu_status = XHSExportStatus.COMPLETED.value
        job.status = XHSBatchStatus.EXPORTED.value
        docs = export_result.get("docs") or []
        if docs:
            job.export_feishu_doc_title = docs[0].get("doc_title")
    except Exception as exc:
        export_log.status = XHSExportStatus.FAILED.value
        export_log.error = str(exc)
        job.export_feishu_status = XHSExportStatus.FAILED.value
        job.export_feishu_error = str(exc)
        await db.commit()
        raise HTTPException(status_code=500, detail="飞书导出失败") from exc

    await db.commit()
    return XHSFeishuExportResponse(
        status=XHSExportStatus.COMPLETED,
        message="飞书文档已创建",
    )


@router.get("/batches/{batch_id}/export/feishu/status", response_model=XHSFeishuExportStatusResponse)
async def get_batch_feishu_export_status(
    batch_id: str,
    current_actor_user_id: str = Depends(get_current_xhs_user_id),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(XHSBatchJob).where(XHSBatchJob.id == batch_id, XHSBatchJob.tenant_id == x_tenant_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="批量任务不存在")

    log_result = await db.execute(
        select(XHSExportLog)
        .where(XHSExportLog.batch_id == batch_id, XHSExportLog.type == XHSExportType.FEISHU.value)
        .order_by(XHSExportLog.created_at.desc())
    )
    latest_log = log_result.scalars().first()
    return _feishu_status_response(latest_log, job)
