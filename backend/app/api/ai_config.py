"""
AI 服务配置 API
品牌方管理 AI 提供商配置、模型选择、连通性测试
"""
import asyncio
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.ai_config import AIConfig
from app.models.tenant import Tenant
from app.schemas.ai_config import (
    AIProvider,
    AIConfigUpdate,
    AIConfigResponse,
    AIModelsConfig,
    AIParametersConfig,
    GetModelsRequest,
    TestConnectionRequest,
    ModelsListResponse,
    ConnectionTestResponse,
    ModelTestResult,
    ModelInfo,
    ModelCapability,
    mask_api_key,
)
from app.services.ai_client import OpenAICompatibleClient
from app.services.ai_service import AIServiceFactory
from app.utils.crypto import encrypt_api_key, decrypt_api_key

router = APIRouter(prefix="/ai-config", tags=["ai-config"])


async def _ensure_tenant_exists(tenant_id: str, db: AsyncSession) -> Tenant:
    """确保租户存在，不存在则自动创建"""
    result = await db.execute(
        select(Tenant).where(Tenant.id == tenant_id)
    )
    tenant = result.scalar_one_or_none()

    if not tenant:
        tenant = Tenant(id=tenant_id, name=f"租户-{tenant_id}")
        db.add(tenant)
        await db.flush()

    return tenant


