"""query_parse 节点：结构化解析。

阶段 0 的作用：抽出关键词，拼到检索串里提升召回。
阶段 2（W2-1）会在这里真正产生 `time_range / places / themes`，
由 retriever 转成 SQL 过滤条件。

**关键容错**：解析失败一律退化为「不过滤」（state.parsed.degraded=True），
宁可多召回让上层 rerank / 拒答处理，也不能因为解析猜错而漏召回。
"""

from __future__ import annotations

from app.agent.nodes.pipeline.common import extract_json_object, today_text
from app.agent.observability import Trace
from app.agent.prompts.loader import render
from app.agent.state import ParsedQuery, PipelineState
from app.core.llm import BaseLLM, LLMMessage


class QueryParseNode:
    def __init__(self, llm: BaseLLM) -> None:
        self.llm = llm

    async def __call__(self, state: PipelineState, trace: Trace) -> None:
        async with trace.step("query_parse", {"query": state.search_query}) as step:
            prompt = render("query_parse", today=today_text(), query=state.search_query)
            result = await self.llm.chat(
                [LLMMessage(role="user", content=prompt)],
                purpose="query_parse",
                json_mode=True,
                temperature=0.0,
            )
            data = extract_json_object(result.content)
            if data is None:
                # 解析不出来就明文降级，不能假装成功
                state.parsed = ParsedQuery(keywords=[], degraded=True)
                step.output = {"degraded": True, "reason": "json parse failed"}
                return

            state.parsed = ParsedQuery(
                keywords=_str_list(data.get("keywords")),
                time_range=data.get("time_range") if isinstance(data.get("time_range"), dict) else None,
                places=_str_list(data.get("places")),
                themes=_str_list(data.get("themes")),
                degraded=False,
            )
            step.output = {
                "keywords": state.parsed.keywords,
                "places": state.parsed.places,
                "themes": state.parsed.themes,
                "time_range": state.parsed.time_range,
                "tokens": result.total_tokens,
            }


def _str_list(value: object) -> list[str]:
    """把 LLM 返回的字段规范成字符串列表（它可能给字符串、None、或混合类型）。"""
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return []
