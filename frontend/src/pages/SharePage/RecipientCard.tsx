/** 收件人选择 + 生成信物。
 *
 * ## 为什么默认勾（且可以取消）"我自己"
 *
 * 单窗口演示要靠它跑完"打包 → 下载 → 导入 → 验签 → 上地图"闭环；
 * 同时它也是真实场景的一半：把旅行发给自己留作备份。
 * 它现在是可取消的普通选项 —— 写死收件人 = 只能自娱自乐，那不是产品。
 *
 * ## 为什么一个没收件人时禁用按钮
 *
 * 零收件人的包没有任何 `wrappedKeys`，谁都解不开，是个纯粹的废品。
 * 生成出来再让用户发现是浪费一次下载。
 */

import { Download, Loader2, Send } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { TAG_LABELS, type Tag } from '../../types/share';
import type { Friend } from './friends';

export interface RecipientCardProps {
  selfSelected: boolean;
  onToggleSelf: (next: boolean) => void;
  selfLabel: string;
  friends: Friend[];
  selectedFriendIds: string[];
  onToggleFriend: (id: string, next: boolean) => void;
  recipientCount: number;
  generating: boolean;
  onGenerate: () => void;
  /** 上一轮打包的降级记录（地理模糊失败的地点）。没有就传 null。 */
  warnings: string[];
  /** 这份旅程用到的语义标签（已按六类校验过）。展示用，让发送方在打包前看清分类。 */
  semanticTags?: Tag[];
}

export function RecipientCard({
  selfSelected,
  onToggleSelf,
  selfLabel,
  friends,
  selectedFriendIds,
  onToggleFriend,
  recipientCount,
  generating,
  onGenerate,
  warnings,
  semanticTags,
}: RecipientCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="h-5 w-5 text-primary" />
          生成信物
          <Badge variant="secondary">内置示例旅程</Badge>
        </CardTitle>
        <CardDescription>
          用内置的洛阳两日示例打包：地点坐标会先做地理模糊，只有被勾选的收件人能解开。
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">收件人</p>

          <div className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
            <Checkbox
              id="recipient-self"
              checked={selfSelected}
              onCheckedChange={(checked) => onToggleSelf(checked === true)}
            />
            <Label htmlFor="recipient-self" className="flex-1 cursor-pointer leading-snug">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">我自己</span>
                <Badge variant="outline">本机身份</Badge>
                <span className="font-mono text-xs text-muted-foreground">{selfLabel}</span>
              </span>
            </Label>
          </div>

          {friends.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground">
              还没有好友可选 —— 先在上面的「好友」卡片里添加，就能把信物同时发给他们。
            </p>
          ) : (
            friends.map((friend) => {
              const inputId = `recipient-${friend.id}`;
              return (
                <div
                  key={friend.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                >
                  <Checkbox
                    id={inputId}
                    checked={selectedFriendIds.includes(friend.id)}
                    onCheckedChange={(checked) => onToggleFriend(friend.id, checked === true)}
                  />
                  <Label htmlFor={inputId} className="flex-1 cursor-pointer leading-snug">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{friend.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {friend.pubkey.slice(0, 24)}…
                      </span>
                    </span>
                  </Label>
                </div>
              );
            })
          )}
        </div>

        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}

        {semanticTags && semanticTags.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              语义标签
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {semanticTags.map((tag) => (
                <Badge key={tag} variant="secure">
                  {TAG_LABELS[tag]}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              分类随信物一起打包（它是明文，参与承诺校验）。分类算法在后端语义服务，
              前端只做六类校验与保底。
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={generating || recipientCount === 0} onClick={onGenerate}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {generating ? '生成中…' : '生成并下载 .trailshare'}
          </Button>
          <p className="text-xs text-muted-foreground">
            {recipientCount === 0
              ? '至少勾选一个收件人，否则这包谁也解不开。'
              : `已勾选 ${recipientCount} 人，生成的文件会直接下载到本地。`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
