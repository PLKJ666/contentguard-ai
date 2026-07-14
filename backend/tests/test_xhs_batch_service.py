from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.models.xhs import (
    XHSBatchItem,
    XHSBatchJob,
    XHSBriefPack,
    XHSDirectionItem,
    XHSProject,
    XHSProjectVariant,
    XHSRulePack,
)
from app.services.xhs_batch_service import (
    _context_to_prompt_text,
    _load_xhs_rewrite_context,
    _run_editor_ai,
    XHSRewriteContext,
    process_xhs_batch_item,
    split_xhs_source_text,
)


@pytest.mark.asyncio
async def test_process_xhs_batch_item_falls_back_without_ai(test_db_session):
    job = XHSBatchJob(
        id="job-1",
        tenant_id="tenant-1",
        created_by="user-1",
        status="running",
        category_id="beauty",
        run_mode="trial",
        input_type="text",
        tag_policy_json={"max_count": 5},
        total_items=1,
        done_items=0,
        running_items=1,
    )
    item = XHSBatchItem(
        id="item-row-1",
        batch_id=job.id,
        item_id="item_001",
        source_text="标题行\n正文段落A\n正文段落B",
        source_title_guess="标题行",
        status="running",
        round=0,
    )

    result = await process_xhs_batch_item(
        tenant_id="tenant-without-ai",
        db=test_db_session,
        job=job,
        item=item,
    )

    assert result["verifier_pass"] is True
    assert result["safe_rewrite_used"] is False
    assert result["final_title"] == "标题行"
    assert "正文段落A" in result["final_body"]
    assert result["actual_tokens"] == 0


@pytest.mark.asyncio
async def test_process_xhs_batch_item_uses_safe_rewrite_after_retries(test_db_session, monkeypatch):
    job = XHSBatchJob(
        id="job-2",
        tenant_id="tenant-2",
        created_by="user-2",
        status="running",
        category_id="beauty",
        run_mode="trial",
        input_type="text",
        tag_policy_json={"max_count": 5},
        total_items=1,
        done_items=0,
        running_items=1,
    )
    item = XHSBatchItem(
        id="item-row-2",
        batch_id=job.id,
        item_id="item_002",
        source_text="最好用的方案\n这款真的最好",
        source_title_guess="最好用的方案",
        status="running",
        round=0,
    )

    async def fake_editor(*args, **kwargs):
        return {
            "title": "最好用的方案",
            "body": "这款真的最好",
            "hashtags": ["#推荐"],
            "strategy": "rewrite",
        }, 42

    async def fake_verifier(*args, **kwargs):
        return {
            "pass": False,
            "confidence": 0.6,
            "issues": [{"term": "最好", "reason": "绝对化表达"}],
            "needs_safe_rewrite": True,
            "summary": "不通过",
        }, 24

    monkeypatch.setattr("app.services.xhs_batch_service._run_editor_ai", fake_editor)
    monkeypatch.setattr("app.services.xhs_batch_service._run_verifier_ai", fake_verifier)

    result = await process_xhs_batch_item(
        tenant_id="tenant-2",
        db=test_db_session,
        job=job,
        item=item,
    )

    assert result["safe_rewrite_used"] is True
    assert result["safe_rewrite_reason"] == "max_rounds_exceeded"
    assert "最好" not in result["final_title"]
    assert "最好" not in result["final_body"]
    assert result["verifier_confidence"] == Decimal("0.9000")
    assert result["actual_tokens"] == 198


@pytest.mark.asyncio
async def test_split_xhs_source_text_uses_ai_model_when_rule_confidence_is_weak(test_db_session, monkeypatch):
    class FakeClient:
        async def chat_completion(self, **kwargs):
            return SimpleNamespace(
                content="""```json
                {
                  "notes": [
                    {"title_guess": "第一篇", "content": "第一篇标题\\n第一篇正文", "boundary_confidence": 0.93},
                    {"title_guess": "第二篇", "content": "第二篇标题\\n第二篇正文", "boundary_confidence": 0.88}
                  ]
                }
                ```""",
                usage={"total_tokens": 123},
            )

    async def fake_get_client(*args, **kwargs):
        return FakeClient()

    async def fake_get_config(*args, **kwargs):
        return SimpleNamespace(
            models={"xhs_split": "split-model"},
            temperature=0.2,
            max_tokens=2000,
        )

    monkeypatch.setattr("app.services.xhs_batch_service.AIServiceFactory.get_client", fake_get_client)
    monkeypatch.setattr("app.services.xhs_batch_service.AIServiceFactory.get_config", fake_get_config)

    notes, meta = await split_xhs_source_text(
        tenant_id="tenant-3",
        db=test_db_session,
        source_text="第一篇标题\n第一篇正文\n第二篇正文也在这里，没有明显分隔。",
    )

    assert len(notes) == 2
    assert notes[0]["split_by"] == "ai_assisted"
    assert notes[0]["title_guess"] == "第一篇"
    assert meta["split_strategy"] == "ai_assisted"
    assert meta["split_model"] == "split-model"
    assert meta["split_tokens"] == 123


