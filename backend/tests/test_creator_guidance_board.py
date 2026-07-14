import asyncio
import io
from pathlib import Path
import zipfile
from types import SimpleNamespace

from app.config import settings
from app.api.tasks import (
    _build_creator_guidance_export_basename,
    _build_creator_guidance_export_zip,
    _build_creator_image_generation,
    _build_creator_card_content_fallback,
    _build_creator_card_summary,
    _build_creator_visual_brief,
    _generate_creator_guidance_images,
    _build_review_candidates,
    _clean_multimodal_transcript_text,
    _merge_review_candidate_pool,
    _merge_audio_track_analysis,
    _normalize_creator_card_content,
    _normalize_review_candidate_payload,
    _repair_audio_track_analysis_with_transcript,
    _resolve_project_ai_scope_id,
    _robust_json_parse,
)


def test_build_review_candidates_extracts_voice_bgm_and_content_items():
    video_ai_result = {
        "audio_track_analysis": {
            "creator_guidance": {
                "summary": "重点优化开场和结尾。",
                "must_fix": [
                    "结尾补一句定位，让用户记住为什么选它。"
                ],
                "voiceover_plan": [
                    {
                        "segment": "前段",
                        "goal": "先让观众进入场景",
                        "instruction": "第一句不要直接讲产品，先讲孩子状态。",
                        "emphasis_words": ["孩子状态", "先别急着讲产品"],
                    }
                ],
                "bgm_plan": [
                    {
                        "segment": "后段",
                        "style": "温和铺底",
                        "action": "压低",
                        "instruction": "结尾音乐压低一点，把最后一句让出来。",
                    }
                ],
            },
            "violations": [],
        }
    }

    candidates = _build_review_candidates(video_ai_result, duration=63)

    assert len(candidates) >= 3
    assert any(item["category"] == "voice" for item in candidates)
    assert any(item["category"] == "bgm" for item in candidates)
    assert any(item["category"] == "content" for item in candidates)
    assert all(" - " in item["time_range"] for item in candidates)
    assert all(item["direct_fix"] for item in candidates)
    assert all(item["where_to_change"] for item in candidates)


def test_build_review_candidates_falls_back_to_audio_summary_when_plans_missing():
    video_ai_result = {
        "audio_track_analysis": {
            "tone_summary": "整体语速偏快，像在读稿，感染力不足。",
            "creator_guidance": {
                "summary": "语速太赶，缺少种草起伏。",
                "must_fix": [],
                "voiceover_plan": [],
                "bgm_plan": [],
            },
            "delivery_signals": {
                "summary": "整体偏平，需要更自然的停顿和重音。",
            },
            "bgm": {
                "present": True,
                "style": "电子流行",
                "summary": "背景音乐存在感偏强，容易抢口播。",
            },
            "violations": [],
        }
    }

    candidates = _build_review_candidates(video_ai_result, duration=68)

    assert any(item["category"] == "voice" for item in candidates)
    assert any(item["category"] == "bgm" for item in candidates)


def test_build_review_candidates_keeps_existing_content_items_and_adds_missing_audio_items():
    video_ai_result = {
        "review_candidates": [
            {
                "id": "content-1",
                "category": "content",
                "start_sec": 0,
                "end_sec": 8,
                "time_range": "0:00 - 0:08",
                "priority": "high",
                "problem": "画面有水印。",
                "direct_fix": "请更换无水印素材。",
                "where_to_change": "0:00 附近画面",
                "suggested_copy": "",
                "bgm_action": "",
                "evidence": "",
            }
        ],
        "audio_track_analysis": {
            "tone_summary": "整体语速偏快，像在读稿。",
            "creator_guidance": {
                "summary": "语速太赶，缺少起伏。",
                "must_fix": [],
                "voiceover_plan": [],
                "bgm_plan": [],
            },
            "bgm": {
                "present": True,
                "style": "电子流行",
                "summary": "背景音乐存在感偏强。",
            },
        },
    }

    candidates = _build_review_candidates(video_ai_result, duration=68)

    assert any(item["id"] == "content-1" for item in candidates)
    assert any(item["category"] == "voice" for item in candidates)
    assert any(item["category"] == "bgm" for item in candidates)


