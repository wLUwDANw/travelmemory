/** 「行程与相册」抽屉的内容（地图右侧滑出）。
 *
 * ## 与原来的 `MapActionPanel` 有什么不同
 *
 * 原来是左上角一块 `w-64` 的悬浮面板：四个区块（新建旅程 / 导入照片 / 图层 /
 * 说明）挤在 256px 里，说明文字被迫截断，行程列表根本放不下。
 * 产品化之后地图是全屏底层，这块内容搬进右侧抽屉，宽度与高度都够，
 * 于是可以把**行程列表**这个真正该被看到的东西放进来 ——
 * 那是"我到底有哪些旅程"的唯一入口，之前它压根不存在。
 *
 * ## 职责边界
 *
 * 本组件只负责"展示 + 发起动作"：
 *   - 选行程、切图层 → 上报给 MapPage（地图归它管）；
 *   - 导入照片 → 自己走完（选文件 → 缩略图 → 上传 → 通知上层刷新）；
 *   - 飞视野 → 也是通知上层，因为地图句柄在 MapPage 手里。
 * 它**不碰地图 API**，所以在 Node 里也能被单测覆盖（见 `importFlow.test.ts`）。
 */

import { type ChangeEvent, useCallback, useRef, useState } from 'react';
import { ImageDown, Layers, Loader2, MapPin, MapPinOff, Pencil, Plus, Route } from 'lucide-react';

import type { TripView } from '../../services/api/trips';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { Separator } from '../../components/ui/separator';
import { toast } from '../../components/ui/use-toast';
import { importPhotos } from '../../services/api/photos';
import { resolveNativeBridge } from '../../services/native';
import {
  IDLE_IMPORT,
  THUMB_MAX_EDGE,
  assignThumbs,
  filterImageFiles,
  reduceImportState,
  type ImportOutcome,
} from './photoImport';
import { CreateTripDialog } from './CreateTripDialog';
import { RenameTripDialog } from './RenameTripDialog';
import type { LayerVisibility } from './layers';

export interface TripDrawerProps {
  trips: readonly TripView[];
  visibility: LayerVisibility;
  onToggleLayer: (layer: keyof LayerVisibility) => void;
  /** 「分享地点」图层的点数（信物解出来的）。 */
  shareCount: number;
  /** 导入成功后通知上层：刷新行程列表 + 把地图视野飞到新行程。 */
  onTripsChanged: () => void | Promise<void>;
  /** 当前选中的行程 id（地图上高亮）。null = 没有选中。 */
  selectedTripId: string | null;
  onSelectTrip: (id: string | null) => void;
}

