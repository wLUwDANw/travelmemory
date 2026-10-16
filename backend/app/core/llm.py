"""LLM 调用封装。

职责边界（设计文档 §5.1）：本模块只负责「调用 + 重试 + 超时 + token 与成本统计」，
**不含任何 prompt 内容**（prompt 全部在 app/agent/prompts/ 下版本化管理）。

provider：
  - openai： OpenAI 兼容的 `/chat/completions`（DeepSeek / Qwen / 火山等均可用）
  - mock：   本地确定性应答，用于在无密钥时验证链路与跑单元测试

`purpose` 参数：标明这次调用属于管道的哪个环节，既便于 trace 归因，
也让 mock 能针对不同环节返回正确形状的结果。
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.core.exceptions import LLMError, LLMBudgetExceeded
from app.core.logging import get_logger

logger = get_logger(__name__)

#: 价格估算表（元 / 百万 token）：(输入价, 输出价)
#: 仅用于判断成本量级是否失控，不作为计费依据；厂商调价不必同步，未知模型按 0 计并告警。
_PRICE_PER_MTOKENS: dict[str, tuple[float, float]] = {
    "deepseek-chat": (2.0, 8.0),
    "deepseek-reasoner": (4.0, 16.0),
    "qwen-plus": (0.8, 2.0),
    "qwen-max": (20.0, 60.0),
}


@dataclass
class LLMMessage:
    role: str          # system / user / assistant
    content: str


@dataclass
class LLMResult:
    """一次 LLM 调用的完整结果，成本与 token 都在这一层统计。"""

    content: str
    model: str
    provider: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    cost_cents: float = 0.0
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class BudgetGuard:
    """日预算守卫。

    阶段 0 是进程内简单计数；阶段 3 引入 Redis 后应替换为原子 INCR/EXPIRE
    （多进程/多实例部署时进程内计数会失效）。
    """

    def __init__(self, limit_cents: int) -> None:
        self.limit_cents = limit_cents
        self.spent_cents: float = 0.0

    def check(self) -> None:
        if self.limit_cents > 0 and self.spent_cents >= self.limit_cents:
            raise LLMBudgetExceeded(
                f"已用 {self.spent_cents:.2f} 分 / 上限 {self.limit_cents} 分（LLM_DAILY_BUDGET_CENTS）"
            )

    def add(self, cents: float) -> None:
        self.spent_cents += cents


class BaseLLM(ABC):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.budget = BudgetGuard(settings.llm_daily_budget_cents)

    @property
    @abstractmethod
    def provider(self) -> str: ...

    @property
    @abstractmethod
    def model(self) -> str: ...

    @abstractmethod
    async def _completion(
        self,
        messages: list[LLMMessage],
        *,
        purpose: str,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> LLMResult:
        """子类实现真正的调用。`purpose` 标明调用来自管道的哪个环节。"""

    async def chat(
        self,
        messages: list[LLMMessage],
        *,
        purpose: str = "generate",
        temperature: float | None = None,
        max_tokens: int | None = None,
        json_mode: bool = False,
    ) -> LLMResult:
        """统一入口：先过预算闸门，再调用，最后统计成本。"""
        self.budget.check()
        result = await self._completion(
            messages,
            purpose=purpose,
            temperature=self.settings.llm_temperature if temperature is None else temperature,
            max_tokens=max_tokens or self.settings.llm_max_tokens,
            json_mode=json_mode,
        )
        result.cost_cents = self.estimate_cost(result.prompt_tokens, result.completion_tokens)
        self.budget.add(result.cost_cents)
        logger.debug(
            "llm.call purpose=%s model=%s tokens=%d cost=%.3f分 latency=%dms",
            purpose,
            result.model,
            result.total_tokens,
            result.cost_cents,
            result.latency_ms,
        )
        return result

    def estimate_cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        """按价格表估算成本（单位：分）。未知模型记 0 并告警，避免静默算错钱。"""
        price = _PRICE_PER_MTOKENS.get(self.model)
        if price is None:
            logger.warning("模型 %s 不在价格表中，本次调用成本按 0 计", self.model)
            return 0.0
        in_rate, out_rate = price
        yuan = prompt_tokens / 1_000_000 * in_rate + completion_tokens / 1_000_000 * out_rate
        return round(yuan * 100, 4)


class OpenAICompatLLM(BaseLLM):
    """OpenAI 兼容协议的 LLM。

    重试策略：只对「网络超时 / 连接错误 / 5xx / 429」重试，业务 4xx（如参数错误）直接失败，
    避免把明显错误的请求重复烧钱。
    """

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self._base_url = settings.llm_base_url.rstrip("/")

    @property
    def provider(self) -> str:
        return "openai"

    @property
    def model(self) -> str:
        return self.settings.llm_model

    async def _completion(
        self,
        messages: list[LLMMessage],
        *,
        purpose: str,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> LLMResult:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if json_mode:
            # 大部分兼容端点支持该参数；不支持时模型通常会忽略，下游 JSON 解析会兜底
            payload["response_format"] = {"type": "json_object"}

        headers = {"Authorization": f"Bearer {self.settings.llm_api_key}"}
        last_error: str = ""
        for attempt in range(self.settings.llm_max_retries + 1):
            started = time.perf_counter()
            try:
                async with httpx.AsyncClient(
                    base_url=self._base_url, headers=headers, timeout=self.settings.llm_timeout_sec
                ) as client:
                    resp = await client.post("/chat/completions", json=payload)
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                last_error = f"网络错误: {exc}"
                if attempt < self.settings.llm_max_retries:
                    await asyncio.sleep(1.5**attempt)
                    continue
                raise LLMError(last_error, retryable=True) from exc

            latency_ms = int((time.perf_counter() - started) * 1000)

            if resp.status_code == 429 or resp.status_code >= 500:
                last_error = f"status={resp.status_code} body={resp.text[:200]}"
                if attempt < self.settings.llm_max_retries:
                    await asyncio.sleep(1.5**attempt)
                    continue
                raise LLMError(last_error, retryable=True)

            if resp.status_code != 200:
                # 4xx：多半是请求本身有问题，重试无意义
                raise LLMError(
                    f"LLM 返回错误 status={resp.status_code} body={resp.text[:300]}",
                    retryable=False,
                )

            body = resp.json()
            try:
                choice = body["choices"][0]
                content = choice["message"]["content"] or ""
            except (KeyError, IndexError) as exc:
                raise LLMError(f"LLM 响应结构异常: {body!r:.300}") from exc

            usage = body.get("usage") or {}
            return LLMResult(
                content=content.strip(),
                model=body.get("model", self.model),
                provider=self.provider,
                prompt_tokens=int(usage.get("prompt_tokens", 0)),
                completion_tokens=int(usage.get("completion_tokens", 0)),
                latency_ms=latency_ms,
                raw=body,
            )

        raise LLMError(last_error or "LLM 调用失败", retryable=True)


class MockLLM(BaseLLM):
    """确定性本地应答，用于「无密钥也能跑通链路」与单元测试。

    它做的事：从上下文中抽出编号证据 `[n]`，拼成一个必定带引用的回答。
    因此整条管道的引用率检查、拒答、trace 都能在没有外部依赖的情况下被验证。
    """

    @property
    def provider(self) -> str:
        return "mock"

    @property
    def model(self) -> str:
        return "mock-llm-v0"

    async def _completion(
        self,
        messages: list[LLMMessage],
        *,
        purpose: str,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> LLMResult:
        last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
        content = self._route(purpose, last_user, json_mode)
        # token 数按字符粗估，只为让 trace/成本的量级合理
        return LLMResult(
            content=content,
            model=self.model,
            provider=self.provider,
            prompt_tokens=max(1, len(last_user) // 2),
            completion_tokens=max(1, len(content) // 2),
            latency_ms=1,
        )

    def _route(self, purpose: str, user_content: str, json_mode: bool) -> str:
        """按调用环节分派应答（确定性，不调用任何外部服务）。"""
        if purpose == "query_parse" or json_mode:
            return self._json_answer(user_content)
        if purpose == "rewrite":
            return self._rewrite_answer(user_content)
        if purpose == "generate":
            return self._cited_answer(user_content)
        # 兜底：留给后续阶段新增的环节
        return "[MOCK] 本地占位回答。"

    @staticmethod
    def _rewrite_answer(user_content: str) -> str:
        """rewriter：直接回用户的原始提问（去空白）。"""
        lines = [ln.strip() for ln in user_content.splitlines() if ln.strip()]
        for ln in lines:
            if ln.startswith("用户问题：") or ln.startswith("原始提问："):
                return ln.split("：", 1)[1].strip()
        return lines[-1] if lines else ""

    @staticmethod
    def _json_answer(user_content: str) -> str:
        """query_parse：抽 2~4 字的中文词作为关键词。"""
        words = re.findall(r"[\u4e00-\u9fa5]{2,}", user_content)
        keywords = list(dict.fromkeys(words))[:8]
        return json.dumps({"keywords": keywords}, ensure_ascii=False)

    @staticmethod
    def _cited_answer(user_content: str) -> str:
        """generate：把前 3 条证据的首句改写出来，并强制带上 [n]。"""
        lines = user_content.splitlines()
        picks: list[tuple[str, str]] = []
        for line in lines:
            m = re.match(r"^\[(\d+)\]\s*(.+)$", line.strip())
            if m:
                picks.append((m.group(1), m.group(2).strip()))
            if len(picks) >= 3:
                break
        if not picks:
            return "抱歉，在你的照片与行程记录里没有找到相关证据，我无法回答这个问题。"
        sentences = []
        for idx, content in picks:
            first_sentence = re.split(r"[。！？!?；;]", content)[0].strip()
            sentences.append(f"{first_sentence}[{idx}]")
        return "；".join(sentences) + "。"


def build_llm(settings: Settings | None = None) -> BaseLLM:
    """工厂：按配置选择 LLM 实现（auto = 有 key 走真实，无 key 走 mock）。"""
    settings = settings or get_settings()
    provider = settings.llm_provider.lower()

    if provider == "auto":
        provider = "openai" if settings.llm_key_present else "mock"

    if provider == "openai":
        return OpenAICompatLLM(settings)
    if provider == "mock":
        logger.warning(
            "LLM_PROVIDER=mock：未配置 LLM_API_KEY，回答由本地规则生成，仅用于验证链路"
        )
        return MockLLM(settings)

    raise LLMError(f"未知的 llm provider: {settings.llm_provider}")