def test_merge_review_candidate_pool_keeps_unselected_candidates_and_updates_selected_ones():
    existing_candidates = [
        {
            "id": "voice-1",
            "category": "voice",
            "start_sec": 0,
            "end_sec": 12,
            "time_range": "0:00 - 0:12",
            "priority": "high",
            "problem": "开头直接讲产品，进入太快",
            "direct_fix": "第一句先讲生活场景，再自然带出产品。",
            "where_to_change": "第一句口播",
            "suggested_copy": "",
            "bgm_action": "",
            "evidence": "",
        },
        {
            "id": "content-1",
            "category": "content",
            "start_sec": 20,
            "end_sec": 28,
            "time_range": "0:20 - 0:28",
            "priority": "medium",
            "problem": "卖点没讲透",
            "direct_fix": "把分龄护理单独说清。",
            "where_to_change": "0:20 附近内容",
            "suggested_copy": "",
            "bgm_action": "",
            "evidence": "",
        },
    ]
    selected_candidates = [
        {
            "id": "voice-1",
            "category": "voice",
            "start_sec": 0,
            "end_sec": 12,
            "time_range": "0:00 - 0:12",
            "priority": "high",
            "problem": "开头还是太快",
            "direct_fix": "先讲孩子状态，再自然带出产品。",
            "where_to_change": "第一句口播",
            "suggested_copy": "",
            "bgm_action": "",
            "evidence": "",
        }
    ]

    merged = _merge_review_candidate_pool(existing_candidates, selected_candidates)

    assert len(merged) == 2
    assert merged[0]["id"] == "voice-1"
    assert merged[0]["problem"] == "开头还是太快"
    assert merged[1]["id"] == "content-1"


def test_resolve_project_ai_scope_id_prefers_config_scope():
    project = SimpleNamespace(config_scope_id="agency-scope-1", brand_id="brand-1")
    assert _resolve_project_ai_scope_id(project) == "agency-scope-1"

    project_without_scope = SimpleNamespace(config_scope_id=None, brand_id="brand-1")
    assert _resolve_project_ai_scope_id(project_without_scope) == "brand-1"


def test_build_creator_guidance_export_zip_packages_generated_pages(monkeypatch):
    async def fake_download(url):
        return f"binary:{url}".encode("utf-8")

    monkeypatch.setattr("app.api.tasks._download_generated_image_bytes", fake_download)

    zip_bytes = asyncio.run(
        _build_creator_guidance_export_zip(
            project_name="项目A",
            creator_name="达人小李",
            iteration_no=3,
            generated_pages=[
                {"page_index": 1, "image_url": "https://example.com/page-1.png"},
                {"page_index": 2, "image_url": "https://example.com/page-2.jpg"},
            ],
        )
    )

    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as archive:
        assert archive.namelist() == [
            "项目A-达人小李-达人修改图-第3轮-第1页.png",
            "项目A-达人小李-达人修改图-第3轮-第2页.jpg",
        ]
        assert archive.read("项目A-达人小李-达人修改图-第3轮-第1页.png") == b"binary:https://example.com/page-1.png"


def test_build_creator_guidance_export_basename_includes_iteration():
    assert _build_creator_guidance_export_basename(
        project_name="项目A",
        creator_name="达人小李",
        iteration_no=2,
    ) == "项目A-达人小李-达人修改图-第2轮"


