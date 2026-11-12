import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  analyticProjection,
  buildJourney,
  Camera,
  Clock,
  createPose,
  DEFAULT_TAU,
  prepareScene,
  Renderer,
  samplePose,
  setCamera,
  type DrawState,
  type Journey,
  type Photo,
  type Projection,
} from '@travelmemory/trail';
import { mercX, mercY, wgs84ToGcj02 } from '@travelmemory/geo';
import { DEMO_TRIPS } from './data/demoJourneys';
import { createBaseMap, type MapController } from './map/baseMap';
import { Hud, type HudHandle } from './ui/Hud';
import { Timeline, type TimelineHandle } from './ui/Timeline';
import { PhotoCards, type PhotoCardsHandle } from './ui/PhotoCards';
import { Landing } from './ui/Landing';
import { SetupPanel } from './ui/SetupPanel';

type Mode = 'landing' | 'setup' | 'play';

declare global {
  interface Window {
    /** DEV 探针：最近一帧的相机/投影快照，供浏览器侧读取（生产包不存在） */
    __tmLast?: Record<string, number>;
  }
}

interface Trip {
  title: string;
  subtitle: string;
  photos: Photo[];
}

const IMPORTED_TITLE = '我的旅程';
const EMPTY_ANCHORS = new Float32Array(0);

/**
 * 播放期下发地图中心的最小间隔（毫秒）。
 * 每帧 `map.setCenter` 会让高德不断取消在飞的瓦片请求（实测 6 秒 293 次 ERR_ABORTED），
 * 底图永远画不出来。25Hz 下：237px/s × 0.04s ≈ 9.5px/步，肉眼基本连续，
 * 瓦片压力只有原来的 2/3（根因修好后平移速度已从 2680px/s 降到 237px/s）。
 *
 * 别改成 50 或 100：`lastCenterAt = now` 用的是 rAF 时间戳（16.667ms 的整数倍），
 * interval 会被量化成整数帧，40/50 都是「每 3 帧一次」，而 50 正好压在 3×16.667 的
 * 临界点上会抖；100（6 帧）实测也没能提升帧率 —— 掉帧来自镜头进入新区域时的瓦片加载，
 * 不是调用频率。详见 docs/stages/stage9-trail-replay.md 的「帧率调查」一节。
 */
const CENTER_INTERVAL_MS = 40;

/** 当前弧长落在第几天（days 已按时间升序） */
function dayIndexAt(journey: Journey, s: number): number {
  const days = journey.days;
  if (days.length === 0) return 0;
  for (let i = 0; i < days.length; i += 1) {
    if (s <= days[i].endS + 0.001) return i;
  }
  return days.length - 1;
}

/**
 * 当前地名。pose.t 在播放时单调递增，用一个游标把每帧比较次数压到常数级：
 * 先让游标追上 t，再只在游标 ±3 张里找最近的一张。
 */
