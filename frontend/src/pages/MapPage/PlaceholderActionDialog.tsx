/** 占位动作弹窗：「新建旅程」/「导入照片」共用。
 *
 * ## 为什么两个按钮共用一句文案
 *
 * 人类实测的反馈是"地图页没有导入入口"—— 缺的是**入口**，不是文案。
 * 所以在功能真的接进来之前，两个入口都给一句实话占位，避免做出一个
 * 点了没反应（或假装有反应）的按钮。文案由人类逐字确认，改动前先问。
 */

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { toast } from '../../components/ui/use-toast';

/** 占位正文。逐字采用人类给定文案，不要改写/扩写。 */
export const PLACEHOLDER_NOTICE = '照片导入功能将在后续接入本地文件';

export interface PlaceholderActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 弹窗标题（「新建旅程」/「导入照片」）。 */
  title: string;
  /** 标题下的一行说明。 */
  description?: string;
}

export function PlaceholderActionDialog({ open, onOpenChange, title, description }: PlaceholderActionDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // 打开时同步一条 toast：Dialog 关掉之后提示还在，用户不会以为点击没生效
        if (next) toast({ title, description: PLACEHOLDER_NOTICE });
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? '该功能尚未接入'}</DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-relaxed text-muted-foreground">{PLACEHOLDER_NOTICE}</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button>知道了</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
