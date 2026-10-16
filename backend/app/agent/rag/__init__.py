"""RAG 子包：索引、检索、上下文构建。

与 `nodes/` 的分工：这里是可复用的策略，节点只负责编排与埋点。
"""

from app.agent.rag.chunker import ChunkConfig, chunk_text
from app.agent.rag.context_builder import BuiltContext, build_context
from app.agent.rag.indexer import DocumentIndexer
from app.agent.rag.retriever import Retriever, RetrieverConfig

__all__ = [
    "BuiltContext",
    "ChunkConfig",
    "DocumentIndexer",
    "Retriever",
    "RetrieverConfig",
    "build_context",
    "chunk_text",
]
