# 阶段 5 第一段 · 评测扩充 + 归因对比（W5-1 / W5-2）

> 这一阶段要解决什么：**让"改完 prompt 指标到底变好还是变坏"变成一张表能回答的问题**，
> 并给生成质量补上第二个口径（忠实度）。出口条件见第 1 节。
>
> 本段只做 W5-1（评测扩充）与 W5-2（归因对比）；**W5-3（可观测看板）暂缓，下一段再做**。

设计文档依据：[`旅忆地图 TravelMemory.md`](../../旅忆地图%20TravelMemory.md) §4.5（评测集 schema）、
§10.1（核心硬指标）、第十一章「阶段 5」。

---

## 1. 这一阶段要解决什么 + 出口条件

```
W5-1 评测扩充（口径收口 + judge + 数据集扩容）  ──┐
                                                   ├──► W5-2 归因对比表
（W5-3 可观测看板：暂缓，下一段）
```

| 块 | 出口条件（验收标准） | 状态 |
| --- | --- | --- |
| W5-1 | 引用率 / 拒答口径收口为 `metrics.py` 纯函数；新增忠实度指标（默认关）；评测集 22 rag + 4 refusal + 1 recommend + 2 plan（阶段 5.2：规划题不再标 rag） | ✅ 已完成 |
| W5-2 | `--compare` 按 prompt_version + embedding_model 分组输出 Markdown 归因表，含环比 ↑/↓ 与 P95；分组逻辑不依赖数据库、可单测 | ✅ 已完成 |
| W5-3 | Run / Step / ToolCall 看板 | ⏸ 暂缓，下一段 |

---

## 2. 核心原理讲解

### 2.1 为什么"拒答"在三个指标里各有各的算法

先看一组容易搞混的场景。假设用户问"我 2019 年去过巴黎吗"（refusal 用例），系统正确地拒答了：

| 指标 | 记什么 | 为什么 |
| --- | --- | --- |
| `refusal_correct` | **1.0** | 这正是它要度量的：该拒的时候拒了 |
| `citation_rate` | **None（不计入）** | 拒答话术不是事实性回答 |
| `faithfulness` | **None（不送 judge）** | 拒答话术没有事实句，评它没有意义 |

三个"不计入"不是偷懒，而是**每个指标只对自己的失败模式负责**。
最容易犯的错是把 `citation_rate` 在拒答时记 **0.0**：阶段 4 真的踩过这个坑 ——
`SELF_CHECK_FAILED_ANSWER` 兜底话术里有一句"你可以把问题说得更具体一些"，
它不在软句白名单里，于是整段话术被当成"缺少引用的事实句"，引用率算出 0.0。
**拿安全话术的质量惩罚生成质量**，是最冤枉的一种错：系统明明做对了（拒答），
却在一个衡量"回答质量"的指标上背了锅。

那 self_check 失败（该拒但生成质量不过关）怎么记？答案是
`refusal_correct = 0.0` 记一次 —— 因为"该拒的用例没给出可验收的回答"本身就是错误，
记在拒答口径里刚好，**不双标**（同一个失败不在两个指标里各扣一遍）。

`refusal_correct` 还有一个反直觉的设计：**正常回答记 None，不记 1.0**。

```
refusal 用例：拒了 = 1.0，没拒 = 0.0
其他用例：   拒了 = 0.0，没拒 = None   ← 注意不是 1.0
```

为什么？打个比方：消防演习的评分标准是"报警器响的时候喷不喷水"。
昨天没演习、没喷水，这不是功劳，只是**什么都没发生**。
如果给"没喷水"也打 1.0，那一个从来不开机的系统也能拿满分，
指标就失去了分辨力。正常回答的质量由 `citation_rate` 负责，各管各的。

还有一类用例连"拒答率"都不该进：**recommend / plan**。

阶段 5.2 修过一个真实事故："帮我照着上次那趟再规划一个类似的路线。"
被标成了 `rag`。可规划题不可能从库里"引用"出一个未来行程 ——
self_check 一失败就拒答，这条题于是在 `refusal_correct` 上记了 0.0。
**用 RAG 的尺子量规划的题**：指标被污染，真正的问题（题目标错了）反而被掩盖。

