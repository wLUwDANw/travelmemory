.PHONY: install dev web-install web-dev web-typecheck up down db-shell migrate test lint \
        eval eval-time eval-ablation eval-ablation-offline eval-compare cli check seed-demo \
        caption-batch index-batch reindex \
        semantic-batch resemantic anchor-batch \
        exp-privacy exp-recommend test-degradation \
        eval-tools cache-stats

# ---------- 基础设施 ----------

install:
	cd backend && pip install -r requirements.txt

up:
	docker compose up -d --build

up-stage3:
	docker compose --profile stage3 up -d --build

up-stage6:
	docker compose --profile stage3 --profile stage6 up -d --build

down:
	docker compose down

db-shell:
	docker compose exec db psql -U user -d travel_memory

migrate:
	cd backend && alembic upgrade head

# ---------- 开发 ----------

dev:
	cd backend && uvicorn app.main:app --reload

web-install:                  # 阶段 2：前端依赖（只需跑一次）
	cd frontend && npm install

web-dev:                      # 阶段 2：前端开发服务器（5173，/api 代理到 8000）
	cd frontend && npm run dev

web-typecheck:                # 阶段 2：前端类型检查 + 生产构建
	cd frontend && npm run build

cli:
	cd backend && python -m app.cli

check:                       # 阶段 0 环境自检：连通性 / 扩展 / 向量维度 / 脏向量
	cd backend && python -m app.cli --check

seed-demo:                   # 导入演示语料到 Document（幂等，重复执行不重复烧钱）
	cd backend && python -m app.scripts.seed_demo

seed-photos:                 # 阶段 1：合成演示照片元数据（无图片文件，仅元数据）
	cd backend && python -m app.scripts.seed_photos

lint:
	cd backend && ruff check . && mypy app

test:
	# ★ 必须是 `python -m pytest` 而不是 `pytest`：
	#   `python -m` 会把**当前目录**加进 sys.path，因此 `app` 包与 `tests/` 下的
	#   `conftest`、`fakes` 都能被导入。直接敲 `pytest` 在 Windows（PowerShell / Git Bash）
	#   下会报 `ModuleNotFoundError: No module named 'app'`（Linux 靠 `pytest` 的
	#   rootdir 约定侥幸能跑，于是这个坑只在 Windows 上暴露）。
	cd backend && python -m pytest

# ★ 最重要的一条：断言科研开关全关时主流程不受影响
test-degradation:
	cd backend && python -m pytest tests/test_degradation.py -v

# ---------- 评测 ----------

eval:
	cd backend && python -m app.agent.eval.runner

eval-time:                    # 阶段 2 W2-1：中文时间表达解析准确率（不需要数据库）
	cd backend && python -m app.agent.eval.runner --time

eval-ablation:                # 阶段 2 W2-2 出口条件：混合检索 Recall@5 不低于纯向量
	cd backend && python -m app.agent.eval.runner --ablation

eval-ablation-offline:     # 阶段 4 W4-3：无数据库时判定 Recall@5 出口条件
	cd backend && python -m app.agent.eval.runner --ablation --offline

eval-compare:
	cd backend && python -m app.agent.eval.runner --compare

eval-tools:                   # 阶段 3 W3-1 出口条件：工具选择准确率 ≥ 0.9（离线可跑）
	cd backend && python -m app.agent.eval.runner --tools

cache-stats:                  # 阶段 3 W3-3 出口条件：POI/路线类工具缓存命中率 ≥ 0.60
	cd backend && python -m app.scripts.cache_stats

# ---------- 批处理（幂等，--limit 控制单次成本）----------

caption-batch:
	cd backend && python -m app.jobs.caption_job --limit 200

index-batch:
	cd backend && python -m app.jobs.index_job --limit 500

reindex:                      # 换 embedding 模型后必须执行
	cd backend && python -m app.jobs.index_job --force

# ---------- 科研轨（阶段 7，feature flag 关闭时无副作用）----------

semantic-batch:
	cd backend && python -m app.jobs.semantic_job --limit 500

resemantic:                   # 换语义标签字典后必须执行
	cd backend && python -m app.jobs.semantic_job --force

anchor-batch:                 # 异步链上锚定，失败不阻塞
	cd backend && python -m app.jobs.anchor_job

exp-privacy:                  # 隐私-效用曲线
	cd research && python experiments/privacy_utility_curve.py

exp-recommend:                # 留一法语义推荐
	cd research && python experiments/leave_one_out.py
