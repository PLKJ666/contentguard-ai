"""
脚本预审 API v2

核心变化：
- 去掉关键词匹配，全部交给 AI 审核
- 结构化 XML 提示词 + 双角色 CoT（法务审核员 + 创意总监）
- 单次 AI 调用，response_format: json_object
- AI 不可用时降级：通知品牌方 + 告知达人，不做审核
- 五维度：法规合规 / 平台规则 / 品牌安全 / Brief匹配 / 内容质量
"""

import json
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.brief import Brief
from app.models.project import Project
from app.models.brand_learning import BrandLearnedRule
from app.schemas.review import (
    ScriptReviewRequest,
    ScriptReviewResponse,
    Violation,
    ViolationType,
    RiskLevel,
    SoftRiskWarning,
    SoftRiskAction,
    ReviewDimension,
    ReviewDimensions,
    SellingPointMatch,
    ChainOfThought,
    ComplianceOfficerCoT,
    ComplianceDimensionCoT,
    ComplianceReasoning,
    CreativeDirectorCoT,
    BriefMatchCoT,
    SellingPointReasoning,
    ContentQualityCoT,
    ReviewConclusions,
    DimensionConclusion,
    ContentQualityConclusion,
    ContentTypeDetection,
    BrandExposureAssessment,
)
from app.api.rules import (
    get_whitelist_for_brand,
    get_forbidden_words_for_tenant,
    get_active_platform_rules,
    get_competitors_for_brand,
)
from app.services.soft_risk import evaluate_soft_risk
from app.services.ai_service import AIServiceFactory
from app.services.document_parser import DocumentParser

router = APIRouter(prefix="/scripts", tags=["scripts"])
logger = logging.getLogger(__name__)

# 维度名称映射：英文 → 中文
DIMENSION_EN_TO_CN = {
    "legal": "法规合规",
    "platform": "平台规则",
    "brand_safety": "品牌安全",
    "brief_match": "Brief匹配",
    "content_quality": "内容质量",
}
# 反向映射：中文 → 英文（用于解析 AI 返回的中文 key）
DIMENSION_CN_TO_EN = {v: k for k, v in DIMENSION_EN_TO_CN.items()}


def _normalize_selling_points(raw_points: list[dict] | None) -> list[dict]:
    """
    标准化卖点列表，兼容旧 required:bool 格式
    返回 [{content, priority}]
    """
    if not raw_points:
        return []
    result = []
    for sp in raw_points:
        content = sp.get("content", "")
        if not content:
            continue
        if "priority" in sp:
            priority = sp["priority"]
        elif "required" in sp:
            priority = "core" if sp["required"] else "recommended"
        else:
            priority = "recommended"
        result.append({"content": content, "priority": priority})
    return result


def _merge_selling_point_matches(
    brief_data: dict,
    selling_point_matches: list[SellingPointMatch],
    content_type: Optional[ContentTypeDetection],
    brand_exposure: Optional[BrandExposureAssessment] = None,
) -> list[SellingPointMatch]:
    """
    用 Brief 卖点补齐 AI 返回，避免 viral 模式只返回“品牌曝光度”。

    Brief 里的卖点始终完整返回；AI 额外生成的评估项（如品牌曝光度）保留。
    """
    brief_points = _normalize_selling_points(brief_data.get("selling_points") or [])
    existing_by_content = {
        (match.content or "").strip(): match
        for match in selling_point_matches
        if (match.content or "").strip()
    }
    merged: list[SellingPointMatch] = []
    used_contents: set[str] = set()

    for point in brief_points:
        content = (point.get("content") or "").strip()
        if not content:
            continue
        existing = existing_by_content.get(content)
        if existing:
            merged.append(existing)
        else:
            merged.append(
                SellingPointMatch(
                    content=content,
                    priority=point.get("priority", "recommended"),
                    matched=False,
                    evidence="AI 未明确识别到该卖点覆盖。",
                )
            )
        used_contents.add(content)

    for match in selling_point_matches:
        content = (match.content or "").strip()
        if not content or content in used_contents:
            continue
        merged.append(match)
        used_contents.add(content)

    if (
        content_type
        and content_type.type == "viral"
        and brand_exposure is None
        and "品牌曝光度" not in used_contents
    ):
        merged.append(
            SellingPointMatch(
                content="品牌曝光度",
                priority="core",
                matched=False,
                evidence="AI 未返回品牌曝光度评估。",
            )
        )

    return merged


def _brief_explicitly_requires_core_selling_points(brief_data: dict) -> bool:
    """
    判断 Brief 是否对核心卖点覆盖有强约束（用于降低 hard_ad 误判带来的误报）。

    说明：
    - hard_ad 本身倾向要求 core 卖点明确覆盖，但 AI 的内容类型判定可能有误判。
    - 当 content_type.confidence=low 时，仅在 Brief 明确写了强约束关键词时才补 violation。
    """
    if not isinstance(brief_data, dict):
        return False
    text_parts: list[str] = []
    for key in ("other_requirements", "product_description", "target_audience", "brand_tone"):
        value = brief_data.get(key)
        if isinstance(value, str) and value.strip():
            text_parts.append(value.strip())
    text = "\n".join(text_parts)
    if not text:
        return False

    strong_keywords = (
        "必须",
        "务必",
        "一定要",
        "需要",
        "需",
        "明确",
        "清晰",
        "拆解",
        "三大卖点",
        "核心卖点",
        "卖点缺失",
        "卖点完全缺失",
        "花字",
        "贴片",
    )
    return any(k in text for k in strong_keywords)


def _split_brief_requirements_text(text: str | None) -> tuple[str, str]:
    raw = (text or "").strip()
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