@router.get("", response_model=AIConfigResponse)
async def get_ai_config(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> AIConfigResponse:
    """
    获取当前 AI 配置

    - 未配置返回 404
    - 已配置返回配置信息（API Key 脱敏）
    """
    result = await db.execute(
        select(AIConfig).where(
            AIConfig.tenant_id == x_tenant_id,
            AIConfig.is_configured == True,
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="AI 服务未配置，请先完成配置",
        )

    # 解密 API Key 用于脱敏显示
    api_key = decrypt_api_key(config.api_key_encrypted)

    return AIConfigResponse(
        provider=config.provider,
        base_url=config.base_url,
        api_key_masked=mask_api_key(api_key),
        models=AIModelsConfig(**config.models),
        parameters=AIParametersConfig(
            temperature=config.temperature,
            max_tokens=config.max_tokens,
        ),
        available_models=config.available_models or {},
        is_configured=config.is_configured,
        last_test_at=config.last_test_at.isoformat() if config.last_test_at else None,
        last_test_result=config.last_test_result,
    )


@router.put("", response_model=AIConfigResponse)
async def update_ai_config(
    request: AIConfigUpdate,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> AIConfigResponse:
    """
    更新 AI 配置

    - 保存提供商、连接信息、模型配置
    - API Key 加密存储
    """
    # 确保租户存在
    await _ensure_tenant_exists(x_tenant_id, db)

    # 处理 API Key：'***' 表示未修改，保留原有密钥
    if request.api_key == '***':
        # 读取现有配置的加密密钥
        existing = await db.execute(
            select(AIConfig).where(AIConfig.tenant_id == x_tenant_id)
        )
        existing_config = existing.scalar_one_or_none()
        if existing_config and existing_config.api_key_encrypted:
            api_key_encrypted = existing_config.api_key_encrypted
            display_api_key = decrypt_api_key(api_key_encrypted)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="请输入 API Key",
            )
    else:
        api_key_encrypted = encrypt_api_key(request.api_key)
        display_api_key = request.api_key

    # 创建或更新配置
    config = await AIServiceFactory.create_or_update_config(
        tenant_id=x_tenant_id,
        provider=request.provider.value,
        base_url=request.base_url,
        api_key_encrypted=api_key_encrypted,
        models=request.models.model_dump(exclude_none=True),
        temperature=request.parameters.temperature,
        max_tokens=request.parameters.max_tokens,
        db=db,
    )

    return AIConfigResponse(
        provider=config.provider,
        base_url=config.base_url,
        api_key_masked=mask_api_key(display_api_key),
        models=AIModelsConfig(**config.models),
        parameters=AIParametersConfig(
            temperature=config.temperature,
            max_tokens=config.max_tokens,
        ),
        available_models=config.available_models or {},
        is_configured=True,
        last_test_at=config.last_test_at.isoformat() if config.last_test_at else None,
        last_test_result=config.last_test_result,
    )


@router.post("/models", response_model=ModelsListResponse)
async def get_available_models(
    request: GetModelsRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> ModelsListResponse:
    """
    获取可用模型列表

    - 调用提供商 API 获取模型列表
    - 按能力分类（text/vision/audio）
    """
    # 如果前端传来脱敏的 Key，从数据库取真实 Key
    actual_api_key = request.api_key
    if not actual_api_key or "***" in actual_api_key:
        db_result = await db.execute(
            select(AIConfig).where(AIConfig.tenant_id == x_tenant_id)
        )
        existing = db_result.scalar_one_or_none()
        if existing and existing.api_key_encrypted:
            actual_api_key = decrypt_api_key(existing.api_key_encrypted)
        else:
            raise HTTPException(
                status_code=400,
                detail="请先输入 API Key",
            )

    try:
        client = OpenAICompatibleClient(
            base_url=request.base_url,
            api_key=actual_api_key,
            provider=request.provider.value,
            # UI 接口与前端保持一致，给上游更多时间，同时仍保证最终可返回
            timeout=60.0,
        )

        # 再加一层硬超时兜底：DNS/网络栈卡死时，SDK timeout 也可能不生效
        models_dict = await asyncio.wait_for(client.list_models(), timeout=55.0)
        await client.close()

        # 转换为 ModelInfo 对象
        models = {
            k: [ModelInfo(**m) for m in v]
            for k, v in models_dict.items()
        }

        # 更新配置中的可用模型缓存
        result = await db.execute(
            select(AIConfig).where(AIConfig.tenant_id == x_tenant_id)
        )
        config = result.scalar_one_or_none()
        if config:
            config.available_models = models_dict
            await db.flush()

        return ModelsListResponse(
            success=True,
            models=models,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="获取模型列表超时：请检查 AI Base URL / 网络连通性",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"获取模型列表失败: {str(e)}",
        )


@router.post("/test", response_model=ConnectionTestResponse)
async def test_connection(
    request: TestConnectionRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> ConnectionTestResponse:
    """
    测试 AI 服务连接

    - 并行测试三个模型
    - 返回每个模型的测试结果
    """
    client = None
    models = request.models.model_dump(exclude_none=True)

    # 如果前端传来脱敏的 Key（*** 或 sk-***xxx），从数据库取真实 Key
    actual_api_key = request.api_key
    if not actual_api_key or "***" in actual_api_key:
        db_result = await db.execute(
            select(AIConfig).where(AIConfig.tenant_id == x_tenant_id)
        )
        existing = db_result.scalar_one_or_none()
        if existing and existing.api_key_encrypted:
            actual_api_key = decrypt_api_key(existing.api_key_encrypted)
        else:
            return ConnectionTestResponse(
                success=False,
                results={
                    k: ModelTestResult(success=False, latency_ms=0, error="API Key 未配置", model=v)
                    for k, v in models.items()
                },
                message="请先输入 API Key",
            )

    try:
        client = OpenAICompatibleClient(
            base_url=request.base_url,
            api_key=actual_api_key,
            provider=request.provider.value,
            # 测试连接与前端保持一致，避免过早失败
            timeout=60.0,
        )

        # 定义模型能力映射
        capability_map = {
            "text": ModelCapability.TEXT,
            "vision": ModelCapability.VISION,
            "audio": ModelCapability.AUDIO,
        }

        async def test_single(model_type: str, model_id: str) -> tuple[str, ModelTestResult]:
            capability = capability_map.get(model_type, ModelCapability.TEXT)
            # 单模型强制超时，避免任一请求卡住拖死整个接口
            try:
                result = await asyncio.wait_for(
                    client.test_connection(model_id, capability),
                    timeout=55.0,
                )
            except asyncio.TimeoutError:
                return model_type, ModelTestResult(
                    success=False,
                    latency_ms=55000,
                    error="连接超时：请检查 Base URL / 网络出站 / 该模型上游是否可达",
                    model=model_id,
                )
            return model_type, ModelTestResult(
                success=result.success,
                latency_ms=result.latency_ms,
                error=result.error,
                model=model_id,
            )

        # 并行测试所有模型
        tasks = [
            test_single(model_type, model_id)
            for model_type, model_id in models.items()
        ]
        # gather 本身再套一层，避免事件循环卡死导致不返回
        results_list = await asyncio.wait_for(asyncio.gather(*tasks), timeout=60.0)
        results = {model_type: result for model_type, result in results_list}

        # 计算测试结果
        all_success = all(r.success for r in results.values())
        failed_count = sum(1 for r in results.values() if not r.success)

        if all_success:
            message = "所有模型连接成功"
        else:
            message = f"{failed_count} 个模型连接失败，请检查模型名称或 API 权限"

        response = ConnectionTestResponse(
            success=all_success,
            results=results,
            message=message,
        )
    except asyncio.TimeoutError as exc:
        # 确保接口返回 200，并返回失败详情（前端不必等到自身超时）
        results = {
            model_type: ModelTestResult(
                success=False,
                latency_ms=60000,
                error="连接测试整体超时：请检查 Base URL / 网络连通性",
                model=model_id,
            )
            for model_type, model_id in models.items()
        }
        response = ConnectionTestResponse(
            success=False,
            results=results,
            message="连接测试超时：请检查 AI Base URL / 网络连通性",
        )
    except Exception as exc:
        # 确保接口返回 200，并返回失败详情
        results = {
            model_type: ModelTestResult(
                success=False,
                latency_ms=0,
                error=str(exc),
                model=model_id,
            )
            for model_type, model_id in models.items()
        }
        response = ConnectionTestResponse(
            success=False,
            results=results,
            message=f"连接测试失败: {str(exc)}",
        )
    finally:
        if client is not None:
            try:
                await client.close()
            except Exception:
                pass

    # 保存测试结果到数据库
    db_result = await db.execute(
        select(AIConfig).where(AIConfig.tenant_id == x_tenant_id)
    )
    config = db_result.scalar_one_or_none()
    if config:
        config.last_test_at = datetime.now(timezone.utc)
        config.last_test_result = {
            k: v.model_dump() for k, v in response.results.items()
        }
        await db.flush()

    return response


# ==================== 供其他模块调用 ====================

async def get_ai_config_for_tenant(
    tenant_id: str,
    db: AsyncSession,
) -> Optional[dict]:
    """获取租户的 AI 配置（供审核服务调用）"""
    result = await db.execute(
        select(AIConfig).where(
            AIConfig.tenant_id == tenant_id,
            AIConfig.is_configured == True,
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        return None

    return {
        "tenant_id": config.tenant_id,
        "provider": config.provider,
        "base_url": config.base_url,
        "api_key": decrypt_api_key(config.api_key_encrypted),
        "models": config.models,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
    }
