"""阶段 0 的 Agent 管道（纯 Python，无框架）。

链路：rewrite → query_parse → retrieve → build_context → generate → self_check

为什么先不用 LangGraph（设计文档 §3.5）：先把 RAG 与 Memory 的本质跑明白，
再引入状态机；届时 `AGENT_RUNTIME=graph` 切换实现，两者对外接口保持一致，可回滚对比。

self_check 的失败处理：重试一次生成 → 仍不满足引用要求就**拒答**。
这是引用率 100% 这条硬指标的执行者。
"""

from __future__ import annotations

import uuid

from app.agent.nodes.pipeline import (
    BuildContextNode,
    GenerateNode,
    QueryParseNode,
    RetrieveNode,
    RewriteNode,
    SelfCheckNode,
)
from app.agent.nodes.pipeline.self_check import SELF_CHECK_FAILED_ANSWER
from app.agent.observability import Trace
from app.agent.rag.ports import VectorSearchPort
from app.agent.rag.retriever import Retriever, RetrieverConfig
from app.agent.state import PipelineState
from app.core.config import Settings, get_settings
from app.core.embedding import BaseEmbedder, build_embedder
from app.core.llm import BaseLLM, build_llm
from app.core.logging import get_logger

logger = get_logger(__name__)


class AgentPipeline:
    """线性管道。所有协作者都从外部注入，便于替换实现与单测。"""

    def __init__(
        self,
        llm: BaseLLM,
        retriever: Retriever,
        *,
        max_context_chars: int = 4000,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.llm = llm
        self.retriever = retriever
        self.rewrite = RewriteNode(llm)
        self.query_parse = QueryParseNode(llm)
        self.retrieve = RetrieveNode(retriever)
        self.build_context = BuildContextNode(max_chars=max_context_chars)
        self.generate = GenerateNode(llm)
        self.self_check = SelfCheckNode()

    @classmethod
    def build(
        cls,
        searcher: VectorSearchPort,
        *,
        embedder: BaseEmbedder | None = None,
        llm: BaseLLM | None = None,
        settings: Settings | None = None,
    ) -> "AgentPipeline":
        """便捷构造：按配置自动选 provider（真实 / mock）。"""
        settings = settings or get_settings()
        embedder = embedder or build_embedder(settings)
        llm = llm or build_llm(settings)
        retriever = Retriever(
            searcher,
            embedder,
            RetrieverConfig(
                top_k=settings.retrieval_top_k,
                min_score=settings.retrieval_min_score,
            ),
        )
        return cls(
            llm,
            retriever,
            max_context_chars=settings.context_max_chars,
            settings=settings,
        )

    async def run(
        self,
        *,
        user_id: uuid.UUID,
        session_id: str,
        query: str,
        history: list[dict[str, str]] | None = None,
        trace: Trace | None = None,
    ) -> PipelineState:
        """跑一次问答。trace 由调用方创建（决定是否落库），否则只写 JSONL。"""
        state = PipelineState(
            user_id=user_id,
            session_id=session_id,
            query=query,
            history=history or [],
        )
        trace = trace or Trace(session=None, user_id=user_id, session_id=session_id, query=query)
        await trace.start_run()

        try:
            await self.rewrite(state, trace)
            await self.query_parse(state, trace)
            await self.retrieve(state, trace)
            await self.build_context(state, trace)
            await self.generate(state, trace)

            violations = await self.self_check(state, trace)

            # 最多重试一次生成：再给模型一次机会，仍不行就拒答
            if violations and state.attempts == 0 and not state.refused:
                logger.info("self_check 未通过，重试一次生成：%s", violations[:2])
                state.attempts += 1
                await self.generate(state, trace)
                violations = await self.self_check(state, trace)

            if violations:
                state.refused = True
                state.refuse_reason = "self_check_failed"
                state.answer = SELF_CHECK_FAILED_ANSWER
                state.citations = []

            status = "refused" if state.refused else "success"
            state.latency_ms = await trace.finish_run(
                status=status, token_usage=state.token_usage
            )
        except Exception:
            # 失败也必须收尾，否则 trace 里会永远是 running
            await trace.finish_run(status="failed", token_usage=state.token_usage)
            raise

        return state
