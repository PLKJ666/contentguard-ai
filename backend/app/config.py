"""应用配置"""
import warnings
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    """应用设置"""
    # Allow unrelated env vars in local .env / container env without breaking startup/tests.
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

    # 应用
    APP_NAME: str = "ContentGuard AI"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"  # development | staging | production

    # CORS（逗号分隔的允许来源列表）
    CORS_ORIGINS: str = "http://localhost:3000"

    # 数据库
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/contentguard"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Celery: 是否使用 Celery 队列执行 AI 审核（需要 Celery worker 运行）
    # 设为 False 时回退到 asyncio.create_task（开发环境推荐）
    USE_CELERY: bool = False
    XHS_BATCH_PARALLELISM: int = 4

    # 应用主密钥：用于派生 AI 配置等敏感数据的加密密钥
    SECRET_KEY: str = "your-secret-key-change-in-production"

    # Logto 认证
    LOGTO_ENDPOINT: str = ""  # 如 https://auth.example.com/
    LOGTO_APP_ID: str = ""
    LOGTO_API_RESOURCE: str = ""  # 如 https://api.example.com
    OPERATOR_ACCESS_CODE: str = ""

    @property
    def LOGTO_JWKS_URI(self) -> str:
        endpoint = self.LOGTO_ENDPOINT.rstrip("/")
        return f"{endpoint}/oidc/jwks" if endpoint else ""

    @property
    def LOGTO_ISSUER(self) -> str:
        endpoint = self.LOGTO_ENDPOINT.rstrip("/")
        return f"{endpoint}/oidc" if endpoint else ""

    # AI 服务（使用兼容 OpenAI API 的服务或中转服务，不直连厂商）
    # 服务地址和密钥只从环境或租户级加密配置注入
    AI_PROVIDER: str = "oneapi"  # oneapi | oneinall | openrouter 等中转服务商
    AI_API_KEY: str = ""  # 中转服务商的 API Key
    AI_API_BASE_URL: str = ""  # 服务 Base URL，如 https://ai.example.com/v1

    # 火山引擎 TOS 配置
    TOS_ACCESS_KEY_ID: str = ""
    TOS_SECRET_ACCESS_KEY: str = ""
    TOS_REGION: str = "cn-beijing"
    TOS_BUCKET_NAME: str = "contentguard-files"
    TOS_ENDPOINT: str = ""  # 自定义 Endpoint，空则用默认 tos-cn-{region}.volces.com
    TOS_CDN_DOMAIN: str = ""  # CDN 自定义域名，空则用 TOS 源站

    # 邮件 SMTP
    SMTP_HOST: str = ""
    SMTP_PORT: int = 465
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_NAME: str = "ContentGuard AI"
    SMTP_USE_SSL: bool = True

    # 验证码
    VERIFICATION_CODE_EXPIRE_MINUTES: int = 5
    VERIFICATION_CODE_LENGTH: int = 6

    # 文件上传限制
    MAX_FILE_SIZE_MB: int = 500  # 最大文件大小 500MB
    LOCAL_FILE_STORAGE_ENABLED: bool = False
    LOCAL_FILE_STORAGE_PREFER_UPLOAD: bool = False
    LOCAL_FILE_STORAGE_FALLBACK_ON_UPLOAD_ERROR: bool = False
    LOCAL_FILE_STORAGE_DIR: str = "/app/local_uploads"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if self.SECRET_KEY == "your-secret-key-change-in-production":
            warnings.warn(
                "SECRET_KEY 使用默认值，请在 .env 中设置安全的密钥；它会用于派生应用加密密钥。",
                UserWarning,
                stacklevel=2,
            )


@lru_cache()
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()


settings = get_settings()
