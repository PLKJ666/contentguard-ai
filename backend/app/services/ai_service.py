"""
AI 服务工厂
根据租户配置创建和管理 AI 客户端
"""
import asyncio
import logging
import os
from typing import Optional
from cachetools import TTLCache
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_config import AIConfig
from app.services.ai_client import OpenAICompatibleClient
from app.utils.crypto import decrypt_api_key

logger = logging.getLogger(__name__)


class AIServiceFactory:
    """
    AI 服务工厂

    根据租户的 AI 配置创建对应的 AI 客户端
    使用 TTL 缓存避免频繁创建客户端
    """

    # 客户端缓存，TTL 10 分钟
    _cache: TTLCache = TTLCache(maxsize=100, ttl=600)

    @classmethod
    def _client_cache_scope(cls, tenant_id: str) -> tuple[str, str]:
        return ("ai_client", tenant_id)

    @classmethod
    def _client_cache_key(cls, tenant_id: str) -> tuple[str, str, int, object]:
        try:
            loop_id: object = id(asyncio.get_running_loop())
        except RuntimeError:
            loop_id = "no-loop"
        return (*cls._client_cache_scope(tenant_id), os.getpid(), loop_id)

    @classmethod
    async def get_client(
        cls,
        tenant_id: str,
        db: AsyncSession,
    ) -> Optional[OpenAICompatibleClient]:
        """
        获取租户的 AI 客户端

        优先级：
        1. 租户自己的 is_configured=True 配置
        2. 租户有配置但 is_configured=False（已保存但未标记完成）
        3. 全局 .env 配置

        Args:
            tenant_id: 租户 ID
            db: 数据库会话

        Returns:
            AI 客户端实例，未配置返回 None
        """
        # 检查缓存
        cache_key = cls._client_cache_key(tenant_id)
        if cache_key in cls._cache:
            return cls._cache[cache_key]

        # 从数据库获取配置（先查 is_configured=True）
        result = await db.execute(
            select(AIConfig).where(
                AIConfig.tenant_id == tenant_id,
                AIConfig.is_configured == True,
            )
        )
        config = result.scalar_one_or_none()
        logger.info(f"AI get_client: tenant={tenant_id}, configured_config={'找到' if config else '无'}")

        # 没找到已配置的，再查任何配置（可能 is_configured=False 但有有效的 key）
        if not config:
            result = await db.execute(
                select(AIConfig).where(AIConfig.tenant_id == tenant_id)
            )
            config = result.scalar_one_or_none()
            logger.info(f"AI get_client: tenant={tenant_id}, any_config={'找到(is_configured=False)' if config else '无'}")
            # 只有当 api_key 不是占位符时才使用
            if config and config.api_key_encrypted and config.api_key_encrypted != "demo-placeholder-key":
                logger.info(f"租户 {tenant_id} 使用未标记完成的 AI 配置")
            else:
                config = None

        if config:
            # 解密 API Key
            api_key = decrypt_api_key(config.api_key_encrypted)
            client = OpenAICompatibleClient(
                base_url=config.base_url,
                api_key=api_key,
                provider=config.provider,
            )
        else:
            # 回退到全局 .env 配置
            from app.config import settings
            if not settings.AI_API_KEY or not settings.AI_API_BASE_URL:
                logger.warning(
                    f"AI 不可用: 租户 {tenant_id} 无 DB 配置，"
                    f".env AI_API_KEY={'已设置' if settings.AI_API_KEY else '空'}, "
                    f"AI_API_BASE_URL={'已设置' if settings.AI_API_BASE_URL else '空'}"
                )
                return None
            logger.info(f"租户 {tenant_id} 使用全局 .env AI 配置")
            client = OpenAICompatibleClient(
                base_url=settings.AI_API_BASE_URL,
                api_key=settings.AI_API_KEY,
                provider=settings.AI_PROVIDER,
            )

        # 缓存客户端
        cls._cache[cache_key] = client

        return client

    @classmethod
    def invalidate_cache(cls, tenant_id: str) -> None:
        """
        使缓存失效

        当租户更新 AI 配置时调用
        """
        cache_scope = cls._client_cache_scope(tenant_id)
        for cache_key in list(cls._cache.keys()):
            if (
                isinstance(cache_key, tuple)
                and len(cache_key) >= 2
                and cache_key[:2] == cache_scope
            ):
                del cls._cache[cache_key]

    @classmethod
    def clear_cache(cls) -> None:
        """清空所有缓存"""
        cls._cache.clear()

    @classmethod
    async def get_config(
        cls,
        tenant_id: str,
        db: AsyncSession,
    ) -> Optional[AIConfig]:
        """
        获取租户的 AI 配置

        Args:
            tenant_id: 租户 ID
            db: 数据库会话

        Returns:
            AI 配置模型，未配置返回 None
        """
        result = await db.execute(
            select(AIConfig).where(AIConfig.tenant_id == tenant_id)
        )
        return result.scalar_one_or_none()

    @classmethod
    async def create_or_update_config(
        cls,
        tenant_id: str,
        provider: str,
        base_url: str,
        api_key_encrypted: str,
        models: dict,
        temperature: float,
        max_tokens: int,
        db: AsyncSession,
    ) -> AIConfig:
        """
        创建或更新 AI 配置

        Args:
            tenant_id: 租户 ID
            provider: 提供商
            base_url: API 地址
            api_key_encrypted: 加密的 API Key
            models: 模型配置
            temperature: 温度参数
            max_tokens: 最大 token 数
            db: 数据库会话

        Returns:
            更新后的配置
        """
        # 查找现有配置
        result = await db.execute(
            select(AIConfig).where(AIConfig.tenant_id == tenant_id)
        )
        config = result.scalar_one_or_none()

        if config:
            # 更新现有配置
            config.provider = provider
            config.base_url = base_url
            config.api_key_encrypted = api_key_encrypted
            config.models = models
            config.temperature = temperature
            config.max_tokens = max_tokens
            config.is_configured = True
        else:
            # 创建新配置
            config = AIConfig(
                tenant_id=tenant_id,
                provider=provider,
                base_url=base_url,
                api_key_encrypted=api_key_encrypted,
                models=models,
                temperature=temperature,
                max_tokens=max_tokens,
                is_configured=True,
            )
            db.add(config)

        await db.flush()

        # 使缓存失效
        cls.invalidate_cache(tenant_id)

        return config


# 便捷函数
async def get_ai_client_for_tenant(
    tenant_id: str,
    db: AsyncSession,
) -> Optional[OpenAICompatibleClient]:
    """获取租户的 AI 客户端"""
    return await AIServiceFactory.get_client(tenant_id, db)
