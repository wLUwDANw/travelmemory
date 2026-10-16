"""评测指标。

阶段 0 只测检索命中与拒答；生成忠实度、工具选择准确率等在阶段 5（W5-1）补齐。

指标口径必须与 self_check 节点保持一致，否则会出现「节点判失败但评测判通过」的错位：
  - Recall@k = 前 k 条召回里命中的期望文档数 / 期望文档总数
  - MRR      = 1 / 第一条命中期望文档的排名（没命中为 0）
  - citation_rate = 事实句中带引用的比例（来自 utils/citation，与 self_check 同口径）
"""

from __future__ import annotations

from dataclasses import dataclass

from app.utils.citation import citation_rate as _citation_rate

#: 拒答识别：命中这些标记即认为模型明确拒答了
REFUSAL_MARKERS = (
    "没有找到能支撑",
    "没能落到具体证据",
    "没有找到相关",
    "无法回答这个问题",
)


@dataclass
class EvalRow:
    """一条用例的一次运行结果。"""

    kind: str
    question: str
    recall_at_k: float | None = None
    mrr: float | None = None
    citation_rate: float | None = None
    refusal_correct: float | None = None
    latency_ms: int = 0
    answer: str | None = None
    refused: bool = False
    case_id: str | None = None


def recall_at_k(retrieved: list[tuple], expected: list[tuple], k: int = 5) -> float | None:
    """召回率@k。expected 为空时返回 None（说明这条不该算检索召回）。"""
    if not expected:
        return None
    top = retrieved[:k]
    hits = sum(1 for key in expected if key in top)
    return round(hits / len(expected), 4)


def mrr(retrieved: list[tuple], expected: list[tuple]) -> float | None:
    """倒排排名：只看第一条命中的位置。"""
    if not expected:
        return None
    expected_set = set(expected)
    for rank, key in enumerate(retrieved, start=1):
        if key in expected_set:
            return round(1.0 / rank, 4)
    return 0.0


def is_refusal(answer: str) -> bool:
    """答案是否属于明确拒答。"""
    return any(marker in answer for marker in REFUSAL_MARKERS)


def citation_rate(answer: str) -> float:
    """引用覆盖率（转发到统一实现，保证与 self_check 口径一致）。"""
    return _citation_rate(answer)


def _mean(values: list[float | None]) -> float | None:
    nums = [v for v in values if v is not None]
    if not nums:
        return None
    return round(sum(nums) / len(nums), 4)


def aggregate(rows: list[EvalRow]) -> dict[str, float | None]:
    """汇总统计。按 kind 分开算，避免群体先验污染个人记忆的口径。"""
    result: dict[str, float | None] = {}
    for kind in {row.kind for row in rows}:
        kind_rows = [row for row in rows if row.kind == kind]
        prefix = f"{kind}."
        result[prefix + "count"] = float(len(kind_rows))
        result[prefix + "recall_at_k"] = _mean([row.recall_at_k for row in kind_rows])
        result[prefix + "mrr"] = _mean([row.mrr for row in kind_rows])
        result[prefix + "citation_rate"] = _mean([row.citation_rate for row in kind_rows])
        result[prefix + "refusal_correct"] = _mean([row.refusal_correct for row in kind_rows])
        result[prefix + "latency_ms"] = _mean([float(row.latency_ms) for row in kind_rows])
    return result
