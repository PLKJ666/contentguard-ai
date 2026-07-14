"""健康检查 API"""
from fastapi import APIRouter, Depends

from app.config import settings
from app.services.health import HealthChecker, get_health_checker

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    """
    健康检查端点

    Returns:
        dict: 包含服务状态信息
    """
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }


@router.get("/health/ready")
async def readiness_check(
    health_checker: HealthChecker = Depends(get_health_checker),
):
    """
    就绪检查端点（用于 K8s）
    检查数据库、Redis 等依赖服务是否就绪

    Returns:
        dict: 服务就绪状态和依赖检查结果
    """
    checks = await health_checker.check_all()
    all_ready = all(checks.values())

    return {
        "ready": all_ready,
        "checks": checks,
    }


@router.get("/health/live")
async def liveness_check():
    """
    存活检查端点（用于 K8s）
    只检查服务进程是否存活，不检查依赖

    Returns:
        dict: 服务存活状态
    """
    return {"alive": True}
