# 自动化执行记录 · 阶段 4 无人值守开发

## 2026-10-22 03:00（首次执行）

**任务**：W4-1 Memory 三层 / W4-2 Pipeline 迁 LangGraph / W4-3 RRF + 上下文压缩。

**结果：三块全部完成，出口条件全部判定通过。**
- `pytest -q`：**204 → 278 passed**（+74）；`ruff` 全绿；`mypy app` 0 错误
- 离线消融 Recall@5：0.714 → 0.857 → 0.857 → RRF **0.857**（≥ 阶段 3 基线），MRR 0.627 → 0.646
- 新增迁移 **0006**（memory_item / memory_source），离线 `--sql` 校验过 DDL
- `PROMPT_VERSION` → `pv2026.10-stage4.1`

**交付物**：
- 早报 `docs/stages/stage4-end-of-night-report.md`
- 复盘 `docs/stages/stage4-memory-graph.md`
- 测试 `tests/test_memory.py`(34) / `tests/test_graph_runtime.py`(21) / `tests/test_fusion_compress.py`(19)

**留给下次的注意点**：
1. 基线是 **204** 条测试不是 196 条；任务书数字与现状有出入时以现状为准
2. 本机无 PostgreSQL，凡是要真实库的验收都跑不了；用 `--offline` 判据替代
3. 仓库只有 1 个 commit（`21ea2f4`），阶段 0~3 一直未提交 —— **本次也未提交**，
   因为不能替用户决定把别人的 WIP 混进一条提交。若下次要提交，需先与用户确认粒度
4. 依赖装在 `.venv`：langgraph 1.2.16 / langchain-core 1.6.12 / ruff / mypy / psycopg2-binary
5. 明早待办：真实库 `make up → make migrate → make eval-ablation`，并跑一遍 `AGENT_RUNTIME=graph`
