"""评测执行器（`make eval` / `make eval-compare` 的入口）。

用法：
```bash
python -m app.agent.eval.runner            # 只测检索：Recall@5 / MRR（不烧生成 token）
python -m app.agent.eval.runner --full     # 含生成：额外算引用率与拒答表现
python -m app.agent.eval.runner --compare  # 读历史 EvalResult，按版本归因对比
python -m app.agent.eval.runner --limit 5  # 只跑前 N 条（省钱）
```

归因的前提：每条结果都记录 `prompt_version` + `embedding_model`，
所以改 prompt 之后能在同一张表里看到指标到底变好还是变坏。
"""

from __future__ import annotations

import argparse
import asyncio
import time

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.eval.dataset import EvalCaseItem, load_dataset
from app.agent.eval.metrics import (
    EvalRow,
    aggregate,
    citation_rate,
    mrr,
    recall_at_k,
)
from app.agent.pipeline import AgentPipeline
from app.agent.prompts.loader import PROMPT_VERSION
from app.agent.rag.retriever import Retriever
from app.agent.state import PipelineState
from app.core.config import get_settings
from app.core.embedding import build_embedder
from app.core.logging import get_logger, setup_logging
from app.db.session import SessionFactory, dispose_engine, ping_database
from app.models.eval import EvalCase, EvalResult
from app.services.user_service import get_or_create_demo_user

logger = get_logger(__name__)


# ---------------------------------------------------------------- 执行
async def run_retrieval_eval(
    retriever: Retriever,
    items: list[EvalCaseItem],
    *,
    user_id,
    k: int = 5,
) -> list[EvalRow]:
    """只跑检索：快、便宜，适合每天改完代码先跑一遍。"""
    rows: list[EvalRow] = []
    for item in items:
        started = time.perf_counter()
        # 直接构造 state 调 retriever：跳过 rewrite/parse，避免评测被 LLM 波动干扰
        state = PipelineState(user_id=user_id, session_id="eval-retrieval", query=item.question)
        hits = await retriever.retrieve(state)
        latency_ms = int((time.perf_counter() - started) * 1000)

        keys = [hit.ref.key for hit in hits]
        rows.append(
            EvalRow(
                kind=item.kind,
                question=item.question,
                recall_at_k=recall_at_k(keys, item.expected_keys, k),
                mrr=mrr(keys, item.expected_keys),
                latency_ms=latency_ms,
            )
        )
    return rows


async def run_full_eval(
    pipeline: AgentPipeline,
    items: list[EvalCaseItem],
    *,
    user_id,
    k: int = 5,
) -> list[EvalRow]:
    """跑完整管道：额外得到引用率与拒答表现（会消耗 LLM token）。"""
    rows: list[EvalRow] = []
    for item in items:
        state = await pipeline.run(
            user_id=user_id, session_id="eval-full", query=item.question
        )
        keys = [hit.ref.key for hit in state.hits]

        refusal_correct: float | None
        if item.kind == "refusal":
            refusal_correct = 1.0 if state.refused else 0.0
        else:
            refusal_correct = 0.0 if state.refused else None

        rows.append(
            EvalRow(
                kind=item.kind,
                question=item.question,
                recall_at_k=recall_at_k(keys, item.expected_keys, k),
                mrr=mrr(keys, item.expected_keys),
                citation_rate=None if state.refused else citation_rate(state.answer),
                refusal_correct=refusal_correct,
                latency_ms=state.latency_ms,
                answer=state.answer,
                refused=state.refused,
            )
        )
    return rows


