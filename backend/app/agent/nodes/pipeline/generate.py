"""generate 节点：带证据生成答案（或明确拒答）。

两条硬约束来自设计文档 §7.4：
  1. 没有证据 → **直接拒答**，连 LLM 都不调用（省一次钱，也避免模型自由发挥）
  2. 有证据 → 让模型在 system 规则下作答，要求每句事实都带 [n]
"""

from __future__ import annotations

from app.agent.nodes.pipeline.common import today_text
from app.agent.observability import Trace
from app.agent.prompts.loader import load, render
from app.agent.state import PipelineState
from app.core.llm import BaseLLM, LLMMessage
from app.schemas.document import DocumentRef
from app.utils.citation import CITATION_RE, extract_citation_indices

#: 无证据时的标准话术：既明确"不知道"，又给一个可执行的替代动作
NO_EVIDENCE_ANSWER = (
    "抱歉，我在你的照片和行程记录里没有找到能支撑这个问题的证据，所以不替你编一个答案。"
    "你可以换个更具体的说法（比如指明城市或年份），或者先把相关行程的照片导入进来。"
)


class GenerateNode:
    def __init__(self, llm: BaseLLM) -> None:
        self.llm = llm

    async def __call__(self, state: PipelineState, trace: Trace) -> None:
        async with trace.step(
            "generate",
            {"question": state.query, "evidence_count": len(state.blocks)},
        ) as step:
            # ---- 情况一：没有证据，直接拒答 ----
            if not state.blocks:
                state.refused = True
                state.refuse_reason = "no_evidence"
                state.answer = NO_EVIDENCE_ANSWER
                state.citations = []
                step.output = {"refused": True, "reason": "no_evidence"}
                return

            # ---- 情况二：有证据，按 system 规则生成 ----
            prompt = render(
                "generate",
                context=_ensure_numbered(state),
                question=state.query,
                today=today_text(),
            )
            result = await self.llm.chat(
                [
                    LLMMessage(role="system", content=load("system")),
                    LLMMessage(role="user", content=prompt),
                ],
                purpose="generate",
            )
            state.answer = result.content.strip()
            state.refused = False
            state.refuse_reason = ""
            state.citations = _cited_refs(state)
            state.token_usage = {
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "cost_cents": result.cost_cents,
            }
            step.output = {
                "answer": state.answer,
                "citations": [str(ref) for ref in state.citations],
                "latency_ms": result.latency_ms,
                "cost_cents": result.cost_cents,
            }


def _ensure_numbered(state: PipelineState) -> str:
    """确保上下文里每条证据都带 [n] 编号。

    引用错位是最难查的一类 bug（模型引用 [3]，但 [3] 其实在上下文里是第 2 条），
    这里做一次兜底编号。
    """
    if state.context_text and CITATION_RE.search(state.context_text):
        return state.context_text
    return "\n\n".join(f"[{b.index}] {b.content}" for b in state.blocks)


def _cited_refs(state: PipelineState) -> list[DocumentRef]:
    """根据答案里出现的引用编号，反查出对应的文档引用。

    这一步让前端能实现「点 [1] → 地图飞到那张照片」（设计文档 §14.1 环节 4）。
    """
    by_index = {b.index: b.ref for b in state.blocks}
    refs: list[DocumentRef] = []
    for idx in dict.fromkeys(extract_citation_indices(state.answer)):
        ref = by_index.get(idx)
        if ref is not None and ref not in refs:
            refs.append(ref)
    return refs