async def _seed_direction_context(session):
    project = XHSProject(
        id="project-1",
        tenant_id="tenant-ctx",
        name="晨间底妆项目",
        category_id="beauty",
        product_name="轻感粉底液",
        project_brief="围绕通勤底妆做种草，强调自然服帖和持妆稳定。",
        shared_requirements="语气自然\n避免医疗功效\n不要夸张承诺",
        created_by="user-ctx",
    )
    variant = XHSProjectVariant(
        id="variant-main-1",
        tenant_id="tenant-ctx",
        project_id=project.id,
        name="金标",
        selling_points="清透持妆\n通勤不斑驳",
        appearance_notes="金色瓶盖",
        notes="优先讲全天通勤场景",
        is_primary=True,
        created_by="user-ctx",
    )
    direction = XHSDirectionItem(
        id="direction-1",
        tenant_id="tenant-ctx",
        project_id=project.id,
        name="夜间通勤妆",
        status="active",
        main_variant_id=variant.id,
        secondary_variant_ids_json=[],
        content_style="真实体验",
        direction_brief="突出下班到夜间聚会也能稳住底妆，不要走成成分科普。",
        extra_requirements="必须提到清透持妆\n避免绝对化承诺",
        notes="以通勤场景起笔",
        created_by="user-ctx",
    )
    rule_pack = XHSRulePack(
        id="rule-pack-1",
        tenant_id="tenant-ctx",
        category_id="beauty",
        name="美妆合规规则",
        version="v1",
        status="active",
        pack_json={
            "banned_terms": ["夸张承诺", "绝不脱妆"],
            "replace_map": {"绝不脱妆": "更稳妆"},
            "format_rules": {"tone": "真实体验"},
            "structure_rules": {"opening": "先场景后结论"},
        },
        created_by="user-ctx",
    )
    brief_pack = XHSBriefPack(
        id="brief-pack-1",
        tenant_id="tenant-ctx",
        category_id="beauty",
        brand_name="某品牌",
        version="v1",
        status="active",
        source_type="upload",
        pack_json={
            "selling_point_priority": [
                {"text": "清透持妆", "priority": "p1"},
                {"text": "通勤不斑驳", "priority": "p2"},
            ],
            "recommended_phrasings": ["真实通勤反馈", "底妆轻薄"],
            "forbidden_phrasings": ["夸张承诺"],
        },
        created_by="user-ctx",
    )
    session.add_all([project, variant, direction, rule_pack, brief_pack])
    await session.commit()