# ---------------------------------------------------------------- 落库
async def upsert_eval_cases(
    session: AsyncSession, user_id, items: list[EvalCaseItem]
) -> dict[str, object]:
    """把评测集同步到 EvalCase 表（按 user_id + question 去重）。"""
    mapping: dict[str, object] = {}
    for item in items:
        existing = (
            await session.execute(
                select(EvalCase).where(
                    EvalCase.user_id == user_id, EvalCase.question == item.question
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            existing = EvalCase(
                user_id=user_id,
                question=item.question,
                kind=item.kind,
                expected_evidence=[ref.model_dump() for ref in item.expected_evidence],
                expected_answer=item.expected_answer,
                note=item.note,
            )
            session.add(existing)
            await session.flush()
        mapping[item.question] = existing.id
    return mapping


async def save_results(
    session: AsyncSession,
    rows: list[EvalRow],
    items: list[EvalCaseItem],
    *,
    user_id,
    embedding_model: str,
) -> int:
    """写入 EvalResult。**不写**就没法做版本归因。"""
    mapping = await upsert_eval_cases(session, user_id, items)
    for row in rows:
        case_id = mapping.get(row.question)
        if case_id is None:
            continue
        session.add(
            EvalResult(
                eval_case_id=case_id,
                recall_at_k=row.recall_at_k,
                mrr=row.mrr,
                citation_rate=row.citation_rate,
                refusal_correct=row.refusal_correct,
                latency_ms=row.latency_ms,
                prompt_version=PROMPT_VERSION,
                embedding_model=embedding_model,
            )
        )
    await session.flush()
    return len(rows)


async def print_compare(session: AsyncSession) -> None:
    """按 prompt_version + embedding_model 聚合历史结果，输出归因对比表。"""
    rows = (
        await session.execute(
            select(
                EvalResult.prompt_version,
                EvalResult.embedding_model,
                func.count(EvalResult.id),
                func.avg(EvalResult.recall_at_k),
                func.avg(EvalResult.mrr),
                func.avg(EvalResult.citation_rate),
                func.avg(EvalResult.latency_ms),
            ).group_by(EvalResult.prompt_version, EvalResult.embedding_model)
        )
    ).all()

    if not rows:
        print("暂无历史评测结果，先跑一次：make eval")
        return

    header = f"{'prompt_version':<22}{'embedding_model':<22}{'n':>4}{'Recall':>9}{'MRR':>8}{'引用率':>9}{'延迟ms':>9}"
    print("\n=== 版本归因对比 ===")
    print(header)
    print("-" * len(header))
    for version, model, count, recall, mean_mrr, cit, latency in rows:
        print(
            f"{str(version):<22}{str(model):<22}{int(count):>4}"
            f"{_fmt(recall):>9}{_fmt(mean_mrr):>8}{_fmt(cit):>9}{_fmt(latency):>9}"
        )


def _fmt(value: object) -> str:
    return "-" if value is None else f"{float(value):.3f}"


# ---------------------------------------------------------------- 报告
def print_report(rows: list[EvalRow], *, k: int, mode: str) -> None:
    settings = get_settings()
    print(f"\n=== 评测报告（mode={mode}, k={k}）===")
    print(f"prompt_version={PROMPT_VERSION}  embedding_model={settings.embedding_model_version}")
    print("-" * 90)
    for row in rows:
        bits = [
            f"{row.kind:<9}",
            f"Recall@{k}={'-' if row.recall_at_k is None else f'{row.recall_at_k:.2f}'}",
            f"MRR={'-' if row.mrr is None else f'{row.mrr:.2f}'}",
        ]
        if row.citation_rate is not None:
            bits.append(f"引用率={row.citation_rate:.2f}")
        if row.refusal_correct is not None:
            bits.append(f"拒答正确={row.refusal_correct:.0f}")
        bits.append(f"{row.latency_ms}ms")
        print(" | ".join(bits) + f" | {row.question}")

    stats = aggregate(rows)
    print("-" * 90)
    print("按 kind 汇总：")
    for name, value in sorted(stats.items()):
        print(f"  {name:<28}{'-' if value is None else f'{value:.4f}'}")


# ---------------------------------------------------------------- 入口
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="TravelMemory 评测执行器")
    parser.add_argument("--full", action="store_true", help="跑完整管道（含生成，消耗 token）")
    parser.add_argument("--compare", action="store_true", help="输出历史结果归因对比")
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 条评测用例")
    parser.add_argument("--top-k", type=int, default=5, help="Recall@k 的 k 值")
    parser.add_argument("--dataset", type=str, default=None, help="自定义评测集路径")
    return parser.parse_args(argv)


async def async_main(args: argparse.Namespace) -> int:
    setup_logging(get_settings().log_level)
    items = load_dataset(args.dataset)
    if args.limit:
        items = items[: args.limit]

    # 先探连通性：数据库起不来就给一句人话，而不是抛一堆连接栈
    if not await ping_database():
        print("✗ 数据库不可达。请依次执行：make up → make migrate → make seed-demo")
        return 1

    async with SessionFactory() as session:
        user = await get_or_create_demo_user(session)

        if args.compare:
            await print_compare(session)
            return 0

        from app.agent.rag.retriever import Retriever, RetrieverConfig
        from app.services.document_service import DocumentService

        settings = get_settings()
        embedder = build_embedder(settings)
        searcher = DocumentService(session)

        rows: list[EvalRow]
        if args.full:
            pipeline = AgentPipeline.build(searcher)
            rows = await run_full_eval(pipeline, items, user_id=user.id, k=args.top_k)
        else:
            # 检索评测刻意把 min_score 设成 0：要测的是「排序质量」本身，
            # 相似度阈值会在 --full 的真实流程里体现，否则阈值会淹没召回指标。
            retriever = Retriever(
                searcher,
                embedder,
                RetrieverConfig(top_k=settings.retrieval_top_k, min_score=0.0),
            )
            rows = await run_retrieval_eval(retriever, items, user_id=user.id, k=args.top_k)

        print_report(rows, k=args.top_k, mode="full" if args.full else "retrieval")
        try:
            await save_results(
                session, rows, items, user_id=user.id, embedding_model=embedder.model_version
            )
            await session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("评测结果入库失败（不阻塞本次报告）: %s", exc)

    await dispose_engine()
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(async_main(parse_args())))


if __name__ == "__main__":
    main()
