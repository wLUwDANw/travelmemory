import { useCallback, useEffect, useState } from 'react';
import { Toaster } from './components/ui/toaster';
import { AgentPage } from './pages/AgentPage';
import { MapPage } from './pages/MapPage';
import { SharePage } from './pages/SharePage';
import { listTrips, type TripView } from './services/api/trips';
import type { UnpackedPlace } from './types/share';

/** 三个页签。地图是主界面（设计文档 §6.1），但默认落在"记忆问答" ——
 *  老用户的入口不该被阶段 6 的改动搬走。 */
const TABS = [
  { key: 'agent', label: '记忆问答' },
  { key: 'map', label: '地图相册' },
  { key: 'share', label: '信物分享' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** 阶段 6 的应用壳。
 *
 * 阶段 2 只有对话一页；阶段 6 把地图（W6-2）与信物分享（W6-4）接进来。
 * 页面间的数据流有两条，都放在这一层（不引入全局 store）：
 *   1. SharePage 解出的地点 → MapPage 画模糊圈；
 *   2. 行程列表：MapPage 导入完照片后要刷新，SharePage 打包时要能读到这批行程。
 */
export default function App() {
  const [tab, setTab] = useState<TabKey>('agent');
  const [mapPlaces, setMapPlaces] = useState<UnpackedPlace[]>([]);
  const [trips, setTrips] = useState<TripView[]>([]);

  /** 拉行程列表。
   *
   * **失败一律静默降级成空列表**：`photo_import` 开关关着时后端对
   * `GET /api/v1/trips` 给 404，那是"这个能力没开"，不是"页面坏了"。
   * 白屏或者顶部飘一条红字都是在拿后端的一个开关惩罚用户。 */
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

  const viewOnMap = useCallback((places: UnpackedPlace[]) => {
    setMapPlaces(places);
    setTab('map');
  }, []);

  return (
    <div className="app-shell">
      <nav className="app-nav">
        {TABS.map((item) => (
          <button
            key={item.key}
            className={tab === item.key ? 'active' : ''}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="app-main">
        {tab === 'agent' && <AgentPage />}
        {tab === 'map' && (
          <MapPage sharePlaces={mapPlaces} trips={trips} onTripsChanged={refreshTrips} />
        )}
        {tab === 'share' && <SharePage onViewOnMap={viewOnMap} trips={trips} />}
      </main>
      {/* 全局挂一份：toast 可能在任意页面的深层回调里触发，多挂会互相遮挡 */}
      <Toaster />
    </div>
  );
}
