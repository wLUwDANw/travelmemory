"""测试替身：内存向量检索。

用途：让「Agent 管道」的测试不需要 Docker / PostgreSQL 就能跑通（这正是 `VectorSearchPort` 抽象的意义）。
与 pgvector 真实行为的对齐由 `tests/test_document_service.py` 负责（该用例需要真实数据库）。
"""

from __future__ import annotations

import math
import uuid
from typing import Sequence

from app.schemas.document import SearchHit


class InMemoryVectorSearch:
    """用余弦相似度在内存里做精确检索（等价于 pgvector 的 <=>）。"""

    def __init__(self) -> None:
        #: (user_id, SearchHit, vector)
        self.rows: list[tuple[uuid.UUID, SearchHit, list[float]]] = []

    async def add(self, user_id: uuid.UUID, hit: SearchHit, vector: Sequence[float]) -> None:
        self.rows.append((user_id, hit, list(vector)))

    async def similar_search(
        self,
        user_id: uuid.UUID,
        query_vector: Sequence[float],
        *,
        top_k: int = 8,
        source_types: list[str] | None = None,
    ) -> list[SearchHit]:
        scored: list[tuple[float, SearchHit]] = []
        for row_user, hit, vector in self.rows:
            if row_user != user_id:
                continue
            if source_types and hit.ref.source_type not in source_types:
                continue
            scored.append((_cosine(query_vector, vector), hit))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [SearchHit(**{**hit.model_dump(), "score": round(score, 6)}) for score, hit in scored[:top_k]]


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    """余弦相似度（向量已归一化时等价于点积，这里仍按通用公式算）。"""
    dot = sum(a * b for a, b in zip(left, right))
    norm_l = math.sqrt(sum(a * a for a in left))
    norm_r = math.sqrt(sum(b * b for b in right))
    if norm_l == 0 or norm_r == 0:
        return 0.0
    return dot / (norm_l * norm_r)