async def _seed_strict_health_direction_context(session):
    project = XHSProject(
        id="project-health-1",
        tenant_id="tenant-health",
        name="AKK益生菌项目",
        category_id="health",
        product_name="innerhealth茵澳斯AKK",
        project_brief="围绕金标和银标做报备科普，表达要克制。",
        shared_requirements="需提及300亿AKK菌\n灭活AKK菌比活菌更安全有效",
        created_by="user-health",
    )
    main_variant = XHSProjectVariant(
        id="variant-health-main",
        tenant_id="tenant-health",
        project_id=project.id,
        name="AKK金标",
        selling_points="每粒含300亿AKK MucT原研菌株\n灭活AKK菌工艺安心有效",
        appearance_notes="瓶装胶囊",
        notes="报备开白仅可写调节代谢，且必须单独成句，绝不能与产品或AKK同句或相邻; 首提必须全称innerhealth茵澳斯 AKK 金标; 绝对禁用安全、温和、体重等词。",
        is_primary=True,
        created_by="user-health",
    )
    secondary_variant = XHSProjectVariant(
        id="variant-health-secondary",
        tenant_id="tenant-health",
        project_id=project.id,
        name="银标",
        selling_points="150亿AKK MucT原研菌株\nB420+益生元三生元配方",
        appearance_notes="瓶装胶囊",
        notes="银标只作系列补充或微调参考，不要展开写。",
        is_primary=False,
        created_by="user-health",
    )
    direction = XHSDirectionItem(
        id="direction-health-1",
        tenant_id="tenant-health",
        project_id=project.id,
        name="AKK报备开白",
        status="active",
        main_variant_id=main_variant.id,
        secondary_variant_ids_json=[secondary_variant.id],
        content_style="报备开白",
        direction_brief="重点讲清大基数优先金标，小基数或微调需求可补充银标；产品名与作用分句表达，不直接强绑功效。",
        extra_requirements="仅可使用调节代谢描述作用，且与产品名分句表达\n银标只作系列补充或微调参考，不要混写功效",
        notes="2026-03-31 strict rewrite guardrails",
        created_by="user-health",
    )
    brief_pack = XHSBriefPack(
        id="brief-pack-health-1",
        tenant_id="tenant-health",
        category_id="health",
        brand_name="innerhealth茵澳斯",
        version="v1",
        status="active",
        source_type="upload",
        pack_json={
            "selling_point_priority": [
                {"text": "每粒含300亿AKK MucT原研菌株", "priority": "p1"},
                {"text": "灭活AKK菌工艺", "priority": "p2"},
            ],
            "recommended_phrasings": ["认清基数对号入座"],
            "forbidden_phrasings": ["安全有效"],
        },
        created_by="user-health",
    )
    session.add_all([project, main_variant, secondary_variant, direction, brief_pack])
    await session.commit()


@pytest.mark.asyncio
async def test_process_xhs_batch_item_includes_direction_and_selling_points_in_prompts(test_db_session, monkeypatch):
    await _seed_direction_context(test_db_session)

    job = XHSBatchJob(
        id="job-ctx-1",
        tenant_id="tenant-ctx",
        created_by="user-ctx",
        status="running",
        category_id="beauty",
        direction_id="direction-1",
        rule_pack_version="v1",
        brief_pack_id="brief-pack-1",
        run_mode="trial",
        input_type="text",
        tag_policy_json={"max_count": 6},
        total_items=1,
        done_items=0,
        running_items=1,
    )
    item = XHSBatchItem(
        id="item-row-ctx-1",
        batch_id=job.id,
        item_id="item_001",
        source_text="今天通勤到晚上都还在线的底妆分享",
        source_title_guess="通勤底妆分享",
        status="running",
        round=0,
    )

    prompts: list[str] = []

    class FakeClient:
        async def chat_completion(self, **kwargs):
            prompts.append(kwargs["messages"][0]["content"])
            if len(prompts) == 1:
                return SimpleNamespace(
                    content=json_payload(
                        {
                            "title": "通勤到底也稳住的底妆",
                            "body": "今天重点聊清透持妆这件事，下班去聚会妆面也没有斑驳。",
                            "hashtags": ["#底妆", "#通勤妆"],
                            "strategy": "rewrite",
                        }
                    ),
                    usage={"total_tokens": 88},
                )
            return SimpleNamespace(
                content=json_payload(
                    {
                        "pass": True,
                        "confidence": 0.96,
                        "issues": [],
                        "needs_safe_rewrite": False,
                        "summary": "通过",
                        "direction_alignment": {"passed": True, "reason": "符合方向", "violations": []},
                        "selling_point_alignment": {
                            "passed": True,
                            "required_points": ["清透持妆"],
                            "covered_points": ["清透持妆"],
                            "missing_points": [],
                            "reason": "卖点吻合",
                        },
                    }
                ),
                usage={"total_tokens": 55},
            )

    def json_payload(payload):
        import json
        return json.dumps(payload, ensure_ascii=False)

    async def fake_get_client(*args, **kwargs):
        return FakeClient()

    async def fake_get_config(*args, **kwargs):
        return SimpleNamespace(
            models={"xhs_editor": "editor-model", "xhs_verifier": "verifier-model"},
            temperature=0.4,
            max_tokens=1200,
        )

    monkeypatch.setattr("app.services.xhs_batch_service.AIServiceFactory.get_client", fake_get_client)
    monkeypatch.setattr("app.services.xhs_batch_service.AIServiceFactory.get_config", fake_get_config)

    result = await process_xhs_batch_item(
        tenant_id="tenant-ctx",
        db=test_db_session,
        job=job,
        item=item,
    )

    assert result["verifier_pass"] is True
    assert "夜间通勤妆" in prompts[0]
    assert "清透持妆" in prompts[0]
    assert "夸张承诺" in prompts[0]
    assert "selling_point_alignment" in prompts[1]
    assert "真实体验" in prompts[1]


