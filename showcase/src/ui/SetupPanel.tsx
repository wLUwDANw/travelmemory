import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import {
  DEFAULT_TRANSPORT,
  formatDateDot,
  formatTimeHM,
  normalizeTransport,
  TRANSPORT_MODES,
  TRANSPORT_STYLE,
  type Photo,
  type TransportMode,
} from '@travelmemory/trail';
import { clamp, gcj02ToWgs84, haversine, wgs84ToGcj02 } from '@travelmemory/geo';
import { readExif } from '../lib/exif';
import { makeThumb } from '../lib/thumb';
import { createBaseMap, type MapController, type MapKind } from '../map/baseMap';

interface SetupPanelProps {
  photos: Photo[];
  onPhotosChange: (next: Photo[]) => void;
  incomingFiles: File[];
  onIncomingConsumed: () => void;
  onStart: () => void;
  onBack: () => void;
}

/** 没有 GPS 记录时的默认取景：中国全域 */
const DEFAULT_VIEW = { center: { lng: 104.2, lat: 35.6 }, zoom: 4.4 };

/**
 * 批量定位时给每张照片一点点扇形偏移（约 45m 递增）。
 * 纯粹为了让轨迹在「多张照片落在同一处」时仍然画得出来，不代表真实位置。
 */
const BATCH_FAN_DEG = 0.00042;

/**
 * 设置面板里「路段」的最小长度（米）。
 *
 * 和 `journey.ts` 的 `STATION_MERGE_METERS` 是同一个数量级：同一景点连拍的两张
 * 常差 1km 出头，那是抖动不是一段路，不该出现在「每段路怎么走」列表里。
 */
const LEG_MIN_METERS = 2000;

interface Leg {
  from: Photo;
  to: Photo;
  km: number;
  /** 生效中的交通工具（可能来自继承，不是这一张上直接设的） */
  mode: TransportMode;
}

function isUnlocated(photo: Photo): boolean {
  return photo.lat === null || photo.lng === null;
}

function initialView(photos: Photo[]): { center: { lng: number; lat: number }; zoom: number } {
  const located = photos.filter((photo) => !isUnlocated(photo));
  if (located.length === 0) return DEFAULT_VIEW;

  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const photo of located) {
    const lng = photo.lng ?? 0;
    const lat = photo.lat ?? 0;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.4, 0.02);
  const zoom = clamp(Math.log2(2025 / span) - 0.6, 3.2, 12);
  return {
    center: { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 },
    zoom,
  };
}

