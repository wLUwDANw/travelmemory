/** 信物分享页：生成 → 下载 → 导入 → 验签 → 上地图。
 *
 * ## 这一页把整条链路接起来
 *
 * ```
 * [生成]   demoTrip() ──prepareShare(obfuscateLocation)──▶ pack ──▶ .trailshare 下载
 *              │                        ↑ 后端 POST /api/v1/privacy/obfuscate
 *              │                        └─ 失败 → 该地点不写坐标（绝不退化成原坐标）
 * [导入]   .trailshare ──unpackForViewer(我的种子)──▶ 验签/承诺报告 + 时间线
 *              └─ radius > 0 的地点 →「在地图上查看」→ MapPage 画半透明圈
 * ```
 *
 * ## 文件怎么分的
 *
 * 这一页的状态编排留在本文件（identity / friends / 收件人勾选 / 生成 / 导入），
 * 展示拆成四个子组件同目录下的兄弟文件：
 * `IdentityCard`（公钥与不可逆重置）、`FriendsCard`（通讯录）、
 * `RecipientCard`（收件人多选）、`ImportCard`（文件与验签报告）。
 * 拆分的理由不是"文件太短"，而是它们各自有一份**独立的关注点与失效场景**，
 * 混在一个 400 行的渲染函数里改一处必看错一处。
 *
 * ## 刻意不做（留给后续阶段 / 人类）
 *
 * - 旅程编辑器、可见性勾选树（TrailShare 规范 §8 的完整 UI）；
 * - 接受/拒绝落本地记忆与溯源边（`store/` 层未移植）；
 * - 照片压缩与相册选择（W6-3 的桥已就位，UI 未接）。
 *
 * 这些都不影响密码学与协议链路的可验证性 —— 那部分在 `services/crypto|share/`
 * 有 100+ 条单测守着。
 */

