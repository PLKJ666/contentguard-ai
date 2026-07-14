from datetime import datetime, timedelta, timezone

import pytest
from billiard.exceptions import SoftTimeLimitExceeded
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

import app.tasks.xhs_batch as xhs_batch_tasks
from app.models.xhs import XHSBatchItem, XHSBatchJob
from app.tasks.xhs_batch import process_xhs_batch_job_async, process_xhs_batch_item_task


async def _create_batch_job(async_session_factory, *, job_id: str, run_mode: str, total_items: int, trial_sample_count: int | None = None):
    async with async_session_factory() as session:
        job = XHSBatchJob(
            id=job_id,
            tenant_id="tenant-1",
            created_by="user-1",
            status="pending",
            category_id="beauty",
            run_mode=run_mode,
            trial_sample_count=trial_sample_count,
            input_type="text",
            total_items=total_items,
            done_items=0,
            running_items=0,
        )
        session.add(job)
        session.add_all(
            [
                XHSBatchItem(
                    id=f"{job_id}-row-{index}",
                    batch_id=job.id,
                    item_id=f"item_{index:03d}",
                    source_text=f"标题{index}\n正文{index}",
                    source_title_guess=f"标题{index}",
                    status="pending",
                    round=0,
                )
                for index in range(1, total_items + 1)
            ]
        )
        await session.commit()


def _build_success_result(item: XHSBatchItem) -> dict:
    return {
        "round": 1,
        "editor_output": {"title": item.source_title_guess, "body": item.source_text, "hashtags": []},
        "verifier": {"pass": True, "confidence": 0.95, "issues": []},
        "verifier_pass": True,
        "verifier_confidence": 0.95,
        "rewrite_fail_reasons": [],
        "safe_rewrite_used": False,
        "safe_rewrite_reason": None,
        "final_title": item.source_title_guess,
        "final_body": item.source_text,
        "final_hashtags": [],
        "copy_ready_text": item.source_text,
        "quality_score": 88,
        "model_meta": {"pipeline": "fake"},
        "actual_tokens": 11,
    }


@pytest.mark.asyncio
async def test_process_xhs_batch_job_async_only_runs_trial_sample(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    await _create_batch_job(
        async_session_factory,
        job_id="job-trial-1",
        run_mode="trial",
        total_items=4,
        trial_sample_count=2,
    )

    processed_items: list[str] = []
    events: list[tuple[str, dict]] = []

    async def fake_process_xhs_batch_item(*args, **kwargs):
        item = kwargs["item"]
        processed_items.append(item.item_id)
        return {
            "round": 1,
            "editor_output": {"title": item.source_title_guess, "body": item.source_text, "hashtags": []},
            "verifier": {"pass": True, "confidence": 0.95, "issues": []},
            "verifier_pass": True,
            "verifier_confidence": 0.95,
            "rewrite_fail_reasons": [],
            "safe_rewrite_used": False,
            "safe_rewrite_reason": None,
            "final_title": item.source_title_guess,
            "final_body": item.source_text,
            "final_hashtags": [],
            "copy_ready_text": item.source_text,
            "quality_score": 88,
            "model_meta": {"pipeline": "fake"},
            "actual_tokens": 11,
        }

    async def fake_publish_sse_event(user_id: str, event: str, data: dict):
        events.append((event, data))

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.process_xhs_batch_item", fake_process_xhs_batch_item)
    monkeypatch.setattr("app.tasks.xhs_batch.publish_sse_event", fake_publish_sse_event)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.USE_CELERY", False, raising=False)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.XHS_BATCH_PARALLELISM", 4, raising=False)

    await process_xhs_batch_job_async("job-trial-1")

    assert set(processed_items) == {"item_001", "item_002"}

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-trial-1"))).scalar_one()
        items = list(
            (
                await session.execute(
                    select(XHSBatchItem).where(XHSBatchItem.batch_id == job.id).order_by(XHSBatchItem.item_id.asc())
                )
            )
            .scalars()
            .all()
        )

    assert job.status == "done"
    assert job.done_items == 2
    assert job.total_items == 4
    assert items[0].status == "completed"
    assert items[1].status == "completed"
    assert items[2].status == "pending"
    assert items[2].model_meta_json["skipped_by"] == "trial_mode"
    assert items[3].model_meta_json["selected_for_run"] is False

    assert events[0][0] == "xhs_batch_started"
    assert events[0][1]["planned_items"] == 2
    assert events[-1][0] == "xhs_batch_completed"
    assert events[-1][1]["status"] == "done"
    assert events[-1][1]["done_items"] == 2


