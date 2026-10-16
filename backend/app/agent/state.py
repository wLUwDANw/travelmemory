"""管道状态容器。

用可变 dataclass 而不是 Pydantic 模型：管道内部是原地传递与修改，
刻意保持轻量；对外（HTTP / CLI 输出）再转成 schemas 里的不可变结构。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.schemas.document import DocumentRef, SearchHit


@dataclass
class ParsedQuery:
    """结构化解析结果。

    阶段 0 只用到 `keywords`（辅助向量检索）。
    `time_range / places / themes` 在阶段 2（W2-1）接入结构化过滤后才真正生效，
    这里先把字段留出来，避免到时改动节点签名。
    """

    keywords: list[str] = field(default_factory=list)
    time_range: dict[str, str] | None = None
    places: list[str] = field(default_factory=list)
    themes: list[str] = field(default_factory=list)
    #: 解析失败时置 True：检索阶段必须**退化为不过滤**，宁可多召回不要漏召回
    degraded: bool = False


@dataclass
class EvidenceBlock:
    """进入上下文的一条证据，`index` 即 prompt 里的 `[n]` 编号（从 1 开始）。"""

    index: int
    ref: DocumentRef
    content: str
    score: float
    meta: dict = field(default_factory=dict)


@dataclass
class PipelineState:
    """一次 Agent 问答的全部中间状态。"""

    user_id: uuid.UUID
    session_id: str
    query: str

    #: 最近若干轮对话（阶段 4 的短期记忆会替换这里的简易实现）
    history: list[dict[str, str]] = field(default_factory=list)

    # ---- 各节点的产物 ----
    rewritten_query: str = ""
    parsed: ParsedQuery | None = None
    hits: list[SearchHit] = field(default_factory=list)
    blocks: list[EvidenceBlock] = field(default_factory=list)
    #: 拼好后交给 LLM 的上下文原文（保留它在 trace 里便于复盘）
    context_text: str = ""
    answer: str = ""
    citations: list[DocumentRef] = field(default_factory=list)

    # ---- 结果与元信息 ----
    refused: bool = False
    refuse_reason: str = ""
    #: generate 重试次数：self_check 失败后只允许再生成一次
    attempts: int = 0
    latency_ms: int = 0
    token_usage: dict[str, float] = field(default_factory=dict)

    @property
    def search_query(self) -> str:
        """实际用于向量检索的文本：改写结果优先，失败回落原问题。"""
        return self.rewritten_query or self.query
