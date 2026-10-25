"""阶段 6 导入闭环的**出参契约**（与 ORM 严格分离）。

## 为什么时间字段的类型是 `str` 而不是 `datetime`

后端这些字段在 ORM 里是 `datetime`（tz-aware UTC），直接 `model_dump()` 交给
FastAPI 也能被 JSON 编码，但编码出来的格式依赖 pydantic 版本与 `json_encoders`
配置（是 `2026-04-12T09:31:05Z` 还是 `2026-04-12T09:31:05+00:00`、带不带毫秒，
都可能随版本变）。

所以契约层**自己**把 `datetime` 折成 ISO 字符串（见 `iso_or_none`），
字段类型直接声明成 `str`：

  - 前端拿到的是能直接喂给 `new Date(...)` 与地图轴的字符串，只需解析一种格式；
  - 哪天 pydantic 改了默认编码，变的是契约层内部的一行，不是前端的解析逻辑；
  - 契约类型就是真正在网络上传输的类型 —— 看 schema 就知道线上会收到什么，
    不用去猜序列化器做了什么。

代价是 API 层多几处 `iso_or_none(...)` 调用。相对于"前后端对时间格式各猜一半"，
以及"类型声明与实际传输的不一致"，这个代价很划算。

## 为什么 `semantic_tag` 允许为 None

导入那一刻照片还没有 caption（`caption` 由离线批处理 `jobs/caption_job` 补），
`classify_place()` 拿不到任何证据，只能诚实地返回 None。
**"没有语义"而不是"猜一个语义"**：猜出来的标签会写进阶段 7 的模式库，
那是比缺一条数据糟得多的事（见 `services/semantic_service.py` 模块 docstring）。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


def iso_or_none(value: datetime | None) -> str | None:
    """tz-aware datetime → ISO 8601 字符串。

    `None` 原样穿过而不是变成 `""` 或 `"null"`：**"没有"和"空"是两件事**。
    缺 GPS 的照片 `lat` 是 None，缺时间的照片 `taken_at` 也是 None，
    前端据此决定"这张不打点 / 不参与排序"；拿到空串只能靠猜。
    """
    return None if value is None else value.isoformat()


class ImportedPhoto(BaseModel):
    """一张被导入（或命中去重）的照片，导入接口的最小回执。

    只回**元数据**，不回原图字节：原图始终留在设备上（设计文档 §4），
    接口能给出的最强承诺就是"库里有这一条记录了"。

    `taken_at` 与 `taken_at_local` 两个都给，是因为它们各有用途：
    前者用来排序（UTC）、后者用来按天聚合（当地墙钟）。
    前端若只要一个，该用哪个是业务判断，不该由后端替它决定。
    """

    id: str = Field(description="Photo 主键（UUID 字符串）")
    asset_id: str = Field(description="平台侧稳定标识（Web 端即为内容指纹）")
    hash: str = Field(description="内容指纹 sha256 hex，导入链路的去重键")

    taken_at: str | None = Field(default=None, description="拍摄时刻（UTC，ISO 8601）")
    taken_at_local: str | None = Field(
        default=None, description="拍摄地当地墙钟时间（ISO 8601，无时区）——按天聚合一律用它"
    )
    tz_name: str | None = Field(default=None, description="形如 UTC+08:00；时区未知时为 null")
    lat: float | None = Field(default=None, description="WGS84 纬度；无 GPS 时为 null")
    lng: float | None = Field(default=None, description="WGS84 经度；无 GPS 时为 null")
    coord_system: str = Field(default="WGS84", description="坐标系，存储侧恒为 WGS84")
    location_source: str | None = Field(default=None, description="位置来源：exif / none")
    location_confidence: float | None = Field(
        default=None, description="位置置信度：EXIF 一手证据 0.9，无位置 0.0"
    )
    semantic_tag: str | None = Field(default=None, description="六类语义标签之一；无证据时为 null")
    semantic_label: str | None = Field(default=None, description="语义标签的中文名")


class ImportPhotosResult(BaseModel):
    """一次批量导入的结果。

    ## 为什么 `failed` 是数量而不是错误列表

    一批 200 张里可能有 30 张是截图/损坏文件。把 30 条错误消息全塞进响应体，
    前端拿到也只会显示"30 张失败"。数量 + 日志（服务端按指纹前缀记下失败原因）
    是信息量与体积之间的正确取舍 —— 排障看日志，用户看数字。

    ## 三个计数器的完备性

    `imported + duplicates + failed == 上传的文件数`，且三者互斥。
    这是本契约最有用的一条保证：前端可以据此直接断言"没有文件被静默吞掉"。
    """

    imported: int = Field(description="本次新建的照片条数")
    duplicates: int = Field(description="命中内容去重（库里已有或本批次内重复）的条数")
    failed: int = Field(description="解析失败（非图片 / 损坏）的文件数")
    photos: list[ImportedPhoto] = Field(
        default_factory=list, description="本次涉及的全部照片（含去重命中的旧记录）"
    )
    trip_ids: list[str] = Field(
        default_factory=list, description="重建后该用户当前全部行程的 id（UUID 字符串）"
    )


class TripItemView(BaseModel):
    """行程里的一张照片。

    `taken_at` 是聚类当时的**快照**（见 `models/trip.py` 的字段说明），
    不是实时从 `Photo` 读出来的值 —— 视图展示的是当初展示给用户的那一版。
    """

    id: str = Field(description="TripItem 主键")
    photo_id: str = Field(description="对应 Photo 主键")
    taken_at: str | None = Field(default=None, description="拍摄时刻（UTC，ISO 8601）")
    lat: float | None = Field(default=None, description="WGS84 纬度")
    lng: float | None = Field(default=None, description="WGS84 经度")
    semantic_tag: str | None = Field(default=None, description="六类语义标签之一；无证据时为 null")
    semantic_label: str | None = Field(default=None, description="语义标签的中文名")


class TripView(BaseModel):
    """一段行程（含它的照片列表）。

    `item_count` 与 `len(items)` 恒等，仍然单独给一个字段：
    将来若做分页（`items` 只回第一页），`item_count` 仍是总数，
    契约不会因此破裂。
    """

    id: str = Field(description="Trip 主键")
    title: str = Field(description="行程标题，形如「2026-04-12 起的旅程」")
    started_at: str | None = Field(default=None, description="行程起点（UTC，ISO 8601）")
    ended_at: str | None = Field(default=None, description="行程终点（UTC，ISO 8601）")
    source: str = Field(default="cluster", description="cluster（聚类生成）/ manual（手工）")
    item_count: int = Field(description="行程内照片数")
    items: list[TripItemView] = Field(default_factory=list, description="行程内照片，按簇内顺序")


class TripListResponse(BaseModel):
    """`GET /api/v1/trips` 的响应：当前用户的全部行程。"""

    trips: list[TripView] = Field(default_factory=list, description="按 started_at 升序")


class TripCreateRequest(BaseModel):
    """`POST /api/v1/trips` 的入参：手工创建一个**空**行程。

    ## 为什么只收 `title`，不收时间 / 照片

    手工行程在这一步是**空的**：它还没有照片，所以 `started_at` / `ended_at`
    无从谈起（`null` 由后端自己填，不是让用户传一个假时间）。
    照片通过后续导入进来，行程的边界再由后端按时间与空间重算 ——
    让用户在这一步就指定"从哪天到哪天"，等于让他手工维护一份
    后端随时会用照片重算出来的派生值，两边必然打架。

    ## 为什么 `title` 有长度上限且不能是纯空白

    `Trip.title` 是 `String(128)`：数据库会在超长时报错（有些数据库是截断），
    而"标题太长"是**用户输入问题**，该在入口层就说清楚，而不是变成一次 500。

    空白标题（`title="   "`）会被 Pydantic 原样接受，落库后就是一个
    看起来为空的行程卡片。所以在校验里剥掉首尾空白再判空 ——
    **存进去的是剥好的值**，不是"存原值、显示时再剥"。
    """

    title: str = Field(
        min_length=1,
        max_length=128,
        description="行程标题，如「洛阳两日」。首尾空白会被剥掉，剥完为空则 422",
    )


class TripRenameRequest(BaseModel):
    """`PATCH /api/v1/trips/{id}` 的入参：重命名一趟行程。

    ## 为什么不复用 `TripCreateRequest`

    两者的**失败语义不同**：创建时标题为空是"这次没建成"，
    重命名时标题为空是"把名字改没了"。后者更糟 —— 用户会看到一行
    没有标题的行程卡片，而且不知道刚才那次点击生效了没有。
    分开两个类型，路由层的校验文案就能各说各话，不用在一个 `if` 里猜语境。
    """

    title: str = Field(
        min_length=1,
        max_length=128,
        description="新的行程标题。首尾空白会被剥掉，剥完为空则 422",
    )


class TripCreateResponse(BaseModel):
    """`POST /api/v1/trips` 的响应：新建出来的那一条行程。

    只回一条而不是整个列表：调用方刚发过 `title`，它知道自己建了什么；
    要刷新列表就再调一次 `GET`。把全量行程塞进创建响应，
    会让"创建成功"和"列表刷新"两件事在前端共用一个状态位，
    将来做乐观更新时反而不好拆。

    `source` 恒为 `"manual"` —— 这是本接口存在的全部意义。
    """

    trip: TripView = Field(description="新建的行程（source 恒为 manual）")


__all__ = [
    "ImportPhotosResult",
    "ImportedPhoto",
    "TripCreateRequest",
    "TripCreateResponse",
    "TripItemView",
    "TripListResponse",
    "TripRenameRequest",
    "TripView",
    "iso_or_none",
]