所以 recommend / plan 对两个事实性指标都是 None：

```
rag：            拒了 = 0.0，没拒 = None
recommend/plan： 恒为 None
```

它们的对错看的是"推荐/规划是否合理"，这个口径现阶段没有自动化指标
（数据集 `note` 里写的"只计 hit@3"也要等阶段 7）。没有尺子的时候就**留白** ——
错记一个 0.0 比不记更糟：它会让人以为"拒答率下降了"，从而去改一个本来没问题的模块。

### 2.2 LLM-as-a-Judge 为什么默认关闭

忠实度（faithfulness）= 让模型再当一回考官，读一遍证据和回答，
判断每句话有没有证据支撑，只输出 1 或 0。

它回答的是引用率回答不了的问题：

```
证据：[1] 清晨的鼓浪屿很安静。
回答：你在鼓浪屿拍了清晨的海滩[1]。   ← 引用率 1.0，但"海滩"证据里根本没有！
```

引用率只查"标没标 `[n]`"，忠实度查"标了的那句话是不是证据真的说了"。

但默认关（`EVAL_LLM_JUDGE=false`），三个理由：

1. **成本**：一次全量评测会多出与用例等量的 LLM 调用（28 条 → 28 次额外调用），
   而输出只有 **1 bit**；
2. **稳定性**：judge 自己也是模型，也会抽风。它适合"盯一段时间的生成质量趋势"，
   不适合当每次改动的门槛；
3. **口径要严**：judge 说了一句"1，因为证据支持"怎么办？
   `parse_faithfulness()` 只认**单独一个 0 或 1（可带句读尾巴）**，
   其余一律 None。猜一个值比没有值更危险 —— 猜出来的忠实度看起来像个指标，
   但它会把"judge 今天话多"误记成"模型今天爱幻觉"。

### 2.3 归因表与环比箭头

评测的绝对值意义有限（换数据、换模型、甚至模型当天抽风都会动），
有意义的是**同一批题、相邻两次运行之间的差**。所以每次结果都记
`prompt_version + embedding_model`，`--compare` 把它们分组、按首现时间排序，
相邻两组之间画箭头：

```
| prompt_version | embedding_model | n | Recall@5 | MRR | 引用率 | ... |
| pv2026.10-stage4.1 | bge-m3@v1 | 28 | 0.857 | 0.778 | 1.000 | ... |
| pv2026.10-stage5.1 | bge-m3@v1 | 28 | 0.857 ↑ | ... |
```

箭头的方向由一个元数据表决定，而不是一堆 if/else：

```python
_METRICS = (
    ("recall_at_k", True),      # True = 越大越好
    ("p95_latency_ms", False),  # False = 越小越好
    ...
)
```

延迟从 200ms 涨到 300ms 是**退步**，箭头朝下；检索分涨了箭头朝上。
↑ 恒为绿、↓ 恒为红，因为方向判完之后颜色就只剩"好不好"一种含义。

不给箭头的情况也和给箭头一样重要：首组没有对比对象、任一侧是 None
（比如上一轮没开 judge，忠实度不可比）、两侧完全相等（延迟持平是常态，
满屏"→"等于没有信息）。

### 2.4 P95 为什么用"最近秩"而不是插值

P95 要回答的是"最慢的 5% 到底有多慢"，用来判断尾延迟有没有失控。
两种算法在样本少时会分叉：

```
3 个样本：100ms, 200ms, 300ms

线性插值：P95 = 第 2.85 个 = 200 + 0.85 × 100 = 285ms  ← 这个延迟从未出现过！
最近秩：  P95 = 第 ceil(0.95×3) = 第 3 个 = 300ms
```

285ms 没有任何一次真实请求对应过，拿它做告警阈值会永远等不到触发
（或者反过来，永远在误报）。最近秩的公式就一行：

```python
rank = max(1, math.ceil(q * len(ordered)))
```

### 2.5 为什么 compare 的逻辑必须不碰数据库

