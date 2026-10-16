"""测试全局夹具。

两个原则：
  1. 单测**不依赖任何外部服务**：LLM 用 mock、embedding 用本地哈希、检索用内存实现
  2. 单测**不写真实 trace 目录**：TRACE_DIR 指向临时目录
"""

from __future__ import annotations

import uuid

import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def test_env(tmp_path, monkeypatch) -> None:
    """每个用例都在确定的环境里跑，避免本地 .env 或真实密钥影响结果。"""
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.setenv("EMBEDDING_PROVIDER", "hashing")
    monkeypatch.setenv("EMBEDDING_DIM", "256")   # 小维度：快且足够验证逻辑
    monkeypatch.setenv("TRACE_DIR", str(tmp_path / "traces"))
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://nobody:nobody@127.0.0.1:5432/none")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def user_id() -> uuid.UUID:
    """一个固定的 user_id（单用户模型，测试里不需要真的入库）。"""
    return uuid.uuid4()