import { useCallback, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { toast } from '../../components/ui/use-toast';
import { obfuscateLocation } from '../../services/api/privacy';
import { prepareShare } from '../../services/share/prepare';
import { SHARE_FILE_EXTENSION } from '../../services/share/schema';
import { unpackForViewer } from '../../services/share/unpack';
import type { UnpackedPlace, UnpackViewerResult } from '../../types/share';
import { demoTrip, demoVisibility } from './demoTrip';
import { FriendsCard } from './FriendsCard';
import { IdentityCard } from './IdentityCard';
import { ImportCard } from './ImportCard';
import { clearIdentity, loadOrCreateIdentity } from './identity';
import { listFriends, type Friend } from './friends';
import { RecipientCard } from './RecipientCard';

export interface SharePageProps {
  /** 「在地图上查看」：把解出的地点交给地图页渲染模糊圈。 */
  onViewOnMap?: (places: UnpackedPlace[]) => void;
}

/** 把包落成文件下载。`Blob` + 临时 `<a>` 是最省事也最稳的一条路；
 *  注意 Firefox 要求 anchor 挂到文档上才会触发下载，`revokeObjectURL` 必须等 click 之后。 */
function downloadShareFile(pkg: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function SharePage({ onViewOnMap }: SharePageProps) {
  // 惰性初始化：localStorage 同步读，useState 初始函数只跑一次（StrictMode 双跑也安全）
  const [identity, setIdentity] = useState<ReturnType<typeof loadOrCreateIdentity>>(() => loadOrCreateIdentity());
  const [friends, setFriends] = useState<Friend[]>(() => listFriends());

  // 自己默认在收件人里（不信 "写死"，用户可以取消）
  const [selfSelected, setSelfSelected] = useState(true);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);

  const [generating, setGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [view, setView] = useState<UnpackViewerResult | null>(null);

  /** 勾选出来的收件人公钥（`bare hex` 或 `ed25519:` 前缀都行，`pack` 两种都认）。 */
  const recipientPubkeys = useMemo(() => {
    const friendKeys = selectedFriendIds
      .map((id) => friends.find((friend) => friend.id === id)?.pubkey)
      .filter((key): key is string => typeof key === 'string');
    return selfSelected ? [identity.pubkey, ...friendKeys] : friendKeys;
  }, [friends, identity.pubkey, selectedFriendIds, selfSelected]);

  /** 通讯录变了就重读，并顺手把已经不存在的好友从勾选里摘掉
   *  （留着一个幽灵 id 会让"勾选人数"和实际收件人对不上）。 */
  const refreshFriends = useCallback(() => {
    const next = listFriends();
    setFriends(next);
    setSelectedFriendIds((prev) => prev.filter((id) => next.some((friend) => friend.id === id)));
  }, []);

  const toggleFriend = useCallback((id: string, next: boolean) => {
    setSelectedFriendIds((prev) =>
      next ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((item) => item !== id),
    );
  }, []);

  const generate = useCallback(async () => {
    setGenerating(true);
    setWarnings([]);
    try {
      const result = await prepareShare(
        {
          groups: [
            {
              trip: demoTrip(),
              visibility: demoVisibility(),
              recipientPubkeys,
            },
          ],
          senderIdentity: identity,
          displayName: '我',
          chainEnabled: false,
        },
        { obfuscate: obfuscateLocation },
      );

      downloadShareFile(result.pkg, `${result.pkg.shareId}${SHARE_FILE_EXTENSION}`);
      setWarnings(result.warnings);
      toast({
        variant: 'success',
        title: '信物已生成',
        description: `${result.pkg.shareId}，收件人 ${recipientPubkeys.length} 人`,
      });
    } catch (exc) {
      // 失败不静默：打包失败通常意味着"这个文件没发出去"，用户必须立刻知道
      toast({
        variant: 'destructive',
        title: '生成失败',
        description: (exc as Error).message,
      });
    } finally {
      setGenerating(false);
    }
  }, [identity, recipientPubkeys]);

  const importFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setImportError(null);
      setView(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        setView(await unpackForViewer(parsed, { privHex: identity.privHex }));
      } catch (exc) {
        setImportError((exc as Error).message);
      } finally {
        setImporting(false);
      }
    },
    [identity.privHex],
  );

  /** 重置身份：种子没了就再也回不去，所以确认由 IdentityCard 的 Dialog 拦一道。 */
  const resetIdentity = useCallback(() => {
    clearIdentity();
    setIdentity(loadOrCreateIdentity());
    // 旧身份解过的东西对新身份没有意义，连带着清掉，避免"看着还在但已经读不了"的假象
    setView(null);
    setImportError(null);
    setWarnings([]);
    toast({
      title: '身份已重置',
      description: '新的密钥对已在本机生成，记得把新公钥重新发给好友。',
    });
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <header className="space-y-2">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
          信物分享
          <Badge variant="secure">端到端加密</Badge>
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          定向加密信物（TrailShare 协议 ts-2026.4）：只有指定收件人能解开；私钥只在本机，绝不上传。
        </p>
      </header>

      <IdentityCard identity={identity} onReset={resetIdentity} />

      <FriendsCard
        friends={friends}
        ownPubHex={identity.pubHex}
        onChanged={refreshFriends}
      />

      <RecipientCard
        selfSelected={selfSelected}
        onToggleSelf={setSelfSelected}
        selfLabel={`指纹 ${identity.pubHex.slice(0, 8)}`}
        friends={friends}
        selectedFriendIds={selectedFriendIds}
        onToggleFriend={toggleFriend}
        recipientCount={recipientPubkeys.length}
        generating={generating}
        onGenerate={() => void generate()}
        warnings={warnings}
      />

      <ImportCard
        importing={importing}
        error={importError}
        view={view}
        onFile={(file) => void importFile(file)}
        onViewOnMap={onViewOnMap}
      />
    </div>
  );
}