老实现是把分组、均值、`count/avg` 全塞进 SQL（`GROUP BY` + `func.avg`）。
问题是：**聚合口径没法单测**。想验证"None 不参与均值""P95 用最近秩"，
你得先起一个 PostgreSQL，造几行历史数据 —— 于是这些口径长期处于
"看起来对"的状态，直到某天 `--compare` 输出了离谱的数字。

阶段 5 把整套逻辑改成纯函数（`eval/compare.py` 不 import SQLAlchemy），
`test_eval_compare.py` 用 `ResultRecord` 纯数据就能把整张表钉死。
ORM → 纯数据的搬运留在 `runner.py` 的 `print_compare` 里，就几行。
代价是万行以上的历史结果要在 Python 侧聚合 —— 真到那天再把均值搬进 SQL，
接口不用变。

---

## 3. 逐块讲解

### 3.1 W5-1 指标口径收口（`app/agent/eval/metrics.py`）

阶段 4 的口径是内联在 `runner.py::run_full_eval` 里的两行 if/else，
阶段 5 收口成三个纯函数，各自管一类"要不要计入"：

| 函数 | 管什么 |
| --- | --- |
| `refusal_correct(kind, refused)` | 拒答口径（见 2.1） |
| `citation_rate_for(kind, answer, refused=)` | 引用率口径：拒答 / recommend / plan 记 None，其余真算 |
| `parse_faithfulness(raw)` | judge 输出的严格解析 |

`UNSCORED_CITATION_KINDS = frozenset({"recommend", "plan"})` 显式列出
"不计引用率"的 kind。推荐类（群体先验）和规划类答案允许没有逐句引用 ——
强求"第二天去西塘[3]"是没有意义的，规划的质量看合理不合理，不看引用。

`EvalRow` 新增 `faithfulness`（judge 分）与 `refuse_reason`
（`no_evidence` / `self_check_failed`，报告里显示拒答原因，不入库）。
`aggregate()` 里 faithfulness 参与按 kind 的均值，None 被 `_mean` 跳过。

### 3.2 judge 接线（`app/agent/eval/runner.py`）

`judge_faithfulness(pipeline, state)`：把 `state.blocks` 拼成证据文本，
用 `render("eval_faithfulness", ...)` 渲染 prompt（`{{var}}` 占位，版本化管理），
复用 `pipeline.llm` / `pipeline.settings`，`temperature=0.0`（评判要确定性）、
`max_tokens=8`（只够输出一个数字，逼模型别解释）。

调用失败按 None 计并告警 —— judge 是附加指标，不该带崩整场评测
（`tests/test_eval_metrics.py` 里有"fake chat 抛异常 → None 且不崩"的用例）。

开关在 `run_full_eval` 里把关：`state.refused or not settings.eval_llm_judge`
→ 不调用，直接 None。

### 3.3 归因对比（`app/agent/eval/compare.py`，新文件）

纯 dataclass + 纯函数，**不 import SQLAlchemy**：

- `ResultRecord` —— runner 从 ORM 搬过来的一条扁平结果；
- `percentile(values, q)` —— 最近秩（见 2.4）；
- `build_compare_rows(records)` —— 分组、排序、均值、P95、箭头；
- `render_compare_markdown(rows, color=)` —— Markdown 表格，
  `color=True` 时箭头套 ANSI 色（`print_compare` 按 `sys.stdout.isatty()` 决定）。

### 3.4 落库与迁移

`EvalResult.faithfulness`（迁移 0007，可空 Float）。**默认 None 而不是 0**：
judge 默认关闭意味着大量行"未评"，存 0 会把"没评过"混进"评为幻觉"，
忠实度均值直接失真。None 的语义是"未评"，聚合时跳过。

`PROMPT_VERSION` 升到 `pv2026.10-stage5.1`（PROJECT.md §五：改 prompt 必须同步版本，
否则归因对不上）。本段只新增了 `eval_faithfulness.md`（只影响 judge 调用），
按约定仍整体递增。

### 3.5 评测集扩容（`backend/data/eval_cases.jsonl`）

