"""
XHS 导出服务。

当前阶段提供一个可替换的飞书导出服务接口：
- 负责把 all.md 内容转换为导出日志
- 返回标准化导出结果

后续接真实飞书 API 时，优先替换本文件实现。
"""
from __future__ import annotations

from datetime import datetime
import hashlib
from typing import Any


def build_feishu_export_result(
    *,
    batch_id: str,
    markdown: str,
    folder_token: str | None,
    doc_title: str | None,
    split_policy: int = 150,
) -> dict[str, Any]:
    title = doc_title or f"小红书批量终稿_{datetime.utcnow().strftime('%Y%m%d_%H%M')}_{batch_id}"
    export_id = hashlib.sha1(f"{batch_id}:{title}:{len(markdown)}".encode("utf-8")).hexdigest()[:16]

    return {
        "status": "completed",
        "docs": [
            {
                "doc_token": f"mock_doc_{export_id}",
                "doc_title": title,
                "doc_url": f"https://feishu.mock/docx/mock_doc_{export_id}",
                "item_range": f"1-{max(1, min(split_policy, markdown.count('## ')))}",
            }
        ],
        "meta": {
            "folder_token": folder_token,
            "split_policy": split_policy,
            "content_length": len(markdown),
        },
    }
