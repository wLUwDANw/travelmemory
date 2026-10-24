// @vitest-environment jsdom
/** 「导入照片」整条链路的集成测试。
 *
 * `photoImport.test.ts` 覆盖的是脱离 DOM 的纯状态机；这一份覆盖的是**那段必须碰 DOM
 * 的接线**：隐藏 file input 的 change → `adoptFiles` → `readThumb` → `importPhotos`
 * → `thumbs.put(photoId)` → 通知上层刷新。这段接线以前是 `PlaceholderActionDialog`
 * —— 一个什么都不做的占位弹窗，谁也不知道它到底接对了没有。
 *
 * 用 jsdom 而不是 node：`<input type="file">` 的 change 事件、`File` 对象、
 * 事件冒泡都只有在 DOM 环境里才成立。代价是慢几秒，换来的是"按钮点下去真的会上传"
 * 这一条有人守着。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MapPage, type MapPageProps } from './MapPage';
import { Toaster } from '../../components/ui/toaster';
import { setNativeBridge, resetNativeBridge } from '../../services/native';
import type { NativeBridge } from '../../types/native';
import type { TripView } from '../../services/api/trips';

const calls: string[] = [];

function fakeBridge(): NativeBridge {
  return {
    platform: 'web',
    photos: {
      platform: 'web',
      pickPhotos: async () => [],
      adoptFiles: (files) => {
        calls.push(`adopt:${files.length}`);
        return files.map((_f, i) => ({ id: `asset-${i}`, width: 4, height: 3 }));
      },
      readThumb: async (assetId) => {
        calls.push(`thumb:${assetId}`);
        return new TextEncoder().encode('thumb').buffer;
      },
    },
    permissions: {
      query: async () => 'granted',
      request: async () => 'granted',
    },
    thumbs: {
      get: async () => null,
      put: async (assetId, maxEdge) => {
        calls.push(`put:${assetId}:${maxEdge}`);
      },
      clear: async () => {},
      sizeHint: 0,
    },
  };
}

function okFetch(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

/** 连 Toaster 一起挂：toast 是挂在 App 壳上的，单渲染 MapPage 看不到它。 */
function renderPage(props: MapPageProps = {}): void {
  render(React.createElement(React.Fragment, null, React.createElement(MapPage, props), React.createElement(Toaster)));
}

afterEach(() => {
  cleanup();
  resetNativeBridge();
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('MapPage 导入闭环', () => {
  it('行程里的照片进「我的照片」图层，Badge 显示真实张数', () => {
    const trips: TripView[] = [
      {
        id: 't1', title: '洛阳两日', startedAt: '2026-10-01T00:00:00Z', endedAt: null,
        source: 'cluster', itemCount: 3,
        items: [
          { id: 'i1', photoId: 'ph1', takenAt: '2026-10-01T02:00:00Z', lat: 34.56, lng: 112.47, semanticTag: 'heritage', semanticLabel: '龙门石窟' },
          { id: 'i2', photoId: 'ph2', takenAt: '2026-10-01T09:00:00Z', lat: null, lng: null, semanticTag: 'food', semanticLabel: '洛邑古城' },
          { id: 'i3', photoId: 'ph3', takenAt: '2026-10-02T02:00:00Z', lat: 34.68, lng: 112.45, semanticTag: null, semanticLabel: null },
        ],
      },
    ];
    renderPage({ trips });

    expect(screen.getByText('我的照片').closest('div')?.parentElement?.textContent).toContain('2');
    expect(screen.getByText('共 3 张，2 张有坐标')).toBeTruthy();
  });

  it('没有照片时 Badge 显示「暂无」', () => {
    renderPage();
    expect(screen.getByText('暂无')).toBeTruthy();
  });

  it('选文件 → adoptFiles → readThumb → importPhotos → thumbs.put(photoId) → 通知刷新', async () => {
    setNativeBridge(fakeBridge());
    vi.stubGlobal(
      'fetch',
      okFetch({
        imported: 1, duplicates: 0, failed: 0,
        photos: [{ id: 'p-9', asset_id: 'a9', hash: 'h9', taken_at: '2026-10-01T02:00:00Z', taken_at_local: null, tz_name: null, lat: 34.5, lng: 112.4, coord_system: 'WGS84', location_source: 'exif', location_confidence: 0.9, semantic_tag: 'heritage', semantic_label: '龙门石窟' }],
        trip_ids: ['t1'],
      }),
    );
    let refreshed = 0;

    renderPage({ onTripsChanged: () => { refreshed += 1; } });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/*');

    const file = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getAllByText('已导入 1 张照片').length).toBeGreaterThan(0));

    expect(calls).toContain('adopt:1');
    expect(calls).toContain('thumb:asset-0');
    // 缩略图按后端 photo id 存，不是相册 assetId
    expect(calls).toContain('put:p-9:256');
    expect(refreshed).toBe(1);
    // 经典坑：选完之后必须清空 value，否则连选同一个文件不再触发 change
    expect(input.value).toBe('');
  });

  it('上传失败时显示中文错误，再选一次能重试（不卡死）', async () => {
    setNativeBridge(fakeBridge());
    vi.stubGlobal('fetch', okFetch({ imported: 0, duplicates: 0, failed: 0, photos: [], trip_ids: [] }));
    // 第一次：后端报 404（开关没开）
    vi.stubGlobal(
      'fetch',
      (async () => new Response('该能力未启用', { status: 404 })) as unknown as typeof fetch,
    );

    renderPage();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getAllByText(/HTTP 404/).length).toBeGreaterThan(0));

    // 第二次：后端恢复
    vi.stubGlobal(
      'fetch',
      okFetch({ imported: 2, duplicates: 0, failed: 0, photos: [{ id: 'p1', asset_id: 'a', hash: '', taken_at: null, taken_at_local: null, tz_name: null, lat: null, lng: null, coord_system: 'WGS84', location_source: null, location_confidence: null, semantic_tag: null, semantic_label: null }], trip_ids: [] }),
    );
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([2])], 'b.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getAllByText('已导入 2 张照片').length).toBeGreaterThan(0));
    // 按钮从「上传中…」回到「导入照片」：重试没有被 error 态卡住
    expect(screen.getByText('导入照片')).toBeTruthy();
    expect(screen.queryByText('上传中…')).toBeNull();
  });

  it('选到非图片文件时给出提示，不发请求', async () => {
    setNativeBridge(fakeBridge());
    let fetched = 0;
    vi.stubGlobal('fetch', (async () => { fetched += 1; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch);

    renderPage();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' })] } });

    await waitFor(() => expect(screen.getAllByText('请选择图片文件').length).toBeGreaterThan(0));
    expect(fetched).toBe(0);
    expect(calls).toEqual([]);
  });
});
