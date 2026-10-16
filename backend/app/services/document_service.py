"""Document 的读写服务。

职责边界（设计文档 §5.1）：本服务只做文档 CRUD 与「底层向量/结构化查询」，
**不**做查询改写、RRF 融合、重排 —— 那些属于 `agent/rag/retriever.py`。

阶段 0 刻意用**精确扫描**（ORDER BY 距离 + LIMIT），不建 HNSW：
pgvector 的 HNSW 是先遍历图再套 WHERE，带 user_id 过滤时可能一条都不返回。
先用精确扫描保证正确性，阶段 3+ 再引入索引并配套「结果不足回退精确扫描」。
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document
from app.schemas.document import DocumentRef, DocumentUpsert, SearchHit


class DocumentService:
    """注入 AsyncSession 构造，方便批处理脚本与测试各自管理事务。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ------------------------------------------------------------------ 写
    async def upsert_many(
        self,
        user_id: uuid.UUID,
        items: Sequence[DocumentUpsert],
        vectors: Sequence[Sequence[float]],
        *,
        embedding_model: str,
    ) -> int:
        """批量写入（同 triple 覆盖）。

        冲突目标用唯一约束 `uq_document_source_chunk` 的三个字段，
        因此**重复导入同一数据源不会重复烧 embedding 的钱**，这是幂等重索引的基础。
        """
        if len(items) != len(vectors):
            raise ValueError("items 与 vectors 数量必须一致")
        if not items:
            return 0

        rows = [
            {
                "user_id": user_id,
                "source_type": item.ref.source_type,
                "source_id": item.ref.source_id,
                "chunk_index": item.ref.chunk_index,
                "content": item.content,
                "metadata": item.metadata or {},
                "token_count": item.token_count,
                "char_len": item.char_len or len(item.content),
                "embedding": list(vector),
                "embedding_model": embedding_model,
            }
            for item, vector in zip(items, vectors, strict=True)
        ]

        # excluded 指向「本次想插入但发生冲突的那一行」，用它做 update 的值
        insert_stmt = insert(Document).values(rows)
        excluded = insert_stmt.excluded
        stmt = insert_stmt.on_conflict_do_update(
            index_elements=["source_type", "source_id", "chunk_index"],
            set_={
                "content": excluded.content,
                "metadata": excluded.metadata,
                "token_count": excluded.token_count,
                "char_len": excluded.char_len,
                "embedding": excluded.embedding,
                "embedding_model": excluded.embedding_model,
                "updated_at": func.now(),
            },
        )
        await self.session.execute(stmt)
        return len(rows)

    async def delete_stale_chunks(
        self, source_type: str, source_id: str, keep_count: int, *, user_id: uuid.UUID
    ) -> int:
        """重索引后清理多余旧 chunk（新的比旧的少时会有残留）。

        比"先全删再插"安全：万一中途失败，旧数据还在，检索不会短暂失效。
        """
        result = await self.session.execute(
            delete(Document).where(
                Document.user_id == user_id,
                Document.source_type == source_type,
                Document.source_id == source_id,
                Document.chunk_index >= keep_count,
            )
        )
        return int(result.rowcount or 0)

    async def delete_by_source(
        self, source_type: str, source_id: str | None = None, *, user_id: uuid.UUID | None = None
    ) -> int:
        """删除某个数据源的全部 chunk（source_id 为空则删整个类型）。"""
        stmt = delete(Document).where(Document.source_type == source_type)
        if source_id is not None:
            stmt = stmt.where(Document.source_id == source_id)
        if user_id is not None:
            stmt = stmt.where(Document.user_id == user_id)
        result = await self.session.execute(stmt)
        return int(result.rowcount or 0)

    # ------------------------------------------------------------------ 读
    async def count(self, user_id: uuid.UUID | None = None) -> int:
        stmt = select(func.count()).select_from(Document)
        if user_id is not None:
            stmt = stmt.where(Document.user_id == user_id)
        return int((await self.session.execute(stmt)).scalar_one())

    async def get_refs_by_source(self, source_type: str, source_id: str) -> list[DocumentRef]:
        """列出某数据源的所有 chunk 引用（用于判断是否需要重索引）。"""
        stmt = (
            select(Document.source_type, Document.source_id, Document.chunk_index)
            .where(Document.source_type == source_type, Document.source_id == source_id)
            .order_by(Document.chunk_index)
        )
        rows = (await self.session.execute(stmt)).all()
        return [DocumentRef(source_type=r[0], source_id=r[1], chunk_index=r[2]) for r in rows]

    async def similar_search(
        self,
        user_id: uuid.UUID,
        query_vector: Sequence[float],
        *,
        top_k: int = 8,
        source_types: Sequence[str] | None = None,
    ) -> list[SearchHit]:
        """余弦相似度检索（精确扫描）。

        注意：`<=>` 是余弦**距离**，所以相似度 = 1 - 距离。
        """
        distance = Document.embedding.cosine_distance(list(query_vector))
        stmt = (
            select(Document, distance.label("distance"))
            .where(Document.user_id == user_id, Document.embedding.is_not(None))
            .order_by(distance)
            .limit(top_k)
        )
        if source_types:
            stmt = stmt.where(Document.source_type.in_(list(source_types)))

        rows = (await self.session.execute(stmt)).all()
        return [
            SearchHit(
                document_id=doc.id,
                ref=DocumentRef(
                    source_type=doc.source_type,
                    source_id=doc.source_id,
                    chunk_index=doc.chunk_index,
                ),
                content=doc.content,
                metadata=dict(doc.metadata_json or {}),
                score=round(1.0 - float(dist), 6),
            )
            for doc, dist in rows
        ]

    async def embedding_stats(self) -> dict[str, int]:
        """各 embedding_model 的文档数量（脏向量排查用）。"""
        rows = (
            await self.session.execute(
                select(Document.embedding_model, func.count())
                .group_by(Document.embedding_model)
                .order_by(func.count().desc())
            )
        ).all()
        return {str(model): int(count) for model, count in rows}
