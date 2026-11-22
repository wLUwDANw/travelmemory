// @vitest-environment jsdom
/** 「生成信物」读到**导入出来的**行程（而不是内置示例）。
 *
 * 这是阶段 6 最后一段断头路的验收：以前 SharePage 只能打包 `demoTrip()` 那份写死的
 * 洛阳两日，用户导入的照片无论如何进不了信物。这一份测试会在 jsdom 里真的点一次
 * 「生成并下载」，确认包是从后端行程数据打出来的。
 *
 * 两个必须手补的环境差异：jsdom 的 `crypto` 没有 `subtle`（AES-GCM / Ed25519 跑不起来），
 * 从 `node:crypto` 借一个；jsdom 也没有 `URL.createObjectURL`（文件下载用）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { SharePage } from './SharePage';
import { Toaster } from '../../components/ui/toaster';
import { setNativeBridge, resetNativeBridge } from '../../services/native';
import type { NativeBridge } from '../../types/native';
import type { TripView } from '../../services/api/trips';

/** 默认的 Web 桥在 jsdom 里是空的内存缓存，那样所有地点都会因为取不到字节被
 *  `hydrateTripPhotos` 丢掉，测不到打包的成功路径。 */
function bridgeWithThumbs(): NativeBridge {
  return {
    platform: 'web',
    photos: {
      platform: 'web',
      pickPhotos: async () => [],
      adoptFiles: (files) => files.map((_f, i) => ({ id: `asset-${i}`, width: 4, height: 3 })),
      readThumb: async () => new TextEncoder().encode('thumb').buffer,
    },
    permissions: { query: async () => 'granted', request: async () => 'granted' },
    thumbs: {
      get: async (assetId: string) => new TextEncoder().encode(`thumb-of-${assetId}`).buffer,
      put: async () => {},
      clear: async () => {},
      sizeHint: 1,
    },
  };
}

afterEach(() => {
  cleanup();
  resetNativeBridge();
  vi.unstubAllGlobals();
});

