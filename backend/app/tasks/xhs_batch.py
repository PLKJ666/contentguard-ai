"""
XHS 批量图文任务执行。
"""
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4
from typing import Optional

from celery import shared_task
from billiard.exceptions import SoftTimeLimitExceeded
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.api.sse import publish_sse_event
from app.config import settings
from app.models.xhs import XHSBatchItem, XHSBatchJob
from app.services.xhs_batch_service import _build_manual_decision_payload, process_xhs_batch_item

logger = logging.getLogger(__name__)

PROCESSED_ITEM_STATUSES = {"completed", "failed", "needs_decision"}
TERMINAL_BATCH_STATUSES = {"done", "partially_done", "failed", "blocked", "cancelled", "completed", "exported", "awaiting_decision"}
PROCESSING_TOKEN_META_KEY = "processing_token"
PROCESSING_HEARTBEAT_AT_META_KEY = "processing_heartbeat_at"
PROCESSING_LEASE_EXPIRES_AT_META_KEY = "processing_lease_expires_at"
PROCESSING_RECOVERED_BY_META_KEY = "recovered_by"
PROCESSING_LEASE_SECONDS = 120
PROCESSING_HEARTBEAT_INTERVAL_SECONDS = 30
RUNTIME_META_KEYS = {
    "selected_for_run",
    "skipped_by",
    "retry_requested",
    "actual_tokens",
    "decision_summary",
    "decision_options",
    "recommended_decision_option_id",
    "selected_decision_option_id",
    "manual_decision_applied",
    PROCESSING_TOKEN_META_KEY,
    PROCESSING_HEARTBEAT_AT_META_KEY,
    PROCESSING_LEASE_EXPIRES_AT_META_KEY,
    PROCESSING_RECOVERED_BY_META_KEY,
}


@dataclass
class BatchState:
    job: XHSBatchJob
    planned_items: int
    is_terminal: bool


def get_async_engine() -> AsyncEngine:
    return create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=3600,
    )