@pytest.mark.asyncio
async def test_process_xhs_batch_item_fails_when_main_selling_points_are_missing(test_db_session, monkeypatch):
    await _seed_direction_context(test_db_session)

    job = XHSBatchJob(
        id="job-ctx-2",
        tenant_id="tenant-ctx",
        created_by="user-ctx",
        status="running",
        category_id="beauty",
        direction_id="direction-1",
        brief_pack_id="brief-pack-1",
        run_mode="trial",
        input_type="text",
        tag_policy_json={"max_count": 6},
        total_items=1,
        done_items=0,
        running_items=1,
    )
    item = XHSBatchItem(
        id="item-row-ctx-2",
        batch_id=job.id,
        item_id="item_002",
        source_text="写一篇夜间妆面分享",
        source_title_guess="夜间妆面分享",
        status="running",
        round=0,
    )

    async def fake_editor(*args, **kwargs):
        return {
            "title": "夜间妆面分享",
            "body": "今天主要讲我的上脸感觉和拍照状态，没有展开具体卖点。",
            "hashtags": ["#底妆"],
            "strategy": "rewrite",
        }, 10

    async def fake_verifier(*args, **kwargs):
        return {
            "pass": True,
            "confidence": 0.93,
            "issues": [],
            "needs_safe_rewrite": False,
            "summary": "AI 初判通过",
            "direction_alignment": {"passed": True, "reason": "方向基本符合", "violations": []},
            "selling_point_alignment": {
                "passed": True,
                "required_points": ["清透持妆"],
                "covered_points": [],
                "missing_points": [],
                "reason": "AI 未发现问题",
            },
        }, 5

    monkeypatch.setattr("app.services.xhs_batch_service._run_editor_ai", fake_editor)
    monkeypatch.setattr("app.services.xhs_batch_service._run_verifier_ai", fake_verifier)

    result = await process_xhs_batch_item(
        tenant_id="tenant-ctx",
        db=test_db_session,
        job=job,
        item=item,
    )

    assert result["verifier_pass"] is False
    assert result["decision_required"] is True
    assert result["safe_rewrite_used"] is False
    assert result["item_status"] == "needs_decision"
    assert result["selected_decision_option_id"] is None
    assert result["recommended_decision_option_id"] in {"compliance_first", "selling_points_first", "style_first"}
    assert any("主版本核心卖点" in reason for reason in result["rewrite_fail_reasons"])


@pytest.mark.asyncio
async def test_process_xhs_batch_item_passes_after_manual_decision_selection(test_db_session, monkeypatch):
    await _seed_direction_context(test_db_session)

    job = XHSBatchJob(
        id="job-ctx-decision-1",
        tenant_id="tenant-ctx",
        created_by="user-ctx",
        status="running",
        category_id="beauty",
        direction_id="direction-1",
        brief_pack_id="brief-pack-1",
        run_mode="trial",
        input_type="text",
        tag_policy_json={"max_count": 6},
        total_items=1,
        done_items=0,
        running_items=1,
    )
    item = XHSBatchItem(
        id="item-row-ctx-decision-1",
        batch_id=job.id,
        item_id="item_009",
        source_text="夜间底妆笔记原稿",
        source_title_guess="夜间底妆笔记",
        status="running",
        round=0,
        model_meta_json={"selected_decision_option_id": "compliance_first"},
    )

    async def fake_editor(*args, **kwargs):
        return {
            "title": "夜间底妆笔记",
            "body": "正文已经压弱风险表达，但原稿结构和卖点覆盖还不够完整。",
            "hashtags": ["#底妆"],
            "strategy": "polish",
        }, 12

    async def fake_verifier(*args, **kwargs):
        return {
            "pass": False,
            "confidence": 0.82,
            "issues": [
                {"term": "原稿骨架", "reason": "正文改动过大，已经偏向重写，不像逐段删改", "category": "direction_alignment"},
            ],
            "needs_safe_rewrite": False,
            "summary": "还存在原稿感取舍",
            "direction_alignment": {"passed": False, "reason": "原稿感下降", "violations": ["正文偏向重写"]},
            "selling_point_alignment": {
                "passed": True,
                "required_points": ["清透持妆"],
                "covered_points": ["清透持妆"],
                "missing_points": [],
                "reason": "卖点已覆盖",
            },
        }, 8

    monkeypatch.setattr("app.services.xhs_batch_service._run_editor_ai", fake_editor)
    monkeypatch.setattr("app.services.xhs_batch_service._run_verifier_ai", fake_verifier)

    result = await process_xhs_batch_item(
        tenant_id="tenant-ctx",
        db=test_db_session,
        job=job,
        item=item,
    )

    assert result["verifier_pass"] is True
    assert result["item_status"] == "completed"
    assert result["selected_decision_option_id"] == "compliance_first"
    assert result["verifier"]["manual_decision_applied"] is True