def test_build_creator_card_content_fallback_groups_candidates_by_category():
    candidates = [
        {
            "id": "voice-1",
            "category": "voice",
            "start_sec": 0,
            "end_sec": 12,
            "time_range": "0:00 - 0:12",
            "priority": "high",
            "problem": "开头直接讲产品，进入太快",
            "direct_fix": "第一句先讲生活场景，再自然带出产品。",
            "where_to_change": "第一句口播",
            "suggested_copy": "最近天气一热，孩子小脸就容易闹情绪。",
            "bgm_action": "",
            "evidence": "",
        },
        {
            "id": "bgm-1",
            "category": "bgm",
            "start_sec": 52,
            "end_sec": 63,
            "time_range": "0:52 - 1:03",
            "priority": "medium",
            "problem": "结尾音乐太满，最后一句不够清楚",
            "direct_fix": "结尾音乐压低，把最后一句完整让出来。",
            "where_to_change": "结尾 BGM",
            "suggested_copy": "",
            "bgm_action": "压低并保持平稳",
            "evidence": "",
        },
    ]

    content = _build_creator_card_content_fallback(
        task_name="任务A",
        project_name="项目A",
        candidates=candidates,
    )

    assert content["title"] == "项目A 修改图"
    assert "按时间顺序处理" in content["summary"]
    assert len(content["priorities"]) == 2
    assert len(content["sections"]["voice"]) == 1
    assert len(content["sections"]["bgm"]) == 1
    assert content["sections"]["content"] == []
    assert content["sections"]["voice"][0]["time_range"] == "0:00 - 0:12"
    assert len(content["summary"]) <= 34
    assert len(content["priorities"][0]) <= 32


def test_build_creator_card_summary_prefers_short_card_copy():
    summary = _build_creator_card_summary([
        {"category": "voice"},
        {"category": "bgm"},
        {"category": "content"},
        {"category": "content"},
    ])

    assert "4 处修改" in summary
    assert "口播" in summary
    assert "BGM" in summary
    assert len(summary) <= 34


def test_normalize_creator_card_content_uses_deterministic_title_and_fills_missing_items():
    candidates = [
        {
            "id": "voice-1",
            "category": "voice",
            "start_sec": 0,
            "end_sec": 12,
            "time_range": "0:00 - 0:12",
            "priority": "high",
            "problem": "开头直接讲产品，进入太快，用户还没进入情境。",
            "direct_fix": "第一句先讲生活场景，再自然带出产品，不要一上来就讲卖点。",
            "where_to_change": "第一句口播",
            "suggested_copy": "最近天气一热，孩子小脸就容易闹情绪。",
            "bgm_action": "",
            "evidence": "",
        },
        {
            "id": "content-1",
            "category": "content",
            "start_sec": 20,
            "end_sec": 28,
            "time_range": "0:20 - 0:28",
            "priority": "high",
            "problem": "核心卖点没有讲清，分龄护理被一笔带过。",
            "direct_fix": "在这段补一句明确卖点，不要只讲感受，要把分龄护理单独说清。",
            "where_to_change": "0:20 附近内容",
            "suggested_copy": "建议补上：6-12岁专研分龄护理",
            "bgm_action": "",
            "evidence": "",
        },
    ]

    fallback = _build_creator_card_content_fallback("任务A", "项目A", candidates)
    normalized = _normalize_creator_card_content(
        task_name="任务A",
        project_name="项目A",
        candidates=candidates,
        parsed={
            "title": "这是一个明显过长而且不适合放在图上的标题应该被忽略",
            "summary": "这是一段非常长的总结，不适合直接放在图卡上展示，应该被系统改成更短的说明。",
            "priorities": ["这一条优先级描述也很长很长，不适合直接展示在图上。"],
            "sections": {
                "voice": [
                    {
                        "time_range": "0:00 - 0:12",
                        "title": "一个非常长的标题会让卡片很难看",
                        "problem": "这里的问题描述写得特别长特别长，不适合在图片里做执行单。",
                        "fix": "这里的改法描述也写得特别长特别长，不适合直接展示，需要被裁短。",
                        "example": "这里的示例同样过长，应该被截断到适合卡片显示的长度。",
                    }
                ],
                "bgm": [],
                "content": [],
            },
        },
        fallback=fallback,
    )

    assert normalized["title"] == "项目A 修改图"
    assert normalized["summary"] == fallback["summary"]
    assert len(normalized["priorities"]) == 1
    assert len(normalized["priorities"][0]) <= 32
    assert len(normalized["sections"]["voice"][0]["title"]) <= 14
    assert len(normalized["sections"]["voice"][0]["problem"]) <= 48
    assert len(normalized["sections"]["voice"][0]["fix"]) <= 52
    assert normalized["sections"]["content"][0]["time_range"] == "0:20 - 0:28"