def get_async_session(engine: Optional[AsyncEngine] = None) -> sessionmaker:
    db_engine = engine or get_async_engine()
    factory = sessionmaker(
        db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    setattr(factory, "_contentguard_engine", db_engine)
    return factory


async def _notify_batch_event(job: XHSBatchJob, event: str, payload: dict) -> None:
    try:
        await publish_sse_event(job.created_by, event, payload)
    except Exception as exc:
        logger.debug("XHS batch SSE 推送失败: %s", exc)


def _base_planned_item_count(job: XHSBatchJob) -> int:
    if job.run_mode == "trial":
        sample_count = job.trial_sample_count or 3
        return min(job.total_items, sample_count)
    return job.total_items


def _build_batch_event_payload(
    job: XHSBatchJob,
    *,
    planned_items: int,
    current_item_id: Optional[str] = None,
    current_item_status: Optional[str] = None,
    reason: Optional[str] = None,
    phase: Optional[str] = None,
) -> dict:
    payload = {
        "batch_id": job.id,
        "status": job.status,
        "run_mode": job.run_mode,
        "done_items": job.done_items,
        "total_items": job.total_items,
        "planned_items": planned_items,
        "running_items": job.running_items,
        "system_blocked": job.system_blocked,
    }
    if current_item_id:
        payload["current_item_id"] = current_item_id
    if current_item_status:
        payload["current_item_status"] = current_item_status
    if reason:
        payload["reason"] = reason
    if phase:
        payload["phase"] = phase
    return payload


def _processed_item_count(items: list[XHSBatchItem], *, selected_only: bool = False) -> int:
    return sum(
        1
        for item in items
        if item.status in PROCESSED_ITEM_STATUSES and (not selected_only or _is_selected_for_run(item))
    )


def _item_meta(item: XHSBatchItem) -> dict:
    return dict(item.model_meta_json or {})


def _set_item_meta(item: XHSBatchItem, **updates: Optional[object]) -> None:
    meta = _item_meta(item)
    for key, value in updates.items():
        if value is None:
            meta.pop(key, None)
            continue
        meta[key] = value
    item.model_meta_json = meta


def _is_selected_for_run(item: XHSBatchItem) -> bool:
    return bool(_item_meta(item).get("selected_for_run"))


def _parse_meta_datetime(value: object) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _lease_expiry(now: Optional[datetime] = None) -> datetime:
    current_time = now or datetime.now(timezone.utc)
    return current_time + timedelta(seconds=PROCESSING_LEASE_SECONDS)


def _new_processing_token(prefix: str = "local") -> str:
    return f"{prefix}:{uuid4().hex}"


def _current_processing_token(item: XHSBatchItem) -> Optional[str]:
    token = _item_meta(item).get(PROCESSING_TOKEN_META_KEY)
    if isinstance(token, str) and token.strip():
        return token.strip()
    return None


def _processing_token_matches(item: XHSBatchItem, processing_token: Optional[str]) -> bool:
    if not processing_token:
        return False
    return _current_processing_token(item) == processing_token


def _has_active_processing_lease(item: XHSBatchItem, now: Optional[datetime] = None) -> bool:
    lease_expires_at = _parse_meta_datetime(_item_meta(item).get(PROCESSING_LEASE_EXPIRES_AT_META_KEY))
    if not lease_expires_at:
        return False
    current_time = now or datetime.now(timezone.utc)
    return lease_expires_at > current_time


def _set_processing_lease(
    item: XHSBatchItem,
    processing_token: str,
    *,
    now: Optional[datetime] = None,
    recovered_by: Optional[str] = None,
) -> None:
    current_time = now or datetime.now(timezone.utc)
    _set_item_meta(
        item,
        **{
            PROCESSING_TOKEN_META_KEY: processing_token,
            PROCESSING_HEARTBEAT_AT_META_KEY: current_time.isoformat(),
            PROCESSING_LEASE_EXPIRES_AT_META_KEY: _lease_expiry(current_time).isoformat(),
            PROCESSING_RECOVERED_BY_META_KEY: recovered_by,
        },
    )


def _clear_processing_lease(item: XHSBatchItem) -> None:
    _set_item_meta(
        item,
        **{
            PROCESSING_TOKEN_META_KEY: None,
            PROCESSING_HEARTBEAT_AT_META_KEY: None,
            PROCESSING_LEASE_EXPIRES_AT_META_KEY: None,
            PROCESSING_RECOVERED_BY_META_KEY: None,
        },
    )


def _item_requires_manual_decision(item: XHSBatchItem) -> bool:
    meta = dict(item.model_meta_json or {})
    if not meta.get("decision_options") and item.status == "failed" and item.safe_rewrite_reason == "alignment_not_satisfied":
        meta = {
            **meta,
            **_build_manual_decision_payload(
                item.rewrite_fail_reasons_json or [],
                meta.get("selected_decision_option_id"),
            ),
        }
    return bool(meta.get("decision_options")) and item.status in {"needs_decision", "failed"}


def _reset_item_for_run(item: XHSBatchItem) -> None:
    item.status = "pending"
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
    meta = _item_meta(item)
    for key in RUNTIME_META_KEYS:
        meta.pop(key, None)
    item.model_meta_json = meta


async def _load_job(db: AsyncSession, batch_id: str, *, for_update: bool = False) -> Optional[XHSBatchJob]:
    query = select(XHSBatchJob).where(XHSBatchJob.id == batch_id)
    if for_update:
        query = query.with_for_update()
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def _load_batch_items(db: AsyncSession, batch_id: str) -> list[XHSBatchItem]:
    items_result = await db.execute(
        select(XHSBatchItem).where(XHSBatchItem.batch_id == batch_id).order_by(XHSBatchItem.item_id.asc())
    )
    return list(items_result.scalars().all())


async def _load_batch_item(db: AsyncSession, batch_id: str, item_id: str) -> Optional[XHSBatchItem]:
    return await _load_batch_item_with_lock(db, batch_id, item_id, for_update=False)


async def _load_batch_item_with_lock(
    db: AsyncSession,
    batch_id: str,
    item_id: str,
    *,
    for_update: bool,
) -> Optional[XHSBatchItem]:
    query = select(XHSBatchItem).where(
            XHSBatchItem.batch_id == batch_id,
            XHSBatchItem.item_id == item_id,
        )
    if for_update:
        query = query.with_for_update()
    item_result = await db.execute(query)
    return item_result.scalar_one_or_none()


def _planned_item_count(job: XHSBatchJob, items: Optional[list[XHSBatchItem]] = None) -> int:
    if items is None:
        return _base_planned_item_count(job)

    selected_count = sum(1 for item in items if _is_selected_for_run(item))
    return selected_count or _base_planned_item_count(job)


def _sum_actual_tokens(items: list[XHSBatchItem]) -> int:
    total = 0
    for item in items:
        if not _is_selected_for_run(item):
            continue
        total += int(_item_meta(item).get("actual_tokens", 0) or 0)
    return total


def _compute_batch_status(
    *,
    current_status: str,
    selected_total: int,
    selected_running: int,
    selected_pending: int,
    selected_decision: int,
    selected_failed: int,
) -> str:
    if selected_total == 0:
        return "done"
    if selected_running > 0:
        return "running"
    if selected_pending > 0:
        return "queued" if current_status == "queued" else "running"
    if selected_decision > 0:
        return "awaiting_decision"
    return "partially_done" if selected_failed else "done"


async def _heartbeat_xhs_item_async(batch_id: str, item_id: str, processing_token: str, stop_event: asyncio.Event) -> None:
    session_factory = get_async_session()
    engine = getattr(session_factory, "_contentguard_engine", None)
    try:
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=PROCESSING_HEARTBEAT_INTERVAL_SECONDS)
                break
            except asyncio.TimeoutError:
                pass

            async with session_factory() as db:
                item = await _load_batch_item_with_lock(db, batch_id, item_id, for_update=True)
                if not item or item.status != "running" or not _processing_token_matches(item, processing_token):
                    return
                _set_processing_lease(item, processing_token)
                await db.commit()
    finally:
        if engine is not None:
            await engine.dispose()


