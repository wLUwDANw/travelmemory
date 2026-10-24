"""`POST /api/v1/trips` —— 手工创建空行程（阶段 6 收尾 + 阶段 7 的记忆入口）。

## 为什么这个接口值得单独一个测试文件

`tests/test_api_photos.py` 盯的是"导入 → 聚类 → 列表"这条**只读**闭环，
而 `POST /trips` 是这条链路上**第一个写接口**，它的风险面完全不同：

  - 它写入的行 `source = "manual"`，而重建逻辑此前**默认全表删除** ——
    "用户刚建完的旅程被下一次导入冲掉"是本接口最可能、也最难被人发现的 bug，
    它不会报错，只表现为"我建的旅程不见了"；
  - 它是唯一一个"暂时没有照片"的行程来源，`GET /trips` 与导入回执
    都要能容得下 `started_at = null` 的行。

## 为什么"手工行程不被重建冲掉"这条必须真的连库测

纯内存测不出它：`_delete_user_trips` 的删除条件在 SQL 里，
Mock 一个 session 只会验证"代码调用了 delete"，而不是"删的范围对不对"。
所以这条用例用 `db_reachable()` 门禁（没库就 skip），
其余不碰数据库的语义用例照常全量跑 —— 与 `test_api_photos.py` 同一套做法。

## 开关与降级的断言

`photo_import` 关着时本接口必须 **404**（能力不存在），与 `GET /trips`、
`POST /photos/import` 完全一致：三个接口共用一个开关，
"这个闭环开没开"只能有一个答案。
"""

from __future__ import annotations

import uuid

import httpx
import pytest
from conftest import db_reachable
from sqlalchemy import delete

from app.core.config import get_settings
from app.db.session import SessionFactory, dispose_engine
from app.main import app
from app.models.user import User
from app.services.trip_service import create_manual_trip, rebuild_user_trips
from app.services.user_service import get_or_create_demo_user

_TRIPS_URL = "/api/v1/trips"


async def _purge_user(name: str) -> None:
    """删掉一个用户（外键 CASCADE 会带走它的 photo / trip / trip_item）。"""
    async with SessionFactory() as session:
        await session.execute(delete(User).where(User.name == name))
        await session.commit()


@pytest.fixture(autouse=True)
def isolated_demo_user(monkeypatch: pytest.MonkeyPatch) -> str:
    """把 `DEMO_USER_NAME` 指到本用例专属的用户上（理由见 `test_api_photos.py`）。"""
    name = f"pytest-trips-{uuid.uuid4().hex[:8]}"
    monkeypatch.setenv("DEMO_USER_NAME", name)
    get_settings.cache_clear()
    try:
        yield name
    finally:
        get_settings.cache_clear()


@pytest.fixture
async def db_user(isolated_demo_user: str):
    """需要真实库的用例用它：**不可达则 skip**（skips 发生在建数据之前）。"""
    if not await db_reachable():
        pytest.skip("未检测到 PostgreSQL，跳过（make up && make migrate 后可运行）")
    yield isolated_demo_user
    await _purge_user(isolated_demo_user)
    await dispose_engine()


@pytest.fixture
def photo_import_enabled(monkeypatch: pytest.MonkeyPatch):
    """开启 `photo_import` 开关（本机 `.env` 里它默认是关的）。"""
    monkeypatch.setenv("PHOTO_IMPORT_ENABLED", "true")
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


@pytest.fixture
def photo_import_disabled(monkeypatch: pytest.MonkeyPatch):
    """显式关掉开关 —— 断言考的是"默认关闭"这件事本身，不是这台机器的配置。"""
    monkeypatch.setenv("PHOTO_IMPORT_ENABLED", "false")
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


