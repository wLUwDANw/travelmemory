"""build_context 节点：给证据编号并拼成 LLM 上下文。

编号从这里诞生，模型的引用就必须指回这里 —— 引用率能否做到 100%，
很大程度上取决于上下文是否清晰、编号是否有歧义。
"""

from __future__ import annotations

from app.agent.observability import Trace
from app.agent.rag.context_builder import build_context
from app.agent.state import PipelineState


class BuildContextNode:
    def __init__(self, *, max_chars: int = 4000) -> None:
        self.max_chars = max_chars

    async def __call__(self, state: PipelineState, trace: Trace) -> None:
        async with trace.step("build_context", {"hits": len(state.hits)}) as step:
            built = build_context(state.hits, max_chars=self.max_chars)
            state.blocks = built.blocks
            state.context_text = built.text
            step.output = {
                "blocks": len(built.blocks),
                "truncated": built.truncated,
                "dropped": built.dropped,
                "chars": len(built.text),
            }
