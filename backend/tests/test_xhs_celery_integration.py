"""
XHS Celery 集成测试。

使用真实 Redis broker + in-process Celery worker，验证任务分发与包装层逻辑。
运行: pytest tests/test_xhs_celery_integration.py -m integration
"""

from uuid import uuid4

import pytest
from billiard.exceptions import SoftTimeLimitExceeded
from celery.contrib.testing.worker import start_worker

from app.celery_app import celery_app
from app.tasks.xhs_batch import process_xhs_batch_item_task
import app.tasks.xhs_batch as xhs_batch_tasks


@pytest.fixture
def redis_test_url(redis_container):
    host = redis_container.get_container_host_ip()
    port = redis_container.get_exposed_port(6379)
    return f"redis://{host}:{port}/0"


@pytest.fixture
def configured_celery_app(redis_test_url):
    original_broker = celery_app.conf.broker_url
    original_backend = celery_app.conf.result_backend
    celery_app.conf.update(
        broker_url=redis_test_url,
        result_backend=redis_test_url,
    )
    try:
        yield celery_app
    finally:
        celery_app.conf.update(
            broker_url=original_broker,
            result_backend=original_backend,
        )


@pytest.mark.integration
def test_process_xhs_batch_item_task_runs_through_real_celery_worker(configured_celery_app, monkeypatch):
    queue_name = f"xhs_batch_test_{uuid4().hex}"
    observed: dict[str, str | None] = {}

    async def fake_process_xhs_batch_item_async(batch_id: str, item_id: str, processing_token: str | None = None):
        observed["batch_id"] = batch_id
        observed["item_id"] = item_id
        observed["processing_token"] = processing_token

    monkeypatch.setattr(
        xhs_batch_tasks,
        "_process_xhs_batch_item_async",
        fake_process_xhs_batch_item_async,
    )

    with start_worker(
        configured_celery_app,
        concurrency=1,
        pool="solo",
        loglevel="error",
        perform_ping_check=False,
        queues=[queue_name],
    ):
        result = process_xhs_batch_item_task.apply_async(
            args=("job-celery-int-1", "item_001"),
            queue=queue_name,
        )
        assert result.get(timeout=10) is None

    assert observed["batch_id"] == "job-celery-int-1"
    assert observed["item_id"] == "item_001"
    assert observed["processing_token"] is not None
    assert str(observed["processing_token"]).startswith("celery:")


@pytest.mark.integration
def test_process_xhs_batch_item_task_marks_timeout_through_real_celery_worker(configured_celery_app, monkeypatch):
    queue_name = f"xhs_batch_test_{uuid4().hex}"
    observed: dict[str, str | None] = {}

    async def fake_process_xhs_batch_item_async(batch_id: str, item_id: str, processing_token: str | None = None):
        observed["process_token"] = processing_token
        raise SoftTimeLimitExceeded()

    async def fake_mark_xhs_item_timeout_async(batch_id: str, item_id: str, processing_token: str | None = None):
        observed["timeout_batch_id"] = batch_id
        observed["timeout_item_id"] = item_id
        observed["timeout_token"] = processing_token

    monkeypatch.setattr(
        xhs_batch_tasks,
        "_process_xhs_batch_item_async",
        fake_process_xhs_batch_item_async,
    )
    monkeypatch.setattr(
        xhs_batch_tasks,
        "_mark_xhs_item_timeout_async",
        fake_mark_xhs_item_timeout_async,
    )

    with start_worker(
        configured_celery_app,
        concurrency=1,
        pool="solo",
        loglevel="error",
        perform_ping_check=False,
        queues=[queue_name],
    ):
        result = process_xhs_batch_item_task.apply_async(
            args=("job-celery-int-2", "item_002"),
            queue=queue_name,
        )
        with pytest.raises(SoftTimeLimitExceeded):
            result.get(timeout=10, propagate=True)

    assert observed["timeout_batch_id"] == "job-celery-int-2"
    assert observed["timeout_item_id"] == "item_002"
    assert observed["process_token"] is not None
    assert observed["timeout_token"] == observed["process_token"]
