// @vitest-environment jsdom
/** VerifyCard 的渲染测试。
 *
 * 只覆盖两件事：空态长得对、注入结果后三条 Badge 的文案对。
 * 三态映射本身由 `verification.test.ts` 在 Node 环境下守着，这里不重复断言 ——
 * 渲染测试的价值在于"组件真的把状态画出来了"，而不是再算一遍逻辑。
 *
 * 用 `React.createElement` 而不是 JSX：`vite.config.ts` 的 `test.include` 只收
 * `src/**\/*.test.ts`（`.tsx` 不在内），而那份配置属于不许改动的文件。
 */

import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { UnpackView } from '../../types/share';
import { VerifyCard } from './VerifyCard';

afterEach(cleanup);

function allPassView(): UnpackView {
  return {
    ok: true,
    groups: [],
    from: { displayName: '小林', pubkey: 'ed25519:' + 'ab'.repeat(32) },
    shareId: 's_test0001',
    commitment: 'sha256:' + 'cd'.repeat(32),
    signature: 'ef'.repeat(32),
    chainSeq: 0,
    chainPrevHash: 'sha256:' + '00'.repeat(32),
    chainOk: true,
    chainNote: '链首记录（seq=0 且 prevHash 指向创世哈希），链路完整',
    report: {
      structureOk: true,
      signatureOk: true,
      commitmentOk: true,
      chainOk: true,
      chainNote: '链首记录（seq=0 且 prevHash 指向创世哈希），链路完整',
    },
    canAccept: true,
  };
}

describe('VerifyCard', () => {
  it('还没选文件时是空态：三条都是「未比对」', () => {
    render(createElement(VerifyCard, { cred: { privHex: '11'.repeat(32) } }));

    expect(screen.getByText('把信物文件拖到这里')).toBeTruthy();
    expect(screen.getAllByText('未比对')).toHaveLength(3);
    // 三条检查项标题都在
    expect(screen.getByText('来源真实')).toBeTruthy();
    expect(screen.getByText('内容未篡改')).toBeTruthy();
    expect(screen.getByText('链锚定状态')).toBeTruthy();
  });

  it('注入全绿的解包结果后：三条 Badge 都是「通过」', () => {
    render(
      createElement(VerifyCard, {
        cred: { privHex: '11'.repeat(32) },
        externalResult: allPassView(),
      }),
    );

    expect(screen.getAllByText('通过')).toHaveLength(3);
    expect(screen.getByText(/无需信任服务器/)).toBeTruthy();
    expect(screen.getByText('小林')).toBeTruthy();
  });
});
