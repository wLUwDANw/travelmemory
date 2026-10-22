"""降级守护（O-1 / PROJECT.md 第 8 条 / 约束 E3）。

**这是扩展代码合入 main 的前提**（PROJECT.md §三）：
所有 feature flag 关闭时，主流程行为必须与阶段 2**逐条一致**。

本文件断言的四件事，正是后面三个批次各自会撬动的地方：

| 断言 | 守护谁 | 被谁可能打破 |
| --- | --- | --- |
| 证据顺序 = 阶段 2 快照 | 检索层 | W3-4 的 reranker / HNSW（关闭时必须 no-op、必须不换序列化 != 换排序） |
| Recall@5 / MRR 不退化 | 检索质量 | 同上 + 任何"顺手优化"融合权重的行为 |
| 引用率 1.00 + 拒答路径 | 生成与自检 | W3-2 的工具证据并入 `[n]`（编号只能续在后，不能打乱口径） |
| 关闭缓存后输出完全不变 | 缓存层 | W3-3 的四级缓存接入（读路径不得改变答案） |

快照为什么硬编码在这里而不动态生成：动态快照会把"当次运行的结果"当成期望值，
任何回归都会被自己 bless 掉。宁可在语料变更时手工更新一次 —— 那次更新本身就是一次评审。

**本文件禁止新增 skip**（O-5）：全部用例走 mock LLM + hashing embedding + 内存检索，离线可跑。
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fakes import InMemoryVectorSearch, load_demo_corpus

from app.agent.eval.metrics import mrr, recall_at_k
from app.agent.observability import Trace
from app.agent.pipeline import AgentPipeline
from app.agent.rag.retriever import Retriever, RetrieverConfig
from app.core.cache import InMemoryCache, NullCache, build_cache
from app.core.config import get_settings
from app.core.embedding import build_embedder
from app.core.feature_flags import STAGE3_FLAG_NAMES, stage3_flags
from app.core.llm import build_llm
from app.utils.citation import citation_rate, out_of_range_indices

#: 记忆类证据的来源类型（工具证据一旦混进来，source_type 会是 `map_tool`）
MEMORY_SOURCE_TYPES = frozenset({"trip", "place", "photo", "note"})


@dataclass(frozen=True)
class Stage2Case:
    """一条阶段 2 快照用例：`expected_prefix` 管顺序，`expected_keys` 管召回。"""

    query: str
    #: 前若干条证据的 `[n]` 编号顺序（含 source_type，工具证据不得插队）
    expected_prefix: tuple[str, ...]
    #: Recall@5 期望命中的 key：`(source_type, source_id, chunk_index)`
    expected_keys: tuple[tuple[str, str, int], ...]


STAGE2_CASES = (
    Stage2Case(
        query="乌镇 西塘 摇橹船 夜景",
        expected_prefix=(
            "place/p10#0",
            "trip/t1#0",
            "place/p20#0",
            "trip/t5#0",
            "place/p11#0",
        ),
        expected_keys=(
            ("place", "p10", 0),
            ("trip", "t1", 0),
            ("place", "p20", 0),
        ),
    ),
    Stage2Case(
        query="我去过哪些爬山看云海的地方？",
        expected_prefix=(
            "trip/t3#0",
            "place/p14#0",
            "trip/t2#0",
            "trip/t6#0",
            "trip/t4#0",
        ),
        expected_keys=(
            ("trip", "t3", 0),
            ("place", "p14", 0),
            ("trip", "t2", 0),
        ),
    ),
)


@pytest.fixture
async def store(user_id) -> InMemoryVectorSearch:
    """演示语料 + 本地哈希向量 + 内存检索（与 `test_pipeline_mock.py` 同一套替身）。"""
    return await load_demo_corpus(user_id, build_embedder(get_settings()))


@pytest.fixture
def stage3_off(monkeypatch) -> dict[str, bool]:
    """把阶段 3 四个开关**显式**关成 false，并把缓存切到 NullCache。

    为什么显式而不是依赖默认值：本守护回答的是"开关关着的时候行为等不等同阶段 2"；
    **默认值是多少**是另一个问题，由 `tests/test_feature_flags.py` 断言。
    两个问题分开，出红时才知道是"默认值被改"还是"关闭路径被写坏"。
    """
    for name in STAGE3_FLAG_NAMES:
        monkeypatch.setenv(f"{name.upper()}_ENABLED", "false")
    monkeypatch.setenv("CACHE_BACKEND", "null")
    get_settings.cache_clear()
    yield stage3_flags()
    get_settings.cache_clear()


def _build_pipeline(store: InMemoryVectorSearch, *, min_score: float) -> AgentPipeline:
    settings = get_settings()
    embedder = build_embedder(settings)
    retriever = Retriever(store, embedder, RetrieverConfig(top_k=5, min_score=min_score))
    return AgentPipeline(build_llm(settings), retriever, max_context_chars=2000, settings=settings)


async def _run(pipeline: AgentPipeline, user_id, query: str):
    trace = Trace(session=None, user_id=user_id, session_id="degradation", query=query)
    return await pipeline.run(user_id=user_id, session_id="degradation", query=query, trace=trace)


# ---------------------------------------------------------------- 前提
def test_degradation_premise_is_all_flags_off(stage3_off):
    """守护的前提本身要先被断言：四个开关全关 + 缓存不参与。"""
    assert stage3_off == {"tools": False, "cache": False, "rerank": False, "hnsw": False}
    assert isinstance(build_cache(), NullCache), "降级模式下缓存必须是直通实现"


# ---------------------------------------------------------------- 检索指标
@pytest.mark.parametrize("case", STAGE2_CASES, ids=lambda case: case.query)
async def test_retrieval_metrics_match_stage2_snapshot(store, user_id, case, stage3_off):
    """Recall@5 / MRR / 证据顺序 = 阶段 2 快照。

    三条断言各有分工，缺一条就可能被"看起来还是对的"骗过：
      - Recall@5 == 1.0：预期证据都没丢（顺序乱了也能过）
      - MRR == 1.0：第一条就命中（顺序乱了会掉下来）
      - 前缀相等：**逐条**顺序完全一致（前两条是它的交集，看不出中间插入）
    """
    pipeline = _build_pipeline(store, min_score=0.05)

    state = await _run(pipeline, user_id, case.query)

    keys = [hit.ref.key for hit in state.hits]
    assert recall_at_k(keys, list(case.expected_keys), 5) == 1.0, (
        f"Recall@5 退化：期望 {case.expected_keys}，实际 {keys}"
    )
    assert mrr(keys, list(case.expected_keys)) == 1.0, f"MRR 退化：实际顺序 {keys}"

    block_keys = [str(block.ref) for block in state.blocks]
    width = len(case.expected_prefix)
    assert tuple(block_keys[:width]) == case.expected_prefix, (
        f"证据顺序相比阶段 2 发生变化：\n  期望 {case.expected_prefix}\n  实际 {tuple(block_keys[:width])}"
    )


# ---------------------------------------------------------------- 生成与自检
async def test_answer_keeps_full_citation_rate(store, user_id, stage3_off):
    """引用率 100% 是硬指标（PROJECT.md §二、[3]）：开关全关时也必须稳在 1.00。"""
    pipeline = _build_pipeline(store, min_score=0.05)

    state = await _run(pipeline, user_id, "乌镇 西塘 摇橹船 夜景")

    assert state.refused is False, f"不该拒答：{state.answer}"
    assert state.citations, "答案必须带引用"
    assert citation_rate(state.answer) == 1.0, f"引用率退化：{state.answer}"
    # 引用不得越界：编号只能来自真实存在的证据块（工具证据将来并入时这条同样生效）
    assert out_of_range_indices(state.answer, len(state.blocks)) == []


async def test_refusal_path_still_triggers(store, user_id, stage3_off):
    """无证据必须拒答：这条路径一旦被工具证据"补上"而失效，引用率红线就守不住了。"""
    pipeline = _build_pipeline(store, min_score=0.99)

    state = await _run(pipeline, user_id, "我攀登珠峰用了几天？")

    assert state.refused is True
    assert state.refuse_reason == "no_evidence"
    assert state.citations == []
    assert citation_rate(state.answer) == 1.0, "拒答话术里不该出现事实句"


async def test_no_map_tool_evidence_when_tools_disabled(store, user_id, stage3_off):
    """tools 关 → 证据里不允许出现 `map_tool`，且编号必须从 1 连续递增。"""
    pipeline = _build_pipeline(store, min_score=0.05)

    state = await _run(pipeline, user_id, "乌镇 西塘 摇橹船 夜景")

    sources = {block.ref.source_type for block in state.blocks}
    assert sources <= MEMORY_SOURCE_TYPES, f"出现了非记忆类证据: {sources - MEMORY_SOURCE_TYPES}"
    assert [block.index for block in state.blocks] == list(range(1, len(state.blocks) + 1))


# ---------------------------------------------------------------- 缓存
async def test_disabled_cache_does_not_change_output(store, user_id, stage3_off):
    """缓存层合进来之后：开关关着时，有无缓存的答案必须**逐字相同**。

    这条是 W3-3 的"旁路设施不得改变主行为"的契约 —— 缓存只能改延迟，不能改答案。
    """
    pipeline = _build_pipeline(store, min_score=0.05)
    query = "乌镇 西塘 摇橹船 夜景"

    first = await _run(pipeline, user_id, query)
    second = await _run(pipeline, user_id, query)

    assert first.answer == second.answer
    assert [str(ref) for ref in first.citations] == [str(ref) for ref in second.citations]

    # 直通实现的世界里：写进去的东西一律读不回来（这正是"没缓存"的可观测形态）
    nothing = build_cache()
    await nothing.set("api:poi:whatever", "cached", 60)
    assert await nothing.get("api:poi:whatever") is None
    assert not isinstance(nothing, InMemoryCache)
