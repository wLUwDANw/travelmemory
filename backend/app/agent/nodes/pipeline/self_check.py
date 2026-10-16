"""self_check 节点：引用率 100% 的硬校验。

引用率 100% 是核心硬指标（设计文档 §10.1），靠"让模型自觉"是不行的，
必须有一段确定性的代码来判。本节点就是那段代码。

判定口径（与 `utils/citation.py` 完全一致，评测共用）：
  - 每个非软句的事实句必须包含至少一个 `[n]`
  - 引用的编号不能超出本轮证据范围
  - 拒答时不允许出现任何引用编号（拒答还说"根据 [1]"是矛盾）

由 pipeline 决定失败后怎么办：重试一次 → 仍失败则拒答。
"""

from __future__ import annotations

from app.agent.observability import Trace
from app.agent.state import PipelineState
from app.utils.citation import (
    CITATION_RE,
    assertive_sentences,
    extract_citation_indices,
    out_of_range_indices,
)

#: self_check 最终失败时的兜底话术
SELF_CHECK_FAILED_ANSWER = (
    "抱歉，这次生成的回答里有没能落到具体证据的内容。"
    "为了保证不编造，我不把它说给你听。你可以把问题说得更具体一些，"
    "或者明确城市与时间范围，我再查一次。"
)


class SelfCheckNode:
    """注意：本节点返回值是违规描述列表（空列表 = 通过）。"""

    async def __call__(self, state: PipelineState, trace: Trace) -> list[str]:
        async with trace.step(
            "self_check",
            {"answer_len": len(state.answer), "refused": state.refused},
        ) as step:
            violations = collect_violations(state)
            step.output = {
                "violations": violations,
                "passed": not violations,
            }
            return violations


def collect_violations(state: PipelineState) -> list[str]:
    """纯函数形式的校验规则，便于单测与离线复算。"""
    max_index = len(state.blocks)

    # 拒答分支：不许带引用
    if state.refused:
        if extract_citation_indices(state.answer):
            return ["拒答答案里出现了引用编号"]
        return []

    if not state.answer.strip():
        return ["答案为空"]

    violations: list[str] = []

    bad = out_of_range_indices(state.answer, max_index)
    if bad:
        violations.append(f"引用编号越界 {bad}（本轮证据共 {max_index} 条）")

    for sentence in assertive_sentences(state.answer):
        if not CITATION_RE.search(sentence):
            violations.append(f"缺少引用：{sentence}")

    return violations