def test_build_review_candidates_handles_string_must_fix_and_timestamp_violation():
    video_ai_result = {
        "audio_track_analysis": {
            "creator_guidance": {
                "must_fix": "结尾没有定位句，记忆点不足",
            },
            "violations": [],
        },
        "violations": [
            {
                "type": "口误",
                "content": "“6-12岁研发”被连读，卖点不清",
                "severity": "high",
                "suggestion": "",
                "timestamp": 16,
                "script_text": "6-12岁专研分龄护理",
                "actual_text": "6-12岁研发",
            }
        ],
    }

    candidates = _build_review_candidates(video_ai_result, duration=63)

    must_fix_candidate = next(item for item in candidates if item["id"].startswith("must-fix-"))
    violation_candidate = next(item for item in candidates if item["id"].startswith("violation-"))

    assert must_fix_candidate["problem"] == "结尾没有定位句，记忆点不足"
    assert "定位" in must_fix_candidate["direct_fix"]
    assert violation_candidate["time_range"] == "0:16 - 0:24"
    assert "建议改成" in violation_candidate["suggested_copy"]
    assert "按通过脚本口径说" in violation_candidate["direct_fix"]


def test_build_review_candidates_includes_subtitle_and_missing_selling_point():
    video_ai_result = {
        "subtitle_issues": [
            {
                "type": "字幕错误",
                "content": "字幕把“分龄护理”写成了“分类护理”",
                "severity": "medium",
                "suggestion": "把字幕改回“分龄护理”",
                "timestamp": "0:22",
            }
        ],
        "selling_point_coverage": [
            {
                "content": "6-12岁专研分龄护理",
                "conveyed": False,
                "evidence": "中段卖点一笔带过",
                "timestamp": "0:16",
            }
        ],
    }

    candidates = _build_review_candidates(video_ai_result, duration=63)

    subtitle_candidate = next(item for item in candidates if item["id"].startswith("subtitle-issue-"))
    selling_point_candidate = next(item for item in candidates if item["id"].startswith("selling-point-"))

    assert subtitle_candidate["time_range"] == "0:22 - 0:28"
    assert subtitle_candidate["where_to_change"] == "0:22 附近字幕"
    assert "分龄护理" in subtitle_candidate["direct_fix"]
    assert selling_point_candidate["time_range"] == "0:16 - 0:24"
    assert "核心卖点没有讲清" in selling_point_candidate["problem"]
    assert "建议补上" in selling_point_candidate["suggested_copy"]


def test_build_review_candidates_handles_weak_selling_point_coverage():
    video_ai_result = {
        "selling_point_coverage": [
            {
                "content": "温和清洁不刺激",
                "conveyed": True,
                "strength": "weak",
                "evidence": "口播里只一笔带过",
                "timestamp": "0:09",
            }
        ]
    }

    candidates = _build_review_candidates(video_ai_result, duration=30)

    candidate = next(item for item in candidates if item["id"].startswith("selling-point-"))
    assert candidate["priority"] == "medium"
    assert "提到了但没讲透" in candidate["problem"]
    assert candidate["time_range"] == "0:09 - 0:17"


def test_repair_audio_track_analysis_with_transcript_removes_false_no_voice_claim():
    repaired = _repair_audio_track_analysis_with_transcript(
        {
            "transcript": "",
            "tone_summary": "未检测到有效的人声口播",
            "delivery_signals": {
                "energy_level": "低",
                "persuasiveness": "极低",
                "brand_fit": "极低",
                "summary": "音频轨道缺乏有效的人声信息，可能为纯BGM或提取失败。",
            },
            "violations": [
                {
                    "type": "语气问题",
                    "content": "未检测到有效的人声口播",
                    "severity": "low",
                    "suggestion": "请检查音轨",
                }
            ],
        },
        "今天想跟大家分享一下这款洗发水，我自己用了两周，最大的感受就是头皮会轻松很多。",
    )

    assert repaired["transcript"].startswith("今天想跟大家分享")
    assert repaired["tone_summary"] == ""
    assert repaired["delivery_signals"]["persuasiveness"] == ""
    assert repaired["delivery_signals"]["brand_fit"] == ""
    assert repaired["violations"] == []


