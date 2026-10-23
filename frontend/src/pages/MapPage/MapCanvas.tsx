/** 地图组件骨架：把 `RenderPlan` 画到高德地图上。
 *
 * ## 这个文件刻意"薄"
 *
 * 所有决策（画什么、圈多大、视野怎么框）都在 `layers.ts` 里算完并经单测锁死，
 * 这里只做四件事：加载高德、建地图、按计划加覆盖物、卸载时销毁。
 * 60fps 渲染（聚合、视口裁剪、canvas 图层）留给人类按真机数据调 ——
 * 但"模糊圈不画 Marker"这类**语义**已经在图层管理器里，不会因为渲染优化而丢。
 *
 * ## 降级路径（PROJECT.md §二、[8]）
 *
 * key 没配 / 脚本加载失败 → 不白屏，显示占位卡片，页面其余部分照常工作。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { SHARE_CIRCLE_STYLE, isAmapReady, loadAmap, type AmapMap, type AmapNamespace, type AmapOverlay } from './amap';
import { planMapRender, type MapPointInput, type RenderPlan } from './layers';

export interface MapCanvasProps {
  points: readonly MapPointInput[];
  /** 高德 JS API key（由页面从环境变量读入后传下，组件本身不读 env，便于测试）。 */
  jsKey: string;
  securityCode?: string;
}

export function MapCanvas({ points, jsKey, securityCode = '' }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AmapMap | null>(null);
  const overlaysRef = useRef<AmapOverlay[]>([]);
  const [amap, setAmap] = useState<AmapNamespace | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 渲染计划：纯函数 + useMemo，points 不变就不重算
  const plan: RenderPlan = useMemo(() => planMapRender(points), [points]);

  // 1) 加载高德（key 缺失 / 网络失败都走 error 分支，不白屏）
  useEffect(() => {
    let cancelled = false;
    if (isAmapReady()) {
      setAmap(window.AMap as AmapNamespace);
      return;
    }
    loadAmap(jsKey, securityCode).then(
      (ns) => {
        if (!cancelled) setAmap(ns);
      },
      (exc: Error) => {
        if (!cancelled) setError(exc.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [jsKey, securityCode]);

  // 2) 建地图（只建一次；销毁时 remove 全部覆盖物再 destroy）
  useEffect(() => {
    if (!amap || !containerRef.current || mapRef.current) return;
    mapRef.current = new amap.Map(containerRef.current, {
      viewMode: '2D',
      zoom: 11,
      // 中国大陆视野；海外用户拖过去就好，不做 IP 定位（隐私）
      center: [105.0, 35.0],
    });
    const map = mapRef.current;
    return () => {
      for (const overlay of overlaysRef.current) overlay.setMap(null);
      overlaysRef.current = [];
      map.destroy();
      mapRef.current = null;
    };
  }, [amap]);

  // 3) 计划变化 → 差量更新覆盖物（先全清再重画：照片量级 < 千，重建比 diff 便宜且不会漏）
  useEffect(() => {
    const map = mapRef.current;
    if (!amap || !map) return;
    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];

    const created: AmapOverlay[] = [];
    for (const item of plan.items) {
      if (item.kind === 'circle') {
        // W6-4 红线：radius > 0 → 半透明圆，**不画 Marker**
        created.push(
          new amap.Circle({
            center: [item.center.lng, item.center.lat],
            radius: item.radius,
            ...SHARE_CIRCLE_STYLE,
            extData: { id: item.id, name: item.name },
          }),
        );
      } else {
        created.push(
          new amap.Marker({
            position: [item.position.lng, item.position.lat],
            extData: { id: item.id, name: item.name },
          }),
        );
      }
    }
    for (const overlay of created) overlay.setMap(map);
    overlaysRef.current = created;

    // 视野：空计划不动地图（否则会 fitBounds 到全世界）
    if (plan.bounds) {
      map.setFitView(created, false);
    }
  }, [amap, plan]);

  if (error) {
    return (
      <div className="map-fallback" role="status">
        <strong>地图不可用</strong>
        <p>{error}</p>
        <p className="hint">这不影响信物的加解密与验签 —— 那些都在本地完成。</p>
      </div>
    );
  }

  return (
    <div className="map-canvas-wrap">
      <div ref={containerRef} className="map-canvas" data-testid="map-canvas" />
      {plan.hidden > 0 && <div className="map-hidden-hint">已隐藏 {plan.hidden} 个点（图层开关）</div>}
      {plan.items.length === 0 && !error && (
        <div className="map-empty-hint">暂无可渲染的地点。导入一个信物，或给照片补上坐标。</div>
      )}
    </div>
  );
}