async def _get_brief_context(
    brand_id: Optional[str],
    db: AsyncSession,
    project_id: str | None = None,
    request_selling_points: list[dict] | None = None,
    request_blacklist_words: list[dict] | None = None,
) -> dict:
    """
    获取 Brief 完整信息（优先从 DB 读取，request 参数做 fallback）

    优先用 project_id 精确查找对应 Brief，
    没有 project_id 时才用 brand_id 查所有项目取第一个。

    返回 dict:
        selling_points, blacklist_words, competitors_from_brief,
        brand_tone, other_requirements, creative_rubric,
        product_description, target_audience
    """
    brief_data: dict = {
        "selling_points": [],
        "blacklist_words": [],
        "product_name": "",
        "product_description": "",
        "target_audience": "",
        "brand_tone": "",
        "other_requirements": "",
        "creative_rubric": None,
        "min_duration": None,
        "max_duration": None,
    }

    def _fill_brief_data(brief: Brief) -> None:
        if brief.selling_points:
            brief_data["selling_points"] = _normalize_selling_points(
                brief.selling_points
            )
        if brief.blacklist_words:
            brief_data["blacklist_words"] = brief.blacklist_words
        if brief.product_name:
            brief_data["product_name"] = brief.product_name
            brief_data["product_description"] = brief.product_name
        if brief.brand_tone:
            brief_data["brand_tone"] = brief.brand_tone
        if brief.other_requirements:
            target_audience, content_requirements = _split_brief_requirements_text(
                brief.other_requirements
            )
            if target_audience:
                brief_data["target_audience"] = target_audience
            brief_data["other_requirements"] = (
                content_requirements or brief.other_requirements
            )
        if (
            not brief_data["target_audience"]
            and brief.brand_tone
            and "\n" in brief.brand_tone
        ):
            legacy_parts = [part.strip() for part in brief.brand_tone.split("\n") if part.strip()]
            if len(legacy_parts) >= 2:
                brief_data["target_audience"] = legacy_parts[1]
        if brief.creative_rubric:
            brief_data["creative_rubric"] = brief.creative_rubric
        if brief.min_duration:
            brief_data["min_duration"] = brief.min_duration
        if brief.max_duration:
            brief_data["max_duration"] = brief.max_duration

    try:
        if project_id:
            # 精确查找：直接用 project_id
            brief_result = await db.execute(
                select(Brief).where(Brief.project_id == project_id)
            )
            brief = brief_result.scalar_one_or_none()
            if brief:
                _fill_brief_data(brief)
        elif brand_id:
            # 兜底：用 brand_id 查所有项目取第一个有 Brief 的
            project_result = await db.execute(
                select(Project).where(Project.brand_id == brand_id)
            )
            projects = project_result.scalars().all()
            for project in projects:
                brief_result = await db.execute(
                    select(Brief).where(Brief.project_id == project.id)
                )
                brief = brief_result.scalar_one_or_none()
                if brief:
                    _fill_brief_data(brief)
                    break
    except Exception as e:
        logger.warning(f"获取 Brief 失败: {e}")

    # Request 参数做 fallback
    if not brief_data["selling_points"] and request_selling_points:
        brief_data["selling_points"] = _normalize_selling_points(request_selling_points)
    if not brief_data["blacklist_words"] and request_blacklist_words:
        brief_data["blacklist_words"] = request_blacklist_words

    return brief_data


async def _get_brand_learned_rules(scope_id: str, db: AsyncSession) -> list[dict]:
    """获取当前配置空间的学习档案。"""
    try:
        result = await db.execute(
            select(BrandLearnedRule)
            .where(BrandLearnedRule.tenant_id == scope_id)
            .order_by(BrandLearnedRule.created_at.desc())
        )
        rules = result.scalars().all()
        return [
            {"type": r.type, "pattern": r.pattern, "reason": r.reason} for r in rules
        ]
    except Exception as e:
        logger.warning(f"获取品牌学习档案失败: {e}")
        return []