async def _refresh_batch_state(db: AsyncSession, batch_id: str) -> Optional[BatchState]:
    job = await _load_job(db, batch_id, for_update=True)
    if not job:
        return None

    items = await _load_batch_items(db, batch_id)
    selected_items = [item for item in items if _is_selected_for_run(item)]
    selected_running = sum(1 for item in selected_items if item.status == "running")
    selected_pending = sum(1 for item in selected_items if item.status == "pending")
    selected_decision = sum(1 for item in selected_items if _item_requires_manual_decision(item))
    selected_failed = sum(
        1 for item in selected_items if item.status == "failed" and not _item_requires_manual_decision(item)
    )
    planned_items = len(selected_items) or _base_planned_item_count(job)

    job.done_items = _processed_item_count(items, selected_only=True)
    job.running_items = selected_running
    job.actual_tokens = _sum_actual_tokens(items)
    job.actual_cost = Decimal("0")
    if not job.system_blocked:
        job.status = _compute_batch_status(
            current_status=job.status,
            selected_total=len(selected_items),
            selected_running=selected_running,
            selected_pending=selected_pending,
            selected_decision=selected_decision,
            selected_failed=selected_failed,
        )

    await db.commit()
    await db.refresh(job)
    return BatchState(job=job, planned_items=planned_items, is_terminal=job.status in TERMINAL_BATCH_STATUSES)


async def _settle_batch_state(db: AsyncSession, batch_id: str) -> Optional[BatchState]:
    state = await _refresh_batch_state(db, batch_id)
    if state and not state.is_terminal:
        await asyncio.sleep(0.05)
        state = await _refresh_batch_state(db, batch_id)
    return state


async def _mark_batch_system_failed(batch_id: str, reason: str) -> None:
    session_factory = get_async_session()
    engine = getattr(session_factory, "_contentguard_engine", None)
    try:
        async with session_factory() as db:
            job = await _load_job(db, batch_id)
            if not job:
                return

            items = await _load_batch_items(db, batch_id)
            job.status = "failed"
            job.running_items = 0
            job.done_items = _processed_item_count(items, selected_only=True)
            job.system_blocked = True
            job.system_block_reason = reason
            await db.commit()
            await db.refresh(job)
            await _notify_batch_event(
                job,
                "xhs_batch_failed",
                _build_batch_event_payload(
                    job,
                    planned_items=_planned_item_count(job, items),
                    reason=job.system_block_reason,
                    phase="failed",
                ),
            )
    finally:
        if engine is not None:
            await engine.dispose()


