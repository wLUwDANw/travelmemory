"""数据小票的不变量测试。

重点不是"字段能序列化"，而是**三档的边界不许被写松**：
L0 一旦允许上传、L1 一旦允许留存、L2 一旦允许不设 TTL，
小票就从"账单"退化成"装饰"。
"""

from __future__ import annotations

import copy

import pytest

from app.privacy.receipt import (
    TIER_FULL,
    TIER_LOCAL,
    TIER_THIN,
    DataReceipt,
    InvalidReceipt,
    build_receipt,
    verify_receipt,
)


def test_l0_什么都不发() -> None:
    receipt = build_receipt(tier=TIER_LOCAL, source_types=["photo"] * 12, gift_edges=3)
    assert receipt.docs_sent == 0
    assert receipt.bytes_sent == 0
    assert receipt.photos_sent == 0
    assert receipt.retention == "none"
    assert receipt.total_sources == 12
    assert "0 条上传" in receipt.describe()
    assert "含朋友信物" in receipt.describe()


def test_l0_不允许上传文档() -> None:
    with pytest.raises(InvalidReceipt, match="L0"):
        build_receipt(tier=TIER_LOCAL, docs_sent=1, bytes_sent=10)


def test_l0_不允许声明留存() -> None:
    with pytest.raises(InvalidReceipt, match="L0"):
        DataReceipt(tier=TIER_LOCAL, retention="ttl", ttl_hours=24)


def test_l1_必须真的发了文档() -> None:
    with pytest.raises(InvalidReceipt, match="L1"):
        build_receipt(tier=TIER_THIN)
    with pytest.raises(InvalidReceipt, match="L1"):
        build_receipt(tier=TIER_THIN, docs_sent=3)


def test_l1_是无状态的不许带_ttl() -> None:
    with pytest.raises(InvalidReceipt, match="L1"):
        DataReceipt(
            tier=TIER_THIN,
            docs_sent=3,
            bytes_sent=1024,
            retention="ttl",
            ttl_hours=1,
        )


def test_l2_必须声明_ttl() -> None:
    with pytest.raises(InvalidReceipt, match="L2"):
        DataReceipt(tier=TIER_FULL, docs_sent=20, bytes_sent=8192, retention="none")
    with pytest.raises(InvalidReceipt, match="L2"):
        DataReceipt(tier=TIER_FULL, docs_sent=20, bytes_sent=8192, retention="ttl", ttl_hours=0)


def test_来源计数去重后排序且累加() -> None:
    receipt = build_receipt(
        tier=TIER_THIN,
        source_types=["photo", "gift", "photo", "", "gift", "photo"],
        docs_sent=6,
        bytes_sent=2048,
    )
    assert receipt.source_counts == (("gift", 2), ("photo", 3))


def test_原图条数恒为零且不可由调用方覆盖() -> None:
    receipt = build_receipt(tier=TIER_THIN, docs_sent=1, bytes_sent=10)
    assert receipt.to_dict()["photos_sent"] == 0
    assert isinstance(receipt.photos_sent, int)


def test_摘要稳定且对字段敏感() -> None:
    first = build_receipt(tier=TIER_FULL, source_types=["photo"], docs_sent=10, bytes_sent=100,
                          ttl_hours=24)
    second = build_receipt(tier=TIER_FULL, source_types=["photo"], docs_sent=10, bytes_sent=100,
                           ttl_hours=24)
    assert first.digest() == second.digest()

    changed = build_receipt(tier=TIER_FULL, source_types=["photo"], docs_sent=11, bytes_sent=100,
                            ttl_hours=24)
    assert first.digest() != changed.digest()


def test_verify_接受合法小票() -> None:
    receipt = build_receipt(tier=TIER_LOCAL, source_types=["photo"] * 3)
    assert verify_receipt(receipt.to_dict()) == []


def test_verify_拦住被改成零外发的_l2() -> None:
    receipt = build_receipt(tier=TIER_FULL, source_types=["photo"], docs_sent=20, bytes_sent=8192,
                            ttl_hours=24)
    forged = copy.deepcopy(receipt.to_dict())
    forged["docs_sent"] = 0
    violations = verify_receipt(forged)
    assert any("不变量" in item or "摘要" in item for item in violations)


def test_verify_拦住非零原图() -> None:
    receipt = build_receipt(tier=TIER_LOCAL)
    forged = copy.deepcopy(receipt.to_dict())
    forged["photos_sent"] = 1
    assert any("原图" in item for item in verify_receipt(forged))


def test_verify_拦住缺字段() -> None:
    receipt = build_receipt(tier=TIER_LOCAL)
    forged = copy.deepcopy(receipt.to_dict())
    del forged["tier"]
    assert verify_receipt(forged) == ["缺少字段：tier"]


def test_verify_拦住未知档位() -> None:
    receipt = build_receipt(tier=TIER_LOCAL)
    forged = copy.deepcopy(receipt.to_dict())
    forged["tier"] = "L9"
    assert any("未知档位" in item for item in verify_receipt(forged))


def test_拒答与降级会出现在人话里() -> None:
    receipt = build_receipt(
        tier=TIER_LOCAL, refused=True, degraded_reason="budget_exhausted"
    )
    text = receipt.describe()
    assert "已拒答" in text
    assert "budget_exhausted" in text