def _build_structured_prompt(
    content: str,
    platform: str,
    brief_data: dict,
    rules_data: dict,
    learned_rules: list[dict],
    review_mode: str = "script",
) -> str:
    """
    构建结构化 XML 提示词

    按设计文档的分层结构：
    <system> → <roles> → <review_task> → <brief> → <creative_rubric>
    → <compliance_rules> → <brand_learning> → <script> → <review_framework> → <output_format>
    """
    platform_labels = {
        "douyin": "抖音",
        "xiaohongshu": "小红书",
        "bilibili": "B站",
        "kuaishou": "快手",
    }
    platform_label = platform_labels.get(platform, platform)

    # 根据审核模式调整措辞
    is_video = review_mode == "video"
    content_label = "视频口播内容" if is_video else "营销脚本"
    content_label_short = "口播内容" if is_video else "脚本"
    review_type_label = "视频口播审核" if is_video else "脚本预审"
    content_tag = "video_content" if is_video else "script"

    # ===== <system> =====
    system_section = f"""<system>
你是一个专业的广告内容审核 AI 系统。你需要扮演两个角色（法务审核员和创意总监），对{content_label}进行全面审核。
你的审核必须严谨、完整、可执行，在保障合规的同时保护创意价值。
宁可多报明确且可修复的问题，也不要漏掉已经有证据支持的明显问题。
你必须逐句、逐段、逐卖点扫描内容，先穷举问题，再汇总结论。
你必须先完成推理分析，再给出结论。不允许跳过推理直接打分。
</system>"""

    # ===== <roles> =====
    roles_section = f"""<roles>
<compliance_officer>
角色：法务审核员
职责：逐句审查{content_label_short}，只管"合不合规"
负责维度：法规合规、平台规则、品牌安全
性格：严谨保守，但不越界评判创意
校准规则：
- 必须标记：绝对化用语（最好、第一、100%等用于产品宣传时）、可证伪的功效承诺、竞品直接提及、虚假信息
- 不应标记：网络修辞（"起飞""封神""绝了"等非广告法意义的夸张）、主观感受（"超好用""很舒服"）、合理夸张（有Brief卖点支撑的描述）、非广告语境的表达（"今天最开心""他是第一个到达的"）
- 判断原则：该词是否被消费者理解为事实承诺？如果只是情感表达或修辞手法，不应标记
内容类型差异化标准：
- 硬广模式：功效宣称严格审查，绝对化用语零容忍，必须检查是否标注"广告"标识
- 软广模式：区分"个人真实感受"和"功效承诺"，"我觉得皮肤变好了"属于主观感受不标记，"美白效果显著"属于功效承诺要标记；对植入自然度要求高，过于生硬的产品推销反而要标记为品牌安全风险
- 混合模式：软广段落用软广标准，硬推段落用硬广标准
- viral/品牌曝光模式：此类内容以创意娱乐为主、品牌通过画面露出呈现，口播极少或无实质产品描述。合规审查只需关注画面和口播中是否有明确的法规/平台违规，不因缺少产品信息而扣分
</compliance_officer>

<creative_director>
角色：创意总监
职责：评估内容的传播效果和创意价值，关心"好不好，怎么更好"
负责维度：Brief匹配、内容质量
性格：洞察用户心理，鼓励有锐度的内容
校准规则：
- 有记忆点、能引发共鸣的内容应该加分，即使表达稍显粗糙
- 完美但无聊、四平八稳的内容不应得高分
- 宁要一篇需要微调的创意好稿，也不要一篇没有传播力的废话
- 评价内容质量时要考虑目标平台的内容生态和用户偏好
- 受众匹配是重要评分维度：内容吸引的受众与产品目标受众高度重合时应大幅加分（即使卖点覆盖一般），受众完全错位时应严重扣分（即使卖点全覆盖也没有传播价值）
- **重点关注：内容要让受众乐于接受，不能教育顾客、引起反感**。用分享体验的方式而非说教，让顾客感觉舒服而非被指导，保持亲和力避免高高在上。发现此类问题必须指出并扣分
内容类型差异化标准：
- 硬广模式：卖点覆盖度权重高，core卖点必须精确传达，允许直接推销话术，产品信息完整度很重要
- 软广模式：自然度和原生感权重高，卖点只需语义级覆盖（不要求原文），硬塞卖点反而扣分，更看重内容的可看性和平台原生感；Brief匹配维度对"覆盖率"要求降低，但对"植入自然度"要求升高
- 混合模式：综合评估，软广部分看自然度，硬推部分看卖点覆盖
- viral/品牌曝光模式：此类内容的核心价值在传播力和品牌曝光，不要求像硬广一样逐条口播卖点，但仍需对 Brief 中每个卖点逐条判断 matched=true/false，并额外评估"品牌曝光度"（品牌logo/产品在画面中的出镜比例、可辨识度、自然融入度）。内容质量维度重点评估：创意新颖度（特效/变装/反转等创意手法）、情绪感染力（是否引发共鸣/好笑/惊叹）、平台原生感（是否符合目标平台的内容调性和传播规律）、互动引导力（是否能引发评论/模仿/分享）。不因缺少口播卖点、产品介绍或内容简短而扣分
</creative_director>
</roles>"""

    # ===== <review_task> =====
    review_task_section = f"""<review_task>
审核类型：{review_type_label}
投放平台：{platform_label}
</review_task>"""

    # ===== <brief> =====
    selling_points = brief_data.get("selling_points", [])
    blacklist_words = brief_data.get("blacklist_words", [])
    product_name = brief_data.get("product_name", "") or brief_data.get("product_description", "")
    target_audience = brief_data.get("target_audience", "")
    brand_tone = brief_data.get("brand_tone", "")
    other_requirements = brief_data.get("other_requirements", "")

    brief_parts = []
    if product_name:
        brief_parts.append(f"  <product_name>{product_name}</product_name>")
    if target_audience:
        brief_parts.append(f"  <target_audience>{target_audience}</target_audience>")
    if brand_tone:
        brief_parts.append(f"  <brand_tone>{brand_tone}</brand_tone>")
    if other_requirements:
        brief_parts.append(
            f"  <other_requirements>{other_requirements}</other_requirements>"
        )

    if selling_points:
        sp_lines = []
        for sp in selling_points:
            sp_lines.append(
                f'    <point priority="{sp["priority"]}">{sp["content"]}</point>'
            )
        brief_parts.append(
            "  <selling_points>\n" + "\n".join(sp_lines) + "\n  </selling_points>"
        )

    if blacklist_words:
        bw_lines = []
        for bw in blacklist_words:
            reason = bw.get("reason", "")
            bw_lines.append(f'    <word reason="{reason}">{bw.get("word", "")}</word>')
        brief_parts.append(
            "  <blacklist_words>\n" + "\n".join(bw_lines) + "\n  </blacklist_words>"
        )

    duration_info = ""
    if brief_data.get("min_duration") or brief_data.get("max_duration"):
        min_d = brief_data.get("min_duration", "不限")
        max_d = brief_data.get("max_duration", "不限")
        duration_info = f"\n  <duration>时长要求：{min_d}~{max_d}秒</duration>"

    brief_section = f"""<brief>
{chr(10).join(brief_parts) if brief_parts else "  （无 Brief 信息）"}{duration_info}
</brief>"""

    # ===== <creative_rubric> =====
    rubric = brief_data.get("creative_rubric")
    if rubric:
        rubric_parts = []
        for dim_key in ["tone", "audience", "content_style", "structure"]:
            dim = rubric.get(dim_key, {})
            if dim:
                target = dim.get("name", "") or dim.get("target", "")
                do_items = "\n".join(
                    f"      <item>{d}</item>"
                    for d in (dim.get("do_items") or dim.get("do") or [])
                )
                dont_items = "\n".join(
                    f"      <item>{d}</item>"
                    for d in (dim.get("dont_items") or dim.get("dont") or [])
                )
                rubric_parts.append(f"""  <{dim_key} target="{target}">
    <do>
{do_items}
    </do>
    <dont>
{dont_items}
    </dont>
  </{dim_key}>""")
        rubric_section = (
            "<creative_rubric>\n" + "\n".join(rubric_parts) + "\n</creative_rubric>"
        )
    else:
        rubric_section = "<creative_rubric>（未配置，请根据Brief信息和平台特性自行判断创意标准）</creative_rubric>"

    # ===== <compliance_rules> =====
    forbidden_words = rules_data.get("forbidden_words", [])
    efficacy_words = rules_data.get("efficacy_words", [])
    competitors = rules_data.get("competitors", [])
    whitelist = rules_data.get("whitelist", [])
    platform_rules = rules_data.get("platform_rules", {})

    rules_parts = []

    # 品牌方自定义违禁词
    if forbidden_words:
        fw_text = ", ".join(w["word"] for w in forbidden_words)
        rules_parts.append(
            f"  <custom_forbidden_words>品牌方配置的违禁词：{fw_text}</custom_forbidden_words>"
        )

    # 功效词
    if efficacy_words:
        ew_text = ", ".join(efficacy_words)
        rules_parts.append(
            f"  <efficacy_words>品牌方配置的功效词（禁止使用）：{ew_text}</efficacy_words>"
        )

    # 平台规则
    if platform_rules:
        pr_parts = []
        pf_words = platform_rules.get("forbidden_words", [])
        if pf_words:
            pr_parts.append(f"    <forbidden>{', '.join(pf_words)}</forbidden>")
        restricted = platform_rules.get("restricted_words", [])
        if restricted:
            for rw in restricted:
                pr_parts.append(
                    f'    <restricted word="{rw.get("word", "")}" condition="{rw.get("condition", "")}"/>'
                )
        content_reqs = platform_rules.get("content_requirements", [])
        if content_reqs:
            for cr in content_reqs:
                pr_parts.append(f"    <content_requirement>{cr}</content_requirement>")
        other_rules = platform_rules.get("other_rules", [])
        if other_rules:
            for or_ in other_rules:
                pr_parts.append(
                    f'    <other rule="{or_.get("rule", "")}">{or_.get("description", "")}</other>'
                )
        if pr_parts:
            rules_parts.append(
                f'  <platform_rules platform="{platform_label}">\n'
                + "\n".join(pr_parts)
                + "\n  </platform_rules>"
            )

    # 竞品
    if competitors:
        comp_parts = []
        for c in competitors:
            kws = ", ".join(c.get("keywords", []))
            comp_parts.append(f'    <competitor name="{c["name"]}" keywords="{kws}"/>')
        rules_parts.append(
            f"  <competitors>{content_label_short}中不得出现以下竞品品牌名或关联词：\n"
            + "\n".join(comp_parts)
            + "\n  </competitors>"
        )
    else:
        rules_parts.append(
            f"  <competitors>品牌方未配置竞品列表。品牌安全维度只需检查是否存在明显的品牌安全风险（如贬低行业、敏感政治话题等），不要猜测或自行判断哪些词是竞品。{content_label_short}中出现的产品名、品牌名均视为正常内容。</competitors>"
        )

    # 白名单
    if whitelist:
        rules_parts.append(
            f"  <whitelist>以下词语已获品牌方授权，不应标记为违规：{', '.join(whitelist)}</whitelist>"
        )

    compliance_section = (
        "<compliance_rules>\n" + "\n".join(rules_parts) + "\n</compliance_rules>"
    )

    # ===== <brand_learning> =====
    if learned_rules:
        lr_lines = []
        for lr in learned_rules:
            lr_lines.append(
                f'  <rule type="{lr["type"]}">{lr["pattern"]}（原因：{lr["reason"]}）</rule>'
            )
        learning_section = (
            "<brand_learning>\n  以下是该品牌的历史审核经验，在本次审核中必须参考：\n"
            + "\n".join(lr_lines)
            + "\n</brand_learning>"
        )
    else:
        learning_section = ""

    # ===== <script> / <video_content> =====
    script_section = f"""<{content_tag}>
{content}
</{content_tag}>"""

    # ===== <review_framework> =====
    review_framework = f"""<review_framework>
审核分三阶段进行：

第零阶段：内容类型判定
在开始审核之前，先判断这段{content_label_short}属于哪种广告类型：
- hard_ad（硬广）：产品测评、开箱、直接推荐、功能讲解、价格对比等直接以产品为主题的内容
- soft_ad（软广）：生活vlog植入、剧情植入、日常分享中自然带入产品、情感故事中提及品牌等
- mixed（混合）：前半段是生活/剧情内容，后半段转为产品推荐；或软性内容中穿插硬推段落
- viral（品牌曝光/病毒营销）：以创意、趣味、视觉冲击、情绪共鸣为主的高传播力内容，产品/品牌通过画面露出（logo、包装、产品出镜）呈现而非口播介绍。典型形式：变装/特效挑战、搞笑反转、舞蹈/音乐创意、情绪类短视频等。核心判断标准：内容的主要目的是娱乐传播而非产品信息传达
判定结果将影响后续审核标准的松紧度。

第一阶段：法务审核员
1. 法规合规：逐句检查是否存在广告法违规、功效承诺、虚假宣传
2. 平台规则：检查是否违反投放平台的内容规范
3. 品牌安全：检查是否出现竞品、其他品牌词、品牌安全风险

第二阶段：创意总监
4. Brief匹配：
   - 硬广/软广/混合：逐个检查卖点是否被{content_label_short}传达（语义匹配，不要求原文出现）
   - 所有内容类型都必须额外输出 top-level 的 brand_exposure 字段，评估品牌/产品是否被看见、被明确提及、以及相关内容占比是否足够
   - viral/品牌曝光：仍需在 selling_point_matches 中逐条返回 Brief 全部卖点的 matched=true/false，同时要把品牌曝光作为重点评估对象。品牌在画面中持续可见且自然融入即为高分（80+），品牌偶尔出现为中等分（60-79），品牌几乎不可见为低分（<60）
5. 内容质量：
   a. 按 creative_rubric 的 4 个维度（tone/audience/content_style/structure）逐条检查 do/dont，评估爆款潜力
   b. 受众匹配分析：根据内容风格、话题、用语、场景判断{content_label_short}的目标受众画像，与Brief中产品的目标受众对比，评估重合度。受众高度重合是加分项，受众完全错位是严重扣分项
   c. 文本质量检查：逐句检查错别字、语病、{"口误" if is_video else "标点符号错误"}、用词不当。发现时以 violation 形式报告（type="typo", dimension="内容质量"），包含原文、修正建议和位置
   d. viral/品牌曝光模式额外评估：创意新颖度（特效/变装/反转等手法的独创性）、情绪感染力（能否引发观众情绪共鸣）、平台原生感（是否契合目标平台的内容生态）、互动引导力（是否能引发评论/模仿/二创/分享）。这4项是viral内容质量的核心评分依据

每个维度先推理再给分，不允许直接打分。

通用召回要求：
- 先按句子/段落扫描，再按维度复核，避免只抓到最显眼的一两个问题
- 同一内容存在多个问题时必须全部列出，不要因为已有高风险问题就省略其他明显问题
- 不要把“场景错位 + 卖点缺失 + 产品命名错误 + 错别字”合并成一条 violation，必须拆开逐项返回
- 官方产品名错误、错别字/病句/标点错误、受众错位、场景错位、植入生硬，都应在有证据时单独指出
- core 卖点缺失只在 hard_ad 或 Brief 明确要求必须口播/明确覆盖时单独作为问题指出；soft_ad 不得因为未逐条口播 core 卖点而自动判违规
- 对视频口播审核，要同时参考口播文本、字幕/贴片文字、已审核通过脚本，不要只依赖单一来源
</review_framework>"""

    # ===== <output_format> =====
    # Build selling points format hint
    sp_format = ""
    if selling_points:
        sp_items = []
        for sp in selling_points:
            if sp["priority"] in ("core", "recommended"):
                sp_items.append(
                    f'{{"selling_point": "{sp["content"]}", "priority": "{sp["priority"]}", "analysis": "推理", "matched": true/false}}'
                )
        if sp_items:
            sp_format = ",\n            ".join(sp_items[:3])
            if len(sp_items) > 3:
                sp_format += ",\n            ..."

    output_format = """<output_format>
请严格按以下 JSON 格式返回（不要添加 markdown 代码块标记）：

{
  "content_type": {
    "type": "hard_ad/soft_ad/mixed/viral",
    "confidence": "high/medium/low",
    "reasoning": "判断依据"
  },
  "brand_exposure": {
    "score": 0-100,
    "level": "high/medium/low",
    "analysis": "品牌曝光分析",
    "visible_duration_seconds": 0,
    "mention_duration_seconds": 0,
    "related_duration_seconds": 0,
    "evidence": ["证据1", "证据2"]
  },
  "chain_of_thought": {
    "compliance_officer": {
      "legal": {
        "reasoning": [
          {"text": "原文片段", "analysis": "推理过程", "conclusion": "violation 或 acceptable", "severity": "high/medium/low"}
        ],
        "summary": "法规合规维度总结"
      },
      "platform": {
        "reasoning": [...],
        "summary": "平台规则维度总结"
      },
      "brand_safety": {
        "reasoning": [...],
        "summary": "品牌安全维度总结"
      }
    },
    "creative_director": {
      "brief_match": {
        "reasoning": [
          {"selling_point": "卖点原文", "priority": "core/recommended", "analysis": "推理", "matched": true/false}
        ],
        "summary": "卖点覆盖总结"
      },
      "content_quality": {
        "reasoning": {
          "tone": {"checklist": [{"criterion": "条目", "result": "pass/fail", "detail": "说明"}]},
          "audience": {"checklist": [...]},
          "content_style": {"checklist": [...]},
          "structure": {"checklist": [...]}
        },
        "highlights": ["亮点1", "亮点2"],
        "suggestions": ["建议1", "建议2"]
      }
    }
  },
  "conclusions": {
    "legal": {"score": 0-100, "passed": true/false, "issue_count": 0},
    "platform": {"score": 0-100, "passed": true/false, "issue_count": 0},
    "brand_safety": {"score": 0-100, "passed": true/false, "issue_count": 0},
    "brief_match": {"score": 0-100, "passed": true/false, "issue_count": 0},
    "content_quality": {
      "score": 0-100,
      "viral_potential": "high/medium/low",
      "viral_reason": "爆款潜力分析",
      "audience_match": "high/medium/low",
      "audience_analysis": "内容受众与产品受众的重合度分析",
      "overall_verdict": "excellent/good/acceptable/needs_improvement/needs_rework"
    },
    "violations": [
      {"dimension": "法规合规/平台规则/品牌安全", "content": "问题内容", "severity": "high/medium/low", "type": "forbidden_word/efficacy_claim/competitor_logo/brand_safety/platform_rule/false_advertising", "suggestion": "修改建议", "fixable": true/false},
      {"dimension": "内容质量", "content": "错别字原文", "severity": "low", "type": "typo", "suggestion": "应改为「正确写法」", "fixable": true}
    ],
    "selling_point_matches": [
      {"content": "卖点原文", "priority": "core/recommended", "matched": true/false, "evidence": "匹配依据"}
    ],
    "overall_score": 0-100,
    "overall_summary": "一句话总结"
  }
}

评分规则：
- 法规合规: 有 high severity violation → passed=false，分数根据违规严重程度扣减
- 平台规则: 有 violation → passed=false
- 品牌安全: 有 violation → passed=false，竞品直接提及是 fixable=false（致命）
- Brief匹配: 硬广/软广/混合模式下 core 卖点全部匹配才 passed=true；viral模式下改为评估品牌曝光度，品牌在画面中持续可见即 passed=true
- 内容质量: needs_rework 时分数应 < 50
- overall_score: 五个维度的加权平均，评分权重根据内容类型自动调整：
  - 硬广：法规合规30% + 平台规则15% + 品牌安全15% + Brief匹配25% + 内容质量15%
  - 软广：法规合规20% + 平台规则20% + 品牌安全15% + Brief匹配15% + 内容质量30%
  - 混合：法规合规25% + 平台规则18% + 品牌安全15% + Brief匹配20% + 内容质量22%
  - viral：法规合规15% + 平台规则15% + 品牌安全15% + Brief匹配(品牌曝光)15% + 内容质量40%
- Brief匹配评判标准根据内容类型调整：
  - 硬广：core卖点必须明确提及，recommended卖点建议覆盖
  - 软广：core卖点语义级覆盖即可（不要求原文），recommended卖点不做硬性要求
  - viral：仍需逐条展示卖点匹配结果，但 passed 与评分可重点参考品牌曝光度（logo/产品出镜比例、品牌可辨识度、融入自然度）
- brand_exposure 是所有内容类型都必须返回的独立字段：
  - 脚本审核：visible_duration_seconds 可为空，mention_duration_seconds / related_duration_seconds 在能估算时给值，无法判断则为 null
  - 视频审核：必须尽量给出 visible_duration_seconds、mention_duration_seconds、related_duration_seconds
  - level 规则：score >= 80 为 high，60-79 为 medium，<60 为 low
  - evidence 至少给出 1-3 条具体证据，说明品牌是如何被提及、展示或缺失的

violations 中的 fixable 字段：
- fixable=false（致命，必须修改）：竞品品牌名直接出现、严重虚假宣传、违反法律法规的硬性违规
- fixable=true（可修，建议优化）：用词可以更精准、表述可以更委婉、轻微的合规风险

输出要求补充：
- 每一个明确问题单独输出为一条 violation
- 如果内容类型是 hard_ad，或 Brief 明确要求必须覆盖某些 core 卖点，则缺失的 core 卖点应体现为独立结论或对应的 selling_point_matches=false；soft_ad 不要求逐条展开为违规
- 当 Brief/内容质量存在多项问题时，不允许只给一条笼统总结替代逐项问题
</output_format>"""

    # 组装完整 prompt
    parts = [
        system_section,
        roles_section,
        review_task_section,
        brief_section,
        rubric_section,
        compliance_section,
    ]
    if learning_section:
        parts.append(learning_section)
    parts.extend(
        [
            script_section,
            review_framework,
            output_format,
        ]
    )

    return "\n\n".join(parts)


