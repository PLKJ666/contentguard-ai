"""结构化日志配置"""
import logging
import sys
from app.config import settings


def setup_logging():
    """配置结构化日志"""
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO

    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Remove default handlers
    root_logger.handlers.clear()

    # Console handler with structured format
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

    # Quiet down noisy libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.DEBUG else logging.WARNING
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)

    return root_logger
