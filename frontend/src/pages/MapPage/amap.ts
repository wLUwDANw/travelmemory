/** 高德 JS API 的动态加载器。
 *
 * ## 为什么不用 index.html 里写死 <script>
 *
 * 1. **key 没配时不能白屏**：脚本标签写死的话，缺 key 的部署会得到一个永远转圈的地图，
 *    而加载器可以返回一个明确的错误，让 UI 显示"未配置高德 Key"的占位。
 * 2. **测试环境不能炸**：本模块在 Node（vitest）里也会被 import，
 *    所以所有 `window` 访问都必须惰性 + 守卫（规范 §2.3 分层边界）。
 * 3. **重复加载要去重**：React StrictMode 会双调用 effect，
 *    两个并发 `loadAmap()` 必须共享同一个 Promise。
 *
 * ## key 从哪来
 *
 * `VITE_AMAP_JS_KEY`（Vite 环境变量，见 `frontend/.env.example`）。
 * **这是前端 key，会被打进产物** —— 高德 JS key 的设计就是在浏览器里公开使用，
 * 靠 referer 白名单限制；但任何人仍能从产物里读到它，所以不要把它当机密。
 */

/** `window.AMap` 的最小形态。我们不 import 高德的类型包（没有官方 d.ts），
 *  只声明用到的部分 —— 地图组件是骨架，FullType 会拖来一堆 never 校验。 */
export interface AmapNamespace {
  Map: new (container: HTMLElement, options?: Record<string, unknown>) => AmapMap;
  Marker: new (options: Record<string, unknown>) => AmapOverlay;
  Circle: new (options: Record<string, unknown>) => AmapOverlay;
}

export interface AmapMap {
  setCenter(center: [number, number]): void;
  setZoom(zoom: number): void;
  getZoom(): number;
  /** 同时设缩放与中心。**一步做完**而不是先 setZoom 再 setCenter：
   *  高德内部会为两次调用各排一次重绘，动画中间态会被用户看到"先缩后跳"。 */
  setZoomAndCenter(zoom: number, center: [number, number]): void;
  setFitView(overlays: AmapOverlay[], immediately?: boolean, avoid?: [number, number, number, number]): void;
  add(overlay: AmapOverlay | AmapOverlay[]): void;
  remove(overlay: AmapOverlay | AmapOverlay[]): void;
  destroy(): void;
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
}

export interface AmapOverlay {
  setMap(map: AmapMap | null): void;
}

/** 半透明圆圈的填充色（W6-4）：与设计文档 §6.2 的"分享圈"图层一致。 */
export const SHARE_CIRCLE_STYLE = {
  fillColor: '#2f6f5e',
  fillOpacity: 0.18,
  strokeColor: '#2f6f5e',
  strokeWeight: 1,
  strokeOpacity: 0.6,
} as const;

declare global {
  interface Window {
    AMap?: AmapNamespace;
    _AMapSecurityConfig?: { securityCode: string };
  }
}

/** 模块级去重：并发调用共享同一个加载 Promise；失败不缓存（下次可重试）。 */
let loading: Promise<AmapNamespace> | null = null;

/** 当前是否已加载完成（供 UI 同步判断，避免闪烁）。 */
export function isAmapReady(): boolean {
  return typeof window !== 'undefined' && typeof window.AMap !== 'undefined';
}

/** 加载高德 JS API 并返回 `window.AMap`。
 *
 * @param jsKey   高德 JS API key（浏览器端公开，靠 referer 白名单保护）
 * @param securityCode  可选的安全密钥（高德控制台配套的 securityCode）
 * @throws key 为空、脚本加载超时（15s）、`window.AMap` 未定义
 */
export function loadAmap(jsKey: string, securityCode = ''): Promise<AmapNamespace> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('高德地图只能在浏览器环境加载（当前没有 window/document）'));
  }
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!jsKey.trim()) {
    return Promise.reject(new Error('未配置高德 JS API Key（VITE_AMAP_JS_KEY）—— 地图不可用，但图层决策与信物流程不受影响'));
  }
  if (loading) return loading;

  loading = new Promise<AmapNamespace>((resolve, reject) => {
    if (securityCode.trim()) {
      window._AMapSecurityConfig = { securityCode: securityCode.trim() };
    }
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(jsKey.trim())}`;
    script.async = true;
    const timer = window.setTimeout(() => {
      loading = null;
      script.remove();
      reject(new Error('高德地图脚本加载超时（15s）—— 检查网络或 key 的 referer 白名单'));
    }, 15000);
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.AMap) {
        resolve(window.AMap);
      } else {
        loading = null;
        reject(new Error('高德脚本已加载但 window.AMap 未定义 —— key 可能无效'));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      loading = null;
      script.remove();
      reject(new Error('高德地图脚本加载失败 —— 检查网络连接'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** 测试专用：清掉去重缓存（`beforeEach` 用，避免用例间互相污染）。 */
export function resetAmapLoaderForTest(): void {
  loading = null;
}