@pytest.mark.asyncio
async def test_process_xhs_batch_job_async_continues_after_item_exception(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    await _create_batch_job(
        async_session_factory,
        job_id="job-fail-1",
        run_mode="full",
        total_items=2,
    )

    events: list[tuple[str, dict]] = []

    async def fake_process_xhs_batch_item(*args, **kwargs):
        item = kwargs["item"]
        if item.item_id == "item_001":
            raise RuntimeError("Request timed out.")
        return {
            "round": 1,
            "editor_output": {"title": item.source_title_guess, "body": item.source_text, "hashtags": []},
            "verifier": {"pass": True, "confidence": 0.95, "issues": []},
            "verifier_pass": True,
            "verifier_confidence": 0.95,
            "rewrite_fail_reasons": [],
            "safe_rewrite_used": False,
            "safe_rewrite_reason": None,
            "final_title": item.source_title_guess,
            "final_body": item.source_text,
            "final_hashtags": [],
            "copy_ready_text": item.source_text,
            "quality_score": 88,
            "model_meta": {"pipeline": "fake"},
            "actual_tokens": 11,
        }

    async def fake_publish_sse_event(user_id: str, event: str, data: dict):
        events.append((event, data))

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.process_xhs_batch_item", fake_process_xhs_batch_item)
    monkeypatch.setattr("app.tasks.xhs_batch.publish_sse_event", fake_publish_sse_event)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.USE_CELERY", False, raising=False)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.XHS_BATCH_PARALLELISM", 4, raising=False)

    await process_xhs_batch_job_async("job-fail-1")

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-fail-1"))).scalar_one()
        items = list(
            (
                await session.execute(
                    select(XHSBatchItem).where(XHSBatchItem.batch_id == job.id).order_by(XHSBatchItem.item_id.asc())
                )
            )
            .scalars()
            .all()
        )

    assert job.status == "partially_done"
    assert job.done_items == 2
    assert job.running_items == 0
    assert job.system_blocked is False
    assert items[0].status == "failed"
    assert items[0].rewrite_fail_reasons_json == ["Request timed out."]
    assert items[1].status == "completed"
    assert events[-1][0] == "xhs_batch_completed"
    assert events[-1][1]["status"] == "partially_done"
    assert not any(event == "xhs_batch_failed" for event, _ in events)


@pytest.mark.asyncio
async def test_process_xhs_batch_job_async_marks_failed_alignment_items_as_awaiting_decision(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    await _create_batch_job(
        async_session_factory,
        job_id="job-decision-1",
        run_mode="full",
        total_items=1,
    )

    events: list[tuple[str, dict]] = []

    async def fake_process_xhs_batch_item(*args, **kwargs):
        item = kwargs["item"]
        return {
            "round": 3,
            "editor_output": {"title": item.source_title_guess, "body": item.source_text, "hashtags": []},
            "verifier": {"pass": False, "confidence": 0.7, "issues": [{"reason": "主版本核心卖点和方向要求冲突"}]},
            "verifier_pass": False,
            "verifier_confidence": 0.7,
            "rewrite_fail_reasons": ["主版本核心卖点和方向要求冲突"],
            "safe_rewrite_used": False,
            "safe_rewrite_reason": "alignment_not_satisfied",
            "final_title": item.source_title_guess,
            "final_body": item.source_text,
            "final_hashtags": [],
            "copy_ready_text": item.source_text,
            "quality_score": 68,
            "item_status": "failed",
            "model_meta": {"pipeline": "fake"},
            "actual_tokens": 11,
        }

    async def fake_publish_sse_event(user_id: str, event: str, data: dict):
        events.append((event, data))

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.process_xhs_batch_item", fake_process_xhs_batch_item)
    monkeypatch.setattr("app.tasks.xhs_batch.publish_sse_event", fake_publish_sse_event)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.USE_CELERY", False, raising=False)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.XHS_BATCH_PARALLELISM", 4, raising=False)

    await process_xhs_batch_job_async("job-decision-1")

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-decision-1"))).scalar_one()
        item = (
            await session.execute(
                select(XHSBatchItem).where(XHSBatchItem.batch_id == job.id, XHSBatchItem.item_id == "item_001")
            )
        ).scalar_one()

    assert job.status == "awaiting_decision"
    assert job.done_items == 1
    assert job.running_items == 0
    assert item.status == "failed"
    assert item.safe_rewrite_reason == "alignment_not_satisfied"
    assert events[-1][0] == "xhs_batch_completed"
    assert events[-1][1]["status"] == "awaiting_decision"


