"""W6-1 + W6-2 的导入接口：`POST /api/v1/photos/import`。

## 为什么是 multipart 而不是 base64 JSON

前端手里拿的是 `File` / `Blob`（相册选择或拖拽进来的原文件），
要塞进 JSON 就得先 base64 一遍，凭白多出 33% 体积和一次编码开销 ——
而照片是本项目体积最大的输入。multipart 是浏览器上传文件的原生形式，
`fetch` 直接 append 进 `FormData` 即可，后端拿到的就是原始字节。

代价是要装 `python-multipart`（见 `requirements.txt`）：
没有它 FastAPI **在进入 handler 之前**就抛
`Form data requires "python-multipart" to be installed`，
连 500 都拿不到业务堆栈，所以它是本接口的硬依赖而不是可选优化。

## 为什么 EXIF 在后端解析

前端拿不到 EXIF：浏览器为隐私默认剥离 `File` 里的大部分元数据，
`FileReader` 读到的字节与用户磁盘上的不同（iOS Safari 尤其明显）。
所以 GPS 与时间只能由后端从**原始字节**里挖 ——
这正是 `services/photo_import.parse_exif()` 存在的理由。

## 为什么开关关闭时返回 404 而不是 403

PROJECT.md §二、[8] 要求：阶段旁路开关默认全关。
未启用的能力对外应当表现为**不存在**（404），而不是"存在但你没权限"（403）。
403 会告诉外部"这里确有此功能"，等于把未来的攻击面先画在地图上。
（同一取舍见 `app/api/v1/privacy.py`。）

## 为什么导入完立刻重建行程

照片全部落库之后，聚类看到的才是**完整**的照片集：
先导入后聚类，第 200 张照片才能把第 1 张所在的行程延伸到正确的边界；
边导边聚则会得出"取决于导入顺序"的切分，而顺序不该影响结果
（`services/trip_cluster.py` 的模块 docstring 有完整论证）。

所以本接口的事务是：**插照片 → 重建行程 → 一起提交**。
三步要么全成，要么全滚 —— 不会出现"照片进了库、行程还是旧的"这种
数据与视图对不上的中间态。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.feature_flags import is_enabled
from app.db.session import SessionFactory
from app.models.photo import Photo
from app.schemas.trip import ImportedPhoto, ImportPhotosResult, iso_or_none
from app.services.photo_import import import_photo_batch
from app.services.trip_service import rebuild_user_trips, semantic_tag_for_photo
from app.services.user_service import get_or_create_demo_user

router = APIRouter(prefix="/photos", tags=["photos"])

#: Web 端没有平台侧稳定标识，`asset_id` 用内容指纹顶上（见 `to_photo_record`）
_PLATFORM_WEB = "web"


def _to_view(photo: Photo) -> ImportedPhoto:
    """`Photo` 行 → 出参契约（时间字段在这里折成 ISO 字符串）。

    `hash` 列可空（`Photo.hash` 是 `str | None`），而契约里它是必填的字符串：
    本接口的照片全部由 `to_photo_record` 造出来，指纹一定有值，
    所以这里的 `or ""` 只是类型上的收口，不是业务上的兜底路径。
    """
    tag, label = semantic_tag_for_photo(photo)
    return ImportedPhoto(
        id=str(photo.id),
        asset_id=photo.asset_id,
        hash=photo.hash or "",
        taken_at=iso_or_none(photo.taken_at),
        taken_at_local=iso_or_none(photo.taken_at_local),
        tz_name=photo.tz_name,
        lat=photo.lat,
        lng=photo.lng,
        coord_system=photo.coord_system,
        location_source=photo.location_source,
        location_confidence=photo.location_confidence,
        semantic_tag=tag,
        semantic_label=label,
    )


@router.post(
    "/import",
    summary="批量导入本地照片并重建行程",
    response_model=ImportPhotosResult,
)
async def import_photos(
    files: Annotated[list[UploadFile], File(description="图片文件（可重复，逐个上传）")],
) -> ImportPhotosResult:
    """接收一批照片：解析 EXIF → 按内容指纹去重 → 落库 → 重建行程。

    单张失败（非图片 / 损坏文件）**只计入 `failed`，不中断整批**，
    也不进响应体：一批里混着几十张截图是常态，用户要的是"剩下那些导完了"，
    细节进日志、体积留给数字。

    三个计数器互斥且完备：`imported + duplicates + failed == 上传的文件数`。
    """
    # 开关未开 = 能力不存在（404，不是 403）。详见模块 docstring。
    if not is_enabled("photo_import"):
        raise HTTPException(status_code=404, detail="该能力未启用")

    payloads = [await upload.read() for upload in files]

    # 不用 `Depends(get_session)`：导入 + 重建必须落在**同一个事务**里，
    # 这里显式 `async with SessionFactory()` 自己管提交边界更直白
    # （依赖注入的会话在 handler 返回后才提交，会把两件事拆成两个事务）。
    async with SessionFactory() as session:
        user = await get_or_create_demo_user(session)
        result = await import_photo_batch(
            session, user_id=user.id, payloads=payloads, platform=_PLATFORM_WEB
        )
        trips = await rebuild_user_trips(session, user_id=user.id)

        response = ImportPhotosResult(
            imported=result.imported,
            duplicates=result.duplicates,
            failed=result.failed,
            photos=[_to_view(photo) for photo in result.photos],
            trip_ids=[str(trip.id) for trip in trips],
        )
        # 提交时机在最后：照片与行程一起生效，失败则一起回滚
        await session.commit()

    return response