function createPlaceLookup(journey: Journey): (t: number) => string {
  const photos = journey.photos;
  if (photos.length === 0) return () => '';
  let cursor = 0;
  return (t: number): string => {
    while (cursor + 1 < photos.length && photos[cursor + 1].takenAt <= t) cursor += 1;
    while (cursor > 0 && photos[cursor].takenAt > t) cursor -= 1;
    const from = cursor > 3 ? cursor - 3 : 0;
    const to = Math.min(photos.length - 1, cursor + 3);
    let best = cursor;
    let bestGap = Math.abs(photos[cursor].takenAt - t);
    for (let i = from; i <= to; i += 1) {
      const gap = Math.abs(photos[i].takenAt - t);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return photos[best].placeName ?? '';
  };
}

function gridSpacingFor(zoom: number): number {
  if (zoom >= 11) return 0.05;
  if (zoom >= 9.5) return 0.1;
  if (zoom >= 8) return 0.25;
  return 0.5;
}

/* ── 播放舞台 ────────────────────────────────────────────────── */

interface PlayStageProps {
  journey: Journey;
  onBack: () => void;
}

function PlayStage({ journey, onBack }: PlayStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HudHandle>(null);
  const timelineRef = useRef<TimelineHandle>(null);
  const cardsRef = useRef<PhotoCardsHandle>(null);
  const resetRef = useRef<() => void>(() => {});

  const clockRef = useRef<Clock | null>(null);
  if (clockRef.current === null) clockRef.current = new Clock();
  const clock = clockRef.current;

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fallback, setFallback] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const scene = prepareScene(journey);
    const renderer = new Renderer(canvas);
    const camera = new Camera();
    const pose = createPose();

    const start = samplePose(journey, 0, pose);
    camera.reset(start.lng, start.lat);
    const startGcj = wgs84ToGcj02(start.lng, start.lat);

    let proj: Projection = analyticProjection(
      startGcj,
      journey.suggestedZoom,
      renderer.width,
      renderer.height,
    );
    let controller: MapController | null = null;
    let isFallback = true;
    let appliedMx = Number.NaN;
    let appliedMy = Number.NaN;
    let disposed = false;
    let raf = 0;

    const spacing = gridSpacingFor(journey.suggestedZoom);

    // 每次挂载使用全新容器，避免地图 SDK 复用旧节点
    const inner = document.createElement('div');
    inner.style.cssText = 'position:absolute;inset:0;';
    host.appendChild(inner);

    void createBaseMap(inner, {
      center: startGcj,
      zoom: journey.suggestedZoom,
      interactive: false,
      paintFallback: false,
    }).then((ctrl) => {
      if (disposed) {
        ctrl.destroy();
        return;
      }
      controller = ctrl;
      isFallback = ctrl.kind === 'fallback';
      setFallback(isFallback);
      proj = ctrl.calibrate(renderer.width, renderer.height, journey.suggestedZoom);
      appliedMx = Number.NaN;
      appliedMy = Number.NaN;
      // 预热：先把相机定在起点
      ctrl.setCenter(startGcj.lng, startGcj.lat);

      // 「遮罩淡出」和「开跑」必须是同一个信号。
      // 若分成两个来源（原来：控制器 resolve 就开跑、whenReady 才揭遮罩），
      // 地图慢的时候会演成「揭开帘子时旅程已经播了半段」。
      // whenReady 自带 4s 上限、降级路径立即 resolve，所以它不会卡住播放。
      void ctrl.whenReady().then(() => {
        if (disposed) return;
        // 最小显示 400ms：地图极快时避免遮罩一闪而过（一次无意义的白/黑闪）
        const wait = Math.max(0, 400 - (performance.now() - mountedAt));
        revealTimer = window.setTimeout(() => {
          if (disposed) return;
          setMapReady(true);
          startPlayback();
        }, wait);
      });
    });

    const drawState: DrawState = {
      scene,
      proj,
      progressS: 0,
      nowMs: 0,
      fallback: true,
      gridSpacingDeg: spacing,
      headMX: 0,
      headMY: 0,
      anchors: EMPTY_ANCHORS,
      anchorCount: 0,
    };

    let last = performance.now();
    let lastPlaying = false;
    let frameCount = 0;
    let lastCenterAt = 0;
    let started = false;
    let revealTimer = 0;
    let failsafeTimer = 0;
    const mountedAt = performance.now();
    const lookupPlace = createPlaceLookup(journey);

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /**
     * 开跑。只由 whenReady()（正常路径）或兜底定时器（异常路径）调用，
     * 这样「揭开遮罩」与「旅程开始」永远同一时刻。
     * `disposed` 守卫必须保留：回调已经变成异步的，可能在组件卸载后才执行。
     */
    const startPlayback = (): void => {
      if (started || disposed) return;
      started = true;
      window.clearTimeout(revealTimer);
      window.clearTimeout(failsafeTimer);
      if (!prefersReducedMotion) clock.play();
    };

    // 兜底：whenReady() 只有在 createBaseMap resolve 之后才存在，
    // 而 loadAmap 最长会等 8s（超时才降级）。也就是说「控制器迟迟不出现」这段
    // 是 whenReady 的 4s cap 覆盖不到的——没有这条兜底，弱网下遮罩可能盖到 8~12s。
    // 它与 whenReady 是「谁先到谁生效」，startPlayback 内部幂等。
    failsafeTimer = window.setTimeout(() => {
      setMapReady(true);
      startPlayback();
    }, 6000);

    /** 画布尺寸自愈 + 视口变化处理（resize() 内部有短路，重复调用几乎零成本） */
    const syncSize = (): void => {
      renderer.resize();
      proj.ox = renderer.width / 2;
      proj.oy = renderer.height / 2;
    };

    const frame = (now: number): void => {
      if (disposed) return;
      raf = window.requestAnimationFrame(frame);

      // 每 32 帧校正一次画布尺寸：防止任何布局/DPR 变化把画布锁在小尺寸上
      frameCount += 1;
      if ((frameCount & 31) === 0) syncSize();

      const dt = now - last;
      last = now;
      const step = Math.min(Math.max(dt, 0), 50);

      clock.tick(step);
      // 只在播放状态「变化」的那一帧同步一次 React，不逐帧 setState
      if (clock.playing !== lastPlaying) {
        lastPlaying = clock.playing;
        setPlaying(clock.playing);
      }

      samplePose(journey, clock.q * scene.totalMeters, pose);
      // 倍速补偿：4x 下屏幕速度翻 4 倍，阻尼滞后 τ·v 会到 ~208px（光点被甩出中心）。
      // 用 max(1, speed) 而不是 speed：快放才需要压滞后；0.5x 是"看清细节"的场景，镜头要更贴。
      camera.follow(pose.lng, pose.lat, step, DEFAULT_TAU / Math.max(1, clock.speed));

      const camGcj = wgs84ToGcj02(camera.lng, camera.lat);
      const camMx = mercX(camGcj.lng);
      const camMy = mercY(camGcj.lat);

      if (controller) {
        const dx = (camMx - appliedMx) * proj.scaleX;
        const dy = (camMy - appliedMy) * proj.scaleY;
        const moved = dx * dx + dy * dy > 4; // 位移 ≥ 2px 才值得下发
        // 时间闸对播放/暂停一视同仁：暂停时相机静止，40ms 后自然追平，
        // 期间瓦片有 25 次/秒的机会去加载，比每帧抢健康得多。
        const due = now - lastCenterAt >= CENTER_INTERVAL_MS;
        if (
          due &&
          (moved || !Number.isFinite(appliedMx) || !Number.isFinite(appliedMy))
        ) {
          controller.setCenter(camGcj.lng, camGcj.lat);
          appliedMx = camMx;
          appliedMy = camMy;
          lastCenterAt = now;
        }
      }

      // 覆盖层锚定「相机当前值」，不是「地图最后一次被下发的中心」：
      // 地图 25Hz、画布 60fps，若锚定 applied 会让整条轨迹+光点以 25Hz 抖动。
      // 两种滞后要分开看，别混：
      //   · 地图量化滞后 = v_px × 40ms  → 1x ≈ 9.5px（底图落后画布，暗色画面，肉眼几乎看不出）
      //   · 相机阻尼滞后 = τ × v_px     → 1x ≈ 52px（光点偏中心，这是设计要的"活"手感）
      setCamera(proj, camMx, camMy, proj.ox, proj.oy);

      const headGcj = wgs84ToGcj02(pose.lng, pose.lat);
      const headMX = mercX(headGcj.lng);
      const headMY = mercY(headGcj.lat);

      // DEV 探针：定位「光点偏离中心」这类只在真机出现的问题
      if (import.meta.env.DEV && (frameCount & 15) === 0) {
        window.__tmLast = {
          frame: frameCount,
          q: clock.q,
          playing: clock.playing ? 1 : 0,
          camMx,
          camMy,
          appliedMx,
          appliedMy,
          headMX,
          headMY,
          projCx: proj.cx,
          projCy: proj.cy,
          scaleX: proj.scaleX,
          scaleY: proj.scaleY,
          ox: proj.ox,
          oy: proj.oy,
          headScreenX: proj.ox + (headMX - proj.cx) * proj.scaleX,
          headScreenY: proj.oy + (headMY - proj.cy) * proj.scaleY,
          canvasW: renderer.width,
          canvasH: renderer.height,
        };
      }

      const cards = cardsRef.current;
      if (cards) {
        const headScreenX = proj.ox + (headMX - proj.cx) * proj.scaleX;
        const headScreenY = proj.oy + (headMY - proj.cy) * proj.scaleY;
        cards.update(scene, proj, pose.s, !clock.playing, now, headScreenX, headScreenY);
      }

      drawState.proj = proj;
      drawState.progressS = pose.s;
      drawState.nowMs = now;
      // 遮罩（.map-scrim, z=2）盖得住高德地图，但盖不住主画布（z=3）。
      // 底图就绪前 isFallback 还是 true，若此时画格网，用户在揭幕前看到的就是
      // 满屏经纬网而不是设计要的「干净深色底」。所以格网只在揭幕之后才画。
      drawState.fallback = isFallback && started;
      drawState.headMX = headMX;
      drawState.headMY = headMY;
      drawState.anchors = cards ? cards.anchors : EMPTY_ANCHORS;
      drawState.anchorCount = scene.photoCount;
      renderer.draw(drawState);

      const hud = hudRef.current;
      if (hud) {
        hud.update(
          pose.t,
          dayIndexAt(journey, pose.s),
          journey.days.length,
          pose.s,
          clock.q,
          lookupPlace(pose.t),
        );
      }
      timelineRef.current?.draw(clock.q);
    };

    raf = window.requestAnimationFrame(frame);

    window.addEventListener('resize', syncSize);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        event.preventDefault();
        clock.toggle();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        clock.seek(clock.q + 0.01);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        clock.seek(clock.q - 0.01);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        clock.seek(0);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    resetRef.current = (): void => {
      samplePose(journey, 0, pose);
      camera.reset(pose.lng, pose.lat);
      appliedMx = Number.NaN;
      appliedMy = Number.NaN;
      clock.replay();
    };

    return () => {
      disposed = true;
      window.clearTimeout(revealTimer);
      window.clearTimeout(failsafeTimer);
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', syncSize);
      window.removeEventListener('keydown', onKeyDown);
      controller?.destroy();
      controller = null;
      if (inner.parentElement) inner.parentElement.removeChild(inner);
    };
  }, [journey]);

  const handleSpeed = useCallback(
    (next: number) => {
      clock.setSpeed(next);
      setSpeed(next);
    },
    [clock],
  );

  const handleReplay = useCallback(() => {
    resetRef.current();
  }, []);

  return (
    <div className="play">
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {/* 盖住底图尚未铺满时的占位网格；底图就绪后 600ms 淡出。
          纯色 + opacity 过渡＝合成器单层操作，不要加 backdrop-filter（全屏重采样会吃掉帧率）。 */}
      <div className="map-scrim" style={{ opacity: mapReady ? 0 : 1 }} />
      {fallback ? <div className="topbar-note">底图未加载，已切换示意格网（轨迹与播放不受影响）</div> : null}
      <canvas className="play-canvas" ref={canvasRef} />
      <PhotoCards ref={cardsRef} journey={journey} />
      <Hud ref={hudRef} title={journey.title} subtitle={journey.subtitle} />
      <button type="button" className="back-btn" onClick={onBack}>
        返回调整
      </button>
      <Timeline
        ref={timelineRef}
        journey={journey}
        clock={clock}
        playing={playing}
        speed={speed}
        onSpeedChange={handleSpeed}
        onReplay={handleReplay}
      />
    </div>
  );
}

