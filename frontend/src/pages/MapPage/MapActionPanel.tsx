/** 地图左上角悬浮操作面板（行程操作 + 图层控制）。
 *
 * ## 为什么是悬浮而不是侧栏
 *
 * 地图页的主体就是地图本身，一块常驻侧栏会永久吃掉 ~280px 宽度，
 * 手机上是灾难。悬浮面板叠在地图上（`absolute left-4 top-4 z-10`），
 * 手机/小屏时再收起成标题条，地图始终是主角。
 *
 * ## 数据是纯逻辑层的
 * 图层开关只负责"点了什么"，可见性状态与渲染计划一律由 `layers.ts` 的
 * `toggleLayer()` / `planMapRender()` 决定 —— 这里不重新实现一遍。
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, ImageDown, Layers, Plus } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { Separator } from '../../components/ui/separator';
import { cn } from '../../lib/utils';
import { PlaceholderActionDialog } from './PlaceholderActionDialog';
import type { LayerVisibility } from './layers';

export interface MapActionPanelProps {
  visibility: LayerVisibility;
  /** 切图层。由页面用 `toggleLayer()` 包一层 setState 后传进来。 */
  onToggleLayer: (layer: keyof LayerVisibility) => void;
  /** 「分享地点」后面的计数（Badge）。 */
  shareCount: number;
  className?: string;
}

export function MapActionPanel({ visibility, onToggleLayer, shareCount, className }: MapActionPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);

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
              onClick={() => setPhotoDialogOpen(true)}
            >
              <ImageDown className="h-4 w-4" />
              导入照片
            </Button>
          </div>

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
                  <Badge variant="muted">未接入</Badge>
                </Label>
              </div>
              {/* pl-7 = checkbox(16px) + gap(12px)，让说明文字与文字标签左对齐 */}
              <p className="pl-7 pt-1 text-xs text-muted-foreground">数据接入见复盘文档</p>
            </div>
          </div>
        </div>
      )}

      <PlaceholderActionDialog
        open={tripDialogOpen}
        onOpenChange={setTripDialogOpen}
        title="新建旅程"
        description="新建旅程流程仍在设计中"
      />
      <PlaceholderActionDialog
        open={photoDialogOpen}
        onOpenChange={setPhotoDialogOpen}
        title="导入照片"
        description="照片导入流程仍在设计中"
      />
    </div>
  );
}
