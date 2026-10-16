"""检索层依赖的端口（抽象）。

用 Protocol 而不是具体类，是为了让 downstream 实现可以替换：
  - 生产：`services/document_service.DocumentService`（pgvector 精确扫描）
  - 测试：`tests/fakes.InMemoryVectorSearch`（不依赖数据库也能跑通管道）

这样单元测试不需要 Docker 就能验证整条 Agent 逻辑，同时不污染生产代码。
"""

from __future__ import annotations

import uuid
from typing import Protocol, runtime_checkable

from app.schemas.document import SearchHit


@runtime_checkable
class VectorSearchPort(Protocol):
    """「给我一批相似文档」的能力。"""

    async def similar_search(
        self,
        user_id: uuid.UUID,
        query_vector: list[float],
        *,
        top_k: int = 8,
        source_types: list[str] | None = None,
    ) -> list[SearchHit]: ...
