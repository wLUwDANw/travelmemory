"""阶段 3 起所有 feature flag 的**唯一读取口**（O-2 / R3-1.5）。

开关清单：

| flag | 含义 | 默认 | 归属 |
| --- | --- | --- | --- |
| `tools` | 工具调用（地图 POI / 路线） | False | 阶段 3 W3-1 |
| `cache` | 走 Redis 共享缓存（关 = 进程内内存实现） | False | 阶段 3 W3-3 |
| `rerank` | 重排接管融合结果 | False | 阶段 3 W3-4 |
| `hnsw` | HNSW 近似检索（含回退精确扫描） | False | 阶段 3 W3-4 |
| `photo_import` | W6-1 本地照片导入（EXIF + 指纹去重） | False | 阶段 6 |
| `map_album` | W6-2 行程聚类 + 地图相册 | False | 阶段 6 |
| `native_bridge` | W6-3 端能力抽象（相册/缩略图/权限） | False | 阶段 6 |
| `privacy` | W6-4 地理模糊 + 定向加密信物 | False | 阶段 6 |
| `semantic` / `zk` / `chain` | 科研轨扩展 | False | 阶段 7 |

## 为什么是薄封装而不是另一套 pydantic-settings

- 环境变量的声明已经在 `core/config.py` 里，再建一套 settings 就会出现
  "两个配置源谁说了算"的问题（同一个开关两处默认值不一致是最难查的那类 bug）。
  本模块只负责**名字映射 + 读取**，`Settings` 仍然是唯一真相。
- 有了统一入口，才能守住 PROJECT.md §二、[5] 的"其他模块禁止 `os.getenv`"：
  业务代码写 `is_enabled("tools")` 而不是读某个环境变量名，
  将来把 `tools_enabled` 改名时只需改这里一行。
- `all_flags()` 是给 SSE `meta` 事件与排障用的：一次拿到全部开关，
  出现"我这边开了你那边没开"时能立刻对比。

## 未声明的开关名：直接报错，不静默 False

`is_enabled("toolz")` 打错字时返回 False 会让功能"悄悄不生效"，
排查成本远高于一次 `ConfigError`。启动时（而非请求中）炸出来更划算。
"""

from __future__ import annotations

from app.core.config import Settings, get_settings
from app.core.exceptions import ConfigError

#: 全部开关名。**顺序即含义分组**：阶段 3 → 阶段 6 → 阶段 7。
FLAG_NAMES: tuple[str, ...] = (
    "tools",
    "cache",
    "rerank",
    "hnsw",
    "photo_import",
    "map_album",
    "native_bridge",
    "privacy",
    "semantic",
    "zk",
    "chain",
)

#: 阶段 3 四个开关（`make test-degradation` 的默认态就由它们定义）
STAGE3_FLAG_NAMES: tuple[str, ...] = ("tools", "cache", "rerank", "hnsw")

#: 阶段 6 四个开关（照片导入 / 地图相册 / 端能力 / 地理模糊+加密信物）
STAGE6_FLAG_NAMES: tuple[str, ...] = ("photo_import", "map_album", "native_bridge", "privacy")

#: 阶段 7 科研轨开关（本阶段只做统一管理，不接任何逻辑）
STAGE7_FLAG_NAMES: tuple[str, ...] = ("semantic", "zk", "chain")


def _settings_field(name: str) -> str:
    """开关名 → Settings 字段名（约定：`{name}_enabled`，环境变量 `{NAME}_ENABLED`）。"""
    return f"{name.lower()}_enabled"


def clean_settings() -> Settings:
    """一份**完全不受外部环境影响**的干净配置，用于断言**默认态**。

    为什么需要它：本机 `.env` 里可能写了 `TOOLS_ENABLED=true`，shell 里也可能导出了
    同名变量 —— 拿 `get_settings()` 去断言"默认是关闭的"会得到**假绿**：
    绿的是这台机器的配置，不是产品的默认值。

    为什么用 `model_construct()` 而不是 `Settings(_env_file=None)`：
    后者只跳过 `.env` 文件，**进程环境变量照读不误**（实测 `TOOLS_ENABLED=true python -c ...`
    下仍返回 True）。`model_construct()` 直接取类字段默认值，两者都不看，才是真正的"出厂设置"。
    """
    return Settings.model_construct()


def is_enabled(name: str, settings: Settings | None = None) -> bool:
    """读取开关当前值。这是全工程唯一允许的开关读取方式。"""
    target = settings or get_settings()
    field = _settings_field(name)
    value = getattr(target, field, None)
    if value is None:
        raise ConfigError(
            f"未声明的 feature flag: {name!r}（已知: {', '.join(FLAG_NAMES)}；"
            f"新开关请先在 app/core/config.py 里加 {field} 字段）"
        )
    return bool(value)


def all_flags(settings: Settings | None = None) -> dict[str, bool]:
    """返回全部开关的当前值（给 `meta` 事件与人工排障用）。"""
    target = settings or get_settings()
    return {name: is_enabled(name, target) for name in FLAG_NAMES}


def stage3_flags(settings: Settings | None = None) -> dict[str, bool]:
    """只返回阶段 3 的四个开关（`test-degradation` 断言的就是它全 False）。"""
    target = settings or get_settings()
    return {name: is_enabled(name, target) for name in STAGE3_FLAG_NAMES}


def stage3_all_disabled(settings: Settings | None = None) -> bool:
    """阶段 3 四个开关是否全部关闭 —— 即"阶段 2 行为"的定义。"""
    return not any(stage3_flags(settings).values())


def stage6_flags(settings: Settings | None = None) -> dict[str, bool]:
    """只返回阶段 6 的四个开关（`test-degradation` 的阶段 6 前提断言）。"""
    target = settings or get_settings()
    return {name: is_enabled(name, target) for name in STAGE6_FLAG_NAMES}


def stage6_all_disabled(settings: Settings | None = None) -> bool:
    """阶段 6 四个开关是否全部关闭 —— 即"阶段 5 行为"的定义。"""
    return not any(stage6_flags(settings).values())
