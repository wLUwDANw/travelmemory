.PHONY: install dev up down db-shell migrate test lint \
        eval eval-compare cli check seed-demo \
        caption-batch index-batch reindex \
        semantic-batch resemantic anchor-batch \
        exp-privacy exp-recommend test-degradation

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

cli:
	cd backend && python -m app.cli

check:                       # 阶段 0 环境自检：连通性 / 扩展 / 向量维度 / 脏向量
	cd backend && python -m app.cli --check

seed-demo:                   # 导入演示语料到 Document（幂等，重复执行不重复烧钱）
	cd backend && python -m app.scripts.seed_demo

lint:
	cd backend && ruff check . && mypy app

test:
	cd backend && pytest

# ★ 最重要的一条：断言科研开关全关时主流程不受影响
test-degradation:
	cd backend && pytest tests/test_degradation.py -v

# ---------- 评测 ----------

eval:
	cd backend && python -m app.agent.eval.runner

eval-compare:
	cd backend && python -m app.agent.eval.runner --compare

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
