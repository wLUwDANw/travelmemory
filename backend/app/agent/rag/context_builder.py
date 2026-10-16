"""上下文构建：把检索结果变成「LLM 可读且带编号」的证据块。

设计文档 §7.4 规定了固定的上下文顺序：

```
[系统指令]
[用户偏好 / 语义记忆]     ← 阶段 4
[当前行程上下文]          ← 阶段 4
[检索证据]                ← 本模块负责
[群体语义先验]            ← 阶段 7（无编号、禁止引用）
[对话历史] / [用户问题]
```

阶段 0 只有「检索证据」与「用户问题」两块，其余位置在对应阶段插入，
顺序本身不要动 —— 位置变化会直接影响模型对"能不能引用"的判断。
"""

from __future__ import annotations

from dataclasses import dataclass

from app.agent.state import EvidenceBlock
from app.schemas.document import SearchHit

#: 元数据里用来给模型看的「人类可读线索」，按展示优先级排列
_META_LABELS = {
    "date_start": "开始",
    "date_end": "结束",
    "city": "城市",
    "places": "地点",
    "themes": "主题",
    "trip_title": "行程",
}


@dataclass
class BuiltContext:
    blocks: list[EvidenceBlock]
    text: str
    #: 是否因预算被截断（写进 trace，便于发现"证据被吃掉"导致的拒答）
    truncated: bool
    dropped: int


def build_context(hits: list[SearchHit], *, max_chars: int = 4000) -> BuiltContext:
    """按分数顺序编号，并在字符预算内截断。

    编号必须在**这里**定下来：模型输出里的 [n] 就是这里的 index，
    一旦前后编号不一致，引用就全部错位。
    """
    blocks: list[EvidenceBlock] = []
    lines: list[str] = []
    used = 0
    dropped = 0

    for hit in hits:
        index = len(blocks) + 1
        line = _format_block(index, hit)
        if blocks and used + len(line) > max_chars:
            # 至少保留一条；超出预算的直接丢弃（保证上下文可控，宁缺毋滥）
            dropped = len(hits) - index + 1
            break
        blocks.append(
            EvidenceBlock(
                index=index,
                ref=hit.ref,
                content=hit.content,
                score=hit.score,
                meta=dict(hit.metadata),
            )
        )
        lines.append(line)
        used += len(line)

    if not blocks:
        return BuiltContext(blocks=[], text="", truncated=False, dropped=len(hits))

    return BuiltContext(
        blocks=blocks, text="\n\n".join(lines), truncated=dropped > 0, dropped=dropped
    )


def _format_block(index: int, hit: SearchHit) -> str:
    """单条证据的文本形式：`[n] 来源 / 元信息 + 原文`。"""
    head = f"[{index}] 来源={hit.ref}"
    metas = _format_meta(hit.metadata)
    if metas:
        head += f"（{metas}）"
    head += f" 相似度={hit.score:.3f}"
    return f"{head}\n{hit.content}"


def _format_meta(metadata: dict) -> str:
    """把结构化元信息压成一行短标签。

    目的：让模型一眼看到时间与地点线索，同时不占用过多上下文预算。
    """
    parts: list[str] = []
    for key, label in _META_LABELS.items():
        value = metadata.get(key)
        if not value:
            continue
        if isinstance(value, list):
            value = "、".join(str(v) for v in value)
        parts.append(f"{label}={value}")
    return " ".join(parts)