async def _prepare_batch_run(batch_id: str, item_ids: Optional[list[str]] = None) -> list[str]:
    session_factory = get_async_session()
    engine = getattr(session_factory, "_contentguard_engine", None)
    try:
        async with session_factory() as db:
            job = await _load_job(db, batch_id)
            if not job:
                logger.warning("XHS batch job not found: %s", batch_id)
                return []

            items = await _load_batch_items(db, batch_id)
            retry_mode = bool(item_ids)
            item_id_set = set(item_ids or [])

            if retry_mode:
                selected_items = [item for item in items if item.item_id in item_id_set]
                skipped_items = [item for item in items if item.item_id not in item_id_set]
            else:
                planned_items = _base_planned_item_count(job)
                selected_items = items[:planned_items]
                skipped_items = items[planned_items:]
                for item in selected_items:
                    _reset_item_for_run(item)

            selected_item_ids = [item.item_id for item in selected_items]
            if not selected_item_ids:
                logger.warning("XHS batch job has no selected items to run: %s", batch_id)
                return []

            for item in selected_items:
                _set_item_meta(item, selected_for_run=True, skipped_by=None)

            for item in skipped_items:
                _set_item_meta(
                    item,
                    selected_for_run=False,
                    skipped_by="trial_mode" if not retry_mode and job.run_mode == "trial" else None,
                )

            job.status = "queued"
            job.running_items = 0
            job.done_items = _processed_item_count(selected_items) if retry_mode else 0
            job.actual_tokens = 0
            job.actual_cost = Decimal("0")
            job.system_blocked = False
            job.system_block_reason = None
            await db.commit()
            await db.refresh(job)

            await _notify_batch_event(
                job,
                "xhs_batch_started",
                _build_batch_event_payload(
                    job,
                    planned_items=len(selected_item_ids),
                    phase="retry_started" if retry_mode else "started",
                ),
            )
            return selected_item_ids
    finally:
        if engine is not None:
            await engine.dispose()


async def _run_local_items(batch_id: str, item_ids: list[str]) -> None:
    concurrency = max(1, int(settings.XHS_BATCH_PARALLELISM))
    semaphore = asyncio.Semaphore(concurrency)

    async def _worker(item_id: str) -> None:
        async with semaphore:
            await process_xhs_batch_item_async(batch_id, item_id)

    await asyncio.gather(*(_worker(item_id) for item_id in item_ids))

    session_factory = get_async_session()
    engine = getattr(session_factory, "_contentguard_engine", None)
    try:
        async with session_factory() as db:
            state = await _refresh_batch_state(db, batch_id)
            if state and state.is_terminal:
                await _notify_batch_event(
                    state.job,
                    "xhs_batch_completed",
                    _build_batch_event_payload(
                        state.job,
                        planned_items=state.planned_items,
                        phase="completed",
                    ),
                )
    finally:
        if engine is not None:
            await engine.dispose()


async def process_xhs_batch_job_async(batch_id: str, item_ids: Optional[list[str]] = None) -> None:
    try:
        selected_item_ids = await _prepare_batch_run(batch_id, item_ids=item_ids)
        if not selected_item_ids:
            return

        if settings.USE_CELERY:
            for item_id in selected_item_ids:
                process_xhs_batch_item_task.delay(batch_id, item_id)
            return

        await _run_local_items(batch_id, selected_item_ids)
    except Exception as exc:
        logger.exception("XHS batch orchestration failed: %s", batch_id)
        await _mark_batch_system_failed(batch_id, str(exc))


async def process_xhs_batch_item_async(batch_id: str, item_id: str) -> None:
    await _process_xhs_batch_item_async(batch_id, item_id, processing_token=None)