26 → 29 行：新增 1 条 rag（厦门清晨，验证新增 trip t9 可召回）+ 1 条 plan
（江南古镇两日规划，验证规划类不计引用率、只要求生成合理）。
阶段 5.2 再修正：把"帮我照着上次那趟再规划一个类似的路线。"从 rag **改判为 plan**
（规划题引用不出未来行程，标 rag 会被 self_check 误杀，详见 §2.1），
并补 1 条 rag（"去年四月我在杭州做了什么？"→ t2）保住被改走那条的检索覆盖。
最终构成：**22 rag + 4 refusal + 1 recommend + 2 plan**，
`test_eval_metrics.py::test_dataset_contract` 钉死这个构成，
并专门断言"含'规划/推荐/该去哪'的问题不许是 rag"。

---

## 4. 文件清单

| 文件 | 作用 | 对应知识点 |
| --- | --- | --- |
| `app/agent/eval/metrics.py` | 指标口径收口：`refusal_correct` / `citation_rate_for` / `parse_faithfulness` | 指标设计、口径分层 |
| `app/agent/eval/compare.py`（新） | 归因对比纯函数：分组 / P95 / 箭头 / Markdown 渲染 | 分位数、环比、可测性 |
| `app/agent/eval/runner.py` | judge 接线、口径换纯函数、`--compare` 重写 | 评测执行、LLM-as-a-Judge |
| `app/agent/prompts/eval_faithfulness.md`（新） | judge prompt（`{{var}}` 占位，版本化） | prompt 管理 |
| `app/agent/prompts/loader.py` | `PROMPT_VERSION` → `pv2026.10-stage5.1` | 版本归因 |
| `app/core/config.py` | `eval_llm_judge` 开关（默认关） | feature flag、成本控制 |
| `app/models/eval.py` + `alembic/versions/0007_*.py` | `faithfulness` 列 + 迁移 | schema 演进、可空列语义 |
| `data/eval_cases.jsonl` | 26 → 29 行（+1 rag +1 plan；1 条 rag 改判 plan） | 评测集构成 |
| `tests/test_eval_metrics.py`（新） | 口径 + judge 接线 + 数据集契约（替身，不烧 token） | Mock、回归防护 |
| `tests/test_eval_compare.py`（新） | 分组 / P95 / 箭头 / 排序 / 渲染全纯数据 | 不依赖 DB 的单测 |
| `.env.example` | `EVAL_LLM_JUDGE=false` 示例条目 | 配置即文档 |

---

## 5. 怎么跑起来验证

```bash
cd backend

# ① 离线口径测试（不连库、不烧 token）——第一道门
python -m pytest tests/test_eval_metrics.py tests/test_eval_compare.py -q
# 期望：25 passed

# ② 小样本全量（含 judge 演示；mock 下 judge 也会走替身链路）
EVAL_LLM_JUDGE=true python -m app.agent.eval.runner --full --limit 5
# 期望：报告每行带「忠实度=1.00」，拒答行带「（拒答：no_evidence）」

# ③ 归因对比（需要历史 EvalResult；至少跑两次不同 PROMPT_VERSION 才有箭头）
python -m app.agent.eval.runner --compare
# 期望：Markdown 表格 + 环比 ↑/↓；空库输出「暂无历史评测结果，先跑一次：make eval」

# ④ 质量门禁
python -m ruff format app tests && python -m ruff check . && python -m mypy app && python -m pytest -q
```

常见报错：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `✗ 数据库不可达` | 没起 Docker | 本段只验证口径用 ①；要跑 `--full` / `--compare` 先 `make up && make migrate && make seed-demo` |
| 忠实度全是 None | `EVAL_LLM_JUDGE` 没开，或该条被拒答 | 开开关再跑；拒答行本就不评 |
| judge 告警「忠实度评判失败」 | LLM 调用异常 | 不阻塞评测；查日志里的具体错误 |
| `--compare` 没有箭头 | 只有一组历史结果，或两侧指标相等 / 一侧 None | 改一次 prompt（升 PROMPT_VERSION）再跑一次 |

