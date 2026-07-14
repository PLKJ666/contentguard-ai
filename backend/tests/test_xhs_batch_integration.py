"""
XHS 批处理集成测试。

使用 testcontainers + 真实 PostgreSQL，覆盖租约争抢和恢复重派发链路。
运行: pytest tests/test_xhs_batch_integration.py -m integration
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

import app.tasks.xhs_batch as xhs_batch_tasks
from app.models.base import Base
from app.models.tenant import Tenant
from app.models.xhs import XHSBatchItem, XHSBatchJob


@pytest.fixture
async def postgres_xhs_session_factory(postgres_container):
    host = postgres_container.get_container_host_ip()
    port = postgres_container.get_exposed_port(5432)
    db_url = f"postgresql+asyncpg://test:test@{host}:{port}/test"

    engine = create_async_engine(db_url, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async_session_factory = sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    try:
        yield async_session_factory
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


async def _create_batch_job(async_session_factory, *, job_id: str) -> None:
    async with async_session_factory() as session:
        session.add(
            Tenant(
                id="tenant-1",
                name="Test Tenant",
                is_active=True,
            )
        )
        job = XHSBatchJob(
            id=job_id,
            tenant_id="tenant-1",
            created_by="user-1",
            status="pending",
            category_id="beauty",
            run_mode="full",
            input_type="text",
            total_items=1,
            done_items=0,
            running_items=0,
        )
        session.add(job)
        session.add(
            XHSBatchItem(
                id=f"{job_id}-item-1",
                batch_id=job.id,
                item_id="item_001",
                source_text="标题1\n正文1",
                source_title_guess="标题1",
                status="pending",
                round=0,
                model_meta_json={"selected_for_run": True},
            )
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
        "model_meta": {"pipeline": "integration"},
        "actual_tokens": 11,
    }


async def _wait_for_batch_completion(async_session_factory, batch_id: str, *, timeout_seconds: float = 3.0) -> tuple[XHSBatchJob, XHSBatchItem]:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while True:
        async with async_session_factory() as session:
            job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == batch_id))).scalar_one()
            item = (
                await session.execute(
                    select(XHSBatchItem).where(
                        XHSBatchItem.batch_id == batch_id,
                        XHSBatchItem.item_id == "item_001",
                    )
                )
            ).scalar_one()
            if job.status == "done" and item.status == "completed":
                return job, item

        if asyncio.get_running_loop().time() >= deadline:
            return job, item
        await asyncio.sleep(0.05)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_process_xhs_batch_item_async_real_postgres_allows_only_one_worker(
    postgres_xhs_session_factory,
    monkeypatch,
):
    await _create_batch_job(postgres_xhs_session_factory, job_id="job-integration-race-1")

    process_started = asyncio.Event()
    release_processing = asyncio.Event()
    processed_tokens: list[str | None] = []

    async def fake_publish_sse_event(user_id: str, event: str, data: dict):
        return None

    async def fake_process_xhs_batch_item(*args, **kwargs):
        item = kwargs["item"]
        processed_tokens.append(xhs_batch_tasks._current_processing_token(item))
        process_started.set()
        await asyncio.wait_for(release_processing.wait(), timeout=2)
        return _build_success_result(item)

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: postgres_xhs_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.publish_sse_event", fake_publish_sse_event)
    monkeypatch.setattr("app.tasks.xhs_batch.process_xhs_batch_item", fake_process_xhs_batch_item)

    task1 = asyncio.create_task(
        xhs_batch_tasks._process_xhs_batch_item_async(
            "job-integration-race-1",
            "item_001",
            processing_token="worker-1",
        )
    )
    await asyncio.wait_for(process_started.wait(), timeout=2)
    task2 = asyncio.create_task(
        xhs_batch_tasks._process_xhs_batch_item_async(
            "job-integration-race-1",
            "item_001",
            processing_token="worker-2",
        )
    )

    await asyncio.sleep(0.2)
    release_processing.set()
    await asyncio.gather(task1, task2)

    async with postgres_xhs_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-integration-race-1"))).scalar_one()
        item = (
            await session.execute(
                select(XHSBatchItem).where(
                    XHSBatchItem.batch_id == "job-integration-race-1",
                    XHSBatchItem.item_id == "item_001",
                )
            )
        ).scalar_one()

    assert len(processed_tokens) == 1
    assert processed_tokens[0] in {"worker-1", "worker-2"}
    assert job.status == "done"
    assert job.done_items == 1
    assert job.running_items == 0
    assert item.status == "completed"
    assert item.final_title == "标题1"
    assert item.model_meta_json["pipeline"] == "integration"
    assert "processing_token" not in item.model_meta_json


@pytest.mark.integration
@pytest.mark.asyncio
async def test_recover_stuck_xhs_batch_items_async_real_postgres_redispatches_local_item(
    postgres_xhs_session_factory,
    monkeypatch,
):
    await _create_batch_job(postgres_xhs_session_factory, job_id="job-integration-recover-1")

    expired_at = datetime.now(timezone.utc) - timedelta(minutes=3)
    async with postgres_xhs_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-integration-recover-1"))).scalar_one()
        item = (
            await session.execute(
                select(XHSBatchItem).where(
                    XHSBatchItem.batch_id == "job-integration-recover-1",
                    XHSBatchItem.item_id == "item_001",
                )
            )
        ).scalar_one()
        job.status = "running"
        job.running_items = 1
        item.status = "running"
        item.started_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        item.model_meta_json = {
            "selected_for_run": True,
            "processing_token": "worker-expired",
            "processing_heartbeat_at": expired_at.isoformat(),
            "processing_lease_expires_at": expired_at.isoformat(),
        }
        await session.commit()

    processed = asyncio.Event()

    async def fake_publish_sse_event(user_id: str, event: str, data: dict):
        return None

    async def fake_process_xhs_batch_item(*args, **kwargs):
        processed.set()
        return _build_success_result(kwargs["item"])

    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: postgres_xhs_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.publish_sse_event", fake_publish_sse_event)
    monkeypatch.setattr("app.tasks.xhs_batch.process_xhs_batch_item", fake_process_xhs_batch_item)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.USE_CELERY", False, raising=False)

    recovered_count = await xhs_batch_tasks.recover_stuck_xhs_batch_items_async(recovered_by="integration")
    await asyncio.wait_for(processed.wait(), timeout=2)
    job, item = await _wait_for_batch_completion(
        postgres_xhs_session_factory,
        "job-integration-recover-1",
    )

    assert recovered_count == 1
    assert job.status == "done"
    assert job.done_items == 1
    assert job.running_items == 0
    assert item.status == "completed"
    assert item.final_title == "标题1"
    assert "processing_token" not in item.model_meta_json
