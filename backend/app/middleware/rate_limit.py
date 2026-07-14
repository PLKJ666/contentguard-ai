"""
速率限制中间件
基于内存的滑动窗口计数器，支持按路径自定义限制和标准响应头。
"""
import time
from collections import defaultdict
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    速率限制中间件

    - 默认: 60 次/分钟 per IP
    - 按路径配置不同限制 (path_limits)
    - 返回标准 X-RateLimit-* 响应头
    """

    # Path-specific rate limits (requests per window).
    # Paths not listed here fall back to ``default_limit``.
    DEFAULT_PATH_LIMITS: dict[str, int] = {
        # Upload — bandwidth / storage cost
        "/api/v1/upload/policy": 30,
        # AI review — service cost + compute
        "/api/v1/scripts/review": 10,
        "/api/v1/videos/review": 5,
    }

    def __init__(
        self,
        app,
        default_limit: int = 60,
        window_seconds: int = 60,
        path_limits: dict[str, int] | None = None,
    ):
        super().__init__(app)
        self.default_limit = default_limit
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)
        # Merge caller-supplied overrides on top of the built-in defaults.
        self.path_limits: dict[str, int] = {**self.DEFAULT_PATH_LIMITS}
        if path_limits:
            self.path_limits.update(path_limits)

    def _get_limit(self, path: str) -> int:
        """Return the rate limit for *path*, falling back to *default_limit*."""
        return self.path_limits.get(path, self.default_limit)

    def _make_key(self, client_ip: str, path: str) -> str:
        """Build the bucket key.

        Paths with a custom limit are bucketed per-IP per-path so that
        hitting one endpoint does not consume the quota of another.
        Default paths share a single per-IP bucket.
        """
        if path in self.path_limits:
            return f"{client_ip}:{path}"
        return client_ip

    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path
        now = time.time()

        limit = self._get_limit(path)
        key = self._make_key(client_ip, path)

        # Clean old entries outside the sliding window
        window_start = now - self.window_seconds
        self.requests[key] = [t for t in self.requests[key] if t > window_start]

        current_count = len(self.requests[key])
        remaining = max(0, limit - current_count)

        # Seconds until the oldest request in the window expires
        if self.requests[key]:
            reset_seconds = int(self.requests[key][0] - window_start)
        else:
            reset_seconds = self.window_seconds

        # Build common rate-limit headers
        rate_headers = {
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Remaining": str(max(0, remaining - 1) if remaining > 0 else 0),
            "X-RateLimit-Reset": str(reset_seconds),
        }

        # Check limit
        if current_count >= limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后再试"},
                headers={
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(reset_seconds),
                    "Retry-After": str(reset_seconds),
                },
            )

        # Record request
        self.requests[key].append(now)

        # Periodic cleanup (keep memory bounded)
        if len(self.requests) > 10000:
            self._cleanup(now)

        response = await call_next(request)

        # Attach rate-limit headers to successful responses
        response.headers["X-RateLimit-Limit"] = rate_headers["X-RateLimit-Limit"]
        response.headers["X-RateLimit-Remaining"] = rate_headers["X-RateLimit-Remaining"]
        response.headers["X-RateLimit-Reset"] = rate_headers["X-RateLimit-Reset"]

        return response

    def _cleanup(self, now: float):
        """Clean up expired entries"""
        window_start = now - self.window_seconds
        expired_keys = [
            k for k, v in self.requests.items()
            if not v or v[-1] < window_start
        ]
        for k in expired_keys:
            del self.requests[k]