@pytest.mark.asyncio
async def test_process_xhs_batch_job_async_dispatches_one_celery_task_per_item(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    await _create_batch_job(
        async_session_factory,
        job_id="job-celery-1",
        run_mode="full",
        total_items=3,
    )

    events: list[tuple[str, dict]] = []
    dispatched: list[tuple[str, str]] = []

    async def fake_publish_sse_event(user_id: str, event: str, data: dict):
        events.append((event, data))

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.publish_sse_event", fake_publish_sse_event)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.USE_CELERY", True, raising=False)
    monkeypatch.setattr(
        "app.tasks.xhs_batch.process_xhs_batch_item_task.delay",
        lambda batch_id, item_id: dispatched.append((batch_id, item_id)),
    )

    await process_xhs_batch_job_async("job-celery-1")

    assert dispatched == [
        ("job-celery-1", "item_001"),
        ("job-celery-1", "item_002"),
        ("job-celery-1", "item_003"),
    ]

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-celery-1"))).scalar_one()
        items = list(
            (
                await session.execute(
                    select(XHSBatchItem).where(XHSBatchItem.batch_id == job.id).order_by(XHSBatchItem.item_id.asc())
                )
            )
            .scalars()
            .all()
        )

    assert job.status == "queued"
    assert job.done_items == 0
    assert job.running_items == 0
    assert all(item.status == "pending" for item in items)
    assert all(item.model_meta_json["selected_for_run"] is True for item in items)
    assert events[0][0] == "xhs_batch_started"
    assert events[0][1]["planned_items"] == 3


@pytest.mark.asyncio
async def test_process_xhs_batch_job_async_retry_tracks_progress_only_for_selected_items(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    await _create_batch_job(
        async_session_factory,
        job_id="job-retry-1",
        run_mode="full",
        total_items=3,
    )

    async with async_session_factory() as session:
        items = list(
            (
                await session.execute(
                    select(XHSBatchItem).where(XHSBatchItem.batch_id == "job-retry-1").order_by(XHSBatchItem.item_id.asc())
                )
            )
            .scalars()
            .all()
        )
        for item in items[:2]:
            item.status = "completed"
            item.model_meta_json = {"selected_for_run": False}
        items[2].status = "pending"
        items[2].model_meta_json = {"selected_for_run": True, "retry_requested": True}
        await session.commit()

    events: list[tuple[str, dict]] = []

    async def fake_process_xhs_batch_item(*args, **kwargs):
        item = kwargs["item"]
        return {
            "round": 1,
            "editor_output": {"title": item.source_title_guess, "body": item.source_text, "hashtags": []},
            "verifier": {"pass": True, "confidence": 0.95, "issues": []},
            "verifier_pass": True,
            "verifier_confidence": 0.95,
            "rewrite_fail_reasons": [],
            "safe_rewrite_used": False,
            "safe_rewrite_reason": None,
            "final_title": item.source_title_guess,
            "final_body": item.source_text,
            "final_hashtags": [],
            "copy_ready_text": item.source_text,
            "quality_score": 88,
            "model_meta": {"pipeline": "fake"},
            "actual_tokens": 11,
        }

    async def fake_publish_sse_event(user_id: str, event: str, data: dict):
        events.append((event, data))

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.process_xhs_batch_item", fake_process_xhs_batch_item)
    monkeypatch.setattr("app.tasks.xhs_batch.publish_sse_event", fake_publish_sse_event)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.USE_CELERY", False, raising=False)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.XHS_BATCH_PARALLELISM", 4, raising=False)

    await process_xhs_batch_job_async("job-retry-1", item_ids=["item_003"])

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-retry-1"))).scalar_one()

    assert job.done_items == 1
    assert events[0][0] == "xhs_batch_started"
    assert events[0][1]["planned_items"] == 1
    assert events[0][1]["done_items"] == 0
    assert events[-1][0] == "xhs_batch_completed"
    assert events[-1][1]["done_items"] == 1