def test_repair_audio_track_analysis_with_transcript_prefers_real_asr_text_over_summary_stub():
    repaired = _repair_audio_track_analysis_with_transcript(
        {
            "transcript": "达人口播了产品种草内容，整体按脚本执行，但后半段转写缺失。",
            "tone_summary": "整体语速偏快，感染力不足。",
            "creator_guidance": {"summary": "语速太赶且缺乏"},
            "delivery_signals": {},
            "bgm": {"present": True, "style": "电子流行"},
            "environment": {"has_noise": False, "clarity_score": 88},
        },
        "谁还没被张柏芝的双重魅力拿捏，看到她的片场路透，温柔婉约，细心照料。",
    )

    assert repaired["transcript"].startswith("谁还没被张柏芝")
    assert repaired["creator_guidance"]["summary"] == "整体语速偏快，感染力不足。"
    assert repaired["delivery_signals"]["summary"] == "整体语速偏快，感染力不足。"
    assert "电子流行" in repaired["bgm"]["summary"]
    assert repaired["environment"]["summary"] == "未识别到明显噪音，音质清晰度约 88 分。"


def test_clean_multimodal_transcript_text_extracts_json_transcript():
    raw = '```json\n{"transcript":"最近刷到一个视频，竟然看到张柏芝拜师庄恩琪。"}\n```'

    cleaned = _clean_multimodal_transcript_text(raw)

    assert cleaned == "最近刷到一个视频，竟然看到张柏芝拜师庄恩琪。"


def test_clean_multimodal_transcript_text_removes_prefixed_label():
    raw = "转写结果：最近刷到一个视频，竟然看到张柏芝拜师庄恩琪。"

    cleaned = _clean_multimodal_transcript_text(raw)

    assert cleaned == "最近刷到一个视频，竟然看到张柏芝拜师庄恩琪。"


def test_merge_audio_track_analysis_allows_focused_bgm_override():
    merged = _merge_audio_track_analysis(
        {
            "bgm": {
                "present": False,
                "style": "",
                "intensity": "",
                "fit": "无",
                "lyrics_risk": False,
                "summary": "未检测到有效BGM信息",
            },
            "creator_guidance": {
                "bgm_plan": [],
            },
        },
        {
            "bgm": {
                "present": True,
                "style": "动感电子乐",
                "intensity": "中",
                "fit": "一般",
                "lyrics_risk": False,
                "summary": "存在持续鼓点铺底，略微分散人声注意力。",
            },
            "creator_guidance": {
                "bgm_plan": [
                    {
                        "segment": "0:00-1:04",
                        "style": "动感电子乐",
                        "action": "压低",
                        "cue_point": "",
                        "instruction": "建议整体压低底乐，让人声更靠前。",
                    }
                ],
            },
        },
    )

    assert merged["bgm"]["present"] is True
    assert merged["bgm"]["style"] == "动感电子乐"
    assert "人声" in merged["bgm"]["summary"]
    assert merged["creator_guidance"]["bgm_plan"][0]["action"] == "压低"


def test_normalize_review_candidate_payload_humanizes_internal_where_and_category():
    normalized = _normalize_review_candidate_payload(
        {
            "id": "violation-2",
            "category": "voice",
            "start_sec": 36,
            "end_sec": 44,
            "priority": "high",
            "problem": "画面中展示的产品包装上印有“婴儿多效舒缓冰沙霜”，与推广产品名称不符。",
            "direct_fix": "严重执行事故！必须替换为正确的“启初青蒿屏障冰沙霜”产品进行拍摄和展示。",
            "where_to_change": "brand_safety",
        }
    )

    assert normalized is not None
    assert normalized["category"] == "content"
    assert normalized["where_to_change"] == "0:36 附近产品展示"
    assert normalized["direct_fix"].startswith("必须替换为")