async def _process_xhs_batch_item_async(batch_id: str, item_id: str, processing_token: Optional[str]) -> None:
    session_factory = get_async_session()
    engine = getattr(session_factory, "_contentguard_engine", None)
    lease_token = processing_token or _new_processing_token("local")
    heartbeat_stop = asyncio.Event()
    heartbeat_task: Optional[asyncio.Task] = None
    try:
        async with session_factory() as db:
            job = await _load_job(db, batch_id)
            item = await _load_batch_item_with_lock(db, batch_id, item_id, for_update=True)
            if not job or not item:
                logger.warning("XHS batch item not found: %s/%s", batch_id, item_id)
                return
            if not _is_selected_for_run(item):
                logger.info("XHS batch item is not selected for current run: %s/%s", batch_id, item_id)
                return
            if item.status == "running" and _has_active_processing_lease(item):
                logger.info("XHS batch item is already leased by another worker: %s/%s", batch_id, item_id)
                return
            if item.status in PROCESSED_ITEM_STATUSES:
                return

            retry_mode = bool(_item_meta(item).get("retry_requested"))
            item.status = "running"
            item.round = max(item.round, 1)
            item.started_at = datetime.now(timezone.utc)
            item.finished_at = None
            _set_processing_lease(item, lease_token)
            await db.commit()
            heartbeat_task = asyncio.create_task(_heartbeat_xhs_item_async(batch_id, item_id, lease_token, heartbeat_stop))

            running_state = await _refresh_batch_state(db, batch_id)
            if running_state:
                await _notify_batch_event(
                    running_state.job,
                    "xhs_batch_progress",
                    _build_batch_event_payload(
                        running_state.job,
                        planned_items=running_state.planned_items,
                        current_item_id=item.item_id,
                        current_item_status="running",
                        phase="item_started",
                    ),
                )

            item_result = await process_xhs_batch_item(
                tenant_id=job.tenant_id,
                db=db,
                job=job,
                item=item,
            )

            await db.refresh(item)
            if not _processing_token_matches(item, lease_token):
                logger.warning("XHS batch item lease changed before completion, skip stale write: %s/%s", batch_id, item_id)
                return

            item.editor_output_json = item_result["editor_output"]
            item.verifier_json = item_result["verifier"]
            item.verifier_pass = item_result["verifier_pass"]
            item.verifier_confidence = item_result["verifier_confidence"]
            item.rewrite_fail_reasons_json = item_result["rewrite_fail_reasons"]
            item.safe_rewrite_used = item_result["safe_rewrite_used"]
            item.safe_rewrite_reason = item_result["safe_rewrite_reason"]
            item.final_title = item_result["final_title"]
            item.final_body = item_result["final_body"]
            item.final_hashtags_json = item_result["final_hashtags"]
            item.copy_ready_text = item_result["copy_ready_text"]
            item.quality_score = item_result["quality_score"]
            item.duration_ms = 0
            _set_item_meta(
                item,
                **(item_result["model_meta"] or {}),
                actual_tokens=int(item_result.get("actual_tokens", 0) or 0),
                selected_for_run=True,
                skipped_by=None,
            )
            _clear_processing_lease(item)
            item.status = str(item_result.get("item_status") or ("completed" if item_result["verifier_pass"] else "failed"))
            item.round = item_result["round"]
            item.finished_at = datetime.now(timezone.utc)
            await db.commit()

            state = await _settle_batch_state(db, batch_id)
            if not state:
                return

            event_name = "xhs_batch_completed" if state.is_terminal else "xhs_batch_progress"
            phase = "completed" if state.is_terminal else ("retry_item_finished" if retry_mode else "item_finished")
            await _notify_batch_event(
                state.job,
                event_name,
                _build_batch_event_payload(
                    state.job,
                    planned_items=state.planned_items,
                    current_item_id=item.item_id,
                    current_item_status=item.status,
                    phase=phase,
                ),
            )
    except Exception as exc:
        logger.exception("XHS batch item failed: %s/%s", batch_id, item_id)
        async with session_factory() as db:
            job = await _load_job(db, batch_id)
            item = await _load_batch_item_with_lock(db, batch_id, item_id, for_update=True)
            if not job or not item:
                return
            if not _processing_token_matches(item, lease_token):
                logger.warning("XHS batch item lease changed after failure, skip stale error write: %s/%s", batch_id, item_id)
                return

            item.status = "failed"
            item.finished_at = datetime.now(timezone.utc)
            item.rewrite_fail_reasons_json = item.rewrite_fail_reasons_json or [str(exc)]
            _set_item_meta(item, selected_for_run=True, skipped_by=None)
            _clear_processing_lease(item)
            await db.commit()

            state = await _settle_batch_state(db, batch_id)
            if not state:
                return

            event_name = "xhs_batch_completed" if state.is_terminal else "xhs_batch_progress"
            phase = "completed" if state.is_terminal else "item_failed"
            await _notify_batch_event(
                state.job,
                event_name,
                _build_batch_event_payload(
                    state.job,
                    planned_items=state.planned_items,
                    current_item_id=item_id,
                    current_item_status="failed",
                    reason=str(exc),
                    phase=phase,
                ),
            )
    finally:
        if heartbeat_task is not None:
            heartbeat_stop.set()
            await heartbeat_task
        if engine is not None:
            await engine.dispose()