---

## 6. 踩过的坑 / 易错点

1. **self_check 兜底话术的引用率陷阱**（阶段 4 遗留，本段用回归用例钉死）：
   `SELF_CHECK_FAILED_ANSWER` 里有"你可以把问题说得更具体一些"这种非软句，
   直接算 `citation_rate()` 得 0.0。解法不是改话术，而是拒答时记 None ——
   口径上"拒答不参与引用率"，`test_eval_metrics.py::test_citation_rate_for_self_check_fallback_is_none`
   防复发。
2. **judge 严格解析**：模型爱带解释（"1，因为…"）、爱输出多个数字（"1 0"）。
   `parse_faithfulness` 用 `fullmatch` 只认单独一个 0/1 + 可选句读，
   其余 None。宁可少一次有效样本，不要一个猜出来的指标。
3. **judge 失败不带崩评测**：`judge_faithfulness` 的调用包在 try 里，
   异常 → 告警 + None。评测跑两个小时，最后因为一次 judge 超时整个作废，最憋屈。
4. **`Settings.model_construct()` 造测试配置**：测试里要"只改一个开关"的 Settings，
   直接 `Settings()` 会去读 .env 与真实环境；`model_construct(eval_llm_judge=True)`
   绕过环境读取，其余字段保持默认，确定性最好。
5. **P95 的 None 传播**：任一侧为 None 就不给箭头。老版 SQL 版对比表把
   "没开 judge"的组和"开了 judge"的组直接摆在一起，忠实度一列一个数一个 `-`，
   没有箭头反而看不懂 —— 现在的约定是"不可比就不比"。
6. **模型的"画蛇添足"会被 self_check 误杀**（阶段 5.2 真实事故）：问"去年秋天去过
   哪些古镇"，模型生成了一句"注：证据显示年份为 2025 年……"—— 这句注脚没有 `[n]`，
   self_check 判"缺少引用"，最终整段答案被拒答（用户实测）。
   解法在 **prompt 层**：`system.md` 铁律第 6 条禁止注脚/免责声明/补充说明，
   并明确"相对时间直接按证据里的年份陈述，不要解释换算过程"；
   同时把 `PROMPT_VERSION` 升到 `pv2026.10-stage5.2`（归因表靠它区分两次行为）。
   **没有**去软句白名单里加"注"—— 那等于给"不带引用的事实句"开闸，
   100% 引用率红线会被这句例外蛀空。prompt 管行为，self_check 管红线，各管各的。
7. **规划题被标成 rag**（阶段 5.2 真实事故，设计分析见 §2.1）：题目标错比指标算错
   更致命 —— 指标会把"标错的题"记成"系统的错"，把人引向错误的方向。
   `test_dataset_contract` 现在专门断言"含'规划/推荐/该去哪'的问题不许是 rag"，
   且 `refusal_correct` 对 recommend/plan 恒为 None（`test_refusal_correct_unscored_kinds_always_none` 钉死）。

---

## 7. 动手练习

1. **看 judge 生效**：`EVAL_LLM_JUDGE=true` 跑一次 `--full --limit 5`，
   对比报告的忠实度列与引用率列。然后手动改 `eval_faithfulness.md` 的第一行指令
   （比如把"只输出 1 或 0"改成"只输出是或否"），**记得同步升 `PROMPT_VERSION`**，
   再跑一次 —— 观察 judge 输出解析失败（全 None）与归因表里的版本变化。
2. **看箭头**：跑两次 `--full`（第一次后手动改 `PROMPT_VERSION` 字符串再跑第二次），
   然后 `--compare`。如果两次指标完全一样，把 `retrieval_vector_weight` 从 0.65 调到 0.5
   再跑一次，看 Recall 的箭头朝哪边。
3. **验证最近秩**：在 `tests/test_eval_compare.py` 里加一条
   `percentile([1.0] * 10 + [100.0], 0.95)` 的断言（先手算：11 个样本，
   rank = ceil(0.95 × 11) = 11 → 100.0），再跑测试确认。