@pytest.mark.asyncio
async def test_process_xhs_batch_item_async_skips_item_with_active_external_lease(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    await _create_batch_job(
        async_session_factory,
        job_id="job-lease-1",
        run_mode="full",
        total_items=1,
    )

    now = datetime.now(timezone.utc)
    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-lease-1"))).scalar_one()
        item = (
            await session.execute(
                select(XHSBatchItem).where(
                    XHSBatchItem.batch_id == "job-lease-1",
                    XHSBatchItem.item_id == "item_001",
                )
            )
        ).scalar_one()
        job.status = "running"
        job.running_items = 1
        item.status = "running"
        item.started_at = now
        item.model_meta_json = {
            "selected_for_run": True,
            "processing_token": "worker-existing",
            "processing_heartbeat_at": now.isoformat(),
            "processing_lease_expires_at": (now + timedelta(minutes=5)).isoformat(),
        }
        await session.commit()

    processed = False

    async def fake_process_xhs_batch_item(*args, **kwargs):
        nonlocal processed
        processed = True
        return _build_success_result(kwargs["item"])

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.process_xhs_batch_item", fake_process_xhs_batch_item)

    await xhs_batch_tasks.process_xhs_batch_item_async("job-lease-1", "item_001")

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-lease-1"))).scalar_one()
        item = (
            await session.execute(
                select(XHSBatchItem).where(
                    XHSBatchItem.batch_id == "job-lease-1",
                    XHSBatchItem.item_id == "item_001",
                )
            )
        ).scalar_one()

    assert processed is False
    assert job.status == "running"
    assert job.running_items == 1
    assert item.status == "running"
    assert item.model_meta_json["processing_token"] == "worker-existing"


@pytest.mark.asyncio
async def test_process_xhs_batch_item_async_skips_stale_completion_write_when_lease_changes(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    await _create_batch_job(
        async_session_factory,
        job_id="job-stale-write-1",
        run_mode="full",
        total_items=1,
    )

    async with async_session_factory() as session:
        item = (
            await session.execute(
                select(XHSBatchItem).where(
                    XHSBatchItem.batch_id == "job-stale-write-1",
                    XHSBatchItem.item_id == "item_001",
                )
            )
        ).scalar_one()
        item.model_meta_json = {"selected_for_run": True}
        await session.commit()

    async def fake_publish_sse_event(user_id: str, event: str, data: dict):
        return None

    async def fake_process_xhs_batch_item(*args, **kwargs):
        db = kwargs["db"]
        item = kwargs["item"]
        xhs_batch_tasks._set_processing_lease(item, "worker-takeover", recovered_by="periodic")
        await db.commit()
        return _build_success_result(item)

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.publish_sse_event", fake_publish_sse_event)
    monkeypatch.setattr("app.tasks.xhs_batch.process_xhs_batch_item", fake_process_xhs_batch_item)

    await xhs_batch_tasks._process_xhs_batch_item_async(
        "job-stale-write-1",
        "item_001",
        processing_token="worker-original",
    )

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-stale-write-1"))).scalar_one()
        item = (
            await session.execute(
                select(XHSBatchItem).where(
                    XHSBatchItem.batch_id == "job-stale-write-1",
                    XHSBatchItem.item_id == "item_001",
                )
            )
        ).scalar_one()

    assert job.status == "running"
    assert job.running_items == 1
    assert item.status == "running"
    assert item.finished_at is None
    assert item.final_title is None
    assert item.model_meta_json["processing_token"] == "worker-takeover"


@pytest.mark.asyncio
async def test_mark_xhs_item_timeout_async_skips_stale_worker_token(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    await _create_batch_job(
        async_session_factory,
        job_id="job-timeout-stale-1",
        run_mode="full",
        total_items=1,
    )

    now = datetime.now(timezone.utc)
    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-timeout-stale-1"))).scalar_one()
        item = (
            await session.execute(
                select(XHSBatchItem).where(
                    XHSBatchItem.batch_id == "job-timeout-stale-1",
                    XHSBatchItem.item_id == "item_001",
                )
            )
        ).scalar_one()
        job.status = "running"
        job.running_items = 1
        item.status = "running"
        item.model_meta_json = {
            "selected_for_run": True,
            "processing_token": "worker-current",
            "processing_lease_expires_at": (now + timedelta(minutes=5)).isoformat(),
        }
        await session.commit()

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)

    await xhs_batch_tasks._mark_xhs_item_timeout_async(
        "job-timeout-stale-1",
        "item_001",
        processing_token="worker-stale",
    )

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-timeout-stale-1"))).scalar_one()
        item = (
            await session.execute(
                select(XHSBatchItem).where(
                    XHSBatchItem.batch_id == "job-timeout-stale-1",
                    XHSBatchItem.item_id == "item_001",
                )
            )
        ).scalar_one()

    assert job.status == "running"
    assert job.running_items == 1
    assert item.status == "running"
    assert item.finished_at is None
    assert item.rewrite_fail_reasons_json is None


def test_process_xhs_batch_item_task_marks_item_failed_on_soft_timeout(test_db_engine, monkeypatch, event_loop):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    event_loop.run_until_complete(
        _create_batch_job(
            async_session_factory,
            job_id="job-timeout-1",
            run_mode="full",
            total_items=1,
        )
    )

    async def _prepare() -> None:
        async with async_session_factory() as session:
            job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-timeout-1"))).scalar_one()
            item = (
                await session.execute(
                    select(XHSBatchItem).where(
                        XHSBatchItem.batch_id == "job-timeout-1",
                        XHSBatchItem.item_id == "item_001",
                    )
                )
            ).scalar_one()
            job.status = "running"
            job.running_items = 1
            item.status = "running"
            item.model_meta_json = {"selected_for_run": True}
            await session.commit()

    event_loop.run_until_complete(_prepare())

    events: list[tuple[str, dict]] = []

    async def fake_publish_sse_event(user_id: str, event: str, data: dict):
        events.append((event, data))

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.publish_sse_event", fake_publish_sse_event)

    async def fake_process_xhs_batch_item_async(batch_id: str, item_id: str, processing_token: str | None = None):
        async with async_session_factory() as session:
            item = (
                await session.execute(
                    select(XHSBatchItem).where(
                        XHSBatchItem.batch_id == batch_id,
                        XHSBatchItem.item_id == item_id,
                    )
                )
            ).scalar_one()
            item.model_meta_json = {
                **(item.model_meta_json or {}),
                "selected_for_run": True,
                "processing_token": processing_token,
                "processing_lease_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
            }
            await session.commit()
        raise SoftTimeLimitExceeded()

    monkeypatch.setattr("app.tasks.xhs_batch._process_xhs_batch_item_async", fake_process_xhs_batch_item_async)

    with pytest.raises(SoftTimeLimitExceeded):
        process_xhs_batch_item_task("job-timeout-1", "item_001")

    async def _read_back():
        async with async_session_factory() as session:
            job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-timeout-1"))).scalar_one()
            item = (
                await session.execute(
                    select(XHSBatchItem).where(
                        XHSBatchItem.batch_id == "job-timeout-1",
                        XHSBatchItem.item_id == "item_001",
                    )
                )
            ).scalar_one()
            return job, item

    job, item = event_loop.run_until_complete(_read_back())

    assert job.status == "partially_done"
    assert job.done_items == 1
    assert job.running_items == 0
    assert item.status == "failed"
    assert item.rewrite_fail_reasons_json == ["任务执行超时，请重试"]
    assert events[-1][0] == "xhs_batch_completed"
