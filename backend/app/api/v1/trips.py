"""W6-2 的读取接口：`GET /api/v1/trips`。

## 为什么行程要单独有一个列表接口

地图相册打开时要的是"我有过哪几趟、每趟有哪些照片、按什么顺序"，
这是一次**成型的读取**，不是拼装出来的副产品。
`POST /api/v1/photos/import` 的响应里只有 `trip_ids`：那是导入的回执，
它的职责是告诉调用方"你这次导入影响了哪些行程"，
而不是把行程详情连着每次导入一起吐出来（每次上传都回全量行程是纯浪费）。

## 为什么它和导入接口共用 `photo_import` 这一个开关

行程是导入链路的产物：没有导入就没有照片，没有照片就没有行程。
把 `GET /trips` 和 `POST /photos/import` 挂在同一个开关下，
"这个闭环开没开"就只有一个答案，而不是两个开关各说各话。
（`map_album` 开关留给前端地图相册的**展示**能力，本轮不接。）

开关关闭时返回 **404**（能力不存在），理由与取舍写在 `api/v1/photos.py` 里。

## 为什么读接口也会"顺手创建用户"

本工程是单用户部署、没有账号体系（设计文档 §1.5），
`get_or_create_demo_user()` 是全项目取用户的统一入口（`api/v1/agent.py` 也这么干）。
空库上第一次调用会创建 demo 用户，然后返回空列表 ——
这是"确实还没有任何行程"，不是错误。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.feature_flags import is_enabled
from app.db.session import SessionFactory
from app.schemas.trip import TripItemView, TripListResponse, TripView, iso_or_none
from app.services.trip_service import (
    TripItemSnapshot,
    TripSnapshot,
    list_user_trips,
    semantic_tag_for_photo,
)
from app.services.user_service import get_or_create_demo_user

router = APIRouter(prefix="/trips", tags=["trips"])


def _to_item_view(entry: TripItemSnapshot) -> TripItemView:
    """`TripItemSnapshot` → 出参契约（时间在这里折成 ISO 字符串）。

    时间与坐标取 `TripItem` 上的**快照**而不是实时读 `Photo`：
    视图展示的是聚类当时展示给用户的那一版，照片后来被改了时间，
    要等下次重建才反映到行程里 —— 否则地图上的连线会在没有任何操作时自己动一下。
    """
    tag, label = semantic_tag_for_photo(entry.photo)
    return TripItemView(
        id=str(entry.item.id),
        photo_id=str(entry.item.photo_id),
        taken_at=iso_or_none(entry.item.taken_at),
        lat=entry.item.lat,
        lng=entry.item.lng,
        semantic_tag=tag,
        semantic_label=label,
    )


def _to_trip_view(snapshot: TripSnapshot) -> TripView:
    """`TripSnapshot` → 出参契约。"""
    items = [_to_item_view(entry) for entry in snapshot.items]
    return TripView(
        id=str(snapshot.trip.id),
        title=snapshot.trip.title,
        started_at=iso_or_none(snapshot.trip.started_at),
        ended_at=iso_or_none(snapshot.trip.ended_at),
        source=snapshot.trip.source,
        item_count=len(items),
        items=items,
    )


@router.get("", summary="当前用户的全部行程（按开始时间升序）", response_model=TripListResponse)
async def list_trips() -> TripListResponse:
    """返回当前用户的全部行程，每个行程带它的照片列表（按簇内顺序）。

    没有照片时返回 `{"trips": []}`，而不是 404：
    "还没有行程"是**数据状态**，不是"这个接口不存在"。
    """
    # 开关未开 = 能力不存在（404，不是 403）。详见模块 docstring。
    if not is_enabled("photo_import"):
        raise HTTPException(status_code=404, detail="该能力未启用")

    async with SessionFactory() as session:
        user = await get_or_create_demo_user(session)
        snapshots = await list_user_trips(session, user_id=user.id)

    return TripListResponse(trips=[_to_trip_view(snapshot) for snapshot in snapshots])