def _parse_ai_response(
    ai_result: dict,
    brief_data: Optional[dict] = None,
) -> tuple[
    ChainOfThought,
    ReviewConclusions,
    list[Violation],
    list[SellingPointMatch],
    ReviewDimensions,
    Optional[ContentTypeDetection],
    Optional[BrandExposureAssessment],
]:
    """
    解析 AI 返回的 JSON 结果，构建 Pydantic 模型

    返回 (chain_of_thought, conclusions, violations, selling_point_matches, dimensions, content_type, brand_exposure)
    """
    # ===== 解析内容类型判定 =====
    content_type_data = ai_result.get("content_type")
    content_type: Optional[ContentTypeDetection] = None
    if content_type_data and isinstance(content_type_data, dict):
        content_type = ContentTypeDetection(
            type=content_type_data.get("type", "hard_ad"),
            confidence=content_type_data.get("confidence", "medium"),
            reasoning=content_type_data.get("reasoning", ""),
        )

    brand_exposure_data = ai_result.get("brand_exposure", {})
    brand_exposure: Optional[BrandExposureAssessment] = None
    if isinstance(brand_exposure_data, dict) and brand_exposure_data:
        brand_exposure = BrandExposureAssessment(
            score=brand_exposure_data.get("score"),
            level=brand_exposure_data.get("level", "medium"),
            analysis=brand_exposure_data.get("analysis", ""),
            visible_duration_seconds=brand_exposure_data.get("visible_duration_seconds"),
            mention_duration_seconds=brand_exposure_data.get("mention_duration_seconds"),
            related_duration_seconds=brand_exposure_data.get("related_duration_seconds"),
            evidence=brand_exposure_data.get("evidence", []) or [],
        )

    # ===== 解析 CoT =====
    cot_data = ai_result.get("chain_of_thought", {})

    # 法务审核员 CoT
    co_data = (
        cot_data.get("compliance_officer", {}) if isinstance(cot_data, dict) else {}
    )
    compliance_officer = ComplianceOfficerCoT()
    for dim_key in ("legal", "platform", "brand_safety"):
        dim_data = co_data.get(dim_key, {}) if isinstance(co_data, dict) else {}
        if not isinstance(dim_data, dict):
            dim_data = {}
        reasoning_list = []
        for r in dim_data.get("reasoning", []):
            if isinstance(r, str):
                r = {"text": r, "analysis": r, "conclusion": "acceptable"}
            if not isinstance(r, dict):
                continue
            reasoning_list.append(
                ComplianceReasoning(
                    text=r.get("text", ""),
                    analysis=r.get("analysis", ""),
                    conclusion=r.get("conclusion", "acceptable"),
                    severity=r.get("severity"),
                )
            )
        setattr(
            compliance_officer,
            dim_key,
            ComplianceDimensionCoT(
                reasoning=reasoning_list,
                summary=dim_data.get("summary", "")
                if isinstance(dim_data, dict)
                else "",
            ),
        )

    # 创意总监 CoT
    cd_data = (
        cot_data.get("creative_director", {}) if isinstance(cot_data, dict) else {}
    )
    if not isinstance(cd_data, dict):
        cd_data = {}
    bm_data = cd_data.get("brief_match", {})
    if not isinstance(bm_data, dict):
        bm_data = {}
    bm_reasoning = []
    for r in bm_data.get("reasoning", []):
        if isinstance(r, str):
            r = {"selling_point": r, "analysis": r, "matched": False}
        if not isinstance(r, dict):
            continue
        bm_reasoning.append(
            SellingPointReasoning(
                selling_point=r.get("selling_point", ""),
                priority=r.get("priority", "recommended"),
                analysis=r.get("analysis", ""),
                matched=r.get("matched", False),
            )
        )

    cq_data = cd_data.get("content_quality", {})
    if not isinstance(cq_data, dict):
        cq_data = {}
    creative_director = CreativeDirectorCoT(
        brief_match=BriefMatchCoT(
            reasoning=bm_reasoning,
            summary=bm_data.get("summary", ""),
        ),
        content_quality=ContentQualityCoT(
            reasoning=cq_data.get("reasoning"),
            highlights=cq_data.get("highlights", []),
            suggestions=cq_data.get("suggestions", []),
        ),
    )

    chain_of_thought = ChainOfThought(
        content_type=content_type,
        compliance_officer=compliance_officer,
        creative_director=creative_director,
    )

    # ===== 解析结论 =====
    conc = ai_result.get("conclusions", {})
    if not isinstance(conc, dict):
        conc = {}

    # 维度结论（防御非 dict 值）
    legal_conc = conc.get("legal", {}) or {}
    platform_conc = conc.get("platform", {}) or {}
    brand_safety_conc = conc.get("brand_safety", {}) or {}
    brief_match_conc = conc.get("brief_match", {}) or {}
    content_quality_conc = conc.get("content_quality", {}) or {}
    if not isinstance(legal_conc, dict):
        legal_conc = {}
    if not isinstance(platform_conc, dict):
        platform_conc = {}
    if not isinstance(brand_safety_conc, dict):
        brand_safety_conc = {}
    if not isinstance(brief_match_conc, dict):
        brief_match_conc = {}
    if not isinstance(content_quality_conc, dict):
        content_quality_conc = {}

    # 违规列表
    violations: list[Violation] = []
    for v in conc.get("violations", []):
        if not isinstance(v, dict):
            continue
        vtype_str = v.get("type", "brand_safety")
        try:
            vtype = ViolationType(vtype_str)
        except ValueError:
            vtype = ViolationType.BRAND_SAFETY

        severity_str = v.get("severity", "medium")
        try:
            severity = RiskLevel(severity_str)
        except ValueError:
            severity = RiskLevel.MEDIUM

        # 将 dimension 统一为中文（兼容 AI 返回英文或中文）
        raw_dim = v.get("dimension", "品牌安全")
        dim_cn = DIMENSION_EN_TO_CN.get(raw_dim, raw_dim)  # 英文→中文，已是中文则保持

        violations.append(
            Violation(
                type=vtype,
                content=v.get("content", ""),
                severity=severity,
                suggestion=v.get("suggestion", ""),
                dimension=dim_cn,
                fixable=v.get("fixable", True),
            )
        )

    # 卖点匹配
    selling_point_matches: list[SellingPointMatch] = []
    for spm in conc.get("selling_point_matches", []):
        if not isinstance(spm, dict):
            continue
        selling_point_matches.append(
            SellingPointMatch(
                content=spm.get("content", ""),
                priority=spm.get("priority", "recommended"),
                matched=spm.get("matched", False),
                evidence=spm.get("evidence", ""),
            )
        )

    selling_point_matches = _merge_selling_point_matches(
        brief_data=brief_data or {},
        selling_point_matches=selling_point_matches,
        content_type=content_type,
        brand_exposure=brand_exposure,
    )

    # 对 hard_ad 的 core 卖点缺失做显式补齐，避免 AI 只在 summary/soft_warnings 中提一句
    if content_type and content_type.type == "hard_ad":
        confidence = (getattr(content_type, "confidence", "") or "").strip().lower()
        should_enforce = confidence in ("high", "medium") or _brief_explicitly_requires_core_selling_points(brief_data or {})

        # content_type 误判（confidence=low）时，不强行补 violation，
        # 仅保留 selling_point_matches=false 供前端展示“未覆盖”。
        if should_enforce:
            existing_violation_text = "\n".join(
                filter(None, [f"{v.content} {v.suggestion}" for v in violations])
            )
            for spm in selling_point_matches:
                point_content = spm.content.strip()
                point_label = (
                    point_content.split("：", 1)[0].strip() if point_content else ""
                )
                if spm.priority != "core" or spm.matched or not point_content:
                    continue
                if point_content in existing_violation_text or (
                    point_label and point_label in existing_violation_text
                ):
                    continue
                violations.append(
                    Violation(
                        type=ViolationType.MENTION_MISSING,
                        content=f"核心卖点缺失：{point_content}",
                        severity=RiskLevel.MEDIUM,
                        suggestion=f"请在内容中明确补充该核心卖点，并给出自然的表达证据：{point_content}",
                        dimension="Brief匹配",
                        fixable=True,
                    )
                )

    legal_issue_count = max(
        legal_conc.get("issue_count", 0),
        sum(1 for v in violations if v.dimension == "法规合规"),
    )
    platform_issue_count = max(
        platform_conc.get("issue_count", 0),
        sum(1 for v in violations if v.dimension == "平台规则"),
    )
    brand_safety_issue_count = max(
        brand_safety_conc.get("issue_count", 0),
        sum(1 for v in violations if v.dimension == "品牌安全"),
    )
    brief_match_issue_count = max(
        brief_match_conc.get("issue_count", 0),
        sum(1 for v in violations if v.dimension == "Brief匹配"),
    )
    content_quality_issue_count = max(
        content_quality_conc.get("issue_count", 0),
        sum(1 for v in violations if v.dimension == "内容质量"),
    )

    # ReviewConclusions
    conclusions = ReviewConclusions(
        legal=DimensionConclusion(
            score=max(0, min(100, legal_conc.get("score", 100))),
            passed=legal_conc.get("passed", True),
            issue_count=legal_issue_count,
        ),
        platform=DimensionConclusion(
            score=max(0, min(100, platform_conc.get("score", 100))),
            passed=platform_conc.get("passed", True),
            issue_count=platform_issue_count,
        ),
        brand_safety=DimensionConclusion(
            score=max(0, min(100, brand_safety_conc.get("score", 100))),
            passed=brand_safety_conc.get("passed", True),
            issue_count=brand_safety_issue_count,
        ),
        brief_match=DimensionConclusion(
            score=max(0, min(100, brief_match_conc.get("score", 100))),
            passed=brief_match_conc.get("passed", True),
            issue_count=brief_match_issue_count,
        ),
        content_quality=ContentQualityConclusion(
            score=max(0, min(100, content_quality_conc.get("score", 70))),
            passed=content_quality_conc.get(
                "passed", content_quality_conc.get("score", 70) >= 60
            ),
            issue_count=content_quality_issue_count,
            viral_potential=content_quality_conc.get("viral_potential", "medium"),
            viral_reason=content_quality_conc.get("viral_reason", ""),
            audience_match=content_quality_conc.get("audience_match", "medium"),
            audience_analysis=content_quality_conc.get("audience_analysis", ""),
            overall_verdict=content_quality_conc.get("overall_verdict", "good"),
        ),
        violations=violations,
        selling_point_matches=selling_point_matches,
        overall_score=max(0, min(100, conc.get("overall_score", 70))),
        overall_summary=conc.get("overall_summary", ""),
    )

    # ReviewDimensions 简化视图
    dimensions = ReviewDimensions(
        legal=ReviewDimension(
            score=conclusions.legal.score,
            passed=conclusions.legal.passed,
            issue_count=conclusions.legal.issue_count,
        ),
        platform=ReviewDimension(
            score=conclusions.platform.score,
            passed=conclusions.platform.passed,
            issue_count=conclusions.platform.issue_count,
        ),
        brand_safety=ReviewDimension(
            score=conclusions.brand_safety.score,
            passed=conclusions.brand_safety.passed,
            issue_count=conclusions.brand_safety.issue_count,
        ),
        brief_match=ReviewDimension(
            score=conclusions.brief_match.score,
            passed=conclusions.brief_match.passed,
            issue_count=conclusions.brief_match.issue_count,
        ),
        content_quality=ReviewDimension(
            score=conclusions.content_quality.score,
            passed=conclusions.content_quality.overall_verdict != "needs_rework",
            issue_count=conclusions.content_quality.issue_count
            + sum(
                1 for v in violations if v.dimension in ("content_quality", "内容质量")
            ),
        ),
    )

    return (
        chain_of_thought,
        conclusions,
        violations,
        selling_point_matches,
        dimensions,
        content_type,
        brand_exposure,
    )