@pytest.mark.asyncio
async def test_process_xhs_batch_item_editor_prompt_preserves_xhs_style_and_retries_from_last_draft(
    test_db_session, monkeypatch
):
    await _seed_direction_context(test_db_session)

    job = XHSBatchJob(
        id="job-ctx-3",
        tenant_id="tenant-ctx",
        created_by="user-ctx",
        status="running",
        category_id="beauty",
        direction_id="direction-1",
        brief_pack_id="brief-pack-1",
        run_mode="trial",
        input_type="text",
        tag_policy_json={"max_count": 6},
        total_items=1,
        done_items=0,
        running_items=1,
    )
    item = XHSBatchItem(
        id="item-row-ctx-3",
        batch_id=job.id,
        item_id="item_003",
        source_text="#1 自定义角度· ❗需人工\n标题：沉迷熬夜后的通勤底妆，还能救吗？\n昨晚熬夜，今天底妆居然还没垮😭\n👉先说结论：通勤到下班，妆面还挺稳。\n#底妆 #通勤妆",
        source_title_guess="沉迷熬夜后的通勤底妆，还能救吗？",
        status="running",
        round=0,
    )

    prompts: list[str] = []
    call_index = 0

    def json_payload(payload):
        import json

        return json.dumps(payload, ensure_ascii=False)

    class FakeClient:
        async def chat_completion(self, **kwargs):
            nonlocal call_index
            prompts.append(kwargs["messages"][0]["content"])
            call_index += 1
            if call_index == 1:
                return SimpleNamespace(
                    content=json_payload(
                        {
                            "title": "通勤底妆分享",
                            "body": "昨晚熬夜，今天底妆状态还不错。关键一环是底妆服帖。",
                            "hashtags": ["#底妆"],
                            "strategy": "rewrite",
                        }
                    ),
                    usage={"total_tokens": 61},
                )
            if call_index == 2:
                return SimpleNamespace(
                    content=json_payload(
                        {
                            "pass": False,
                            "confidence": 0.82,
                            "issues": [
                                {
                                    "term": "关键一环",
                                    "reason": "语气太像重写稿，原稿的小红书口吻和结构被洗掉",
                                    "category": "direction_alignment",
                                }
                            ],
                            "needs_safe_rewrite": False,
                            "summary": "风格不通过",
                            "direction_alignment": {
                                "passed": False,
                                "reason": "平台感丢失",
                                "violations": ["语气变得太官方"],
                            },
                            "selling_point_alignment": {
                                "passed": True,
                                "required_points": ["清透持妆"],
                                "covered_points": ["清透持妆"],
                                "missing_points": [],
                                "reason": "卖点基本符合",
                            },
                        }
                    ),
                    usage={"total_tokens": 32},
                )
            if call_index == 3:
                return SimpleNamespace(
                    content=json_payload(
                        {
                            "title": "沉迷熬夜后的通勤底妆，还能救吗？",
                            "body": "昨晚熬夜，今天底妆居然还没垮😭\n👉先说结论：通勤到下班，妆面还挺稳，清透持妆这点我真的有感。",
                            "hashtags": ["#底妆", "#通勤妆"],
                            "strategy": "polish",
                        }
                    ),
                    usage={"total_tokens": 58},
                )
            return SimpleNamespace(
                content=json_payload(
                    {
                        "pass": True,
                        "confidence": 0.95,
                        "issues": [],
                        "needs_safe_rewrite": False,
                        "summary": "通过",
                        "direction_alignment": {"passed": True, "reason": "风格贴近原稿", "violations": []},
                        "selling_point_alignment": {
                            "passed": True,
                            "required_points": ["清透持妆"],
                            "covered_points": ["清透持妆"],
                            "missing_points": [],
                            "reason": "卖点吻合",
                        },
                    }
                ),
                usage={"total_tokens": 28},
            )

    async def fake_get_client(*args, **kwargs):
        return FakeClient()

    async def fake_get_config(*args, **kwargs):
        return SimpleNamespace(
            models={"xhs_editor": "editor-model", "xhs_verifier": "verifier-model"},
            temperature=0.7,
            max_tokens=1200,
        )

    monkeypatch.setattr("app.services.xhs_batch_service.AIServiceFactory.get_client", fake_get_client)
    monkeypatch.setattr("app.services.xhs_batch_service.AIServiceFactory.get_config", fake_get_config)

    result = await process_xhs_batch_item(
        tenant_id="tenant-ctx",
        db=test_db_session,
        job=job,
        item=item,
    )

    assert result["verifier_pass"] is True
    assert "最小必要修改" in prompts[0]
    assert "不是另起炉灶的重写作者" in prompts[0]
    assert "原稿自带 hashtags" in prompts[0]
    assert "弱化改写" in prompts[0]
    assert "逐段修稿规则" in prompts[0]
    assert "keep / trim / replace_phrase" in prompts[0]
    assert "沉迷熬夜后的通勤底妆，还能救吗？" in prompts[0]
    assert "#1 自定义角度" not in prompts[0]
    assert "current_draft" in prompts[2]
    assert "是底妆服帖" in prompts[2]
    assert "关键一环是底妆服帖" not in prompts[2]
    assert "只针对本轮 issues 下刀" in prompts[2]


