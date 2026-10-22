import { useState } from 'react';
import type { EvidenceBlock } from '../../types/agent';

/** 证据列表。
 *
 * 编号 `[n]` 与回答里的引用一一对应 —— 这是"点 [1] 就能看到证据"的基础。
 * 阶段 6 接上地图后，点编号会变成「地图飞到那张照片并高亮」，
 * 但现在先把"引用能对应到原文"这条链路做实。
 */
export function EvidenceList({ blocks }: { blocks: EvidenceBlock[] }) {
  const [open, setOpen] = useState(false);
  if (!blocks.length) return null;

  return (
    <div className="evidence">
      <button className="evidence-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '收起' : '展开'}证据（{blocks.length}）
      </button>
      {open && (
        <ol className="evidence-list">
          {blocks.map((block) => (
            <li key={block.ref}>
              <code>[{block.index}]</code>{' '}
              <span className="ref">{block.ref}</span>{' '}
              <span className="score">score={block.score.toFixed(3)}</span>
              <p>{block.content}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
