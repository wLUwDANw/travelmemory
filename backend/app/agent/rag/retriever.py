"""检索编排。

职责（设计文档 §5.1）：查询串组织、底层搜索调用、分数过滤、top-k 组装。
**不做**embedding 写入（那是 indexer 的事）。

阶段 0 是纯向量检索；阶段 2 会在这里加结构化过滤，阶段 3 加重排，
届时 node 层签名不变，只在内部插梯子。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.agent.rag.ports import VectorSearchPort
from app.agent.state import PipelineState
from app.core.embedding import BaseEmbedder
from app.schemas.document import SearchHit


@dataclass
class RetrieverConfig:
    top_k: int = 8
    #: 相似度下限：低于此值的证据不参与生成，宁可拒答也不硬凑引用
    min_score: float = 0.30


class Retriever:
    """把「状态里的自然语言」变成「一批带分数的证据」。"""

    def __init__(
        self,
        searcher: VectorSearchPort,
        embedder: BaseEmbedder,
        config: RetrieverConfig | None = None,
    ) -> None:
        self.searcher = searcher
        self.embedder = embedder
        self.config = config or RetrieverConfig()

    async def retrieve(self, state: PipelineState) -> list[SearchHit]:
        """执行一次检索。

        检索串 = 改写后的问句 + 抽取出的关键词拼接。
        关键词拼接是廉价的、能明显提升召回的技巧：短问题的向量往往过于稀疏。
        """
        query_text = self.build_search_text(state)
        if not query_text.strip():
            return []
        vector = await self.embedder.embed_one(query_text)
        hits = await self.searcher.similar_search(
            state.user_id, vector, top_k=self.config.top_k
        )
        # 相似度过滤放在这里，让"为什么这批证据被丢掉"能在 trace 里看见
        return [hit for hit in hits if hit.score >= self.config.min_score]

    @staticmethod
    def build_search_text(state: PipelineState) -> str:
        """拼接检索文本：问句为主，关键词补语义。"""
        parts = [state.search_query]
        if state.parsed and state.parsed.keywords:
            parts.extend(state.parsed.keywords[:5])
        return " ".join(p for p in parts if p).strip()
