"""WGS84 ↔ GCJ-02 坐标转换（纯函数，无 IO，可单测）。

## 为什么必须存在这个模块

PROJECT.md §二、[2] 是硬红线：**WGS84 存储，GCJ-02 展示**。

- 照片 EXIF 里写的是 **WGS84**（GPS 设备的真实坐标）
- 高德/腾讯地图底图用的是 **GCJ-02**（俗称火星坐标，在 WGS84 上加了非线性偏移）

两者混用会直接偏移几百米——在"这张照片是在哪个景点拍的"这种判断上，
几百米就足以把答案指向隔壁街区。而且这种错误**不会报错**，只会安静地错下去，
所以必须做成纯函数并用单测锁死。

## 为什么用迭代反解而不是直接套逆公式

GCJ-02 → WGS84 没有解析形式的逆（偏移量本身依赖原坐标）。
工程上通用做法是**迭代逼近**：先假设偏移为 0，算出正向偏移，减掉，再算一次。
3 次迭代后误差已降到厘米级，远小于 GPS 本身的误差（米级）——再多算就是浪费。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

#: 克拉索夫斯基椭球参数（GCJ-02 使用的基准）
_A = 6378245.0
_EE = 0.00669342162296594323
_PI = math.pi


@dataclass(frozen=True)
class LngLat:
    """经纬度。**字段顺序刻意是 (lng, lat)**：与 GeoJSON / 高德 API 一致。

    很多坐标 bug 的根源就是 lon/lat 顺序写反，而且反了之后数值看起来"挺合理"
    （在中国境内两个值都是 100 上下），所以这里用字段名强制对齐外部协议。
    """

    lng: float
    lat: float


def _out_of_china(lng: float, lat: float) -> bool:
    """境外不做偏移（GCJ-02 只在中国境内有偏移）。"""
    return not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _transform_lat(x: float, y: float) -> float:
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * _PI) + 20.0 * math.sin(2.0 * x * _PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * _PI) + 40.0 * math.sin(y / 3.0 * _PI)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * _PI) + 320 * math.sin(y * _PI / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lng(x: float, y: float) -> float:
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * _PI) + 20.0 * math.sin(2.0 * x * _PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * _PI) + 40.0 * math.sin(x / 3.0 * _PI)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * _PI) + 300.0 * math.sin(x / 30.0 * _PI)) * 2.0 / 3.0
    return ret


def wgs84_to_gcj02(lng: float, lat: float) -> LngLat:
    """WGS84 → GCJ-02（存储坐标 → 展示/地图 API 坐标）。"""
    if _out_of_china(lng, lat):
        return LngLat(lng, lat)

    d_lat = _transform_lat(lng - 105.0, lat - 35.0)
    d_lng = _transform_lng(lng - 105.0, lat - 35.0)
    rad_lat = lat / 180.0 * _PI
    magic = math.sin(rad_lat)
    magic = 1 - _EE * magic * magic
    sqrt_magic = math.sqrt(magic)

    d_lat = (d_lat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrt_magic) * _PI)
    d_lng = (d_lng * 180.0) / (_A / sqrt_magic * math.cos(rad_lat) * _PI)
    return LngLat(round(lng + d_lng, 6), round(lat + d_lat, 6))


def gcj02_to_wgs84(lng: float, lat: float, *, iterations: int = 3) -> LngLat:
    """GCJ-02 → WGS84（地图 API 返回的坐标 → 入库坐标）。迭代逼近，3 次足够。"""
    if _out_of_china(lng, lat):
        return LngLat(lng, lat)

    cur_lng, cur_lat = float(lng), float(lat)
    for _ in range(max(1, iterations)):
        guessed = wgs84_to_gcj02(cur_lng, cur_lat)
        cur_lng += lng - guessed.lng
        cur_lat += lat - guessed.lat
    return LngLat(round(cur_lng, 6), round(cur_lat, 6))
