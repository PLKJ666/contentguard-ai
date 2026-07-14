import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

from app.main import _recover_stuck_xhs_batch_tasks, _run_periodic_xhs_batch_recovery
from app.models.xhs import XHSBatchItem, XHSBatchJob


@pytest.mark.asyncio
async def test_recover_stuck_xhs_batch_tasks_requeues_running_item_with_expired_lease(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    expired_at = datetime.now(timezone.utc) - timedelta(minutes=3)

    async with async_session_factory() as session:
        session.add(
            XHSBatchJob(
                id="job-recover-1",
                tenant_id="tenant-1",
                created_by="user-1",
                status="running",
                category_id="beauty",
                run_mode="full",
                input_type="text",
                total_items=3,
                done_items=2,
                running_items=1,
            )
        )
        session.add_all(
            [
                XHSBatchItem(
                    id="job-recover-1-item-1",
                    batch_id="job-recover-1",
                    item_id="item_001",
                    source_text="标题1\n正文1",
                    source_title_guess="标题1",
                    status="failed",
                    round=3,
                    model_meta_json={"selected_for_run": True},
                ),
                XHSBatchItem(
                    id="job-recover-1-item-2",
                    batch_id="job-recover-1",
                    item_id="item_002",
                    source_text="标题2\n正文2",
                    source_title_guess="标题2",
                    status="completed",
                    round=1,
                    model_meta_json={"selected_for_run": True},
                ),
                XHSBatchItem(
                    id="job-recover-1-item-3",
                    batch_id="job-recover-1",
                    item_id="item_003",
                    source_text="标题3\n正文3",
                    source_title_guess="标题3",
                    status="running",
                    round=1,
                    started_at=datetime.now(timezone.utc) - timedelta(seconds=30),
                    model_meta_json={
                        "selected_for_run": True,
                        "processing_token": "worker-expired",
                        "processing_heartbeat_at": expired_at.isoformat(),
                        "processing_lease_expires_at": expired_at.isoformat(),
                    },
                ),
            ]
        )
        await session.commit()

    dispatched: list[tuple[str, str]] = []
    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.USE_CELERY", True, raising=False)
    monkeypatch.setattr(
        "app.tasks.xhs_batch.process_xhs_batch_item_task.delay",
        lambda batch_id, item_id: dispatched.append((batch_id, item_id)),
    )

    await _recover_stuck_xhs_batch_tasks()

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-recover-1"))).scalar_one()
        items = list(
            (
                await session.execute(
                    select(XHSBatchItem).where(XHSBatchItem.batch_id == "job-recover-1").order_by(XHSBatchItem.item_id.asc())
                )
            ).scalars().all()
        )

    assert dispatched == [("job-recover-1", "item_003")]
    assert job.status == "queued"
    assert job.done_items == 2
    assert job.running_items == 0
    assert job.system_blocked is False
    assert items[2].status == "pending"
    assert items[2].started_at is None
    assert items[2].model_meta_json["selected_for_run"] is True
    assert items[2].model_meta_json["recovered_by"] == "startup"
    assert "processing_token" not in items[2].model_meta_json


@pytest.mark.asyncio
async def test_recover_stuck_xhs_batch_tasks_ignores_running_item_with_active_lease(test_db_engine, monkeypatch):
    async_session_factory = sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    future_at = datetime.now(timezone.utc) + timedelta(minutes=3)

    async with async_session_factory() as session:
        session.add(
            XHSBatchJob(
                id="job-recover-2",
                tenant_id="tenant-1",
                created_by="user-1",
                status="running",
                category_id="beauty",
                run_mode="full",
                input_type="text",
                total_items=1,
                done_items=0,
                running_items=1,
            )
        )
        session.add(
            XHSBatchItem(
                id="job-recover-2-item-1",
                batch_id="job-recover-2",
                item_id="item_001",
                source_text="标题1\n正文1",
                source_title_guess="标题1",
                status="running",
                round=1,
                started_at=datetime.now(timezone.utc) - timedelta(seconds=20),
                model_meta_json={
                    "selected_for_run": True,
                    "processing_token": "worker-active",
                    "processing_heartbeat_at": datetime.now(timezone.utc).isoformat(),
                    "processing_lease_expires_at": future_at.isoformat(),
                },
            )
        )
        await session.commit()

    dispatched: list[tuple[str, str]] = []
    monkeypatch.setattr("app.tasks.xhs_batch.get_async_session", lambda: async_session_factory)
    monkeypatch.setattr("app.tasks.xhs_batch.settings.USE_CELERY", True, raising=False)
    monkeypatch.setattr(
        "app.tasks.xhs_batch.process_xhs_batch_item_task.delay",
        lambda batch_id, item_id: dispatched.append((batch_id, item_id)),
    )

    await _recover_stuck_xhs_batch_tasks()

    async with async_session_factory() as session:
        job = (await session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "job-recover-2"))).scalar_one()
        item = (
            await session.execute(
                select(XHSBatchItem).where(
                    XHSBatchItem.batch_id == "job-recover-2",
                    XHSBatchItem.item_id == "item_001",
                )
            )
        ).scalar_one()

    assert dispatched == []
    assert job.status == "running"
    assert job.running_items == 1
    assert item.status == "running"
    assert item.model_meta_json["processing_token"] == "worker-active"


@pytest.mark.asyncio
async def test_run_periodic_xhs_batch_recovery_uses_periodic_marker(monkeypatch):
    recovered_by_values: list[str] = []
    first_call = asyncio.Event()

    async def fake_recover_stuck_xhs_batch_items_async(*, recovered_by: str) -> int:
        recovered_by_values.append(recovered_by)
        first_call.set()
        return 0

    monkeypatch.setattr(
        "app.tasks.xhs_batch.recover_stuck_xhs_batch_items_async",
        fake_recover_stuck_xhs_batch_items_async,
    )

    recovery_task = asyncio.create_task(_run_periodic_xhs_batch_recovery(interval_seconds=0.01))
    await asyncio.wait_for(first_call.wait(), timeout=1)
    recovery_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await recovery_task

    assert recovered_by_values == ["periodic"]