describe('SharePage 读到导入出来的行程', () => {
  it('默认选中的是导入的行程，并真的能打包成信物', async () => {
    // jsdom 的 crypto 没有 subtle，密码学那一层（AES-GCM / Ed25519）跑不起来。
    // specifier 拼出来而不是写死 `await import('node:crypto')`：本项目没装
    // `@types/node`（也不为此多一个依赖），写死会让 `tsc --noEmit` 直接红在
    // "Cannot find module 'node:crypto'"。运行时照常拿到 Node 的 webcrypto。
    const moduleId = ['node', 'crypto'].join(':');
    const { webcrypto } = (await import(/* @vite-ignore */ moduleId)) as { webcrypto: Crypto };
    const bufferModuleId = ['node', 'buffer'].join(':');
    const { Buffer: NodeBuffer } = (await import(/* @vite-ignore */ bufferModuleId)) as {
      Buffer: { from(values: number[]): Uint8Array };
    };

    /**
     * Node 20 的 WebCrypto 用 `instanceof` 判 BufferSource：jsdom realm 里
     * `new ArrayBuffer(...)` 出来的对象不是 Node 的实例，`importKey` 会直接抛
     * "2nd argument is not instance of ArrayBuffer, Buffer, TypedArray, or DataView"。
     * Node 24 的判型更宽松，所以这条测试**本地绿、CI 红**。
     *
     * 产品代码只跑在单 realm（浏览器），不需要这层；这里做的是**测试边界**适配：
     * 把入参拷成 Node 的 Buffer，Node 20 / 24 都认。
     */
    const toNodeBytes = (value: unknown): unknown => {
      const bytes =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)
            : null;
      return bytes === null ? value : NodeBuffer.from(Array.from(bytes));
    };

    /** 只替换算法对象里的 `iv`；CryptoKey / 布尔 / usages 数组原样传。 */
    const wrapSubtle = (subtle: SubtleCrypto): SubtleCrypto =>
      new Proxy(subtle, {
        get(target, key) {
          const original = Reflect.get(target, key) as unknown;
          if (typeof original !== 'function') return original;
          return (...args: unknown[]) => {
            const mapped = args.map((arg) => {
              if (arg !== null && typeof arg === 'object' && 'iv' in arg) {
                const copy = { ...(arg as Record<string, unknown>) };
                copy.iv = toNodeBytes((arg as { iv: unknown }).iv);
                return copy;
              }
              return toNodeBytes(arg);
            });
            return (original as (...inner: unknown[]) => unknown).apply(target, mapped);
          };
        },
      }) as SubtleCrypto;

    /**
     * `getRandomValues` 同样做一层：jsdom 的 Uint8Array 在 Node 20 上也可能被判型拒绝。
     * 让 Node 先填自己的数组，再拷回调用方的视图。
     */
    const bridgeCrypto = {
      subtle: wrapSubtle(webcrypto.subtle),
      getRandomValues<T extends ArrayBufferView>(out: T): T {
        const temp = new Uint8Array(out.byteLength);
        webcrypto.getRandomValues(temp);
        new Uint8Array(out.buffer as ArrayBuffer, out.byteOffset, out.byteLength).set(temp);
        return out;
      },
      ...(typeof webcrypto.randomUUID === 'function'
        ? { randomUUID: webcrypto.randomUUID.bind(webcrypto) }
        : {}),
    } as unknown as Crypto;

    Object.defineProperty(globalThis, 'crypto', { value: bridgeCrypto, configurable: true });

    /**
     * 成功信号用「真的触发了下载」而不是 toast 文案。
     *
     * toast 只有 5 秒寿命；CI 上第一次失败时，等待器在 40 秒后只报
     * 「找不到 信物已生成」，真正的异常早随 toast 一起消失了。
     * `downloadShareFile` 一定会先调 `URL.createObjectURL(blob)`，
     * 所以在这里把 blob 截下来 —— 它同时也是「打包真的产出了文件」的证据。
     */
    let downloaded: Blob | null = null;
    (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = (blob: Blob) => {
      downloaded = blob;
      return 'blob:mock';
    };
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};

    /** 同上：失败 toast 也会在 5 秒后消失，用观察器把文案留到超时之后。 */
    let failureText = '';
    const observer = new MutationObserver(() => {
      if (failureText) return;
      const text = document.body.textContent ?? '';
      const at = text.indexOf('生成失败');
      if (at >= 0) failureText = text.slice(at, at + 800);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });

    vi.stubGlobal('fetch', (async (url: string) => {
      if (String(url).includes('/privacy/obfuscate')) {
        return new Response(
          JSON.stringify({ lat: 34.57, lng: 112.48, radius: 800, mode: 'approx', epsilon: 1, coord_system: 'WGS84' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch);

    const trips: TripView[] = [
      {
        id: 't-real', title: '我的洛阳行', startedAt: '2026-10-01T00:00:00Z', endedAt: null,
        source: 'cluster', itemCount: 1,
        items: [
          { id: 'i1', photoId: 'ph1', takenAt: '2026-10-01T02:00:00Z', lat: 34.5636, lng: 112.4699, semanticTag: 'heritage', semanticLabel: '龙门石窟' },
        ],
      },
    ];
    setNativeBridge(bridgeWithThumbs());
    render(React.createElement(React.Fragment, null, React.createElement(SharePage, { trips }), React.createElement(Toaster)));

    const select = document.getElementById('trip-source') as HTMLSelectElement;
    expect(select).toBeTruthy();
    // 默认优先用导入出来的行程
    expect(select.value).toBe('t-real');
    expect(screen.getByText('我导入的照片')).toBeTruthy();

    fireEvent.click(screen.getByText('生成并下载 .trailshare'));
    try {
      await waitFor(
        () => {
          // 失败 toast 会消失，但文案已经被观察器留下；这里抛它才能让 CI 看到真正原因
          if (failureText) throw new Error(`打包失败：${failureText}`);
          expect(downloaded, '还没有触发下载（生成没有走完）').not.toBeNull();
        },
        { timeout: 40000 },
      );
    } finally {
      observer.disconnect();
    }
    expect(screen.getAllByText('信物已生成').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/t-real|我的洛阳行/).length).toBeGreaterThan(0);

    // 也能切回内置示例
    fireEvent.change(select, { target: { value: '__demo__' } });
    expect(screen.getByText('内置示例旅程')).toBeTruthy();
  }, 60000);
});