/* ── App ─────────────────────────────────────────────────────── */

export default function App() {
  const [mode, setMode] = useState<Mode>('landing');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [incoming, setIncoming] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const journey = useMemo(() => {
    if (mode !== 'play' || !trip) return null;
    return buildJourney({
      id: 'active',
      title: trip.title,
      subtitle: trip.subtitle,
      photos: trip.photos,
    });
  }, [mode, trip]);

  const demos = useMemo(
    () =>
      DEMO_TRIPS.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        photoCount: item.photos.length,
      })),
    [],
  );

  const handleSelectDemo = useCallback((id: string) => {
    const demo = DEMO_TRIPS.find((item) => item.id === id);
    if (!demo) return;
    // 演示数据的每张照片都自带坐标，setup（补地点）对它没有意义，直接进播放。
    setTrip({ title: demo.title, subtitle: demo.subtitle, photos: demo.photos });
    setIncoming([]);
    setMode('play');
  }, []);

  const handlePickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length === 0) return;
    setTrip({ title: IMPORTED_TITLE, subtitle: `${files.length} 张照片`, photos: [] });
    setIncoming(files);
    setMode('setup');
  }, []);

  const handleDropFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setTrip({ title: IMPORTED_TITLE, subtitle: `${files.length} 张照片`, photos: [] });
    setIncoming(files);
    setMode('setup');
  }, []);

  const handlePhotosChange = useCallback((next: Photo[]) => {
    setTrip((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        photos: next,
        subtitle: prev.title === IMPORTED_TITLE ? `${next.length} 张照片` : prev.subtitle,
      };
    });
  }, []);

  const consumeIncoming = useCallback(() => setIncoming([]), []);

  const handleStart = useCallback(() => {
    if (!trip) return;
    const located = trip.photos.filter((photo) => photo.lat !== null && photo.lng !== null);
    if (located.length < 2) return;
    setMode('play');
  }, [trip]);

  const handleBack = useCallback(() => setMode('setup'), []);

  if (mode === 'landing') {
    return (
      <>
        <Landing
          trips={demos}
          onSelectDemo={handleSelectDemo}
          onPickFiles={handlePickFiles}
          onDropFiles={handleDropFiles}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
      </>
    );
  }

  if (mode === 'setup' && trip) {
    return (
      <SetupPanel
        photos={trip.photos}
        onPhotosChange={handlePhotosChange}
        incomingFiles={incoming}
        onIncomingConsumed={consumeIncoming}
        onStart={handleStart}
        onBack={() => setMode('landing')}
      />
    );
  }

  if (mode === 'play' && journey && journey.track.length > 0) {
    return <PlayStage journey={journey} onBack={handleBack} />;
  }

  return (
    <div className="modal-mask">
      <div className="modal">
        <div className="modal-title">还差一点</div>
        <div className="modal-text">
          这条轨迹至少需要 2 张已定位的照片。回到上一页，选中照片后在地图上点一下补个地点。
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setMode(trip ? 'setup' : 'landing')}>
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
