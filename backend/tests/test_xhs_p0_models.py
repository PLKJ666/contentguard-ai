from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.tenant import Tenant
from app.models.xhs import XHSBatchItem, XHSBatchJob, XHSBrandPack, XHSExportLog
from app.schemas.ai_config import AIModelsConfig
from app.schemas.xhs_batch import (
    BrandPackPayload,
    XHSBatchCreateRequest,
    XHSBatchRunMode,
    XHSInputType,
)


def test_ai_models_config_keeps_legacy_fields_compatible():
    config = AIModelsConfig(
        text="gpt-4o-mini",
        vision="gpt-4o",
        audio="whisper-1",
    )

    assert config.text == "gpt-4o-mini"
    assert config.xhs_split is None
    assert config.xhs_editor is None
    assert config.xhs_verifier is None


def test_ai_models_config_accepts_xhs_role_models():
    config = AIModelsConfig(
        text="gpt-4o-mini",
        vision="gpt-4o",
        audio="whisper-1",
        xhs_split="gpt-4.1-mini",
        xhs_editor="gpt-4.1",
        xhs_verifier="gpt-4.1-mini",
    )

    assert config.xhs_split == "gpt-4.1-mini"
    assert config.xhs_editor == "gpt-4.1"
    assert config.xhs_verifier == "gpt-4.1-mini"


def test_xhs_batch_create_request_defaults():
    request = XHSBatchCreateRequest(
        category_id="beauty",
        input_type=XHSInputType.TEXT,
        input_text="note one",
    )

    assert request.run_mode == XHSBatchRunMode.TRIAL
    assert request.tag_policy == {}
    assert request.export_options == {}


def test_brand_pack_payload_has_fact_graph_default():
    payload = BrandPackPayload()

    assert payload.fact_graph == {"nodes": [], "relations": []}


@pytest.mark.asyncio
async def test_xhs_models_can_persist_with_existing_metadata(test_db_session):
    tenant = Tenant(id="tenant-xhs", name="Tenant XHS")
    test_db_session.add(tenant)

    brand_pack = XHSBrandPack(
        id="bp-1",
        tenant_id=tenant.id,
        brand_name="Test Brand",
        category_id="beauty",
        version="2026.03.1",
        status="draft",
        is_default=True,
        pack_json={"fact_graph": {"nodes": [], "relations": []}},
        created_by="user-1",
    )
    batch = XHSBatchJob(
        id="batch-1",
        tenant_id=tenant.id,
        created_by="user-1",
        status="pending",
        category_id="beauty",
        run_mode="trial",
        input_type="text",
        estimated_tokens=1200,
        estimated_cost=Decimal("3.2500"),
        system_blocked=False,
        total_items=1,
        done_items=0,
        running_items=0,
    )
    item = XHSBatchItem(
        id="item-row-1",
        batch_id=batch.id,
        item_id="item-1",
        source_text="original note text",
        status="pending",
        round=0,
    )
    export_log = XHSExportLog(
        id="log-1",
        batch_id=batch.id,
        type="all_md",
        status="pending",
    )

    test_db_session.add_all([brand_pack, batch, item, export_log])
    await test_db_session.commit()

    result = await test_db_session.execute(select(XHSBatchJob).where(XHSBatchJob.id == "batch-1"))
    saved_batch = result.scalar_one()

    assert saved_batch.estimated_tokens == 1200
    assert saved_batch.estimated_cost == Decimal("3.2500")
    assert len(saved_batch.items) == 1
    assert len(saved_batch.export_logs) == 1