@router.post("/review", response_model=ScriptReviewResponse)
async def review_script(
    request: ScriptReviewRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> ScriptReviewResponse:
    """
    脚本预审 v2 — 结构化 AI 审核

    五维度：法规合规 / 平台规则 / 品牌安全 / Brief匹配 / 内容质量
    双角色 CoT：法务审核员 + 创意总监
    """
    content = request.content

    # 品牌方用户的 tenant_id 即 brand_id；前端可能传空字符串
    if not request.brand_id:
        request.brand_id = x_tenant_id

    # ===== Step 0: 文件解析（如提供文件 URL）=====
    if request.file_url and request.file_name:
        file_text = ""
        try:
            # 先尝试图片 PDF 检测
            if request.file_name.lower().endswith(".pdf"):
                images = (
                    await DocumentParser.download_and_get_images(
                        request.file_url, request.file_name
                    )
                    or []
                )
                if images:
                    logger.info(
                        f"脚本文件为图片型 PDF，提取 {len(images)} 页图片（待 vision 解析）"
                    )
                    # 图片型 PDF 暂不做 OCR，后续可扩展 vision 模型提取文本

            # 非图片型或非 PDF，走文本提取
            if not file_text:
                file_text = (
                    await DocumentParser.download_and_parse(
                        request.file_url, request.file_name
                    )
                    or ""
                )

            if file_text:
                content = content + "\n\n" + file_text if content.strip() else file_text
        except Exception as e:
            logger.warning(f"文件文本解析失败: {e}")

    # ===== Step 1: 获取所有上下文信息 =====

    # 1a. Brief 信息
    brief_data = await _get_brief_context(
        brand_id=request.brand_id,
        db=db,
        project_id=request.project_id,
        request_selling_points=request.selling_points,
        request_blacklist_words=request.blacklist_words,
    )

    # 1b. 规则信息
    whitelist = await get_whitelist_for_brand(x_tenant_id, request.brand_id, db)
    all_tenant_words = await get_forbidden_words_for_tenant(x_tenant_id, db)
    efficacy_words = [
        w["word"] for w in all_tenant_words if w.get("category") == "功效词"
    ]
    forbidden_words = [w for w in all_tenant_words if w.get("category") != "功效词"]
    competitors = await get_competitors_for_brand(x_tenant_id, request.brand_id, db)
    db_platform_rules = await get_active_platform_rules(
        x_tenant_id,
        request.brand_id,
        request.platform.value,
        db,
    )

    rules_data = {
        "forbidden_words": forbidden_words,
        "efficacy_words": efficacy_words,
        "competitors": competitors,
        "whitelist": whitelist,
        "platform_rules": db_platform_rules or {},
    }

    # 1c. 品牌学习档案
    learned_rules = await _get_brand_learned_rules(request.brand_id, db)

    # ===== Step 2: 获取 AI 客户端 =====
    try:
        ai_client = await AIServiceFactory.get_client(x_tenant_id, db)
        config = await AIServiceFactory.get_config(x_tenant_id, db)
    except Exception:
        ai_client = None
        config = None

    # ===== AI 不可用降级 =====
    if not ai_client:
        logger.warning(f"AI 服务不可用 (tenant={x_tenant_id})，返回降级响应")
        return ScriptReviewResponse(
            score=0,
            summary="AI 审核服务当前不可用，请稍后重试或联系管理员",
            ai_available=False,
            violations=[],
            selling_point_matches=[],
        )

    text_model = "gpt-4o"
    if config:
        text_model = config.models.get("text", "gpt-4o")

    # ===== Step 3: 构建结构化 prompt =====
    prompt = _build_structured_prompt(
        content=content,
        platform=request.platform.value,
        brief_data=brief_data,
        rules_data=rules_data,
        learned_rules=learned_rules,
        review_mode=request.review_mode,
    )

    # ===== Step 4: 单次 AI 调用 =====
    try:
        response = await ai_client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model=text_model,
            temperature=0.2,
            max_tokens=8000,
        )

        # 解析 AI 响应
        response_content = response.content.strip()
        # 清理可能的 markdown 代码块
        if response_content.startswith("```"):
            response_content = response_content.split("\n", 1)[1]
        if response_content.endswith("```"):
            response_content = response_content.rsplit("\n", 1)[0]

        ai_result = json.loads(response_content)
        # 防御双重 JSON 编码：中转服务可能把 JSON 再包一层字符串
        if isinstance(ai_result, str):
            ai_result = json.loads(ai_result)

    except json.JSONDecodeError as e:
        logger.error(f"AI 返回无法解析为 JSON: {e}")
        return ScriptReviewResponse(
            score=0,
            summary="AI 审核结果解析失败，请重试",
            ai_available=False,
            violations=[],
            selling_point_matches=[],
        )
    except Exception as e:
        logger.error(f"AI 审核调用失败: {type(e).__name__}: {e}")
        return ScriptReviewResponse(
            score=0,
            summary="AI 审核服务当前不可用，请稍后重试",
            ai_available=False,
            violations=[],
            selling_point_matches=[],
        )

    # ===== Step 5: 解析 AI 结果 =====
    (
        chain_of_thought,
        conclusions,
        violations,
        selling_point_matches,
        dimensions,
        content_type,
        brand_exposure,
    ) = _parse_ai_response(ai_result, brief_data=brief_data)

    # ===== Step 6: 构建响应 =====
    # 向后兼容 missing_points
    missing_points: list[str] | None = None
    if selling_point_matches:
        core_missing = [
            spm.content
            for spm in selling_point_matches
            if spm.priority == "core" and not spm.matched
        ]
        missing_points = core_missing if core_missing else []

    # 软性风控评估
    soft_warnings: list[SoftRiskWarning] = []
    if request.soft_risk_context:
        soft_warnings = evaluate_soft_risk(request.soft_risk_context)

    if missing_points:
        soft_warnings.append(
            SoftRiskWarning(
                code="missing_selling_points",
                message=f"核心卖点未覆盖：{', '.join(missing_points)}",
                action_required=SoftRiskAction.NOTE,
                blocking=False,
            )
        )

    return ScriptReviewResponse(
        score=conclusions.overall_score,
        summary=conclusions.overall_summary,
        content_type=content_type,
        chain_of_thought=chain_of_thought,
        conclusions=conclusions,
        dimensions=dimensions,
        violations=violations,
        selling_point_matches=selling_point_matches,
        brand_exposure=brand_exposure,
        missing_points=missing_points,
        soft_warnings=soft_warnings,
        ai_available=True,
    )
