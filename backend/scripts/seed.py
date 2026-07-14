"""
种子数据脚本
创建 demo 用户、组织关系、项目、Brief、任务、规则数据
支持幂等运行：已存在则跳过

用法：
  cd backend && python -m scripts.seed
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, insert, text
from sqlalchemy.ext.asyncio import AsyncSession

# 确保能找到 app 模块
sys.path.insert(0, ".")

from app.database import AsyncSessionLocal
from app.models import (
    User, UserRole, Brand, Agency, Creator,
    Project, Task, TaskStage, TaskStatus, Brief,
    ForbiddenWord, WhitelistItem, Competitor, AIConfig, Tenant,
    Message,
    brand_agency_association, agency_creator_association,
    project_agency_association,
)
from app.models.brand_learning import BrandLearnedRule


# ============================================================
# 固定 ID，方便前端 mock 数据对齐和反复运行幂等检查
# ============================================================
BRAND_USER_ID = "U100001"
AGENCY_USER_ID = "U100002"
CREATOR_USER_ID = "U100003"

BRAND_ID = "BR100001"
AGENCY_ID = "AG100001"
CREATOR_ID = "CR100001"

TENANT_ID = BRAND_ID  # 品牌方 = 租户

PROJECT_ID = "PJ100001"
BRIEF_ID = "BF100001"

TASK_IDS = ["TK100001", "TK100002", "TK100003", "TK100004"]

NOW = datetime.now(timezone.utc)


async def seed_data() -> None:
    async with AsyncSessionLocal() as db:
        # ========== 幂等检查 ==========
        result = await db.execute(
            select(User).where(User.phone == "13800000001")
        )
        if result.scalar_one_or_none():
            print("✅ 种子数据已存在，跳过创建")
            return

        print("🌱 开始创建种子数据...")

        # ========== 1. Demo 用户 ==========
        brand_user = User(
            id=BRAND_USER_ID,
            phone="13800000001",
            name="张明",
            role=UserRole.BRAND,
            is_active=True,
            is_verified=True,
        )
        agency_user = User(
            id=AGENCY_USER_ID,
            phone="13800000002",
            name="王丽",
            role=UserRole.AGENCY,
            is_active=True,
            is_verified=True,
        )
        creator_user = User(
            id=CREATOR_USER_ID,
            phone="13800000003",
            name="李小红",
            role=UserRole.CREATOR,
            is_active=True,
            is_verified=True,
        )
        db.add_all([brand_user, agency_user, creator_user])
        await db.flush()
        print("  ✓ 用户已创建: 13800000001(品牌) / 13800000002(代理) / 13800000003(达人)")

        # ========== 2. 组织实体 ==========
        brand = Brand(
            id=BRAND_ID,
            user_id=BRAND_USER_ID,
            name="ContentGuard Demo Brand",
            description="A demo brand for the ContentGuard AI portfolio environment",
            contact_name="张明",
            contact_phone="13800000001",
            final_review_enabled=True,
            is_active=True,
        )
        agency = Agency(
            id=AGENCY_ID,
            user_id=AGENCY_USER_ID,
            name="星辰传媒",
            description="星辰传媒是一家专业的内容营销代理商",
            contact_name="王丽",
            contact_phone="13800000002",
            force_pass_enabled=True,
            is_active=True,
        )
        creator = Creator(
            id=CREATOR_ID,
            user_id=CREATOR_USER_ID,
            name="李小红",
            bio="美妆博主，专注护肤分享，全网粉丝 50 万+",
            douyin_account="lixiaohong_dy",
            xiaohongshu_account="lixiaohong_xhs",
            is_active=True,
        )
        db.add_all([brand, agency, creator])
        await db.flush()
        print("  ✓ organizations created: ContentGuard Demo Brand / Northstar Media / Li Xiaohong")

        # ========== 3. 租户（兼容旧表） ==========
        tenant = Tenant(
            id=TENANT_ID,
            name="ContentGuard Demo Brand",
            is_active=True,
        )
        db.add(tenant)
        await db.flush()
        print("  ✓ tenant created: ContentGuard Demo Brand")

        # ========== 4. 组织关联关系 ==========
        await db.execute(
            insert(brand_agency_association).values(
                brand_id=BRAND_ID,
                agency_id=AGENCY_ID,
                is_active=True,
            )
        )
        await db.execute(
            insert(agency_creator_association).values(
                agency_id=AGENCY_ID,
                creator_id=CREATOR_ID,
                is_active=True,
            )
        )
        await db.flush()
        print("  ✓ 组织关系已建立: 品牌方 → 代理商 → 达人")

        # ========== 5. 项目 ==========
        project = Project(
            id=PROJECT_ID,
            brand_id=BRAND_ID,
            name="2026春季新品推广",
            description="春季新品防晒霜推广活动，面向 18-35 岁女性用户，重点投放抖音和小红书平台",
            platform="douyin",
            start_date=NOW,
            deadline=NOW + timedelta(days=30),
            status="active",
        )
        db.add(project)
        await db.flush()

        # 项目 → 代理商关联
        await db.execute(
            insert(project_agency_association).values(
                project_id=PROJECT_ID,
                agency_id=AGENCY_ID,
                is_active=True,
            )
        )
        await db.flush()
        print("  ✓ 项目已创建: 2026春季新品推广")

        # ========== 6. Brief ==========
        brief = Brief(
            id=BRIEF_ID,
            project_id=PROJECT_ID,
            selling_points=[
                {"content": "SPF50+ PA++++，超强防晒", "priority": "core"},
                {"content": "轻薄不油腻，适合日常通勤", "priority": "core"},
                {"content": "添加玻尿酸成分，防晒同时保湿", "priority": "recommended"},
                {"content": "获得皮肤科医生推荐", "priority": "reference"},
            ],
            blacklist_words=[
                {"word": "最好", "reason": "绝对化用语"},
                {"word": "第一", "reason": "绝对化用语"},
                {"word": "纯天然", "reason": "虚假宣传"},
            ],
            competitors=["安耐晒", "怡思丁", "薇诺娜"],
            brand_tone="年轻、活力、专业、可信赖",
            min_selling_points=2,
            min_duration=30,
            max_duration=60,
            other_requirements="请在视频中展示产品实际使用效果，包含户外场景拍摄",
            creative_rubric={
                "tone": {
                    "name": "年轻活力",
                    "do_items": ["使用轻松自然的口吻", "加入生活化场景描述", "体现产品使用乐趣"],
                    "dont_items": ["不要使用过于严肃的措辞", "避免说教式表达"],
                },
                "audience": {
                    "name": "18-35岁女性",
                    "do_items": ["围绕日常通勤防晒场景", "强调轻薄质地适合化妆前使用"],
                    "dont_items": ["不要假设用户不懂防晒", "避免使用过于专业的化学术语"],
                },
                "content_style": {
                    "name": "种草测评",
                    "do_items": ["展示真实上脸效果", "对比使用前后差异", "融入个人真实体验"],
                    "dont_items": ["不要纯念产品说明书", "避免过度滤镜美化效果"],
                },
                "structure": {
                    "name": "开箱种草",
                    "do_items": ["开头3秒设置悬念或痛点", "中间展示产品细节和使用", "结尾总结推荐理由"],
                    "dont_items": ["不要平铺直叙", "避免结尾太突兀"],
                },
            },
        )
        db.add(brief)
        await db.flush()
        print("  ✓ Brief 已创建")

        # ========== 7. 示例任务（4 种阶段） ==========
        tasks = [
            # TK-001: 等待上传脚本
            Task(
                id=TASK_IDS[0],
                project_id=PROJECT_ID,
                agency_id=AGENCY_ID,
                creator_id=CREATOR_ID,
                name="春季防晒霜种草视频(1)",
                sequence=1,
                stage=TaskStage.SCRIPT_UPLOAD,
            ),
            # TK-002: 脚本等待代理商审核
            Task(
                id=TASK_IDS[1],
                project_id=PROJECT_ID,
                agency_id=AGENCY_ID,
                creator_id=CREATOR_ID,
                name="春季防晒霜种草视频(2)",
                sequence=2,
                stage=TaskStage.SCRIPT_AGENCY_REVIEW,
                script_file_url="https://example.com/scripts/demo-script.pdf",
                script_file_name="防晒霜种草脚本v2.pdf",
                script_uploaded_at=NOW - timedelta(hours=2),
                script_ai_score=85,
                script_ai_result={
                    "score": 85,
                    "summary": "脚本整体符合要求，卖点覆盖充分",
                    "ai_available": True,
                    "dimensions": {
                        "legal": {"score": 100, "passed": True, "issue_count": 0},
                        "platform": {"score": 85, "passed": True, "issue_count": 1},
                        "brand_safety": {"score": 100, "passed": True, "issue_count": 0},
                        "brief_match": {"score": 80, "passed": True, "issue_count": 1},
                        "content_quality": {"score": 78, "passed": True, "issue_count": 1},
                    },
                    "chain_of_thought": {
                        "compliance_officer": {
                            "legal": {"observations": ["未发现法律违禁词"], "risk_assessment": "脚本中未包含绝对化用语、虚假宣传等法规违禁内容", "score": 100, "passed": True, "violations_found": 0},
                            "platform": {"observations": ["发现\"神器\"一词属于夸大宣传"], "risk_assessment": "\"神器\"在抖音平台被视为夸大宣传用语，可能触发平台审核", "score": 85, "passed": True, "violations_found": 1},
                            "brand_safety": {"observations": ["未提及竞品"], "risk_assessment": "脚本中无竞品品牌或产品的直接或间接提及", "score": 100, "passed": True, "violations_found": 0},
                        },
                        "creative_director": {
                            "brief_match": {
                                "selling_points": [
                                    {"content": "SPF50+ PA++++，超强防晒", "priority": "core", "matched": True, "evidence": "脚本中提到了SPF50+防晒参数"},
                                    {"content": "轻薄不油腻，适合日常通勤", "priority": "core", "matched": True, "evidence": "提到了轻薄质地不油腻"},
                                    {"content": "添加玻尿酸成分，防晒同时保湿", "priority": "recommended", "matched": False, "evidence": "未提及玻尿酸成分"},
                                ],
                                "overall_assessment": "核心卖点覆盖良好，推荐卖点玻尿酸成分未提及",
                                "score": 80,
                                "passed": True,
                            },
                            "content_quality": {
                                "rubric_checks": [
                                    {"dimension": "tone", "passed": True, "note": "语言轻松自然，符合年轻活力调性"},
                                    {"dimension": "audience", "passed": True, "note": "场景贴合日常通勤"},
                                    {"dimension": "content_style", "passed": False, "note": "缺少真实上脸效果展示环节"},
                                    {"dimension": "structure", "passed": True, "note": "开头设置了防晒痛点"},
                                ],
                                "creative_assessment": "整体创意表现良好，但缺少真实使用效果展示",
                                "viral_assessment": "卖点覆盖良好但缺少使用效果展示，降低了种草说服力",
                                "score": 78,
                            },
                        },
                    },
                    "conclusions": {
                        "legal": {"score": 100, "passed": True, "issue_count": 0},
                        "platform": {"score": 85, "passed": True, "issue_count": 1},
                        "brand_safety": {"score": 100, "passed": True, "issue_count": 0},
                        "brief_match": {"score": 80, "passed": True, "issue_count": 1},
                        "content_quality": {
                            "score": 78,
                            "passed": True,
                            "issue_count": 1,
                            "viral_potential": "medium",
                            "viral_reason": "卖点覆盖良好但缺少使用效果展示，降低了种草说服力",
                            "overall_verdict": "good",
                        },
                        "violations": [
                            {"type": "forbidden_word", "content": "神器", "severity": "medium", "suggestion": "建议替换为\"好物\"", "dimension": "platform", "fixable": True},
                        ],
                        "selling_point_matches": [
                            {"content": "SPF50+ PA++++，超强防晒", "priority": "core", "matched": True, "evidence": "脚本中提到了SPF50+防晒参数"},
                            {"content": "轻薄不油腻，适合日常通勤", "priority": "core", "matched": True, "evidence": "提到了轻薄质地不油腻"},
                            {"content": "添加玻尿酸成分，防晒同时保湿", "priority": "recommended", "matched": False, "evidence": "未提及玻尿酸成分"},
                        ],
                        "soft_warnings": [
                            {"type": "suggestion", "content": "建议增加产品成分说明", "suggestion": "可提及玻尿酸等核心成分"},
                        ],
                    },
                    "violations": [
                        {"type": "forbidden_word", "content": "神器", "severity": "medium", "suggestion": "建议替换为\"好物\"", "dimension": "platform", "fixable": True},
                    ],
                    "selling_point_matches": [
                        {"content": "SPF50+ PA++++，超强防晒", "priority": "core", "matched": True, "evidence": "脚本中提到了SPF50+防晒参数"},
                        {"content": "轻薄不油腻，适合日常通勤", "priority": "core", "matched": True, "evidence": "提到了轻薄质地不油腻"},
                        {"content": "添加玻尿酸成分，防晒同时保湿", "priority": "recommended", "matched": False, "evidence": "未提及玻尿酸成分"},
                    ],
                    "soft_warnings": [
                        {"type": "suggestion", "content": "建议增加产品成分说明", "suggestion": "可提及玻尿酸等核心成分"},
                    ],
                },
                script_ai_reviewed_at=NOW - timedelta(hours=1),
            ),
            # TK-003: 脚本已通过，等待上传视频
            Task(
                id=TASK_IDS[2],
                project_id=PROJECT_ID,
                agency_id=AGENCY_ID,
                creator_id=CREATOR_ID,
                name="春季防晒霜种草视频(3)",
                sequence=3,
                stage=TaskStage.VIDEO_UPLOAD,
                script_file_url="https://example.com/scripts/demo-script-3.pdf",
                script_file_name="防晒霜种草脚本v3.pdf",
                script_uploaded_at=NOW - timedelta(days=2),
                script_ai_score=92,
                script_ai_result={
                    "score": 92,
                    "summary": "脚本质量优秀，完全符合 Brief 要求",
                    "ai_available": True,
                    "dimensions": {
                        "legal": {"score": 100, "passed": True, "issue_count": 0},
                        "platform": {"score": 100, "passed": True, "issue_count": 0},
                        "brand_safety": {"score": 100, "passed": True, "issue_count": 0},
                        "brief_match": {"score": 90, "passed": True, "issue_count": 0},
                        "content_quality": {"score": 88, "passed": True, "issue_count": 0},
                    },
                    "conclusions": {
                        "legal": {"score": 100, "passed": True, "issue_count": 0},
                        "platform": {"score": 100, "passed": True, "issue_count": 0},
                        "brand_safety": {"score": 100, "passed": True, "issue_count": 0},
                        "brief_match": {"score": 90, "passed": True, "issue_count": 0},
                        "content_quality": {
                            "score": 88, "passed": True, "issue_count": 0,
                            "viral_potential": "high",
                            "viral_reason": "卖点全覆盖，使用场景真实，种草说服力强",
                            "overall_verdict": "excellent",
                        },
                        "violations": [],
                        "selling_point_matches": [
                            {"content": "SPF50+ PA++++，超强防晒", "priority": "core", "matched": True, "evidence": "脚本完整提及防晒参数"},
                            {"content": "轻薄不油腻，适合日常通勤", "priority": "core", "matched": True, "evidence": "详细描述了质地体验"},
                            {"content": "添加玻尿酸成分，防晒同时保湿", "priority": "recommended", "matched": True, "evidence": "提及了玻尿酸保湿功能"},
                        ],
                        "soft_warnings": [],
                    },
                    "selling_point_matches": [
                        {"content": "SPF50+ PA++++，超强防晒", "priority": "core", "matched": True, "evidence": "脚本完整提及防晒参数"},
                        {"content": "轻薄不油腻，适合日常通勤", "priority": "core", "matched": True, "evidence": "详细描述了质地体验"},
                        {"content": "添加玻尿酸成分，防晒同时保湿", "priority": "recommended", "matched": True, "evidence": "提及了玻尿酸保湿功能"},
                    ],
                    "violations": [],
                    "soft_warnings": [],
                },
                script_ai_reviewed_at=NOW - timedelta(days=2),
                script_agency_status=TaskStatus.PASSED,
                script_agency_comment="脚本内容不错，可以进入拍摄",
                script_agency_reviewer_id=AGENCY_USER_ID,
                script_agency_reviewed_at=NOW - timedelta(days=1),
                script_brand_status=TaskStatus.PASSED,
                script_brand_comment="同意",
                script_brand_reviewer_id=BRAND_USER_ID,
                script_brand_reviewed_at=NOW - timedelta(days=1),
            ),
            # TK-004: 已完成
            Task(
                id=TASK_IDS[3],
                project_id=PROJECT_ID,
                agency_id=AGENCY_ID,
                creator_id=CREATOR_ID,
                name="春季防晒霜种草视频(4)",
                sequence=4,
                stage=TaskStage.COMPLETED,
                script_file_url="https://example.com/scripts/demo-script-4.pdf",
                script_file_name="防晒霜种草脚本v4.pdf",
                script_uploaded_at=NOW - timedelta(days=7),
                script_ai_score=90,
                script_ai_result={
                    "score": 90,
                    "summary": "符合要求",
                    "ai_available": True,
                    "dimensions": {
                        "legal": {"score": 100, "passed": True, "issue_count": 0},
                        "platform": {"score": 100, "passed": True, "issue_count": 0},
                        "brand_safety": {"score": 100, "passed": True, "issue_count": 0},
                        "brief_match": {"score": 85, "passed": True, "issue_count": 0},
                        "content_quality": {"score": 85, "passed": True, "issue_count": 0},
                    },
                    "selling_point_matches": [],
                    "violations": [],
                    "soft_warnings": [],
                },
                script_ai_reviewed_at=NOW - timedelta(days=7),
                script_agency_status=TaskStatus.PASSED,
                script_agency_comment="通过",
                script_agency_reviewer_id=AGENCY_USER_ID,
                script_agency_reviewed_at=NOW - timedelta(days=6),
                script_brand_status=TaskStatus.PASSED,
                script_brand_comment="通过",
                script_brand_reviewer_id=BRAND_USER_ID,
                script_brand_reviewed_at=NOW - timedelta(days=6),
                video_file_url="https://example.com/videos/demo-video-4.mp4",
                video_file_name="防晒霜种草视频v4.mp4",
                video_duration=45,
                video_uploaded_at=NOW - timedelta(days=5),
                video_ai_score=88,
                video_ai_result={
                    "score": 88,
                    "summary": "视频质量良好",
                    "ai_available": True,
                    "dimensions": {
                        "legal": {"score": 100, "passed": True, "issue_count": 0},
                        "platform": {"score": 100, "passed": True, "issue_count": 0},
                        "brand_safety": {"score": 85, "passed": True, "issue_count": 0},
                        "brief_match": {"score": 80, "passed": True, "issue_count": 0},
                        "content_quality": {"score": 82, "passed": True, "issue_count": 0},
                    },
                    "selling_point_matches": [],
                    "violations": [],
                    "soft_warnings": [],
                },
                video_ai_reviewed_at=NOW - timedelta(days=5),
                video_agency_status=TaskStatus.PASSED,
                video_agency_comment="视频效果好",
                video_agency_reviewer_id=AGENCY_USER_ID,
                video_agency_reviewed_at=NOW - timedelta(days=4),
                video_brand_status=TaskStatus.PASSED,
                video_brand_comment="终审通过",
                video_brand_reviewer_id=BRAND_USER_ID,
                video_brand_reviewed_at=NOW - timedelta(days=3),
            ),
        ]
        db.add_all(tasks)
        await db.flush()
        print("  ✓ 任务已创建: TK100001~TK100004 (4种阶段)")

        # ========== 8. 规则数据 ==========
        forbidden_words = [
            ForbiddenWord(id="FW100001", tenant_id=TENANT_ID, word="假药", category="法规违禁", severity="high"),
            ForbiddenWord(id="FW100002", tenant_id=TENANT_ID, word="虚假宣传", category="法规违禁", severity="high"),
            ForbiddenWord(id="FW100003", tenant_id=TENANT_ID, word="最好", category="绝对化用语", severity="medium"),
            ForbiddenWord(id="FW100004", tenant_id=TENANT_ID, word="第一", category="绝对化用语", severity="medium"),
            ForbiddenWord(id="FW100005", tenant_id=TENANT_ID, word="纯天然", category="虚假宣传", severity="medium"),
            # 功效词（品牌方可自行增删）
            ForbiddenWord(id="FW100006", tenant_id=TENANT_ID, word="根治", category="功效词", severity="high"),
            ForbiddenWord(id="FW100007", tenant_id=TENANT_ID, word="治愈", category="功效词", severity="high"),
            ForbiddenWord(id="FW100008", tenant_id=TENANT_ID, word="治疗", category="功效词", severity="high"),
            ForbiddenWord(id="FW100009", tenant_id=TENANT_ID, word="药效", category="功效词", severity="high"),
            ForbiddenWord(id="FW100010", tenant_id=TENANT_ID, word="疗效", category="功效词", severity="high"),
            ForbiddenWord(id="FW100011", tenant_id=TENANT_ID, word="特效", category="功效词", severity="high"),
        ]
        db.add_all(forbidden_words)
        await db.flush()
        print("  ✓ 违禁词已创建: 11 条（含 6 条功效词）")

        competitors = [
            Competitor(id="CP100001", tenant_id=TENANT_ID, brand_id=BRAND_ID, name="安耐晒", keywords=["安耐晒", "ANESSA", "资生堂防晒"]),
            Competitor(id="CP100002", tenant_id=TENANT_ID, brand_id=BRAND_ID, name="怡思丁", keywords=["怡思丁", "ISDIN"]),
            Competitor(id="CP100003", tenant_id=TENANT_ID, brand_id=BRAND_ID, name="薇诺娜", keywords=["薇诺娜", "WINONA"]),
        ]
        db.add_all(competitors)
        await db.flush()
        print("  ✓ 竞品已创建: 3 条")

        whitelist_items = [
            WhitelistItem(id="WL100001", tenant_id=TENANT_ID, brand_id=BRAND_ID, term="SPF50+", reason="产品实际参数，非夸大宣传"),
            WhitelistItem(id="WL100002", tenant_id=TENANT_ID, brand_id=BRAND_ID, term="PA++++", reason="产品实际参数，非夸大宣传"),
        ]
        db.add_all(whitelist_items)
        await db.flush()
        print("  ✓ 白名单已创建: 2 条")

        # ========== 8.5. 品牌学习档案 ==========
        learned_rules = [
            BrandLearnedRule(
                id="LR100001",
                brand_id=BRAND_ID,
                type="allowed_expression",
                pattern="口语化的\"超好用\"\"绝了\"等种草类表达在非正式种草内容中可以接受",
                reason="品牌定位偏向年轻消费者，种草内容需要真实自然的表达，过于正式反而降低说服力",
                source_task=TASK_IDS[2],
                created_by="ai_learning",
            ),
            BrandLearnedRule(
                id="LR100002",
                brand_id=BRAND_ID,
                type="false_positive",
                pattern="\"第一次用就爱上\"不构成绝对化用语，属于个人感受描述",
                reason="这是主观感受的描述而非客观功效宣称，不违反广告法相关规定",
                source_task=TASK_IDS[3],
                created_by="ai_learning",
            ),
        ]
        db.add_all(learned_rules)
        await db.flush()
        print("  ✓ 品牌学习规则已创建: 2 条")

        # ========== 9. AI 配置（模板） ==========
        ai_config = AIConfig(
            tenant_id=TENANT_ID,
            provider="oneapi",
            base_url="https://api.example.com/v1",
            api_key_encrypted="demo-placeholder-key",
            models={"text": "gpt-4o", "vision": "gpt-4o", "audio": "whisper-1"},
            temperature=0.7,
            max_tokens=4096,
            is_configured=False,
        )
        db.add(ai_config)
        await db.flush()
        print("  ✓ AI 配置模板已创建")

        # ========== 10. 示例消息 ==========
        messages = [
            # 达人消息
            Message(
                id="MSG100001",
                user_id=CREATOR_USER_ID,
                type="new_task",
                title="新任务分配",
                content="您有新的任务「春季防晒霜种草视频(1)」，来自项目「2026春季新品推广」",
                is_read=False,
                related_task_id=TASK_IDS[0],
                related_project_id=PROJECT_ID,
                sender_name="星辰传媒",
            ),
            Message(
                id="MSG100002",
                user_id=CREATOR_USER_ID,
                type="pass",
                title="脚本审核通过",
                content="您的任务「春季防晒霜种草视频(3)」脚本已被通过",
                is_read=True,
                related_task_id=TASK_IDS[2],
                sender_name="星辰传媒",
            ),
            Message(
                id="MSG100003",
                user_id=CREATOR_USER_ID,
                type="system_notice",
                title="系统通知",
                content="平台违禁词库已更新，请在创作时注意避免使用新增的违禁词",
                is_read=True,
            ),
            # 代理商消息
            Message(
                id="MSG100004",
                user_id=AGENCY_USER_ID,
                type="new_task",
                title="新脚本提交",
                content="达人「李小红」提交了「春季防晒霜种草视频(2)」脚本，请及时审核",
                is_read=False,
                related_task_id=TASK_IDS[1],
                sender_name="李小红",
            ),
            Message(
                id="MSG100005",
                user_id=AGENCY_USER_ID,
                type="pass",
                title="品牌终审通过",
                content="任务「春季防晒霜种草视频(4)」已通过品牌方终审",
                is_read=True,
                related_task_id=TASK_IDS[3],
                sender_name="ContentGuard Demo Brand",
            ),
            # 品牌方消息
            Message(
                id="MSG100006",
                user_id=BRAND_USER_ID,
                type="new_task",
                title="脚本待终审",
                content="「星辰传媒」的达人「李小红」脚本已通过代理商审核，请进行终审",
                is_read=False,
                related_task_id=TASK_IDS[1],
                sender_name="星辰传媒",
            ),
            Message(
                id="MSG100007",
                user_id=BRAND_USER_ID,
                type="system_notice",
                title="项目创建成功",
                content="您的项目「2026春季新品推广」已创建成功",
                is_read=True,
                related_project_id=PROJECT_ID,
            ),
        ]
        db.add_all(messages)
        await db.flush()
        print("  ✓ 示例消息已创建: 7 条 (达人3 + 代理商2 + 品牌方2)")

        # ========== 提交 ==========
        await db.commit()
        print("\n🎉 种子数据创建完成！")
        print("=" * 50)
        print("Demo 账号:")
        print("  品牌方: 13800000001 / demo123")
        print("  代理商: 13800000002 / demo123")
        print("  达人:   13800000003 / demo123")
        print("=" * 50)


def main():
    asyncio.run(seed_data())


if __name__ == "__main__":
    main()