def test_build_review_candidates_humanizes_violation_positions_and_categories():
    video_ai_result = {
        "violations": [
            {
                "type": "forbidden_word",
                "source": "语音",
                "content": "被央视力推的“宗门圣女”",
                "severity": "high",
                "suggestion": "删除“被央视力推的”表述。",
            },
            {
                "type": "画面质量",
                "source": "画面",
                "content": "视频全程右上角存在账号水印。",
                "severity": "medium",
                "timestamp": 0,
                "suggestion": "移除画面中的第三方账号水印。",
            },
        ]
    }

    candidates = _build_review_candidates(video_ai_result, duration=45)

    forbidden = next(item for item in candidates if item["id"] == "violation-1")
    visual = next(item for item in candidates if item["id"] == "violation-2")

    assert forbidden["where_to_change"] == "对应时间段口播文案"
    assert forbidden["category"] == "content"
    assert visual["where_to_change"] == "0:00 附近画面"
    assert visual["category"] == "content"


def test_build_review_candidates_uses_specific_fix_for_missing_script_segment():
    video_ai_result = {
        "script_match": {
            "segments": [
                {
                    "status": "missing",
                    "segment_label": "IP引入",
                    "script_segment": "张柏芝片场哄娃混剪",
                    "note": "完全删除了张柏芝相关内容",
                }
            ]
        }
    }

    candidates = _build_review_candidates(video_ai_result, duration=45)
    candidate = next(item for item in candidates if item["id"] == "script-match-1")

    assert candidate["where_to_change"] == "开头引入内容"
    assert "张柏芝片场哄娃混剪" in candidate["direct_fix"]


def test_robust_json_parse_repairs_truncated_json():
    raw = '{"bgm":{"present":true,"style":"轻快电子流行","summary":"存在持续背景音乐"},"environment":{"has_noise":false,"summary":"人声清晰'

    parsed = _robust_json_parse(raw)

    assert parsed["bgm"]["present"] is True
    assert parsed["bgm"]["style"] == "轻快电子流行"
    assert parsed["environment"]["summary"] == "人声清晰"


def test_build_creator_visual_brief_reuses_review_data_and_brief_context():
    candidates = [
        {
            "id": "voice-1",
            "category": "voice",
            "start_sec": 0,
            "end_sec": 12,
            "time_range": "0:00 - 0:12",
            "priority": "high",
            "problem": "开头直接讲产品，进入太快。",
            "direct_fix": "先讲夏天烦躁场景，再带出产品。",
            "where_to_change": "第一句口播",
            "suggested_copy": "天气一热，孩子就容易烦躁。",
            "bgm_action": "",
            "evidence": "开头节奏很赶，情绪还没立起来。",
        },
        {
            "id": "bgm-1",
            "category": "bgm",
            "start_sec": 20,
            "end_sec": 28,
            "time_range": "0:20 - 0:28",
            "priority": "medium",
            "problem": "中段 BGM 太满，人声被压住。",
            "direct_fix": "这段把底乐压低，让关键词更靠前。",
            "where_to_change": "中段 BGM",
            "suggested_copy": "",
            "bgm_action": "压低",
            "evidence": "",
        },
    ]
    video_ai_result = {
        "speech_transcript": "天气一热，孩子就容易烦躁，所以我最近会先准备这支冰沙霜。",
        "audio_track_analysis": {
            "delivery_signals": {
                "tone": "自然",
                "emotion": "关心",
                "energy_level": "中",
                "pacing": "偏快",
                "summary": "整体语速略快，前段进入过急。",
            },
            "bgm": {
                "present": True,
                "style": "轻快电子",
                "intensity": "中高",
                "fit": "一般",
                "summary": "中段底乐偏满，会压住关键词。",
            },
        },
    }
    brief = SimpleNamespace(
        product_name="启初青蒿舒缓冰沙霜",
        selling_points=[
            {"content": "6-12岁专研分龄护理", "priority": "core"},
            {"content": "一抹降温5℃", "priority": "recommended"},
        ],
        brand_tone="温和、真实、像妈妈分享",
        other_requirements="目标人群：宝妈\n内容要求：先讲孩子状态，再带产品。",
        creative_rubric={"tone": {"target": "自然口语感"}},
    )

    visual_brief = _build_creator_visual_brief(
        task_id="task-1",
        task_name="任务A",
        project_name="项目A",
        candidates=candidates,
        video_ai_result=video_ai_result,
        brief=brief,
    )

    assert visual_brief["meta"]["page_title"] == "项目A 修改指导图"
    assert visual_brief["meta"]["product_name"] == "启初青蒿舒缓冰沙霜"
    assert visual_brief["reference_context"]["key_selling_points"][0] == "6-12岁专研分龄护理"
    assert visual_brief["current_video_context"]["multimodal_signals"]["voice"]["pacing"] == "偏快"
    assert visual_brief["timeline_blocks"][0]["source_candidate_ids"] == ["voice-1"]
    assert visual_brief["page_plan"]["page_count"] == 1


