"""离线索引：把「数据源」变成可检索的 Document + 向量。

职责边界（设计文档 §5.1）：
  - 本模块只做「切块 → 向量化 → 调 DocumentService 落库」
  - 不负责查询；调度与幂等重试由阶段 1 的 `jobs/` 负责

幂等性的关键：`Document` 的唯一键是 `(source_type, source_id, chunk_index)`，
所以同一份数据重复索引只会覆盖，不会堆积重复向量。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.rag.chunker import ChunkConfig, chunk_text
from app.core.embedding import BaseEmbedder
from app.schemas.document import DocumentRef, DocumentUpsert
from app.services.document_service import DocumentService
from app.utils.text import estimate_tokens


@dataclass
class IndexResult:
    """一次索引的结果摘要，写日志与批处理统计都要用。"""

    source_type: str
    source_id: str
    chunks: int
    keywords_hit: bool = False

    def __str__(self) -> str:  # pragma: no cover - 日志用
        return f"{self.source_type}/{self.source_id} 写入 {self.chunks} 个 chunk"


class DocumentIndexer:
    """把一个数据源的文本变成向量文档。"""

    def __init__(
        self,
        session: AsyncSession,
        embedder: BaseEmbedder,
        *,
        chunk_config: ChunkConfig | None = None,
    ) -> None:
        self.service = DocumentService(session)
        self.embedder = embedder
        self.chunk_config = chunk_config

    async def index_source(
        self,
        *,
        user_id: uuid.UUID,
        source_type: str,
        source_id: str,
        text: str,
        metadata: dict | None = None,
    ) -> IndexResult:
        """索引单个数据源（幂等：重复调用只会覆盖）。"""
        base_meta = metadata or {}
        chunks = chunk_text(text, self.chunk_config)
        if not chunks:
            return IndexResult(source_type, source_id, 0)

        items = [
            DocumentUpsert(
                ref=DocumentRef(source_type=source_type, source_id=source_id, chunk_index=i),
                content=chunk,
                metadata=base_meta,
                token_count=estimate_tokens(chunk),
                char_len=len(chunk),
            )
            for i, chunk in enumerate(chunks)
        ]

        vectors = await self.embedder.embed([item.content for item in items])
        await self.service.upsert_many(
            user_id, items, vectors, embedding_model=self.embedder.model_version
        )
        # 若这次切出的块数比上次少，清理尾部残留（例如原文被缩短）
        await self.service.delete_stale_chunks(
            source_type, source_id, len(items), user_id=user_id
        )
        return IndexResult(source_type, source_id, len(items))