async def _mark_xhs_item_timeout_async(batch_id: str, item_id: str, processing_token: Optional[str] = None) -> None:
    session_factory = get_async_session()
    engine = getattr(session_factory, "_contentguard_engine", None)
    try:
        async with session_factory() as db:
            job = await _load_job(db, batch_id)
            item = await _load_batch_item_with_lock(db, batch_id, item_id, for_update=True)
            if not job or not item:
                return

            if item.status == "completed":
                return
            if item.status != "running":
                logger.info("XHS batch item is no longer running, skip timeout write: %s/%s", batch_id, item_id)
                return
            if processing_token and not _processing_token_matches(item, processing_token):
                logger.warning("XHS batch item timeout belongs to stale worker, skip timeout write: %s/%s", batch_id, item_id)
                return

            item.status = "failed"
            item.finished_at = datetime.now(timezone.utc)
            item.rewrite_fail_reasons_json = item.rewrite_fail_reasons_json or ["任务执行超时，请重试"]
            _set_item_meta(item, selected_for_run=True, skipped_by=None)
            _clear_processing_lease(item)
            await db.commit()

            state = await _settle_batch_state(db, batch_id)
            if not state:
                return

            event_name = "xhs_batch_completed" if state.is_terminal else "xhs_batch_progress"
            phase = "completed" if state.is_terminal else "item_timeout"
            await _notify_batch_event(
                state.job,
                event_name,
                _build_batch_event_payload(
                    state.job,
                    planned_items=state.planned_items,
                    current_item_id=item_id,
                    current_item_status="failed",
                    reason="任务执行超时，请重试",
                    phase=phase,
                ),
            )
    finally:
        if engine is not None:
            await engine.dispose()


async def recover_stuck_xhs_batch_items_async(*, recovered_by: str) -> int:
    session_factory = get_async_session()
    engine = getattr(session_factory, "_contentguard_engine", None)
    recovered_pairs: list[tuple[str, str]] = []
    try:
        async with session_factory() as db:
            now = datetime.now(timezone.utc)
            result = await db.execute(select(XHSBatchItem).where(XHSBatchItem.status == "running"))
            items = list(result.scalars().all())
            recoverable_items = [item for item in items if not _has_active_processing_lease(item, now)]
            if not recoverable_items:
                logger.info("XHS 任务恢复: 没有租约过期的运行中条目")
                return 0

            batch_ids = sorted({item.batch_id for item in recoverable_items})
            jobs = {
                batch_id: await _load_job(db, batch_id, for_update=True)
                for batch_id in batch_ids
            }
            for item in recoverable_items:
                item.status = "pending"
                item.started_at = None
                item.finished_at = None
                _set_item_meta(item, selected_for_run=True, skipped_by=None)
                _clear_processing_lease(item)
                _set_item_meta(item, **{PROCESSING_RECOVERED_BY_META_KEY: recovered_by})
                recovered_pairs.append((item.batch_id, item.item_id))
                logger.warning("XHS 任务恢复: 条目 %s/%s 租约已过期，重新排队", item.batch_id, item.item_id)

            await db.commit()

            for batch_id in batch_ids:
                job = jobs.get(batch_id)
                if job:
                    job.status = "queued"
                    job.system_blocked = False
                    job.system_block_reason = None
                await _refresh_batch_state(db, batch_id)
    finally:
        if engine is not None:
            await engine.dispose()

    for batch_id, item_id in recovered_pairs:
        if settings.USE_CELERY:
            process_xhs_batch_item_task.delay(batch_id, item_id)
        else:
            asyncio.create_task(process_xhs_batch_item_async(batch_id, item_id))

    return len(recovered_pairs)


@shared_task(name="app.tasks.xhs_batch.process_xhs_batch_job_task")
def process_xhs_batch_job_task(batch_id: str, item_ids: Optional[list[str]] = None) -> None:
    asyncio.run(process_xhs_batch_job_async(batch_id, item_ids=item_ids))


@shared_task(bind=True, name="app.tasks.xhs_batch.process_xhs_batch_item_task")
def process_xhs_batch_item_task(self, batch_id: str, item_id: str) -> None:
    processing_token = f"celery:{getattr(getattr(self, 'request', None), 'id', None) or uuid4().hex}"
    try:
        asyncio.run(_process_xhs_batch_item_async(batch_id, item_id, processing_token=processing_token))
    except SoftTimeLimitExceeded:
        logger.exception("XHS batch item timed out: %s/%s", batch_id, item_id)
        asyncio.run(_mark_xhs_item_timeout_async(batch_id, item_id, processing_token=processing_token))
        raise
