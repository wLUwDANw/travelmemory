"""全局配置：所有环境变量的唯一入口。

约定（PROJECT.md §二、[5]）：**其他模块不得直接 os.getenv**，一律从这里取。
这样做的收益：换环境只改 .env；测试里可以方便整体替换 Settings；CI 能在启动时
立刻发现漏配，而不是运行到一半才 KeyError。

.env 查找顺序：项目根 .env → backend/.env（后者覆盖前者）。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py → parents = [core, app, backend, project_root]
BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    """运行时配置。

    字段按阶段分组，当前阶段用不到的保持默认值即可，不影响跑通主流程。
    """

    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",   # .env 里未在本类声明的变量直接忽略，避免拼写错配导致的静默失效
        case_sensitive=False,
    )

    # ---------------- 基础（阶段 0） ----------------
    database_url: str = "postgresql+asyncpg://user:pass@localhost:5432/travel_memory"
    agent_runtime: str = "pipeline"      # pipeline（阶段 0~3）| graph（阶段 4+）
    log_level: str = "INFO"

    # ---------------- LLM（DeepSeek / Qwen，统一 OpenAI 兼容协议） ----------------
    # provider = auto：有 key 走真实 API，没 key 自动降级为 mock（打印醒目警告），
    # 这样阶段 0 在没有密钥时也能把整条管道跑通，方便先验证工程链路。
    llm_provider: str = "auto"           # auto | openai | mock
    llm_model: str = "deepseek-chat"
    llm_api_key: str = ""
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_temperature: float = 0.2
    llm_max_tokens: int = 1024
    llm_timeout_sec: float = 60.0
    llm_max_retries: int = 2             # 仅对网络类错误重试，业务 4xx 不重试
    llm_daily_budget_cents: int = 2000   # 阶段 0 为进程内计数，阶段 3 换成 Redis 原子计数

    # ---------------- Embedding ----------------
    embedding_provider: str = "auto"     # auto | openai | hashing
    embedding_model: str = "bge-m3"
    embedding_model_version: str = "bge-m3@v1"   # 变更此值必须 make reindex
    embedding_dim: int = 1024            # 必须与实际模型维度一致，启动时会校验
    embedding_api_key: str = ""
    embedding_base_url: str = ""         # OpenAI 兼容端点，留空时跟随 LLM_BASE_URL
    embedding_batch_size: int = 16

    # ---------------- 检索 ----------------
    retrieval_top_k: int = 8             # 召回条数（构建上下文的上限）
    retrieval_min_score: float = 0.30    # 低于该相似度的证据不进上下文，防"硬凑引用"
    context_max_chars: int = 4000        # 上下文预算：超出按分数从高到低截断

    # ---------------- 可观测 ----------------
    # 相对 backend/ 解析；JSONL 便于脱离数据库直接 grep / 画 trace
    trace_dir: str = "../backend/data/traces"

    # ---------------- 演示数据 ----------------
    demo_user_name: str = "我"           # 单用户部署，阶段 0 用于演示语料归属

    # ---------------- 阶段 3+（先占位，阶段 0 不使用）----------------
    redis_url: str = "redis://localhost:6379/0"
    amap_api_key: str = ""
    amap_js_key: str = ""
    rerank_model: str = "bge-reranker-v2-m3"

    # ---------------- 阶段 6+（占位）----------------
    minio_endpoint: str = ""
    minio_access_key: str = ""
    minio_secret_key: str = ""

    # ---------------- 扩展开关（阶段 7，默认全关）----------------
    privacy_enabled: bool = False
    semantic_enabled: bool = False
    zk_enabled: bool = False
    chain_enabled: bool = False
    privacy_version: str = "privacy-2026.1"
    semantic_tag_version: str = "sem-2026.1"

    # ---------------- 派生属性 ----------------
    @property
    def llm_key_present(self) -> bool:
        """是否配置了 LLM 密钥（决定 auto 走真实还是 mock）。"""
        return bool(self.llm_api_key.strip())

    @property
    def embedding_key_present(self) -> bool:
        return bool(self.embedding_api_key.strip()) or self.llm_key_present

    @property
    def resolved_embedding_base_url(self) -> str:
        """embedding 未单独配置端点时复用 LLM 端点（多数国产平台两者同源）。"""
        return self.embedding_base_url.strip() or self.llm_base_url

    @property
    def resolved_trace_dir(self) -> Path:
        """trace 输出目录（绝对路径，自动创建）。"""
        path = (BACKEND_DIR / self.trace_dir).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def project_root(self) -> Path:
        return PROJECT_ROOT

    @property
    def backend_dir(self) -> Path:
        return BACKEND_DIR


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """进程内单例。测试要覆盖配置时用 `get_settings.cache_clear()`。"""
    return Settings()


def reload_settings() -> Settings:
    """重新读取 .env（改了配置又不想重启进程时用）。"""
    get_settings.cache_clear()
    return get_settings()
