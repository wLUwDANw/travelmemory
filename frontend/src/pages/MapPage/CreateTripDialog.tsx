/** 「新建旅程」对话框。
 *
 * ## 诚实说明：这一版**不能**真的建出一条空旅程
 *
 * 后端目前只有 `GET /api/v1/trips`（读），没有任何写入接口 —— `backend/app/api/v1/trips.py`
 * 里只有一个 `@router.get("")`。行程是后端 `services/trip_cluster.py` 在**导入照片之后**
 * 按「时间相邻 + 空间相邻」聚类出来的，库里没有 `POST /trips` 可以调。
 *
 * 所以这里的确认按钮是**禁用**的，并且把原因写在按钮旁边：
 * 「空旅程需要先导入照片」。**不伪造一个假的『已创建』** —— 一个点下去显示创建成功、
 * 刷新之后什么都没有的按钮，比一个禁用并说明原因的按钮糟糕得多。
 *
 * 等后端补上 `POST /api/v1/trips`，只需要把 `MANUAL_TRIP_ENDPOINT_READY` 翻成
 * `true` 并接上客户端方法，表单与校验都是现成的。
 */

import { useState } from 'react';
import { ImageDown, Info } from 'lucide-react';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

/** 后端是否有「新建空旅程」的写入接口。**当前没有**，见文件头。 */
export const MANUAL_TRIP_ENDPOINT_READY = false;

export interface CreateTripDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 「去导入照片」：关掉本对话框并拉起文件选择器。由 MapActionPanel 注入。 */
  onImportPhotos?: () => void;
}

const MAX_TITLE = 40;

export function CreateTripDialog({ open, onOpenChange, onImportPhotos }: CreateTripDialogProps) {
  const [title, setTitle] = useState('');

  const trimmed = title.trim();
  const confirmEnabled = MANUAL_TRIP_ENDPOINT_READY && trimmed.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建旅程</DialogTitle>
          <DialogDescription>
            给这趟旅行起个名字。确认前需要先有照片。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="trip-title">旅程标题</Label>
          <Input
            id="trip-title"
            value={title}
            maxLength={MAX_TITLE}
            placeholder="例如：洛阳两日"
            onChange={(event) => setTitle(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {trimmed.length}/{MAX_TITLE}
          </p>
        </div>

        <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            <strong>空旅程需要先导入照片。</strong>
            后端目前只能读取行程（<code>GET /api/v1/trips</code>），还没有「新建空旅程」接口；
            行程是在导入照片后由后端按时间与地点聚类出来的，标题也由后端给出。
            先导入照片，行程会自动出现在这里。
          </p>
        </div>

        <DialogFooter>
          {onImportPhotos && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                onImportPhotos();
              }}
            >
              <ImageDown className="h-4 w-4" />
              去导入照片
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <Button disabled={!confirmEnabled} title={confirmEnabled ? '' : '空旅程需要先导入照片'}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
