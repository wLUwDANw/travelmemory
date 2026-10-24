/** 地图相册页（阶段 6 UI）。
 *
 * ## 这一页现在做什么、不做什么
 *
 * 做：
 * - 渲染分享信物解出的地点：`radius > 0` → 半透明模糊圈，否则 Marker。
 *   这条红线由 `layers.ts` + `layers.test.ts` 锁死，本页只是把结果交给
 *   `MapCanvas` 执行；
 * - 渲染「我的照片」图层：后端 `GET /api/v1/trips` 回来的行程里有坐标的照片，
 *   由 `tripPoints.ts` 折成 `MapPointInput` 后追加进同一份渲染计划；
 * - 左上角悬浮操作面板：新建旅程（`POST /api/v1/trips`，真的建出一趟空行程）+
 *   导入照片（真实 file input → 上传 → 缩略图入库）+ 图层开关；
 * - 空态 / 降级态（key 没配、脚本没加载）由 `MapCanvas` 自己渲染，本页不接管。
 *
 * 不做（留给人类 / 后续阶段）：
 * - 60fps 聚合渲染、视口裁剪、轨迹回放 —— 见 `docs/stages/stage6-map-album.md`；
 * - 行程的手工**编辑**（改标题、合并、拆分）：写入接口只有"新建"这一条，
 *   改与删还没有，所以 `CreateTripDialog` 只负责创建。
 */

import { useMemo, useState } from 'react';
import { CircleDot, Info, Map as MapIcon } from 'lucide-react';

import type { TripView } from '../../services/api/trips';
import type { UnpackedPlace } from '../../types/share';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { MapActionPanel } from './MapActionPanel';
import { MapCanvas } from './MapCanvas';
import {
  DEFAULT_LAYER_VISIBILITY,
  planMapRender,
  sharePointsFromPlaces,
  toggleLayer,
  type LayerVisibility,
} from './layers';
import { countTripPhotos, tripPointsFromTrips } from './tripPoints';

export interface MapPageProps {
  /** 信物解包结果里的全部地点（已过验签）。坐标是 WGS84（模糊后）。 */
  sharePlaces?: readonly UnpackedPlace[];
  /** 后端行程列表。每个 item 里带坐标的会进「我的照片」图层。 */
  trips?: readonly TripView[];
  /** 导入成功后通知上层重新拉行程列表。 */
  onTripsChanged?: () => void;
}

/** 高德 JS API key。前端 key 会被打进产物，靠 referer 白名单保护，不当机密。 */
const AMAP_JS_KEY = import.meta.env.VITE_AMAP_JS_KEY ?? '';
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE ?? '';

export function MapPage({ sharePlaces = [], trips = [], onTripsChanged }: MapPageProps) {
  const [visibility, setVisibility] = useState<LayerVisibility>(DEFAULT_LAYER_VISIBILITY);

  // 两个数据源拼成一份点列表：图层开关与渲染计划都只认 `MapPointInput`，
  // 所以"合流"发生在这一层，layers.ts 不需要知道行程是什么。
  const points = useMemo(
    () => [...sharePointsFromPlaces(sharePlaces), ...tripPointsFromTrips(trips)],
    [sharePlaces, trips],
  );
  // 可见点数 / 已隐藏点数都来自纯逻辑层，UI 不自己数一遍
  const plan = useMemo(() => planMapRender(points, visibility), [points, visibility]);
  const shareCount = useMemo(() => points.filter((p) => p.source === 'share').length, [points]);
  const photoCounts = useMemo(() => countTripPhotos(trips), [trips]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm transition-shadow duration-200 hover:shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MapIcon className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <h1 className="text-lg font-semibold tracking-tight">旅忆地图</h1>
            <p className="text-xs text-muted-foreground">本地解签 · 坐标不出设备</p>
          </div>
          <Badge variant="secure">隐私模糊</Badge>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleDot className="h-4 w-4" />
          <span>
            可见 <span className="font-semibold text-foreground">{plan.items.length}</span> 个点
          </span>
          {plan.hidden > 0 && <Badge variant="muted">已隐藏 {plan.hidden}</Badge>}
        </div>
      </header>

      {/* relative + flex-col：MapCanvas 内部的 .map-canvas-wrap 靠 flex:1 撑满这个定高容器 */}
      <div className="relative flex h-[70vh] min-h-[420px] flex-col overflow-hidden rounded-xl border shadow-md">
        <MapActionPanel
          visibility={visibility}
          onToggleLayer={(layer) => setVisibility((v) => toggleLayer(v, layer))}
          shareCount={shareCount}
          photoCount={photoCounts.onMap}
          photoTotal={photoCounts.total}
          onTripsChanged={onTripsChanged}
        />
        <MapCanvas points={points} jsKey={AMAP_JS_KEY} securityCode={AMAP_SECURITY_CODE} />
      </div>

      <Alert variant="info" className="shadow-sm transition-shadow duration-200 hover:shadow-md">
        <Info className="h-4 w-4" />
        <AlertTitle>模糊圈半径的含义</AlertTitle>
        <AlertDescription>
          模糊圈的半径是<strong>承诺半径</strong>，不是本次实际偏移量 —— 真实位置只在圈内某处。
        </AlertDescription>
      </Alert>
    </div>
  );
}
