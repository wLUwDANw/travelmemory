# TravelMemory 项目长期约定

## 环境

- 虚拟环境在 `F:/project/travelmemory/.venv`，用 `.venv/Scripts/python.exe` 跑一切
  （`python -m pytest` 而不是 `pytest`：Windows 下 `python -m` 才把 cwd 加进 sys.path）
- 本机 **没有可用的 PostgreSQL**（5432 不通），`make up` 依赖的 Docker 未运行。
  涉及真实库的用例会自动 skip；需要验证检索类出口条件时用
  `python -m app.agent.eval.runner --ablation --offline`
- lint：`python -m ruff check .` + `python -m mypy app`（`make lint`）

## 不可协商的红线（PROJECT.md §二）

1. 原图永不上云；坐标 WGS84 存储 / GCJ-02 展示，字段带 `coord_system`
2. 事实性回答**引用率 100%，无证据必须拒答**
3. 依赖方向单向：`agent → nodes → tools → services → models`
   **推论**：被 agent 与 services 共用的东西（契约、纯函数）必须放 `app/schemas/` 或
   `app/utils/`，**不能放 `app/agent/` 下**，否则 services 反向依赖
4. 只有 `core/config.py` 与 `core/feature_flags.py` 能读环境变量
5. 阶段严格串行；扩展模块走 feature flag 且默认全关
6. 改 prompt 必须同步改 `PROMPT_VERSION`（`app/agent/prompts/loader.py`）

## 阶段进度

| 阶段 | 状态 | 迁移 |
| --- | --- | --- |
| 0 纯文本 RAG CLI | ✅ | 0001 |
| 1 离线批处理 | ✅ | 0002 / 0003 |
| 2 结构化 + 混合检索 | ✅ | 0004 |
| 3 工具 + Reranker + 缓存 | ✅ | 0005 |
| 4 Memory + LangGraph | ✅ | **0006**（`memory_item` / `memory_source`） |
| 5 评估与可观测 | 待开始 | — |

## 运行时

- `AGENT_RUNTIME=pipeline`（默认，阶段 0~3）/ `graph`（阶段 4 LangGraph），
  统一入口 `app/agent/runtime.py::build_agent()`；两种运行时对外接口一致
- 检索融合：`RETRIEVAL_FUSION=weighted`（默认）/ `rrf`
- 记忆总开关 `MEMORY_ENABLED=true`（主干能力，不是 feature flag）

## 已知坑

- 先 `import app.services` 曾触发循环导入，已用 PEP 562 惰性导出修掉；
  新增 `app/services/*` 时留意不要再引回 `app.agent.rag` 的 eager import
- `SELF_CHECK_FAILED_ANSWER` 含非软句 → `citation_rate()` 判 0.0（self_check 不受影响），
  阶段 5 做聚合归因时需处理
- 历史对话进上下文前必须剥掉 `[n]`（`context_builder._fit_history`），
  否则上一轮编号会造成本轮"引用越界"误拒答
