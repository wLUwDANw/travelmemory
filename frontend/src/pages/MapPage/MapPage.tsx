/** 地图相册页（W6-2 骨架）。
 *
 * ## 这一页现在做什么、不做什么
 *
 * 做：
 * - 渲染分享信物解出的地点：`radius > 0` → 半透明模糊圈，否则 Marker（W6-4）；
 * - 两个图层开关（分享 / 照片），按来源分组显隐；
 * - 空态 / 降级态（key 没配、脚本被墙）都有明确占位，不白屏。
 *
 * 不做（留给人类 / 后续阶段）：
 * - 本机照片图层的数据接入（后端还没有照片列表 API，`layers.ts` 的
 *   `source: 'photo'` 分支与开关已就位，接上即用）；
 * - 60fps 聚合渲染、视口裁剪、轨迹回放 —— 组件按"骨架"交付，
 *   真机数据下的性能调优见 `docs/stages/stage6-map-album.md` 的人工验证清单。
 */

import { useMemo, useState } from 'react';
import type { UnpackedPlace } from '../../types/share';
import { MapCanvas } from './MapCanvas';
import { DEFAULT_LAYER_VISIBILITY, sharePointsFromPlaces, toggleLayer, type LayerVisibility } from './layers';

export interface MapPageProps {
  /** 信物解包结果里的全部地点（已过验签）。坐标是 WGS84（模糊后）。 */
  sharePlaces?: readonly UnpackedPlace[];
}

/** 高德 JS API key。前端 key 会被打进产物，靠 referer 白名单保护，不当机密。 */
const AMAP_JS_KEY = import.meta.env.VITE_AMAP_JS_KEY ?? '';
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE ?? '';

export function MapPage({ sharePlaces = [] }: MapPageProps) {
  const [visibility, setVisibility] = useState<LayerVisibility>(DEFAULT_LAYER_VISIBILITY);

  const points = useMemo(() => sharePointsFromPlaces(sharePlaces), [sharePlaces]);

  return (
    <div className="map-page">
      <header className="map-header">
        <h1>旅忆地图</h1>
        <div className="layer-toggles">
          <label>
            <input
              type="checkbox"
              checked={visibility.share}
              onChange={() => setVisibility((v) => toggleLayer(v, 'share'))}
            />
            分享地点（{points.filter((p) => p.source === 'share').length}）
          </label>
          <label>
            <input
              type="checkbox"
              checked={visibility.photo}
              onChange={() => setVisibility((v) => toggleLayer(v, 'photo'))}
            />
            我的照片（数据接入见复盘文档）
          </label>
        </div>
      </header>
      <MapCanvas points={points} jsKey={AMAP_JS_KEY} securityCode={AMAP_SECURITY_CODE} />
      <footer className="map-footer hint">
        模糊圈的半径是<strong>承诺半径</strong>，不是本次实际偏移量 —— 真实位置只在圈内某处。
      </footer>
    </div>
  );
}
