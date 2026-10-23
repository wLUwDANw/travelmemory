/** 信物分享页（W6-4 骨架）：生成 → 下载 → 导入 → 验签 → 上地图。
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
 * ## 刻意不做（留给后续阶段 / 人类）
 *
 * - 旅程编辑器、可见性勾选树、好友名单（TrailShare 规范 §8 的完整 UI）；
 * - 接受/拒绝落本地记忆与溯源边（`store/` 层未移植）；
 * - 照片压缩与相册选择（W6-3 的桥已就位，UI 未接）。
 *
 * 这些都不影响密码学与协议链路的可验证性 —— 那部分在 `services/crypto|share/`
 * 有 100+ 条单测守着。
 */

import { useCallback, useState } from 'react';
import type { UnpackedPlace } from '../../types/share';
import { obfuscateLocation } from '../../services/api/privacy';
import { prepareShare } from '../../services/share/prepare';
import { unpackForViewer } from '../../services/share/unpack';
import { SHARE_FILE_EXTENSION } from '../../services/share/schema';
import { clearIdentity, loadOrCreateIdentity } from './identity';
import { demoTrip, demoVisibility } from './demoTrip';

export interface SharePageProps {
  /** 「在地图上查看」：把解出的地点交给地图页渲染模糊圈。 */
  onViewOnMap?: (places: UnpackedPlace[]) => void;
}

export function SharePage({ onViewOnMap }: SharePageProps) {
  // 惰性初始化：localStorage 同步读，useState 初始函数只跑一次（StrictMode 双跑也安全）
  const [identity, setIdentity] = useState<ReturnType<typeof loadOrCreateIdentity>>(() => loadOrCreateIdentity());

  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [view, setView] = useState<Awaited<ReturnType<typeof unpackForViewer>> | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setGenMessage(null);
    try {
      // 收件人填自己：单窗口也能验证"打包 → 解包 → 模糊圈"全链路。
      // 真实分享时这里填好友的 Ed25519 公钥（bare hex 或带前缀都认）。
      const result = await prepareShare(
        {
          groups: [
            {
              trip: demoTrip(),
              visibility: demoVisibility(),
              recipientPubkeys: [identity.pubkey],
            },
          ],
          senderIdentity: identity,
          displayName: '我',
          chainEnabled: false,
        },
        { obfuscate: obfuscateLocation },
      );

      const blob = new Blob([JSON.stringify(result.pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${result.pkg.shareId}${SHARE_FILE_EXTENSION}`;
      anchor.click();
      URL.revokeObjectURL(url);

      const warned = result.warnings.length;
      setGenMessage(
        warned > 0
          ? `已生成 ${result.pkg.shareId}（${warned} 个地点模糊失败，已按规范原版打包，未写入坐标）`
          : `已生成 ${result.pkg.shareId}（地点坐标已模糊）`,
      );
    } catch (exc) {
      setGenMessage(`生成失败：${(exc as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }, [identity]);

  const importFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setImportError(null);
      setView(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const result = await unpackForViewer(parsed, { privHex: identity.privHex });
        setView(result);
      } catch (exc) {
        setImportError(`读取失败：${(exc as Error).message}`);
      } finally {
        setImporting(false);
      }
    },
    [identity],
  );

  const places: UnpackedPlace[] =
    view && view.ok ? view.groups.flatMap((group) => group.places) : [];

  return (
    <div className="share-page">
      <header className="share-header">
        <h1>信物分享</h1>
        <p className="hint">
          定向加密信物（TrailShare 协议 ts-2026.4）：只有指定收件人能解开；私钥只在本机，绝不上传。
        </p>
      </header>

      <section className="identity-card">
        <h2>我的身份</h2>
        <p>
          公钥指纹：<code>{identity.pubkey.slice(0, 16)}…</code>
        </p>
        <button
          onClick={() => {
            clearIdentity();
            setIdentity(loadOrCreateIdentity());
            setGenMessage('已重置身份');
          }}
        >
          重置身份
        </button>
      </section>

      <section className="share-generate">
        <h2>生成信物</h2>
        <p className="hint">用内置示例旅程（洛阳两日，一个地点带坐标）打包，收件人是本机身份。</p>
        <button disabled={generating} onClick={() => void generate()}>
          {generating ? '生成中…' : '生成并下载 .trailshare'}
        </button>
        {genMessage && <p className="gen-message">{genMessage}</p>}
      </section>

      <section className="share-import">
        <h2>导入信物</h2>
        <input
          type="file"
          accept=".trailshare,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
        {importing && <p>解析中…</p>}
        {importError && <p className="error-bar">{importError}</p>}
        {view && !view.ok && <p className="error-bar">{view.reason}</p>}
        {view && view.ok && (
          <div className="import-result">
            <p>
              来自：<strong>{view.from.displayName}</strong>（{view.from.pubkey.slice(0, 12)}…）
            </p>
            <p className="verify-row">
              验签 {view.report.signatureOk ? '✅' : '❌'} · 承诺{' '}
              {view.report.commitmentOk === null ? '—' : view.report.commitmentOk ? '✅' : '❌'} · 链{' '}
              {view.report.chainOk === null ? '—' : view.report.chainOk ? '✅' : '❌'}
            </p>
            {view.groups.map((group) => (
              <div key={group.groupId} className="timeline">
                {group.places.map((place) => (
                  <div key={place.placeId} className="place-card">
                    <div className="place-title">
                      {place.label ? `${place.label} · ` : ''}
                      {place.name}
                    </div>
                    <div className="place-meta">
                      {place.date} · {place.tag} · {place.intensity}
                    </div>
                    {typeof place.radius === 'number' && place.radius > 0 ? (
                      <div className="place-geo">模糊圈：半径约 {place.radius} 米（真实位置只在圈内某处）</div>
                    ) : null}
                    <div className="place-photos">{place.photos.length} 张照片</div>
                  </div>
                ))}
              </div>
            ))}
            {places.length > 0 && onViewOnMap && (
              <button onClick={() => onViewOnMap(places)}>在地图上查看{places.length > 0 ? `（${places.length} 个地点）` : ''}</button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
