# PROJECT.md —— 项目约定

设计基线：[旅忆地图 TravelMemory.md](./旅忆地图 TravelMemory.md)
上手指南：[README.md](./README.md)

---

## 一、学习目标（Checklist）

- [ ] **RAG**：索引、检索、重排、上下文构建、引用
- [ ] **Memory**：短期会话、情景记忆、语义偏好；衰减与冲突处理
- [ ] **Tool Use**：Pydantic schema、超时、重试、缓存、限流、调用日志
- [ ] **Planning**：任务拆解、多步执行、状态机（LangGraph）
- [ ] **Reflection**：复盘、摘要、写回记忆
- [ ] **Evaluation**：检索指标、引用率、拒答率、工具选择准确率
- [ ] **Observability**：Run / Step / ToolCall 全链路 trace
- [ ] （可选）**Privacy**：差分隐私机制、隐私-效用权衡度量
- [ ] （可选）**Verifiability**：承诺方案、零知识证明、链上锚定与验证

---

## 二、不可协商的约定

| # | 约定 | 违反后果 |
| --- | --- | --- |
| 1 | 照片不搬家，原图永不上云 | 项目立论失效 |
| 2 | WGS84 存储，GCJ-02 展示，字段显式带 `coord_system` | 后期偏移问题极难排查 |
| 3 | 事实性回答引用率 100%，无证据必须拒答 | 核心硬指标失效 |
| 4 | 依赖方向单向：`agent → nodes → tools → services → models` | 视为缺陷，CI 拦截 |
| 5 | 可观测统一由 `observability.py` 写，节点只调 `trace.step(...)` | trace 口径不一致，无法归因 |
| 6 | 换 embedding 模型 → `make reindex`；换语义字典 → `make resemantic` | 产生脏向量 / 脏模式 |
| 7 | 阶段严格串行，上一阶段出口条件未满足不得进入下一阶段 | 范围蔓延 |
| 8 | 扩展模块走 feature flag，默认全关；失败必须降级而非抛错 | 主线被拖垮 |
| 9 | 分享信物的解密私钥（X25519）永远只在用户设备本地生成，绝不上传服务端；服务端只收孤立坐标点、只回加噪点 | 隐私保证形同虚设 |

---

## 三、分支策略

```
main            始终可交付状态，对应阶段 0~6
feat/research   阶段 7 扩展方向，独立分支，可整块放弃
```

**扩展代码合入 `main` 的前提**：`make test-degradation` 通过（断言所有 flag 关闭时主流程指标不变）。

---

## 四、工作块推进方式

每个阶段拆成若干工作块（见设计文档第十章）。推进原则：

1. **先定契约，再并行**：每个阶段中标记为"共同依赖"的块（通常是数据契约或框架块）先由一人完成，之后其余块可交给不同的人并行推进。
2. **单人开发**：按块号顺序完成，不要跨阶段并行。
3. **出口条件优先于完成度**：一个块只有满足出口条件才算完成，不要为了赶下一个块而留下未验证的代码。

---

## 五、提交规范

```
<type>(<scope>): <subject>

type: feat | fix | refactor | docs | test | chore
scope: agent | rag | memory | tools | api | photo | trip | map | jobs | frontend | infra
```

**每次改动 prompt 必须同时更新 `agent/prompts/` 文件与 `prompt_version`**，否则评测无法归因。
