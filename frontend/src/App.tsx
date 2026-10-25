import { useCallback, useEffect, useState } from 'react';
import { Toaster } from './components/ui/toaster';
import { MapPage } from './pages/MapPage';
import { listTrips, type TripView } from './services/api/trips';
import type { UnpackedPlace } from './types/share';

/** 阶段 7 的应用壳：**地图是唯一底层，其余全部叠在它上面**。
 *
 * ## 为什么不再是三个 Tab
 *
 * 阶段 6 之前这里是「记忆问答 / 地图相册 / 信物分享」三个页签，默认落在问答上。
 * 那个结构对"旅忆地图"是错的：产品的第一屏应该是**地图**，
 * 而问答、相册、信物都是从地图出发的动作。Tab 结构把三者摆成平级，
 * 用户每次想聊一句都要先切走、看完地图再切回来。
 *
 * 现在壳只做两件事：
 *   1. 全屏渲染 `MapPage`（它自己管抽屉、FAB、对话框）；
 *   2. 持有**跨浮层共享**的两份数据：
 *      - `mapPlaces`：信物解出的地点 → 地图画模糊圈；
 *      - `trips`：行程列表 → 行程抽屉展示、信物分享打包。
 *
 * 为什么数据在这一层而不是各浮层自己拉：信物对话框要打包"我刚导入的那趟行程"，
 * 而导入发生在行程抽屉里。两个浮层互斥（同时只开一个），
 * 所以它们之间**不可能**直接对话 —— 共享状态必须有个共同祖先。
 * 引入全局 store 是为这点数据付出的过度设计，useState 足够。
 */
export default function App() {
  const [mapPlaces, setMapPlaces] = useState<UnpackedPlace[]>([]);
  const [trips, setTrips] = useState<TripView[]>([]);

  /** 拉行程列表。
   *
   *  **失败一律静默降级成空列表**：`photo_import` 开关关着时后端对
   *  `GET /api/v1/trips` 给 404，那是"这个能力没开"，不是"页面坏了"。
   *  白屏或者顶部飘一条红字，都是在拿后端的一个开关惩罚用户。 */
  const refreshTrips = useCallback(async () => {
    try {
      setTrips(await listTrips());
    } catch {
      setTrips([]);
    }
  }, []);

  useEffect(() => {
    void refreshTrips();
  }, [refreshTrips]);

  return (
    <div className="h-[100dvh] w-full overflow-hidden">
      <MapPage
        sharePlaces={mapPlaces}
        trips={trips}
        onTripsChanged={refreshTrips}
        onViewOnMap={setMapPlaces}
      />
      {/* 全局挂一份：toast 可能在任意浮层的深层回调里触发，多挂会互相遮挡 */}
      <Toaster />
    </div>
  );
}
