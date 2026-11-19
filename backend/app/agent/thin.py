"""L1 薄引擎：本机选证据，服务端只做**无状态**生成。

## 为什么单独一个类，而不是复用 AgentPipeline

`AgentPipeline` 的第一段是 `rewrite → query_parse → retrieve`。
在 L1 里，这三步**客户端已经做完了**（否则没法把"选哪几条"留在本机）。
直接复用会把查询再发一遍给 LLM 做解析、再做一次向量检索，
既多花钱，也和"只发选中的 K 条"这条承诺自相矛盾。

所以这里复用**生成侧的三个节点**（build_context / generate / self_check），
跳过检索侧的全部环节。两条链路共享的是"引用编号怎么来、怎么校验"，
这正是引用率 100% 那条硬指标真正依赖的部分。

## 无状态的具体含义

本类不接数据库、不写 session、不缓存、不落 trace 表（只写 JSONL）。
请求结束，服务端内存里不保留任何本次内容。
`DataReceipt.retention` 因此恒为 `none` —— 这是契约，不是口号。
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field

from app.agent.nodes.pipeline.build_context import BuildContextNode
from app.agent.nodes.pipeline.generate import GenerateNode
from app.agent.nodes.pipeline.self_check import SELF_CHECK_FAILED_ANSWER, SelfCheckNode
from app.agent.observability import Trace
from app.agent.state import PipelineState
from app.core.llm import BaseLLM
from app.privacy.receipt import TIER_THIN, DataReceipt, build_receipt
from app.schemas.document import DocumentRef, SearchHit

__all__ = [
    "MAX_CONTEXT_CHARS",
    "MAX_CONTEXT_ITEMS",
    "InvalidThinRequest",
    "ThinAnswer",
    "ThinAnswerService",
    "ThinContextItem",
]

#: 单次最多接受几条日文档。8 与检索默认 top_k 对齐，
#: 超过这个数量说明客户端在做检索而不是"挑证据"，该走 L2。
MAX_CONTEXT_ITEMS = 8

#: 上下文字符上限。防止调用方把整本旅行日记塞进来（那也不是 L1 的用法）。
MAX_CONTEXT_CHARS = 12_000


class InvalidThinRequest(ValueError):
    """L1 请求本身不合法（空上下文、超限、缺字段）。调用方的问题，不是降级。"""


@dataclass(frozen=True)
class ThinContextItem:
    """客户端挑好的一条日文档。`doc_id` 会原样回显在证据里，便于前端定位照片。"""

    doc_id: str
    text: str
    date: str = ""
    place: str = ""

    def __post_init__(self) -> None:
        if not self.doc_id.strip():
            raise InvalidThinRequest("doc_id 不能为空")
        if not self.text.strip():
            raise InvalidThinRequest(f"doc_id={self.doc_id} 的正文为空")


@dataclass
class ThinAnswer:
    """一次 L1 回答的结果。

    `violations` 非空且 `refused=True` 表示：生成两次都没通过引用校验，
    已按硬指标拒答（不是"模型说不知道"，是"我们不让它说"）。
    """

    answer: str
    refused: bool
    violations: list[str] = field(default_factory=list)
    receipt: DataReceipt | None = None
    token_usage: dict[str, float] = field(default_factory=dict)

    def to_event(self) -> dict:
        """给 SSE 用的 `receipt` 事件载荷。"""
        if self.receipt is None:  # pragma: no cover - 构造后必填
            return {}
        return {"receipt": self.receipt.to_dict(), "text": self.receipt.describe()}


class ThinAnswerService:
    """L1 的无状态生成服务。一个实例可跨请求复用（它不持有请求状态）。"""

    def __init__(self, llm: BaseLLM, *, max_context_chars: int = MAX_CONTEXT_CHARS) -> None:
        self.build_context = BuildContextNode(
            max_chars=max_context_chars,
            include_history=False,
            compress=False,
        )
        self.generate = GenerateNode(llm)
        self.self_check = SelfCheckNode()
        self.max_context_chars = max_context_chars

    # ------------------------------------------------------------------ 主入口
    async def answer(
        self,
        *,
        user_id: uuid.UUID,
        session_id: str,
        query: str,
        context: list[ThinContextItem],
        trace: Trace | None = None,
    ) -> ThinAnswer:
        items = self._validate(context)
        state = PipelineState(user_id=user_id, session_id=session_id, query=query)
        state.hits = [self._to_hit(item) for item in items]

        trace = trace or Trace(session=None, user_id=user_id, session_id=session_id, query=query)
        await trace.start_run()
        try:
            await self.build_context(state, trace)
            await self.generate(state, trace)
            violations = await self.self_check(state, trace)
            # 与主链路同一套失败策略：重试一次，仍不过就拒答。
            # 不在 L1 里另立标准 —— 引用率 100% 是全局红线，不因档位打折。
            if violations and not state.refused:
                state.attempts += 1
                await self.generate(state, trace)
                violations = await self.self_check(state, trace)
            if violations:
                state.refused = True
                state.refuse_reason = "self_check_failed"
                state.answer = SELF_CHECK_FAILED_ANSWER
                state.citations = []
        except Exception:
            await trace.finish_run(status="failed", token_usage=state.token_usage)
            raise

        await trace.finish_run(
            status="refused" if state.refused else "success",
            token_usage=state.token_usage,
        )
        receipt = build_receipt(
            tier=TIER_THIN,
            source_types=["day"] * len(items),
            docs_sent=len(items),
            bytes_sent=self._payload_bytes(items),
            refused=state.refused,
        )
        return ThinAnswer(
            answer=state.answer,
            refused=state.refused,
            violations=violations,
            receipt=receipt,
            token_usage=state.token_usage,
        )

    # ------------------------------------------------------------------ 内部
    def _validate(self, context: list[ThinContextItem]) -> list[ThinContextItem]:
        if not context:
            raise InvalidThinRequest("L1 至少需要一条上下文；没有证据应当走拒答，不是调这个接口")
        if len(context) > MAX_CONTEXT_ITEMS:
            raise InvalidThinRequest(
                f"上下文最多 {MAX_CONTEXT_ITEMS} 条，收到 {len(context)} 条；请先在客户端筛"
            )
        total = sum(len(item.text) for item in context)
        if total > self.max_context_chars:
            raise InvalidThinRequest(
                f"上下文合计 {total} 字，超过上限 {self.max_context_chars}；请先在客户端压缩"
            )
        return context

    @staticmethod
    def _to_hit(item: ThinContextItem) -> SearchHit:
        return SearchHit(
            ref=DocumentRef(source_type="day", source_id=item.doc_id),
            content=item.text,
            metadata={"date": item.date, "place": item.place},
            # 分数固定 1.0：客户端已经做过筛选，服务端不再二次打分。
            # 这里若给随机分，重排/阈值逻辑会偷偷改变客户端的选择。
            score=1.0,
        )

    @staticmethod
    def _payload_bytes(items: list[ThinContextItem]) -> int:
        payload = [
            {"doc_id": item.doc_id, "text": item.text, "date": item.date, "place": item.place}
            for item in items
        ]
        return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