def test_build_creator_image_generation_increments_iteration_and_keeps_feedback():
    creator_visual_brief = {
        "meta": {"page_title": "项目A 修改指导图"},
        "timeline_blocks": [],
    }
    previous_generation = {
        "generation_id": "guidance-123",
        "iteration_no": 2,
        "layout_variant": "landscape",
        "style_variant": "comic",
        "feedback_history": [
            {
                "iteration_no": 1,
                "target_page": 1,
                "feedback_type": "layout",
                "instruction": "改成横版",
                "created_at": "2026-04-21T10:00:00",
            }
        ],
    }

    generation = _build_creator_image_generation(
        creator_visual_brief=creator_visual_brief,
        previous_generation=previous_generation,
    )

    assert generation["generation_id"] == "guidance-123"
    assert generation["iteration_no"] == 3
    assert generation["layout_variant"] == "landscape"
    assert generation["style_variant"] == "comic"
    assert generation["status"] == "draft"
    assert generation["feedback_history"][0]["instruction"] == "改成横版"


def test_generate_creator_guidance_images_populates_generated_pages(monkeypatch, tmp_path):
    class FakeAIClient:
        async def image_generation(self, prompt, model, size, quality, n):
            assert model == "gpt-image-1"
            assert size == "1024x1536"
            assert "项目A 修改指导图" in prompt
            return SimpleNamespace(images=["data:image/png;base64,abc123"], model=model)

    monkeypatch.setattr(settings, "LOCAL_FILE_STORAGE_ENABLED", True)
    monkeypatch.setattr(settings, "LOCAL_FILE_STORAGE_DIR", str(tmp_path))

    creator_visual_brief = {
        "meta": {"page_title": "项目A 修改指导图", "project_name": "项目A", "product_name": "产品A"},
        "reference_context": {"must_keep_terms": ["产品A"], "brand_rules": [], "brief_core_message": ""},
        "visual_preferences": {"layout_variant": "portrait", "style_variant": "editorial_comic_guidance", "feedback_instruction": ""},
        "timeline_blocks": [
            {
                "block_id": "voice-1",
                "time_range": "0:00 - 0:12",
                "segment_title": "第一句口播",
                "current_problem": "开头进入太快。",
                "content_task": "先讲场景再带产品。",
                "voice_direction": "自然一点",
                "bgm_direction": "",
                "emotion": ["关心"],
                "must_keep_selling_points": ["产品A"],
                "visual_anchor": "人物口播气泡",
            }
        ],
        "transition_blocks": [],
        "page_plan": {"page_count": 1, "max_main_blocks_per_page": 2, "max_info_blocks_per_segment": 3, "ratio": "4:5"},
    }
    creator_image_generation = {
        "generation_id": "guidance-local",
        "layout_variant": "portrait",
        "style_variant": "editorial_comic_guidance",
        "status": "draft",
        "generated_pages": [],
        "feedback_history": [],
    }

    result = asyncio.run(
        _generate_creator_guidance_images(
            ai_client=FakeAIClient(),
            image_model="gpt-image-1",
            creator_visual_brief=creator_visual_brief,
            creator_image_generation=creator_image_generation,
            task_id="task-1",
        )
    )

    assert result["status"] == "reviewing"
    assert result["generated_pages"][0]["page_index"] == 1
    assert result["generated_pages"][0]["image_url"].startswith("/api/v1/upload/local?key=")
    saved_path = tmp_path / Path("generated/creator-guidance/task-1/guidance-local/page-1.png")
    assert saved_path.read_bytes() == b"i\xb75\xdb"