@pytest.mark.asyncio
async def test_process_xhs_batch_item_preserves_source_hashtags_when_editor_omits_them(test_db_session, monkeypatch):
    job = XHSBatchJob(
        id="job-4",
        tenant_id="tenant-4",
        created_by="user-4",
        status="running",
        category_id="beauty",
        run_mode="trial",
        input_type="text",
        tag_policy_json={"max_count": 5},
        total_items=1,
        done_items=0,
        running_items=1,
    )
    item = XHSBatchItem(
        id="item-row-4",
        batch_id=job.id,
        item_id="item_004",
        source_text="#1 自定义角度· ❗需人工\n标题：底妆小记\n今天妆面状态还不错。\n#底妆 #通勤妆",
        source_title_guess="底妆小记",
        status="running",
        round=0,
    )

    async def fake_editor(*args, **kwargs):
        return {
            "title": "底妆小记",
            "body": "今天妆面状态还不错。",
            "hashtags": [],
            "strategy": "polish",
        }, 12

    async def fake_verifier(*args, **kwargs):
        return {
            "pass": True,
            "confidence": 0.94,
            "issues": [],
            "needs_safe_rewrite": False,
            "summary": "通过",
            "direction_alignment": {"passed": True, "reason": "通过", "violations": []},
            "selling_point_alignment": {
                "passed": True,
                "required_points": [],
                "covered_points": [],
                "missing_points": [],
                "reason": "通过",
            },
        }, 6

    monkeypatch.setattr("app.services.xhs_batch_service._run_editor_ai", fake_editor)
    monkeypatch.setattr("app.services.xhs_batch_service._run_verifier_ai", fake_verifier)

    result = await process_xhs_batch_item(
        tenant_id="tenant-4",
        db=test_db_session,
        job=job,
        item=item,
    )

    assert result["verifier_pass"] is True
    assert result["final_hashtags"] == ["#底妆", "#通勤妆"]


