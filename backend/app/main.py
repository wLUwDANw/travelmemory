"""FastAPI 应用壳。

阶段 0 **不开放任何业务接口**（入口是 `python -m app.cli`），
这里只保留健康检查，确保 `make dev` 能起来，也方便后面阶段直接挂路由。

业务路由从阶段 2（SSE 流式问答）开始加入 `app/api/v1/`。
"""

from __future__ import annotations

from fastapi import FastAPI

from app.agent.prompts.loader import PROMPT_VERSION
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="旅忆地图 TravelMemory",
    description="以个人照片地图记忆为数据源的旅行记忆 Agent（阶段 0：RAG CLI）",
    version="0.0.0-stage0",
)


@app.get("/health", summary="健康检查", tags=["ops"])
async def health() -> dict:
    """存活探测。刻意不查数据库：容器编排需要一个轻量探针。"""
    return {
        "status": "ok",
        "stage": 0,
        "runtime": settings.agent_runtime,
        "prompt_version": PROMPT_VERSION,
    }
