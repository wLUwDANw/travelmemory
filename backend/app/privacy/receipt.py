"""数据小票（Data Receipt）：一次回答把什么数据送出了设备，逐项写清楚。

## 为什么需要它

产品承诺是"本地优先"，但用户无法从界面上判断这句话是真是假。
小票把"这次走的是哪一档、上传了几条、服务端留存多久"变成**结构化数据**：
前端可以直接渲染成人话，后端可以用不变量校验，评测可以按档位统计外发量。

## 三档的含义（与产品定义一一对应）

| 档位 | 检索在哪 | 生成在哪 | 外发什么 | 留存 |
| --- | --- | --- | --- | --- |
| L0 | 本机 | 本机（规则） | 什么都不发 | 无 |
| L1 | 本机 | 云端（无状态） | 本次选中的 K 条日文档 | 不留存 |
| L2 | 云端 | 云端 | 整个派生索引 | TTL 到期删除 |

## 它不是什么

**它是自报 + 不变量校验，不是密码学证明。**
服务端仍然可以撒谎；小票保证的是"说法自洽、可审计、可逐次对比"，
不保证"服务端一定照做"。要更强需要服务端签名 + 客户端抽样核对，
那属于后续工作——报告里必须把这条边界写清楚，不能包装成"可证明"。

## 一条结构性不变量

`photos_sent` 恒为 0，且它不是可传参数，而是 `to_dict()` 里写死的常量。
原图不出设备是产品底线（PROJECT.md §二、[1]），不该由调用方"记得别传"来保证。
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "TIER_FULL",
    "TIER_LOCAL",
    "TIER_THIN",
    "InvalidReceipt",
    "ReceiptViolation",
    "DataReceipt",
    "build_receipt",
    "verify_receipt",
]

#: L0：全本机。允许出现朋友信物（它本来就在本机解密），但不允许任何上传。
TIER_LOCAL = "L0"
#: L1：本机选证据、云端只做无状态生成。请求结束即忘。
TIER_THIN = "L1"
#: L2：云端检索 + 生成。只允许派生索引，且必须带 TTL。
TIER_FULL = "L2"

_TIERS = (TIER_LOCAL, TIER_THIN, TIER_FULL)

#: 留存策略。`none` = 请求结束即忘；`ttl` = 服务端暂存并在到期后删除。
RETENTION_NONE = "none"
RETENTION_TTL = "ttl"
_RETENTIONS = (RETENTION_NONE, RETENTION_TTL)

#: 小票格式版本。字段一旦改名必须升版本，否则前端无法判断自己读的是哪一版。
SCHEMA_VERSION = "receipt-v1"


class InvalidReceipt(ValueError):
    """小票自身不合法（构造期就炸，避免把矛盾的数据发给前端）。"""


class ReceiptViolation(ValueError):
    """校验一份**外部传入**的小票时发现的问题；异常里带完整的违规列表。"""

    def __init__(self, violations: list[str]) -> None:
        self.violations = violations
        super().__init__("；".join(violations) if violations else "小票校验失败")


@dataclass(frozen=True)
class DataReceipt:
    """一次回答的数据外发账单（不可变，可直接进 JSON / 日志 / 测试断言）。

    Attributes:
        tier: `L0` / `L1` / `L2`，见模块 docstring 的三档表
        source_counts: 本轮引用的证据来源计数，按来源名排序，如
            `(("gift", 3), ("photo", 12))`。排序是为了让摘要稳定
        docs_sent: 本次真正发送到服务端的文档条数（L0 必须为 0）
        bytes_sent: 发送的 JSON 字节数（估算即可，用于展示量级）
        retention: `none` / `ttl`
        ttl_hours: 仅 `ttl` 档需要；`none` 档必须为 None
        gift_edges: 本轮命中的朋友信物溯源边条数（它只在本机，不上传）
        refused: 本轮是否为拒答
        degraded_reason: 降级原因（如 `budget_exhausted`），空串表示未降级
    """

    tier: str
    source_counts: tuple[tuple[str, int], ...] = ()
    docs_sent: int = 0
    bytes_sent: int = 0
    retention: str = RETENTION_NONE
    ttl_hours: int | None = None
    gift_edges: int = 0
    refused: bool = False
    degraded_reason: str = ""
    schema_version: str = field(default=SCHEMA_VERSION, init=False)

    def __post_init__(self) -> None:
        if self.tier not in _TIERS:
            raise InvalidReceipt(f"未知档位 {self.tier!r}（可用: {', '.join(_TIERS)}）")
        if self.retention not in _RETENTIONS:
            raise InvalidReceipt(f"未知留存策略 {self.retention!r}")
        if self.docs_sent < 0:
            raise InvalidReceipt(f"docs_sent 不能为负：{self.docs_sent}")
        if self.bytes_sent < 0:
            raise InvalidReceipt(f"bytes_sent 不能为负：{self.bytes_sent}")
        if self.gift_edges < 0:
            raise InvalidReceipt(f"gift_edges 不能为负：{self.gift_edges}")

        for name, count in self.source_counts:
            if not name:
                raise InvalidReceipt("来源名不能为空")
            if count < 0:
                raise InvalidReceipt(f"来源 {name!r} 的计数不能为负：{count}")

        # ---- 三档的核心不变量：任何一条被破坏，小票就在撒谎 ----
        if self.tier == TIER_LOCAL:
            if self.docs_sent != 0 or self.bytes_sent != 0:
                raise InvalidReceipt("L0 不允许任何上传，docs_sent / bytes_sent 必须为 0")
            if self.retention != RETENTION_NONE or self.ttl_hours is not None:
                raise InvalidReceipt("L0 没有服务端留存，retention 必须为 none 且 ttl_hours 为空")
        elif self.tier == TIER_THIN:
            if self.docs_sent == 0 or self.bytes_sent == 0:
                raise InvalidReceipt("L1 至少发送一条日文档，docs_sent / bytes_sent 不能为 0")
            if self.retention != RETENTION_NONE or self.ttl_hours is not None:
                raise InvalidReceipt("L1 是无状态生成，retention 必须为 none")
        else:  # TIER_FULL
            if self.retention != RETENTION_TTL:
                raise InvalidReceipt("L2 必须声明 ttl 留存策略")
            if not self.ttl_hours or self.ttl_hours <= 0:
                raise InvalidReceipt("L2 必须给出正的 ttl_hours")

    # ------------------------------------------------------------------ 展示
    @property
    def photos_sent(self) -> int:
        """恒为 0。写成属性而不是字段，是为了让它**没有传错的入口**。"""
        return 0

    @property
    def total_sources(self) -> int:
        return sum(count for _name, count in self.source_counts)

    def describe(self) -> str:
        """给前端直接显示的一句话。措辞按档位区分，不夸大。"""
        if self.tier == TIER_LOCAL:
            head = "本机完成 · 0 条上传 · 0 张原图"
        elif self.tier == TIER_THIN:
            head = f"本机选证据 · 上传 {self.docs_sent} 条日文档 · 不留存"
        else:
            head = f"云端检索 · 上传 {self.docs_sent} 条派生索引 · {self.ttl_hours} 小时后删除"
        tail = " · 含朋友信物" if self.gift_edges else ""
        if self.refused:
            tail += " · 已拒答"
        if self.degraded_reason:
            tail += f" · 降级：{self.degraded_reason}"
        return head + tail

    # ------------------------------------------------------------------ 序列化
    def to_payload(self) -> dict[str, Any]:
        """不含摘要的 JSON 载荷；字段顺序固定，便于人工比对。"""
        return {
            "schema_version": self.schema_version,
            "tier": self.tier,
            "sources": {name: count for name, count in self.source_counts},
            "docs_sent": self.docs_sent,
            "bytes_sent": self.bytes_sent,
            "photos_sent": self.photos_sent,
            "retention": self.retention,
            "ttl_hours": self.ttl_hours,
            "gift_edges": self.gift_edges,
            "refused": self.refused,
            "degraded_reason": self.degraded_reason,
        }

    def digest(self) -> str:
        """对载荷做 SHA256，用于日志/trace 对齐同一次回答。"""
        canonical = json.dumps(
            self.to_payload(), ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def to_dict(self) -> dict[str, Any]:
        payload = self.to_payload()
        payload["digest"] = self.digest()
        return payload


def build_receipt(
    *,
    tier: str,
    source_types: Iterable[str] = (),
    docs_sent: int = 0,
    bytes_sent: int = 0,
    ttl_hours: int | None = None,
    gift_edges: int = 0,
    refused: bool = False,
    degraded_reason: str = "",
) -> DataReceipt:
    """按来源类型列表聚合计数，再交给 `DataReceipt` 做一致性校验。

    `source_types` 传的是"本轮引用了哪些来源"，重复项会累加；
    空字符串与 `None` 一律忽略（调用方从 state 里拼列表时难免带进来）。
    留存策略不在这里猜：L0/L1 固定 `none`、L2 固定 `ttl`，
    跟档位绑定比让调用方传更安全——少一个能传错的参数，就少一种撒谎方式。
    """
    counter = Counter(name for name in source_types if name)
    counts = tuple(sorted(counter.items()))
    retention = RETENTION_TTL if tier == TIER_FULL else RETENTION_NONE
    return DataReceipt(
        tier=tier,
        source_counts=counts,
        docs_sent=docs_sent,
        bytes_sent=bytes_sent,
        retention=retention,
        ttl_hours=ttl_hours,
        gift_edges=gift_edges,
        refused=refused,
        degraded_reason=degraded_reason,
    )


def verify_receipt(payload: Mapping[str, Any]) -> list[str]:
    """校验一份**外部传入**的小票，返回违规列表（空列表 = 通过）。

    为什么前端也需要这套规则：小票是服务端自报的，如果前端只负责渲染，
    一个 bug 就能让界面显示"0 条上传"而实际发了 20 条。
    把不变量写成可执行检查，至少能拦住"自相矛盾"的那一类谎言。

    校验分三步：字段齐全 → 用构造器重建（复用同一套不变量）→ 摘要比对。
    """
    violations: list[str] = []

    required = {
        "schema_version",
        "tier",
        "sources",
        "docs_sent",
        "bytes_sent",
        "photos_sent",
        "retention",
        "ttl_hours",
        "gift_edges",
        "refused",
    }
    missing = sorted(required - set(payload))
    if missing:
        return [f"缺少字段：{', '.join(missing)}"]

    if payload.get("photos_sent") != 0:
        violations.append("photos_sent 必须为 0（原图不出设备）")

    sources = payload.get("sources")
    if not isinstance(sources, Mapping):
        violations.append("sources 必须是对象")
        sources = {}
    source_counts = tuple(sorted((str(k), int(v)) for k, v in sources.items()))

    try:
        rebuilt = DataReceipt(
            tier=str(payload["tier"]),
            source_counts=source_counts,
            docs_sent=int(payload["docs_sent"]),
            bytes_sent=int(payload["bytes_sent"]),
            retention=str(payload["retention"]),
            ttl_hours=payload["ttl_hours"],
            gift_edges=int(payload["gift_edges"]),
            refused=bool(payload["refused"]),
            degraded_reason=str(payload.get("degraded_reason", "")),
        )
    except (InvalidReceipt, TypeError, ValueError) as exc:
        violations.append(f"不变量不成立：{exc}")
        return violations

    digest = payload.get("digest")
    if digest is not None and digest != rebuilt.digest():
        violations.append("摘要与内容不一致（小票被改过，或字段顺序被破坏）")

    return violations