@pytest.mark.asyncio
async def test_process_xhs_batch_item_fails_when_output_reads_like_new_ai_rewrite(test_db_session, monkeypatch):
    await _seed_direction_context(test_db_session)

    job = XHSBatchJob(
        id="job-ctx-5",
        tenant_id="tenant-ctx",
        created_by="user-ctx",
        status="running",
        category_id="beauty",
        direction_id="direction-1",
        brief_pack_id="brief-pack-1",
        run_mode="trial",
        input_type="text",
        tag_policy_json={"max_count": 6},
        total_items=1,
        done_items=0,
        running_items=1,
    )
    item = XHSBatchItem(
        id="item-row-ctx-5",
        batch_id=job.id,
        item_id="item_005",
        source_text="#1 自定义角度· ❗需人工\n标题：沉迷熬夜后的通勤底妆，还能救吗？\n昨晚熬夜，今天底妆居然还没垮😭\n👉先说结论：通勤到下班，妆面还挺稳。\n总结一句：这次底妆真的省心。\n#底妆 #通勤妆",
        source_title_guess="沉迷熬夜后的通勤底妆，还能救吗？",
        status="running",
        round=0,
    )

    async def fake_editor(*args, **kwargs):
        return {
            "title": "通勤底妆管理指南",
            "body": "对于这类需求人群来说，底妆管理是一大关键一环。\n本次产品表现出色，作为系列补充也是不错的选择。",
            "hashtags": ["#底妆"],
            "strategy": "rewrite",
        }, 18

    async def fake_verifier(*args, **kwargs):
        return {
            "pass": True,
            "confidence": 0.94,
            "issues": [],
            "needs_safe_rewrite": False,
            "summary": "AI 初判通过",
            "direction_alignment": {"passed": True, "reason": "基本通过", "violations": []},
            "selling_point_alignment": {
                "passed": True,
                "required_points": ["清透持妆"],
                "covered_points": ["清透持妆"],
                "missing_points": [],
                "reason": "AI 未发现问题",
            },
        }, 8

    monkeypatch.setattr("app.services.xhs_batch_service._run_editor_ai", fake_editor)
    monkeypatch.setattr("app.services.xhs_batch_service._run_verifier_ai", fake_verifier)

    result = await process_xhs_batch_item(
        tenant_id="tenant-ctx",
        db=test_db_session,
        job=job,
        item=item,
    )

    assert result["verifier_pass"] is False
    assert result["safe_rewrite_used"] is False
    assert any("重写" in reason or "AI 修饰腔" in reason or "局部修订" in reason for reason in result["rewrite_fail_reasons"])


@pytest.mark.asyncio
async def test_process_xhs_batch_item_postprocesses_ai_review_tone_before_verifier(test_db_session, monkeypatch):
    await _seed_strict_health_direction_context(test_db_session)

    job = XHSBatchJob(
        id="job-health-1",
        tenant_id="tenant-health",
        created_by="user-health",
        status="running",
        category_id="health",
        direction_id="direction-health-1",
        brief_pack_id="brief-pack-health-1",
        run_mode="trial",
        input_type="text",
        tag_policy_json={"max_count": 8},
        total_items=1,
        done_items=0,
        running_items=1,
    )
    item = XHSBatchItem(
        id="item-row-health-1",
        batch_id=job.id,
        item_id="item_001",
        source_text="标题：沉迷外卖？茵澳斯益生菌来帮你！\n外卖吃太多？肠胃不适？是时候认清自己的基数段位了！👀\n👉大基数看这里：innerhealth茵澳斯AKK金标！适合平时吃得多、基数大的朋友。单粒含有300亿AKK菌。\n👉小基数也有专属：innerhealth茵澳斯AKK银标！专为微调需求设计。\n总结一句：认清基数对号入座。\n#innerhealth益生菌 #茵澳斯 #AKK金标 #AKK银标",
        source_title_guess="沉迷外卖？茵澳斯益生菌来帮你！",
        status="running",
        round=0,
    )

    seen_payload = {}

    async def fake_editor(*args, **kwargs):
        return {
            "title": "沉迷外卖？茵澳斯益生菌来帮你！",
            "body": "外卖吃太多？有饮食不规律后的状态管理诉求？是时候认清自己的基数段位，给身体来点儿科学管理了！👀\n有助于调节代谢。\n👉大基数看这里：innerhealth茵澳斯AKK金标！适合平时吃得多、基数大、遭遇顽固瓶颈期的朋友。单粒含有300亿AKK菌，采用的灭活AKK菌工艺，比活菌更安全有效，实力不容小觑。\n👉小基数也有专属：innerhealth茵澳斯AKK银标！作为系列补充，专为微调需求设计。150亿AKK原研菌株与B420、益生元强强联手，贴心陪伴管不住嘴的贪吃党，方便日常坚持。\n总结一句：懒人管理也能找到适合的方向！日常坚持打卡。",
            "hashtags": ["#innerhealth益生菌", "#茵澳斯", "#AKK金标", "#AKK银标"],
            "strategy": "rewrite",
        }, 30

    async def fake_verifier(*args, **kwargs):
        seen_payload["title"] = kwargs["title"]
        seen_payload["body"] = kwargs["body"]
        seen_payload["hashtags"] = kwargs["hashtags"]
        return {
            "pass": True,
            "confidence": 0.93,
            "issues": [],
            "needs_safe_rewrite": False,
            "summary": "通过",
            "direction_alignment": {"passed": True, "reason": "通过", "violations": []},
            "selling_point_alignment": {
                "passed": True,
                "required_points": ["每粒含300亿AKK MucT原研菌株"],
                "covered_points": ["每粒含300亿AKK MucT原研菌株"],
                "missing_points": [],
                "reason": "通过",
            },
        }, 12

    monkeypatch.setattr("app.services.xhs_batch_service._run_editor_ai", fake_editor)
    monkeypatch.setattr("app.services.xhs_batch_service._run_verifier_ai", fake_verifier)

    result = await process_xhs_batch_item(
        tenant_id="tenant-health",
        db=test_db_session,
        job=job,
        item=item,
    )

    assert result["verifier_pass"] is True
    assert "状态管理诉求" not in seen_payload["body"]
    assert "科学管理" not in seen_payload["body"]
    assert "安全有效" not in seen_payload["body"]
    assert "实力不容小觑" not in seen_payload["body"]
    assert "作为系列补充" not in seen_payload["body"]
    assert "贴心陪伴" not in seen_payload["body"]
    assert "调节代谢这件事，也得慢慢来。" in seen_payload["body"]
    assert "采用的灭活AKK菌工艺，采用灭活AKK菌工艺" not in seen_payload["body"]
    assert "innerhealth茵澳斯 AKK 金标" in seen_payload["body"]
    assert "innerhealth茵澳斯 AKK 银标" in seen_payload["body"]
    assert "小基数或微调需求也可以看看这款。" in seen_payload["body"]


