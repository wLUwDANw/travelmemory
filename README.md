# 旅忆地图 TravelMemory

> 以个人照片地图记忆为数据源的旅行记忆 Agent。地图相册是数据底座与可视化，Agent 是核心。

完整设计见 **[旅忆地图 TravelMemory.md](./旅忆地图 TravelMemory.md)**，本文档只讲如何跑起来。
项目约定见 [PROJECT.md](./PROJECT.md)，历史文档见 [docs/archive/](./docs/archive/)。
**阶段复盘与原理讲解见 [docs/stages/](./docs/stages/)**（每完成一个阶段新增一份，阶段 0 已完成）。

---

## 快速上手

```bash
python -m venv .venv && .venv/Scripts/pip install -r backend/requirements.txt   # Windows
cp .env.example .env          # 填 LLM_API_KEY / LLM_BASE_URL
make up                       # 启动 PostgreSQL(PostGIS + pgvector)
make migrate                  # 建表 + 建扩展
make check                    # 环境自检：扩展 / 向量维度 / 脏向量
make seed-demo                # 导入演示语料（幂等）
make cli                      # 阶段 0：纯文本 RAG 问答
```

> 未配置 API Key 时会自动降级为**离线占位模式**（本地规则作答 + 本地哈希向量），
> 此时只能验证链路是否通畅，回答质量不代表真实效果。

**阶段 0 验证清单**（三个出口条件逐条对应）：

| 步骤 | 命令 | 期待结果 |
| --- | --- | --- |
| 扩展与表 | `make check` | 三个扩展齐备，`document` 表有数据 |
| 有证据问答 | `make cli` 后问「我去年秋天去过哪些古镇？」 | 带 `[n]` 引用的回答，下方列出证据与来源 |
| 无证据拒答 | 问「我在南极看过企鹅吗？」 | 明确拒答，不编造 |
| 检索指标 | `make eval` | 输出 Recall@5 / MRR |
| 生成指标 | `python -m app.agent.eval.runner --full` | 引用率 1.00、拒答正确 1.00 |
| 归因对比 | `make eval-compare` | 按 prompt_version / embedding_model 输出对比表 |
| 单元测试 | `make test` | 通过（依赖数据库的用例在无 Docker 时自动跳过） |

按阶段启用更多服务：

```bash
docker compose --profile stage3 up -d                    # + Redis（阶段 3 起）
docker compose --profile stage3 --profile stage6 up -d   # + MinIO（阶段 6 起）
```

---

## 三条不可协商的约定

1. **照片不搬家**：原图永不上云，只取 EXIF 元数据 + 本地生成缩略图。
2. **WGS84 存储，GCJ-02 展示**：所有位置字段显式标注 `coord_system`。
3. **无证据必须拒答**：事实性回答引用率 100%，缺失即判失败。

---

## 开发顺序

阶段严格串行：**上一阶段的出口条件未满足，不进入下一阶段**。
每个阶段拆成若干**工作块**，块之间依赖独立即可并行推进；单人开发按块号顺序完成。
详细的块内容与出口条件见 [设计文档第十一章](./旅忆地图 TravelMemory.md)；前端地图（图层栈、动画、性能红线）见 [第六章](./旅忆地图 TravelMemory.md)。

| 阶段 | 目标 | 工作块 |
| --- | --- | --- |
| **0** | 纯文本 RAG CLI | W0-1 数据底座 / W0-2 RAG 管道 / W0-3 评测与可观测 |
| **1** | 离线批处理 + 照片元数据 | W1-1 jobs 框架 / W1-2 caption+ai_tags / W1-3 索引任务 |
| **2** | 结构化 + 向量混合检索 | W2-1 Query 解析 / W2-2 时空过滤+全文 / W2-3 SSE 流式 |
| **3** | 工具调用 + Reranker + 缓存 | W3-1 tools 框架 / W3-2 地图工具 / W3-3 Redis / W3-4 Reranker+HNSW |
| **4** | Memory + LangGraph | W4-1 三层记忆 / W4-2 LangGraph 迁移 / W4-3 RRF+压缩 |
| **5** | 评估与可观测 | W5-1 评测扩充 / W5-2 归因对比 / W5-3 看板 |
| **6** | 地图相册 + 跨端 | W6-1 导入链路 / W6-2 地图与行程 / W6-3 Capacitor / W6-4 隐私分享 / W6-5 降级测试 |
| **7** | 扩展方向（可选，独立分支） | W7-1 语义与隐私 / W7-2 模式挖掘与推荐 / W7-3 可验证断言 |

**阶段 7 可整块放弃**，不影响阶段 0～6 的交付。

---

## 常用命令

```bash
make test               # 全量测试
make test-degradation   # ★ 断言扩展开关全关时主流程不受影响
make eval               # 跑评测集
make eval-compare       # 按 prompt_version / embedding_model 输出对比表
make reindex            # 换 embedding 模型后必须执行
make resemantic         # 换语义标签字典后必须执行（阶段 7）
make lint               # ruff + mypy
```

---

## 目录速查

```
frontend/    React + TS + Capacitor（Web / Android / iOS 同一套代码）
backend/app/
  api/ 接口层        schemas/ 接口契约      services/ 业务层
  agent/ Agent 运行时（pipeline / graph / rag / memory / eval / prompts）
  jobs/  离线批处理   tools/ 工具适配器
  privacy/ 隐私机制（纯函数）   zk/ 电路执行（进程外，阶段 7）
  models/ 表结构      core/ 配置 / LLM / Redis 缓存 / feature flags
research/   实验脚本与结果（不参与部署）
deploy/     Nginx 与生产 Compose
docs/archive/ 历史文档
```

依赖方向严格单向：`agent → nodes → tools → services → models`。
