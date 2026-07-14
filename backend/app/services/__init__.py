"""服务层模块"""
from typing import Optional, Any

_openai_import_error: Optional[Exception] = None

try:
    from app.services.ai_client import OpenAICompatibleClient, AIResponse, ConnectionTestResult
    from app.services.ai_service import AIServiceFactory, get_ai_client_for_tenant
except ModuleNotFoundError as exc:  # openai 依赖缺失时允许非 AI 路径正常导入
    _openai_import_error = exc
    OpenAICompatibleClient = None
    AIResponse = None
    ConnectionTestResult = None
    AIServiceFactory = None

    def get_ai_client_for_tenant(*_args: Any, **_kwargs: Any) -> Any:
        raise ModuleNotFoundError(
            "Optional dependency 'openai' is required for AI client usage."
        ) from _openai_import_error

# 视频处理服务（无外部依赖）
from app.services.video_download import VideoDownloadService, DownloadResult, get_download_service
from app.services.keyframe import KeyFrameExtractor, KeyFrame, ExtractionResult, get_keyframe_extractor
from app.services.asr import ASRService, VideoASRService, TranscriptionResult
from app.services.vision import VisionAnalysisService, CompetitorLogoDetector, VideoOCRService
from app.services.video_review import VideoReviewService

__all__ = [
    # AI 客户端
    "OpenAICompatibleClient",
    "AIResponse",
    "ConnectionTestResult",
    "AIServiceFactory",
    "get_ai_client_for_tenant",
    # 视频下载
    "VideoDownloadService",
    "DownloadResult",
    "get_download_service",
    # 关键帧提取
    "KeyFrameExtractor",
    "KeyFrame",
    "ExtractionResult",
    "get_keyframe_extractor",
    # ASR
    "ASRService",
    "VideoASRService",
    "TranscriptionResult",
    # 视觉分析
    "VisionAnalysisService",
    "CompetitorLogoDetector",
    "VideoOCRService",
    # 视频审核
    "VideoReviewService",
]