@pytest.mark.asyncio
async def test_strict_direction_filters_conflicting_required_points(test_db_session):
    await _seed_strict_health_direction_context(test_db_session)

    job = XHSBatchJob(
        id="job-health-ctx",
        tenant_id="tenant-health",
        created_by="user-health",
        status="running",
        category_id="health",
        direction_id="direction-health-1",
        brief_pack_id="brief-pack-health-1",
        run_mode="trial",
        input_type="text",
        total_items=1,
        done_items=0,
        running_items=1,
    )

    context = await _load_xhs_rewrite_context("tenant-health", test_db_session, job)

    assert all("原研" not in point for point in context.required_selling_points)
    assert all("300亿" not in point for point in context.required_selling_points)
    assert all("安全有效" not in point for point in context.required_selling_points)

    prompt_text = _context_to_prompt_text(context)
    assert "requirement_precedence" in prompt_text
    assert "以 direction 为准" in prompt_text


@pytest.mark.asyncio
async def test_run_editor_ai_retries_invalid_json_then_succeeds(test_db_session, monkeypatch):
    responses = [
        SimpleNamespace(content="", usage={"total_tokens": 0}),
        SimpleNamespace(
            content='{"title":"改好了","body":"保留原稿结构","hashtags":["#小红书"],"strategy":"polish"}',
            usage={"total_tokens": 18},
        ),
    ]

    class FakeClient:
        async def chat_completion(self, **kwargs):
            return responses.pop(0)

    async def fake_get_client(*args, **kwargs):
        return FakeClient()

    async def fake_get_config(*args, **kwargs):
        return SimpleNamespace(
            models={"xhs_editor": "editor-model"},
            temperature=0.4,
            max_tokens=1200,
        )

    monkeypatch.setattr("app.services.xhs_batch_service.AIServiceFactory.get_client", fake_get_client)
    monkeypatch.setattr("app.services.xhs_batch_service.AIServiceFactory.get_config", fake_get_config)

    result, tokens = await _run_editor_ai(
        tenant_id="tenant-editor-retry",
        db=test_db_session,
        source_text="原标题\n原正文",
        source_note={"title": "原标题", "body": "原正文", "hashtags": ["#原始"]},
        current_draft={"title": "原标题", "body": "原正文", "hashtags": ["#原始"]},
        round_num=1,
        context=XHSRewriteContext(),
        max_hashtags=5,
        issues=[],
    )

    assert result["title"] == "改好了"
    assert result["body"] == "保留原稿结构"
    assert result["hashtags"] == ["#小红书"]
    assert tokens == 18
