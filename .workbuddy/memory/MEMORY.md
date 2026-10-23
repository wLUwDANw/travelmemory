# TravelMemory 项目长期约定

## 环境

- 虚拟环境在 `F:/project/travelmemory/.venv`，用 `.venv/Scripts/python.exe` 跑一切
  （`python -m pytest` 而不是 `pytest`：Windows 下 `python -m` 才把 cwd 加进 sys.path）
- ~~本机 **没有可用的 PostgreSQL**（5432 不通）~~ **2026-10-23 复核：库是在线的**
  （`eval_result` 有 60 行 3 组），`make dashboard` / `--compare` 可直接跑真实数据。
  仍保留离线路径 `--ablation --offline` 与 `--demo` 以备无库环境。
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
7. 分享信物的解密私钥只在用户设备本地生成，绝不上传服务端（阶段 6 新增）

## 阶段进度

| 阶段 | 状态 | 迁移 |
| --- | --- | --- |
| 0 纯文本 RAG CLI | ✅ | 0001 |
| 1 离线批处理 | ✅ | 0002 / 0003 |
| 2 结构化 + 混合检索 | ✅ | 0004 |
| 3 工具 + Reranker + 缓存 | ✅ | 0005 |
| 4 Memory + LangGraph | ✅ | **0006**（`memory_item` / `memory_source`） |
| 5 评估与可观测 | ✅ 已封板 | 0007（`faithfulness`） |
| 6 地图相册 + 跨端 + 隐私分享 | ✅ 已交付（真机验证待人工） | — |

## 阶段 6 要点（W6-1 ~ W6-5）

- W6-4 = **后端拉普拉斯地理模糊**（`app/privacy/`，孤立点、独立抽样、`radius` 是承诺半径、
  开关关返回 404）+ **前端 TrailShare 信物移植**（`services/crypto|share/`，协议 ts-2026.4）
- 阶段 6 四个 flag：`photo_import` / `map_album` / `native_bridge` / `privacy`（默认全关）
- 信物私钥红线落点：`pages/SharePage/identity.ts`（localStorage 种子，无网络调用）
- 地图渲染规则：`radius > 0` → Circle 半透明圆不画 Marker；WGS84→GCJ-02 前端
  `pages/MapPage/coords.ts` 与后端同算法（天安门向量测试锁死）
- 前端测试在 `src/**/*.test.ts`（co-located，node 环境）；`npm test` 141 passed
- 高德 JS key 在 `frontend/.env.local`（值来自根 `.env` 的 `AMAP_JS_KEY`，被 gitignore）

## 阶段 5 看板（W5-3）

- `make dashboard` → `backend/data/dashboard.html`（单文件静态 HTML，双击即开）
- `make dashboard-demo` → `data/dashboard.demo.html`（无库时验证看板本身，标题标注 DEMO）
- 纯函数在 `app/agent/eval/dashboard.py`，DB 脏活在 `app/scripts/export_dashboard.py`
- 卡片取**最新一组**不是跨版本平均；P50/P95 同现；与 `--compare` 同源复用聚合

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
