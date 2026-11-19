# 阶段复盘文档

每完成一个阶段，就在这个目录里新增一份文档。文档不是"提交记录"，而是**教学材料**：
目标是你读完就能像自己动手写了一遍那样，讲清楚这个阶段为什么这么设计、每个环节的原理是什么。

## 命名与结构约定

| 文件 | 对应阶段 | 状态 |
| --- | --- | --- |
| [stage0-rag-cli.md](./stage0-rag-cli.md) | 阶段 0：纯文本 RAG CLI（W0-1 / W0-2 / W0-3） | ✅ 已完成并实测跑通（含第 10 节 Windows 实战记录；Recall@5≈0.71、拒答 4/4） |
| [stage1-offline-jobs.md](./stage1-offline-jobs.md) | 阶段 1：离线批处理 + 照片元数据（W1-1 / W1-2 / W1-3） | ✅ 已完成并实测跑通（129 张照片 → 43 条日文档；重跑执行 0 条） |
| [stage2-structured-retrieval.md](./stage2-structured-retrieval.md) | 阶段 2：结构化 + 向量混合检索（W2-1 / W2-2 / W2-3） | ✅ 已完成（时间解析 22/22；消融 0.714→0.857；流式 7 条断言；真实库 eval-ablation 待跑） |
| [stage3-tools-rerank.md](./stage3-tools-rerank.md) | 阶段 3：工具调用 + Reranker + 缓存（W3-1 ~ W3-4） | ✅ 已完成并在真实库验收（工具选择 22/22；真实消融 0.619→0.809→0.762；HNSW 迁移 0005 已建；pytest 204 passed / 0 skipped） |
| [stage4-memory-graph.md](./stage4-memory-graph.md) | 阶段 4：Memory + LangGraph（W4-1 ~ W4-3） | ✅ 已完成并在真实库验收（迁移 0006 已建；真实消融：weighted 0.857/0.778 为最优，RRF 0.833/0.679 未达标故默认 weighted；`pytest` 305 passed）。**W4-3 出口条件按 §4.3 判定为"策略降级"而非"算法失败"** |
| `stage5-eval-observability.md` | 阶段 5：评估与可观测增强（W5-1 ~ W5-3） | ✅ 第一段已完成并经 5.2/5.3 真实 API 修正（W5-1 评测扩充 + W5-2 归因对比：评测集 29 条含 2 plan；拒答口径收口；`--compare` 环比表；self_check 对 plan/recommend 豁免逐句引用（`utils/intent.py` 规则分类，与评测集标注一致性有测试钉死）；prompt 禁注脚/禁"有证据却说无法回答"，`PROMPT_VERSION=pv2026.10-stage5.3`；W5-3 可观测看板待下一段） |
| `stage6-map-album.md` | 阶段 6：地图相册 + 跨端 + 隐私分享（W6-1 ~ W6-5） | ✅ 已全量交付（后端 pytest 447 passed / 11 skipped；前端 vitest 141 passed；W6-4 = 后端拉普拉斯地理模糊 + 前端 TrailShare 定向加密信物移植；真机双窗口与高德渲染待人工验证） |
| `stage7-research.md` | 阶段 7：扩展方向（可选，独立分支） | 待开始 |
| [stage9-trail-replay.md](./stage9-trail-replay.md) | **阶段 9：轨迹回放**（阶段 6 的延伸能力，非原定路线图阶段；编号 8 属于「多 Agent 引用审计」提案） | ✅ 已交付（前端 423 条测试全绿；展示站 10 秒采样 ≈60fps；光点滞后 45~52px；瓦片 0 abort）。**地图加载器仍是两份，合并前需先补测试** |
| [stage10-track-studio-share-standalone.md](./stage10-track-studio-share-standalone.md) | 阶段 10：Track Studio + TrailShare Standalone（独立小应用） | ✅ 已交付（AI 执行，复盘见文件第二部分） |
| [stage10-delivery-report.md](./stage10-delivery-report.md) | 阶段 10 **交付报告**（文件清单 / 测试 / 边界 / 差异） | ✅ 与阶段 10 任务书配套 |
| [stage11-delivery-report.md](./stage11-delivery-report.md) | 阶段 11：**主应用接入**（iframe 嵌入 + 照片/身份注入 + 导回） | ✅ 已交付（任务书为对话交付，未单独落盘；细节见报告 §8–§12） |
| [stage12-delivery-report.md](./stage12-delivery-report.md) | 阶段 12：**轨迹变速 + 位置补全 + 高德共享 + TrailShare 地图与收件人侧**（W12-1 ~ W12-5） | ✅ 已交付（682 条测试全绿；主应用 `StudioEmbed` 切 `embed.html` 仍为 A15 TODO） |
| [stage13-track-studio-dual-theme.md](./stage13-track-studio-dual-theme.md) | 阶段 13：**双入口双主题 + 主应用指向 embed + showcase 退役 + 代码审计**（W13-1 ~ W13-7） | ✅ 已交付（756 条测试全绿；`apps/` 仍未纳入 git，见报告 §19） |
| [stage13-code-audit.md](./stage13-code-audit.md) | 阶段 13 代码审计清单（极低 18 已合并 / 中 8 / 高 7） | ✅ 归档 |
| [stage14-e2e-and-light-playstage.md](./stage14-e2e-and-light-playstage.md) | 阶段 14：**端到端验证 + 嵌入版浅色播放页 + 深色版补缺口 + 省市轮廓图**（W14-1 ~ W14-5） | ✅ 已交付（812 条测试全绿；分享包日期丢失与单地点 5 张上限两个 P1 待决策） |
| [stage15-p1-fix-receive-library.md](./stage15-p1-fix-receive-library.md) | 阶段 15：**P1 修复 + 技术卫生 + 接收端接受/拒绝 + 记忆库分类**（W15-1 ~ W15-5） | ✅ 已交付（886/984 条测试全绿；W15-2 改自动拆分、W15-5 降级在行程抽屉） |

文件名规则：`stage<编号>-<主题>.md`，编号与设计文档第十一章保持一致；配套的交付报告统一命名为 `stage<编号>-delivery-report.md`，与阶段文档放在同一目录。

## 每份文档固定包含

1. **这一阶段要解决什么** + 出口条件（做完没做完，用出口条件判定）
2. **核心原理讲解**（用比喻和手算例子，不讲黑话）
3. **逐块讲解**：每个工作块做了什么、为什么这么做、代码在哪
4. **文件清单**：文件 → 作用 → 对应知识点
5. **怎么跑起来验证**：命令 + 期望结果 + 常见报错排查
6. **踩过的坑 / 易错点**
7. **动手练习**（可选）：改一个小参数，看指标怎么变

## 与其他文档的关系

- 设计文档 [`旅忆地图 TravelMemory.md`](../../旅忆地图%20TravelMemory.md)：规格说明书，讲"要做什么"
- 约定 [`PROJECT.md`](../../PROJECT.md)：不可协商的红线
- 上手 [`README.md`](../../README.md)：怎么跑起来
- **本目录**：讲"为什么这么做、原理是什么"，是给学习用的