export function TripDrawer({
  trips,
  visibility,
  onToggleLayer,
  shareCount,
  onTripsChanged,
  selectedTripId,
  onSelectTrip,
}: TripDrawerProps) {
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TripView | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome>(IDLE_IMPORT);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const uploading = outcome.status === 'uploading';
  const photoCount = trips.reduce(
    (sum, trip) => sum + trip.items.filter((item) => typeof item.lat === 'number').length,
    0,
  );
  const photoTotal = trips.reduce(
    (sum, trip) => sum + new Set(trip.items.map((item) => item.id)).size,
    0,
  );

  const pickFiles = useCallback(() => inputRef.current?.click(), []);

  const runImport = useCallback(
    async (files: File[]) => {
      setOutcome((prev) => reduceImportState(prev, { type: 'start' }));
      try {
        const bridge = resolveNativeBridge();

        // 缩略图与指纹都允许单张失败：一张图解码不了不该让整批导入挂掉，
        // 后端那边本来就有一个 `failed` 计数器负责这类文件。
        const assets = bridge.photos.adoptFiles?.(files) ?? [];
        const thumbs = await Promise.all(
          assets.map((asset) =>
            bridge.photos.readThumb(asset.id, THUMB_MAX_EDGE).then(
              (bytes) => bytes,
              () => null,
            ),
          ),
        );
        const hashes = await Promise.all(files.map(sha256Hex));

        const result = await importPhotos(files);
        // 拿 reduce 的返回值去弹 toast，而不是读 `outcome`：后者这一轮 render 还没生效
        const done = reduceImportState(IDLE_IMPORT, { type: 'success', result });
        setOutcome(done);

        // 缩略图按**后端 photo id** 存，后面「生成信物」就是按这个 id 取图
        await Promise.all(
          assignThumbs(result.photos, hashes, thumbs).map((entry) =>
            bridge.thumbs.put(entry.photoId, THUMB_MAX_EDGE, entry.bytes),
          ),
        );

        toast({
          variant: 'success',
          title: '导入完成',
          description: `成功导入 ${result.imported} 张照片，生成 ${result.tripIds.length} 个行程`,
        });
        await onTripsChanged();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setOutcome((prev) => reduceImportState(prev, { type: 'error', message }));
        toast({ variant: 'destructive', title: '导入失败', description: message });
      }
    },
    [onTripsChanged],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = filterImageFiles(Array.from(event.target.files ?? []));
      // 必须清空：否则连着选同一个文件不会触发第二次 change（浏览器经典坑）
      event.target.value = '';

      if (files.length === 0) {
        toast({ variant: 'destructive', title: '导入失败', description: '请选择图片文件' });
        return;
      }
      void runImport(files);
    },
    [runImport],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部 */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Route className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold tracking-tight">行程与相册</h2>
          <Badge variant="muted">{trips.length} 趟</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          导入照片后，后端按时间与地点自动聚类成行程；点一条行程可在地图上高亮。
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* 操作区 */}
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => setTripDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            新建旅程
          </Button>
          <Button variant="outline" size="sm" disabled={uploading} onClick={pickFiles}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
            {uploading ? '上传中…' : '导入照片'}
          </Button>
        </div>

        {outcome.status === 'error' && (
          <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs leading-relaxed text-destructive">
            {outcome.message}
          </p>
        )}
        {outcome.status === 'done' && (
          <p className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs leading-relaxed text-emerald-900">
            {outcome.message}
          </p>
        )}

        {/* 隐藏的文件选择器：挂在文档里但不占布局 */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={handleChange}
        />

        <Separator className="my-4" />

        {/* 图层开关 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            图层
          </div>

          <div className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-accent/60">
            <Checkbox
              id="layer-share"
              checked={visibility.share}
              onCheckedChange={() => onToggleLayer('share')}
            />
            <Label
              htmlFor="layer-share"
              className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-sm font-normal"
            >
              <span>分享地点</span>
              <Badge variant="secondary">{shareCount}</Badge>
            </Label>
          </div>

          <div className="rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-accent/60">
            <div className="flex items-center gap-3">
              <Checkbox
                id="layer-photo"
                checked={visibility.photo}
                onCheckedChange={() => onToggleLayer('photo')}
              />
              <Label
                htmlFor="layer-photo"
                className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-sm font-normal"
              >
                <span>我的照片</span>
                <Badge variant={photoCount > 0 ? 'secondary' : 'muted'}>
                  {photoCount > 0 ? photoCount : '暂无'}
                </Badge>
              </Label>
            </div>
            <p className="pl-7 pt-1 text-xs text-muted-foreground">
              {photoTotal === 0
                ? '导入照片后，有坐标的会自动出现在这里'
                : `共 ${photoTotal} 张，${photoCount} 张有坐标`}
            </p>
          </div>
        </div>

        <Separator className="my-4" />

        {/* 行程列表 */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">行程</div>

          {trips.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              还没有行程。点上面的「导入照片」或「新建旅程」开始。
            </p>
          ) : (
            <ul className="space-y-2">
              {trips.map((trip) => {
                const unlocated = trip.items.filter((item) => typeof item.lat !== 'number').length;
                const active = trip.id === selectedTripId;
                return (
                  <li key={trip.id}>
                    <button
                      type="button"
                      onClick={() => onSelectTrip(active ? null : trip.id)}
                      aria-pressed={active}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-all duration-150 ${
                        active
                          ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30'
                          : 'hover:bg-accent/60 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{trip.title}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            aria-label={`重命名行程 ${trip.title}`}
                            onClick={(event) => {
                              // 阻止冒泡：否则会同时触发卡片的"选中"，
                              // 用户只是想改个名字，地图却跟着高亮了一下
                              event.stopPropagation();
                              setRenameTarget(trip);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Badge variant={trip.source === 'manual' ? 'outline' : 'muted'}>
                            {trip.source === 'manual' ? '手工' : '聚类'}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{formatRange(trip.startedAt, trip.endedAt)}</span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {trip.items.length} 个地点
                        </span>
                        {unlocated > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-700">
                            <MapPinOff className="h-3 w-3" />
                            {unlocated} 个未定位
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <CreateTripDialog
        open={tripDialogOpen}
        onOpenChange={setTripDialogOpen}
        onImportPhotos={pickFiles}
        onCreated={() => void onTripsChanged()}
      />

      {/* 只在有目标时挂载：对话框内部的输入框要用当前标题预填，
          常驻组件会因为 useState 初值只读一次而一直显示第一次的名字。 */}
      {renameTarget && (
        <RenameTripDialog
          open
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null);
          }}
          tripId={renameTarget.id}
          currentTitle={renameTarget.title}
          onRenamed={() => void onTripsChanged()}
        />
      )}
    </div>
  );
}

/** 行程时间范围的人话形式。两端都缺时说「时间未知」而不是空串。 */
export function formatRange(startedAt: string | null, endedAt: string | null): string {
  const start = dayOf(startedAt);
  const end = dayOf(endedAt);
  if (!start && !end) return '时间未知';
  if (start && end) return start === end ? start : `${start} ~ ${end}`;
  return start ?? end ?? '时间未知';
}

/** 取 ISO 串的日期部分（YYYY-MM-DD）。非法或不是真实日期时返回 null。
 *
 *  为什么不能只查形状：`2026-13-99` 完全匹配 `\d{4}-\d{2}-\d{2}`，
 *  但它不是任何一天。这种值来自后端脏数据时会原样显示在行程卡片上，
 *  而用户看到"2026-13-99"只会以为产品坏了。
 *  所以形状对了之后还要过一次 `new Date`，并**反向比对**是否被滚动过
 *  （`2026-02-31` 会被 JS 静默滚成 `2026-03-03`，只查 isNaN 抓不到它）。
 */
export function dayOf(iso: string | null): string | null {
  if (!iso || iso.length < 10) return null;
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === day ? day : null;
}

/** 一份文件的内容指纹（sha256 hex）。
 *
 *  用来把「按文件下标排好的缩略图」精确对上后端返回的照片 ——
 *  后端 `photos` 不含重复与失败的那些，下标会整体错位。见 `assignThumbs`。
 *  `crypto.subtle` 只在**安全上下文**（https / localhost）存在，局域网 http 下是
 *  `undefined`；此时返回 null，由 `assignThumbs` 退回下标配对。
 */
async function sha256Hex(file: File): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}