def test_generate_creator_guidance_images_regenerates_only_target_page():
    class FakeAIClient:
        def __init__(self):
            self.prompts = []

        async def image_generation(self, prompt, model, size, quality, n):
            self.prompts.append(prompt)
            return SimpleNamespace(images=["https://example.com/page-2.png"], model=model)

    fake_ai_client = FakeAIClient()
    creator_visual_brief = {
        "meta": {"page_title": "项目A 修改指导图", "project_name": "项目A", "product_name": "产品A"},
        "reference_context": {"must_keep_terms": ["产品A"], "brand_rules": [], "brief_core_message": ""},
        "visual_preferences": {"layout_variant": "landscape", "style_variant": "editorial_comic_guidance", "feedback_instruction": "第二页再横一点"},
        "timeline_blocks": [
            {
                "block_id": "voice-1",
                "time_range": "0:00 - 0:12",
                "segment_title": "第一句口播",
                "current_problem": "开头进入太快。",
                "content_task": "先讲场景再带产品。",
                "voice_direction": "自然一点",
                "bgm_direction": "",
                "emotion": ["关心"],
                "must_keep_selling_points": ["产品A"],
                "visual_anchor": "人物口播气泡",
            },
            {
                "block_id": "content-1",
                "time_range": "0:20 - 0:28",
                "segment_title": "中段卖点",
                "current_problem": "卖点不够清楚。",
                "content_task": "把产品定位单独说出来。",
                "voice_direction": "稳一点",
                "bgm_direction": "",
                "emotion": ["坚定"],
                "must_keep_selling_points": ["产品A"],
                "visual_anchor": "产品贴纸",
            },
            {
                "block_id": "bgm-1",
                "time_range": "0:40 - 0:52",
                "segment_title": "结尾转场",
                "current_problem": "音乐太满。",
                "content_task": "收一点给结尾口播。",
                "voice_direction": "",
                "bgm_direction": "压低底乐",
                "emotion": ["轻松"],
                "must_keep_selling_points": ["产品A"],
                "visual_anchor": "音乐波形",
            },
        ],
        "transition_blocks": [],
        "page_plan": {"page_count": 2, "max_main_blocks_per_page": 2, "max_info_blocks_per_segment": 3, "ratio": "16:9", "layout_variant": "landscape"},
    }
    creator_image_generation = {
        "generation_id": "guidance-keep-pages",
        "layout_variant": "landscape",
        "style_variant": "editorial_comic_guidance",
        "status": "regenerating",
        "generated_pages": [
            {"page_index": 1, "image_url": "https://example.com/page-1.png", "page_summary": "第一页旧图"},
            {"page_index": 2, "image_url": "https://example.com/page-2-old.png", "page_summary": "第二页旧图"},
        ],
        "feedback_history": [],
    }

    result = asyncio.run(
        _generate_creator_guidance_images(
            ai_client=fake_ai_client,
            image_model="gpt-image-1",
            creator_visual_brief=creator_visual_brief,
            creator_image_generation=creator_image_generation,
            task_id="task-1",
            target_page=2,
        )
    )

    assert result["status"] == "reviewing"
    assert len(fake_ai_client.prompts) == 1
    assert "第 2 / 2 页" in fake_ai_client.prompts[0]
    assert result["generated_pages"][0]["image_url"] == "https://example.com/page-1.png"
    assert result["generated_pages"][1]["image_url"] == "https://example.com/page-2.png"
