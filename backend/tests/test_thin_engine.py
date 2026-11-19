"""L1 薄引擎的契约测试。

三条不能松的线：
  1. 上下文条数/字数上限 —— 超了就是客户端在做检索，该走 L2；
  2. 引用校验与主链路同口径 —— 不许因为"档位低"就放过没引用的句子；
  3. 小票必须是 `retention=none` 且 `docs_sent>0` —— 无状态不是形容词。
"""

from __future__ import annotations

import uuid

import pytest

from app.agent.thin import (
    MAX_CONTEXT_ITEMS,
    InvalidThinRequest,
    ThinAnswerService,
    ThinContextItem,
)
from app.core.config import get_settings
from app.core.llm import build_llm
from app.privacy.receipt import verify_receipt

CONTEXT = [
    ThinContextItem(
        doc_id="d_2024-10-02_wuzhen",
        date="2024-10-02",
        place="乌镇",
        text="2024-10-02 乌镇：西栅夜景，临水木屋，江南水乡古镇。",
    ),
    ThinContextItem(
        doc_id="d_2024-10-03_xitang",
        date="2024-10-03",
        place="西塘",
        text="2024-10-03 西塘：烟雨长廊与石皮弄，典型的水乡古镇。",
    ),
]


def _service() -> ThinAnswerService:
    return ThinAnswerService(llm=build_llm(get_settings()))


async def test_l1_回答带引用且小票声明不留存() -> None:
    result = await _service().answer(
        user_id=uuid.uuid4(),
        session_id="test-thin",
        query="我去年秋天去过哪些古镇？",
        context=CONTEXT,
    )
    assert not result.refused
    assert "[1]" in result.answer
    assert result.receipt is not None
    assert result.receipt.tier == "L1"
    assert result.receipt.docs_sent == len(CONTEXT)
    assert result.receipt.retention == "none"
    assert result.receipt.ttl_hours is None
    assert result.receipt.photos_sent == 0
    assert result.receipt.total_sources == len(CONTEXT)


async def test_l1_小票能通过外部校验() -> None:
    result = await _service().answer(
        user_id=uuid.uuid4(), session_id="test-thin", query="哪些古镇？", context=CONTEXT
    )
    assert result.receipt is not None
    assert verify_receipt(result.receipt.to_dict()) == []


async def test_空上下文_直接拒绝_不浪费一次调用() -> None:
    with pytest.raises(InvalidThinRequest, match="至少需要一条"):
        await _service().answer(
            user_id=uuid.uuid4(), session_id="test-thin", query="哪些古镇？", context=[]
        )


async def test_超过条数上限_拒绝() -> None:
    too_many = [
        ThinContextItem(doc_id=f"d{i}", text="某天：某地。") for i in range(MAX_CONTEXT_ITEMS + 1)
    ]
    with pytest.raises(InvalidThinRequest, match="最多"):
        await _service().answer(
            user_id=uuid.uuid4(), session_id="test-thin", query="哪些？", context=too_many
        )


async def test_超过字数上限_拒绝() -> None:
    huge = [ThinContextItem(doc_id="d_big", text="乌镇" * 7000)]
    with pytest.raises(InvalidThinRequest, match="超过上限"):
        await _service().answer(
            user_id=uuid.uuid4(), session_id="test-thin", query="哪些？", context=huge
        )


async def test_doc_id_或正文为空_拒绝() -> None:
    with pytest.raises(InvalidThinRequest, match="doc_id 不能为空"):
        ThinContextItem(doc_id="  ", text="某天。")
    with pytest.raises(InvalidThinRequest, match="正文为空"):
        ThinContextItem(doc_id="d1", text="  ")


class _FakeGenerate:
    """替换生成节点，用来制造"模型不守规矩"的两种场景。"""

    def __init__(self, answer: str) -> None:
        self.answer = answer

    async def __call__(self, state, trace) -> None:  # noqa: ANN001 - 与节点签名一致即可
        state.answer = self.answer
        state.citations = []


async def test_没有引用的回答_重试后仍拒答() -> None:
    service = _service()
    service.generate = _FakeGenerate("你去年秋天去了乌镇和西塘。")  # type: ignore[assignment]
    result = await service.answer(
        user_id=uuid.uuid4(), session_id="test-thin", query="哪些古镇？", context=CONTEXT
    )
    assert result.refused
    assert result.receipt is not None
    assert result.receipt.refused is True
    # 两次都不过，最终话术必须是拒答，而不是把这句没有引用的话发给用户
    assert "没能落到具体证据" in result.answer


async def test_引用编号越界_同样拒答() -> None:
    service = _service()
    service.generate = _FakeGenerate("你去了乌镇 [9]。")  # type: ignore[assignment]
    result = await service.answer(
        user_id=uuid.uuid4(), session_id="test-thin", query="哪些古镇？", context=CONTEXT
    )
    assert result.refused
    assert result.violations and "越界" in result.violations[0]
