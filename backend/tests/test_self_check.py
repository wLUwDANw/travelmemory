"""self_check 测试：引用率硬校验的行为必须稳定可预期。"""

from __future__ import annotations

import uuid

from app.agent.nodes.pipeline.self_check import collect_violations
from app.agent.state import EvidenceBlock, PipelineState
from app.schemas.document import DocumentRef


def _state(answer: str, *, n_blocks: int = 2, refused: bool = False) -> PipelineState:
    state = PipelineState(user_id=uuid.uuid4(), session_id="test", query="测试问题")
    state.answer = answer
    state.refused = refused
    state.blocks = [
        EvidenceBlock(
            index=i + 1,
            ref=DocumentRef(source_type="trip", source_id=f"t{i + 1}"),
            content=f"第 {i + 1} 条证据",
            score=0.9 - i * 0.1,
        )
        for i in range(n_blocks)
    ]
    return state


def test_all_sentences_cited_passes():
    assert collect_violations(_state("你在 2025 年去过乌镇[1]。西塘是第二站[2]。")) == []


def test_uncited_fact_is_violation():
    violations = collect_violations(_state("你在 2025 年去过乌镇[1]。你还去过另外三个地方。"))
    assert len(violations) == 1
    assert "缺少引用" in violations[0]


def test_out_of_range_citation_is_violation():
    violations = collect_violations(_state("你在 2025 年去过乌镇[9]。"))
    assert any("越界" in v for v in violations)


def test_refusal_without_citation_passes():
    state = _state("抱歉，我在你的照片和行程记录里没有找到能支撑这个问题的证据。", refused=True, n_blocks=0)
    assert collect_violations(state) == []


def test_refusal_with_citation_fails():
    """拒答却带引用编号是自我矛盾，必须判失败。"""
    state = _state("抱歉，没有找到乌镇的记录[1]。", refused=True, n_blocks=1)
    assert collect_violations(state) != []


def test_empty_answer_is_violation():
    assert collect_violations(_state("")) != []