@pytest.fixture
async def client():
    """跑在自己事件循环里的 HTTP 客户端（理由见 `test_api_photos.py` 文件头）。"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


# ---------------------------------------------------------------- 路由与开关


def test_post_route_is_registered() -> None:
    """`POST /api/v1/trips` 必须真的挂上：它不会因为任何单测失败而自动显形。"""
    paths = app.openapi()["paths"]
    assert _TRIPS_URL in paths, f"行程路由没挂上：{list(paths)}"
    assert "post" in paths[_TRIPS_URL], f"只有 {list(paths[_TRIPS_URL])}，缺 post"


async def test_disabled_flag_returns_404(
    client: httpx.AsyncClient, photo_import_disabled
) -> None:
    """未启用 → **404**（能力不存在），不是 403（存在但没权限）。"""
    response = await client.post(_TRIPS_URL, json={"title": "洛阳两日"})
    assert response.status_code == 404
    # 404 必须来自业务闸门而不是"压根没这条路由"
    assert response.json()["detail"] != "Not Found"


# ---------------------------------------------------------------- 入参校验


async def test_blank_title_returns_422(client: httpx.AsyncClient, photo_import_enabled) -> None:
    """纯空白标题 → 422。`min_length=1` 挡不住 `"   "`（它是 3 个字符）。"""
    assert (await client.post(_TRIPS_URL, json={"title": "   "})).status_code == 422


async def test_empty_title_returns_422(client: httpx.AsyncClient, photo_import_enabled) -> None:
    """空串 → 422（Pydantic 的 `min_length` 直接拦）。"""
    assert (await client.post(_TRIPS_URL, json={"title": ""})).status_code == 422


async def test_missing_title_returns_422(client: httpx.AsyncClient, photo_import_enabled) -> None:
    assert (await client.post(_TRIPS_URL, json={})).status_code == 422


async def test_overlong_title_returns_422(client: httpx.AsyncClient, photo_import_enabled) -> None:
    """超过 `Trip.title` 的 `String(128)` → 422，而不是让数据库报错变成 500。"""
    assert (await client.post(_TRIPS_URL, json={"title": "x" * 129})).status_code == 422


async def test_error_shape_has_the_detail_field(
    client: httpx.AsyncClient, photo_import_enabled
) -> None:
    """错误响应用 FastAPI 标准的 `detail`，前端按一个地方解析即可。"""
    assert "detail" in (await client.post(_TRIPS_URL, json={"title": ""})).json()


# ---------------------------------------------------------------- 需要真实库的语义


async def test_creates_an_empty_manual_trip(client: httpx.AsyncClient, photo_import_enabled, db_user: str) -> None:
    """核心语义：201 + `source = "manual"` + 空条目 + 两个时间字段为 null。"""
    response = await client.post(_TRIPS_URL, json={"title": "  洛阳两日  "})
    assert response.status_code == 201, response.text

    trip = response.json()["trip"]
    assert trip["source"] == "manual", "手工行程的 source 必须是 manual"
    assert trip["item_count"] == 0
    assert trip["items"] == []
    # 标题剥掉首尾空白后才落库：存原值会出现一个"看起来为空"的行程卡片
    assert trip["title"] == "洛阳两日"
    # 起止时间是"照片决定的事实"，创建时还不知道 → null，不是 now()
    assert trip["started_at"] is None
    assert trip["ended_at"] is None
    assert uuid.UUID(trip["id"]) is not None


async def test_created_trip_shows_up_in_the_list(
    client: httpx.AsyncClient, photo_import_enabled, db_user: str
) -> None:
    """创建完立刻能在 `GET /trips` 里看到 —— 否则按钮点了像没生效。"""
    created = (await client.post(_TRIPS_URL, json={"title": "洛阳两日"})).json()["trip"]

    trips = (await client.get(_TRIPS_URL)).json()["trips"]
    assert [item["id"] for item in trips] == [created["id"]]


async def test_manual_trip_survives_a_rebuild(db_user: str) -> None:
    """**本文件最重要的一条**：重建行程不能冲掉用户手工建的行程。

    重建此前是全表 `delete(Trip).where(user_id == ...)`，手工行程会被一起删掉。
    这个 bug 不会报错，只在"我建的旅程不见了"时被发现 —— 而标题是库里唯一的副本，
    删了就找不回来，所以必须用一条真的连库的用例钉死。

    走 service 层而不是 HTTP：`/photos/import` 要求至少一个文件，
    为测这一条去造一张假图会把重心从"删除范围对不对"挪到"假图造得对不对"。
    """
    async with SessionFactory() as session:
        user = await get_or_create_demo_user(session)
        manual = await create_manual_trip(session, user_id=user.id, title="洛阳两日")
        await session.commit()

        after = await rebuild_user_trips(session, user_id=user.id)
        await session.commit()

        assert [trip.id for trip in after] == [manual.id], "手工行程被重建冲掉了"
        assert after[0].source == "manual"


async def test_rebuild_receipt_matches_the_list_order(db_user: str) -> None:
    """重建的返回值与 `list_user_trips` 必须给出**同一个**序列。

    重建只返回新建的聚类行程也能跑通，但那样导入回执里的 `trip_ids` 与
    `GET /trips` 会给出不同答案，而这种不一致不报错，
    只在"导入后列表看起来少了一趟"时被人发现。
    """
    from app.services.trip_service import list_user_trips

    async with SessionFactory() as session:
        user = await get_or_create_demo_user(session)
        await create_manual_trip(session, user_id=user.id, title="洛阳两日")
        await session.commit()

        rebuilt = await rebuild_user_trips(session, user_id=user.id)
        listed = await list_user_trips(session, user_id=user.id)
        await session.commit()

        assert [trip.id for trip in rebuilt] == [snapshot.trip.id for snapshot in listed]
