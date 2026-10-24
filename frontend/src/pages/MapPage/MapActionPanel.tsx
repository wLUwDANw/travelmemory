/** 地图左上角悬浮操作面板（行程操作 + 图层控制 + 真实照片导入）。
 *
 * ## 为什么是悬浮而不是侧栏
 *
 * 地图页的主体就是地图本身，一块常驻侧栏会永久吃掉 ~280px 宽度，
 * 手机上是灾难。悬浮面板叠在地图上（`absolute left-4 top-4 z-10`），
 * 手机/小屏时再收起成标题条，地图始终是主角。
 *
 * ## 数据是纯逻辑层的
 * 图层开关只负责"点了什么"，可见性状态与渲染计划一律由 `layers.ts` 的
 * `toggleLayer()` / `planMapRender()` 决定；导入状态机在 `photoImport.ts`，
 * 行程转地图点在 `tripPoints.ts`。这里只留下必须碰 DOM 的那点副作用：
 * 隐藏的 file input、缩略图解码、multipart 上传。
 */

import { useRef, useState, type ChangeEvent } from 'react';
import { ChevronDown, ChevronUp, ImageDown, Layers, Plus } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { Separator } from '../../components/ui/separator';
import { toast } from '../../components/ui/use-toast';
import { cn } from '../../lib/utils';
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
import type { LayerVisibility } from './layers';

export interface MapActionPanelProps {
  visibility: LayerVisibility;
  /** 切图层。由页面用 `toggleLayer()` 包一层 setState 后传进来。 */
  onToggleLayer: (layer: keyof LayerVisibility) => void;
  /** 「分享地点」后面的计数（Badge）。 */
  shareCount: number;
  /** 「我的照片」图层里真正上地图的张数（有坐标的）。 */
  photoCount: number;
  /** 行程里的照片总数（含没有坐标的）。 */
  photoTotal: number;
  /** 导入成功后通知上层重新拉行程列表。 */
  onTripsChanged?: () => void;
  className?: string;
}

/** 一份文件的内容指纹（sha256 hex）。
 *
 * 用来把「按文件下标排好的缩略图」精确对上后端返回的照片 ——
 * 后端 `photos` 不含重复与失败的那些，下标会整体错位。见 `assignThumbs`。
 *
 * `crypto.subtle` 只在**安全上下文**（https / localhost）存在，局域网 http 下是
 * `undefined`；此时返回 null，由 `assignThumbs` 退回下标配对。
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

export function MapActionPanel({
  visibility,
  onToggleLayer,
  shareCount,
  photoCount,
  photoTotal,
  onTripsChanged,
  className,
}: MapActionPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome>(IDLE_IMPORT);

  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = outcome.status === 'uploading';

  /** 拉起系统文件选择器。隐藏 input 必须挂在文档里，否则部分浏览器不处理 click()。 */
  const pickFiles = (): void => inputRef.current?.click();

  async function runImport(files: File[]): Promise<void> {
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

      toast({ variant: 'success', title: '导入完成', description: done.message });
      onTripsChanged?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOutcome((prev) => reduceImportState(prev, { type: 'error', message }));
      toast({ variant: 'destructive', title: '导入失败', description: message });
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = filterImageFiles(Array.from(event.target.files ?? []));
    // 必须清空：否则连着选同一个文件不会触发第二次 change（浏览器经典坑）
    event.target.value = '';

    if (files.length === 0) {
      toast({ variant: 'destructive', title: '导入失败', description: '请选择图片文件' });
      return;
    }
    void runImport(files);
  }

  return (
    <div
      className={cn(
        'absolute left-4 top-4 z-10 w-64 rounded-xl border bg-white/85 shadow-lg backdrop-blur transition-shadow duration-200 hover:shadow-xl',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="text-sm font-semibold tracking-tight">行程操作</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起操作面板' : '展开操作面板'}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          <div className="grid gap-2">
            <Button size="sm" className="w-full justify-start" onClick={() => setTripDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              新建旅程
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              disabled={uploading}
              onClick={pickFiles}
            >
              <ImageDown className="h-4 w-4" />
              {uploading ? '上传中…' : '导入照片'}
            </Button>
          </div>

          {outcome.status === 'error' && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs leading-relaxed text-destructive">
              {outcome.message}
            </p>
          )}
          {outcome.status === 'done' && (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs leading-relaxed text-emerald-900">
              {outcome.message}
            </p>
          )}

          {/* 隐藏的文件选择器。挂在文档里但不占布局：
              `pickPhotos()` 会自己弹一个选择器，而这里要的是"页面上的按钮 → 选文件 → 立刻上传"，
              所以走自己的 input + `adoptFiles()` 通道。 */}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleChange}
          />

          <Separator />

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
              {/* pl-7 = checkbox(16px) + gap(12px)，让说明文字与文字标签左对齐 */}
              <p className="pl-7 pt-1 text-xs text-muted-foreground">
                {photoTotal === 0
                  ? '导入照片后，有坐标的会自动出现在这里'
                  : `共 ${photoTotal} 张，${photoCount} 张有坐标`}
              </p>
            </div>
          </div>
        </div>
      )}

      <CreateTripDialog
        open={tripDialogOpen}
        onOpenChange={setTripDialogOpen}
        onImportPhotos={pickFiles}
      />
    </div>
  );
}