export function SetupPanel({
  photos,
  onPhotosChange,
  incomingFiles,
  onIncomingConsumed,
  onStart,
  onBack,
}: SetupPanelProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [mapKind, setMapKind] = useState<MapKind>('fallback');
  const [dragOver, setDragOver] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MapController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<Photo[]>(photos);
  const selectedRef = useRef<string[]>(selected);
  const changeRef = useRef(onPhotosChange);
  const applyRef = useRef<(lng: number, lat: number) => void>(() => {});

  photosRef.current = photos;
  selectedRef.current = selected;
  changeRef.current = onPhotosChange;

  const locatedCount = useMemo(() => photos.filter((photo) => !isUnlocated(photo)).length, [photos]);
  const pendingCount = photos.length - locatedCount;
  const sorted = useMemo(() => [...photos].sort((a, b) => a.takenAt - b.takenAt), [photos]);

  /* ── 路段（交通工具） ─────────────────────────────────────── */
  const legs = useMemo<Leg[]>(() => {
    const located = sorted.filter((p) => p.lat !== null && p.lng !== null);
    const out: Leg[] = [];
    let carry: TransportMode = DEFAULT_TRANSPORT;
    for (let i = 0; i < located.length - 1; i += 1) {
      const from = located[i];
      const to = located[i + 1];
      // 显式设置优先，并成为后续的继承值——即使这一段短到不显示，用户的设置也不算丢
      if (from.transportToNext !== undefined) carry = normalizeTransport(from.transportToNext);
      const meters = haversine(from.lat as number, from.lng as number, to.lat as number, to.lng as number);
      if (meters < LEG_MIN_METERS) continue;
      out.push({ from, to, km: meters / 1000, mode: carry });
    }
    return out;
  }, [sorted]);

  const setTransport = useCallback(
    (photoId: string, mode: TransportMode) => {
      changeRef.current(
        photos.map((photo) => (photo.id === photoId ? { ...photo, transportToNext: mode } : photo)),
      );
    },
    [photos],
  );

  /* ── 地址落点 ──────────────────────────────────────────────── */
  applyRef.current = (lng: number, lat: number) => {
    const ids = selectedRef.current;
    const targets =
      ids.length > 0
        ? ids.filter((id) => photosRef.current.some((photo) => photo.id === id))
        : photosRef.current.filter(isUnlocated).slice(0, 1).map((photo) => photo.id);
    if (targets.length === 0) return;

    const set = new Set(targets);
    const fan = targets.length > 1;
    const next = photosRef.current.map((photo) => {
      if (!set.has(photo.id)) return photo;
      const index = targets.indexOf(photo.id);
      const offset = fan ? index * BATCH_FAN_DEG : 0;
      return {
        ...photo,
        lat: clamp(lat + offset * 0.6, -85, 85),
        lng: lng + offset,
        locationSource: 'manual' as const,
        placeName: photo.placeName ?? '手工定位',
      };
    });
    changeRef.current(next);

    const remaining = next.filter(isUnlocated);
    setSelected(remaining.length > 0 ? [remaining[0].id] : []);
  };

  /* ── 导入照片（串行，绝不 Promise.all 全解码） ──────────────── */
  const importFiles = useCallback(async (files: File[]): Promise<void> => {
    const accepted = files.filter(
      (file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name),
    );
    if (accepted.length === 0) return;

    setImporting({ done: 0, total: accepted.length });
    const added: Photo[] = [];

    for (let i = 0; i < accepted.length; i += 1) {
      const file = accepted[i];
      const exif = await readExif(file);
      const thumb = await makeThumb(file, 480, exif.orientation);
      const hasGps = exif.lat !== null && exif.lng !== null;
      const lat = hasGps ? exif.lat : null;
      const lng = hasGps ? exif.lng : null;

      added.push({
        id: `local-${file.lastModified}-${i}-${file.name}`,
        thumb: thumb ?? undefined,
        lat,
        lng,
        takenAt: exif.takenAt ?? (file.lastModified > 0 ? file.lastModified : Date.now()),
        placeName: hasGps ? 'EXIF 定位' : undefined,
        locationSource: hasGps ? 'exif' : 'none',
      });
      setImporting({ done: i + 1, total: accepted.length });
    }

    const next = [...photosRef.current, ...added].sort((a, b) => a.takenAt - b.takenAt);
    changeRef.current(next);
    setImporting(null);
    const firstPending = next.find(isUnlocated);
    setSelected(firstPending ? [firstPending.id] : []);
  }, []);

  /* ── 外部拖入 / 选中的文件 ─────────────────────────────────── */
  useEffect(() => {
    if (incomingFiles.length === 0) return;
    onIncomingConsumed();
    void importFiles(incomingFiles);
  }, [incomingFiles, importFiles, onIncomingConsumed]);

  /* ── 地图（可交互） ───────────────────────────────────────── */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // 每次挂载都用全新的容器节点，避免高德在 StrictMode 二次挂载时复用旧容器报错
    const inner = document.createElement('div');
    inner.style.cssText = 'position:absolute;inset:0;';
    host.appendChild(inner);

    let disposed = false;
    const view = initialView(photosRef.current);
    const gcj = wgs84ToGcj02(view.center.lng, view.center.lat);

    void createBaseMap(inner, {
      center: gcj,
      zoom: view.zoom,
      interactive: true,
      paintFallback: true,
    }).then((controller) => {
      if (disposed) {
        controller.destroy();
        return;
      }
      controllerRef.current = controller;
      setMapKind(controller.kind);
      controller.onClick((lng, lat) => {
        const target =
          controller.coordinateSystem === 'gcj02' ? gcj02ToWgs84(lng, lat) : { lng, lat };
        applyRef.current(target.lng, target.lat);
      });
    });

    return () => {
      disposed = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
      if (inner.parentElement) inner.parentElement.removeChild(inner);
    };
  }, []);

  /* ── 自动选中第一张待定位 ──────────────────────────────────── */
  useEffect(() => {
    if (selected.length > 0) return;
    const firstPending = photos.find(isUnlocated);
    if (firstPending) setSelected([firstPending.id]);
  }, [photos, selected.length]);

  const handleCellClick = (event: MouseEvent<HTMLButtonElement>, id: string): void => {
    const multi = event.metaKey || event.ctrlKey || event.shiftKey;
    setSelected((prev) => {
      if (!multi) return [id];
      return prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
    });
  };

  const selectAllPending = (): void => {
    const ids = photos.filter(isUnlocated).map((photo) => photo.id);
    setSelected(ids);
  };

  const handlePickFiles = (): void => {
    fileInputRef.current?.click();
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length > 0) void importFiles(files);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) void importFiles(files);
  };

  const selectedSet = new Set(selected);

  return (
    <div className="setup">
      <div
        className="setup-side"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={dragOver ? { outline: '1px dashed rgba(34,211,238,0.5)', outlineOffset: -10 } : undefined}
      >
        <div className="setup-head">
          <div className="setup-title">
            <button type="button" className="btn btn-ghost" style={{ height: 24, padding: '0 8px' }} onClick={onBack}>
              ← 返回
            </button>
            <span style={{ color: 'var(--muted)', fontSize: 10, letterSpacing: '0.24em' }}>SETUP</span>
          </div>
          <div className="setup-sub">
            {photos.length === 0
              ? '还没有照片。导入后可以在地图上逐张补地点。'
              : pendingCount > 0
                ? `${pendingCount} 张缺少地点 · 共 ${photos.length} 张`
                : `全部 ${photos.length} 张都有地点`}
          </div>
          <div className="setup-tools">
            <button type="button" className="chip" onClick={handlePickFiles}>
              添加照片
            </button>
            {pendingCount > 0 ? (
              <button type="button" className="chip chip-warn" onClick={selectAllPending}>
                全选待定位 ({pendingCount})
              </button>
            ) : null}
            {selected.length > 0 ? (
              <button type="button" className="chip" onClick={() => setSelected([])}>
                清除选择 ({selected.length})
              </button>
            ) : null}
            {importing ? (
              <span className="chip" style={{ borderColor: 'rgba(34,211,238,0.4)' }}>
                导入中 {importing.done}/{importing.total}
              </span>
            ) : null}
          </div>
        </div>

        <div className="photo-grid">
          {sorted.length === 0 ? (
            <div className="setup-hint" style={{ gridColumn: '1 / -1' }}>
              把照片拖到这里，或者点「添加照片」。
              <br />
              <br />
              会自动读取 EXIF 里的 <b>GPS</b> 与<b>拍摄时间</b>。传到电脑后 GPS 常被平台抹掉，
              这种情况会标成「待定位」，选中后在地图上点一下即可。
            </div>
          ) : (
            sorted.map((photo) => {
              const pending = isUnlocated(photo);
              const isSelected = selectedSet.has(photo.id);
              return (
                <button
                  type="button"
                  key={photo.id}
                  className={`photo-cell${isSelected ? ' is-selected' : ''}${pending ? ' is-pending' : ''}`}
                  style={{ padding: 0, background: 'none' }}
                  onClick={(event) => handleCellClick(event, photo.id)}
                  title={pending ? '点击选中，再在地图上点一下补地点' : photo.placeName}
                >
                  <span
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      backgroundImage: photo.thumb ? `url(${photo.thumb})` : photo.gradient,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <span className={`photo-badge${pending ? '' : ' ok'}`}>
                    {pending ? '待定位' : photo.locationSource === 'manual' ? '手工' : 'EXIF'}
                  </span>
                  <span className="photo-cell-meta">
                    {formatDateDot(photo.takenAt)} {formatTimeHM(photo.takenAt)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {legs.length > 0 ? (
          <div className="legs">
            <div className="legs-head">
              每段路怎么走
              <span className="legs-sub">决定播放时那段轨迹的颜色与线型</span>
            </div>
            <div className="legs-list">
              {legs.map((leg) => (
                <div className="leg-row" key={leg.from.id}>
                  <div className="leg-title">
                    <span className="leg-from">{leg.from.placeName ?? '未命名'}</span>
                    <span className="leg-arrow">→</span>
                    <span className="leg-to">{leg.to.placeName ?? '未命名'}</span>
                    <span className="leg-km">{leg.km < 10 ? leg.km.toFixed(1) : Math.round(leg.km)} km</span>
                  </div>
                  <div className="leg-modes">
                    {TRANSPORT_MODES.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`leg-mode${leg.mode === mode ? ' is-on' : ''}`}
                        onClick={() => setTransport(leg.from.id, mode)}
                        title={TRANSPORT_STYLE[mode].hint}
                      >
                        {TRANSPORT_STYLE[mode].label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="setup-foot">
          <div className="setup-hint">
            选中照片 → 在地图上点击即可写入坐标
            {selected.length > 1 ? `（当前 ${selected.length} 张，点一次批量定位）` : ''}
            。<br />
            <b>Ctrl / Shift</b> 多选，<b>拖拽</b>平移，<b>滚轮</b>缩放。
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={locatedCount < 2}
            onClick={onStart}
            style={{ width: '100%' }}
          >
            开始旅程（{locatedCount} 张已定位）
          </button>
          {locatedCount < 2 ? (
            <div className="setup-hint" style={{ textAlign: 'center' }}>
              至少需要 2 张已定位的照片才能生成轨迹
            </div>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
      </div>

      <div className="setup-map">
        {mapKind === 'fallback' ? (
          <div className="topbar-note">底图未加载，已切换示意格网（可拖拽 / 滚轮缩放 / 点击取点）</div>
        ) : null}
        <div className="map-canvas-host" ref={hostRef} />
        <div className="map-hint panel">
          {selected.length > 0 ? (
            <span>
              点击地图为 <b>{selected.length}</b> 张照片写入地点
            </span>
          ) : (
            <span>先选中一张待定位的照片</span>
          )}
        </div>
      </div>
    </div>
  );
}
