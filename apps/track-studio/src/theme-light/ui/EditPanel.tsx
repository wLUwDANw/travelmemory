/** 编辑页（Edit，§7.1.1）：看照片、删照片、给「两个地点之间」选交通工具。
 *
 * 页面上必须诚实展示两条信息：
 * 1. 哪些照片**没有坐标** —— 它们不会出现在轨迹上（我们绝不伪造坐标）；
 * 2. 演示数据的话，明确写"演示路线，不是你的照片位置"。
 */

import { TRANSPORT_MODES, TRANSPORT_STYLE, type TransportMode } from '@travelmemory/trail';
import type { SystemPhoto } from '@travelmemory/photo-source';

import { DEMO_NOTE } from '../../core/demoRoute';
import { photosWithoutLocation, placeNameFromFileName } from '../../core/photoImport';

export interface EditPanelProps {
  photos: SystemPhoto[];
  /** photoId → 到下一张的交通工具 */
  transports: Record<string, TransportMode>;
  demoMode: boolean;
  busy: boolean;
  onRemove: (photoId: string) => void;
  onTransport: (photoId: string, mode: TransportMode) => void;
  /** W12-2a：进入「补全照片位置」页（仅在有照片缺坐标时才有入口）。 */
  onFixLocations: () => void;
  onGenerate: () => void;
  onBack: () => void;
}

export function EditPanel(props: EditPanelProps): JSX.Element {
  const { photos, transports, demoMode, busy } = props;
  const missing = photosWithoutLocation(photos);
  const locatedCount = photos.length - missing.length;
  const canGenerate = locatedCount >= 2 && !busy;

  /* 空状态之一：一张照片都没有（用户把列表删空了）。
   *
   * 为什么要在这一页拦：原实现只留下一个禁用按钮 + 「至少需要 2 张带位置的照片」，
   * 用户无法区分「没照片」和「有照片但都没坐标」—— 两种空的原因不同，下一步也不同。
   * 这里与深色版 `.empty` 用同一套结构：标题说事实，说明说原因，动作给出路。 */
  if (photos.length === 0) {
    return (
      <div className="panel">
        <header className="panel-head">
          <div>
            <h1>照片与路段</h1>
            <p className="lead">照片只存在内存里，关掉页面即清空。</p>
          </div>
        </header>

        <div className="empty">
          <p className="empty-title">还没有照片</p>
          <p className="empty-body">
            这一页只处理你刚选进来的照片。现在列表是空的，生成不了轨迹，回去重新选一批吧。
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={props.onBack}>
              重新选照片
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <h1>照片与路段</h1>
          <p className="lead">
            {missing.length === 0
              ? `共 ${photos.length} 张，全部带位置信息。`
              : locatedCount === 0
                ? `共 ${photos.length} 张，都还没有位置信息 —— 补完才能生成轨迹。`
                : `共 ${photos.length} 张，其中 ${locatedCount} 张带位置信息；另外 ${missing.length} 张没有位置信息，不会出现在轨迹上。`}
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={props.onBack}>
          重新选照片
        </button>
      </header>

      {demoMode ? <p className="hint hint-strong">{DEMO_NOTE}</p> : null}

      {/* 空状态之二：有照片、但一张带坐标的都没有。
          这不是"差几张"，而是"这条轨迹还画不出来"，所以用提示条而不是一行 hint。 */}
      {locatedCount === 0 ? (
        <div className="notice notice-warn" role="status">
          <p className="notice-title">这 {photos.length} 张照片都没有位置信息</p>
          <p className="notice-body">
            点下面的「补全位置」逐张在地图上点选，或回到相册重新选带 GPS 的照片。
          </p>
        </div>
      ) : missing.length > 0 ? (
        <p className="hint">
          没有位置信息的照片已标为「待定位」：点上面的「补全位置」，或在拍照时开启定位。
        </p>
      ) : null}

      {/* W12-2a：缺坐标的入口。只在真的缺坐标时出现 ——
          没有缺项时挂一个点不动的按钮，比不挂更让人困惑。 */}
      {missing.length > 0 ? (
        <div className="panel-action">
          <button type="button" className="btn btn-tiny" onClick={props.onFixLocations}>
            {missing.length} 张照片缺位置，点击补全
          </button>
        </div>
      ) : null}

      <ol className="photo-list">
        {photos.map((photo, index) => {
          const noLocation =
            typeof photo.lat !== 'number' ||
            !Number.isFinite(photo.lat) ||
            typeof photo.lng !== 'number' ||
            !Number.isFinite(photo.lng);
          const next = photos[index + 1];
          return (
            <li key={photo.id} className="photo-item">
              <img className="photo-thumb" src={photo.thumbnailDataUrl} alt="" width={64} height={64} />
              <div className="photo-meta">
                <div className="photo-name">{placeNameFromFileName(photo.name)}</div>
                <div className="photo-sub">
                  {photo.takenAt ? photo.takenAt.replace('T', ' ').slice(0, 16) + ' UTC' : '无拍摄时间'}
                  {noLocation ? (
                    <span className="badge badge-warn" title="没有 EXIF 坐标，不会出现在轨迹上">
                      待定位
                    </span>
                  ) : null}
                </div>
              </div>

              {next ? (
                <label className="photo-transport">
                  <span>到下一段</span>
                  <select
                    value={transports[photo.id] ?? 'drive'}
                    onChange={(event) =>
                      props.onTransport(photo.id, event.target.value as TransportMode)
                    }
                  >
                    {TRANSPORT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {TRANSPORT_STYLE[mode].label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="photo-transport photo-transport-end">终点</span>
              )}

              <button
                type="button"
                className="btn btn-tiny"
                onClick={() => props.onRemove(photo.id)}
                aria-label={`移除 ${photo.name}`}
              >
                移除
              </button>
            </li>
          );
        })}
      </ol>

      <footer className="panel-foot">
        {/* 主按钮始终叫「生成轨迹（N 张带位置）」：深色版是「开始旅程（N 张已定位）」，
            两版都用"动作 + 数量"的形状，用户不用先读禁用原因才知道按钮干什么。 */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canGenerate}
          onClick={props.onGenerate}
        >
          生成轨迹（{locatedCount} 张带位置）
        </button>
        {locatedCount < 2 ? (
          <p className="hint hint-inline">
            至少需要 2 张带位置的照片，还差 {2 - locatedCount} 张。
          </p>
        ) : null}
      </footer>
    </div>
  );
}
