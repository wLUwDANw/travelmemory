/** 照片导入 / 行程列表客户端测试。
 *
 * 跑在 Node 环境（vite.config.ts 的 `environment: 'node'`），全程不发真实请求：
 * fetch 一律用替身。断言的重点不是"能联网"，而是**契约**——字段名 `files`、
 * URL、错误信息的中文上下文，这三样写错了线上才会炸。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { importPhotos, setPhotosApi } from './photos';
import { listTrips, renameTrip, setTripsApi } from './trips';

const BASE = 'http://api.test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Internal Server Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(text: string, status = 500): Response {
  return new Response(text, { status, statusText: 'Internal Server Error' });
}

/** 造一个真 File：Node 18+ 自带 undici 的 File，和浏览器里 append 进 FormData 的行为一致。 */
function makeFile(name: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type: 'image/jpeg' });
}

/** 后端线格式：**snake_case**（Python 惯例），客户端负责折成 camelCase。
 *  这里刻意按"线上真实会收到什么"来造假数据 —— 用 camelCase 造假的
 *  问题在于测试全绿、联调全断，而这类 bug 只有到页面上才看得见。 */
const SAMPLE_PHOTO = {
  id: 'p1',
  asset_id: 'web:1:a.jpg:0',
  hash: 'deadbeef',
  taken_at: '2026-04-03T10:20:00Z',
  taken_at_local: '2026-04-03T18:20:00',
  tz_name: 'Asia/Shanghai',
  lat: 31.2304,
  lng: 121.4737,
  coord_system: 'WGS84',
  location_source: 'exif',
  location_confidence: 0.92,
  semantic_tag: 'metropolis',
  semantic_label: '都市风光',
};

const SAMPLE_RESULT = {
  imported: 3,
  duplicates: 1,
  failed: 0,
  photos: [SAMPLE_PHOTO],
  trip_ids: ['t1', 't2'],
};

afterEach(() => {
  setPhotosApi(null);
  setTripsApi(null);
  vi.unstubAllGlobals();
});

describe('importPhotos', () => {
  it('空数组直接抛「请先选择照片」，且一个请求都不发', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SAMPLE_RESULT));
    await expect(importPhotos([], { baseUrl: BASE, fetchImpl })).rejects.toThrow('请先选择照片');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('正常响应能解析出 imported / duplicates / failed / photos / tripIds', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SAMPLE_RESULT));
    const result = await importPhotos([makeFile('a.jpg')], { baseUrl: BASE, fetchImpl });

    expect(result.imported).toBe(3);
    expect(result.duplicates).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.tripIds).toEqual(['t1', 't2']);
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].semanticTag).toBe('metropolis');
    expect(result.photos[0].coordSystem).toBe('WGS84');
    expect(result.photos[0].locationConfidence).toBeCloseTo(0.92);
  });

  it('请求打到 {baseUrl}/api/v1/photos/import', async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(SAMPLE_RESULT),
    );
    await importPhotos([makeFile('a.jpg')], { baseUrl: 'http://api.test/', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/photos/import');
  });

  it('非 2xx 抛错，且错误信息里带状态码与响应体', async () => {
    const fetchImpl = vi.fn(async () => textResponse('{"detail":"EXIF 解析失败：字节太短"}', 500));
    await expect(
      importPhotos([makeFile('a.jpg')], { baseUrl: BASE, fetchImpl }),
    ).rejects.toThrow(/照片导入失败：HTTP 500[\s\S]*EXIF 解析失败/);
  });

  it('fetch 本身 reject 时抛带中文上下文的错（不把原始 TypeError 直接漏出去）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      importPhotos([makeFile('a.jpg')], { baseUrl: BASE, fetchImpl }),
    ).rejects.toThrow(/照片导入失败：网络请求异常（fetch failed）/);
  });

  it('FormData 的字段名是 files，且每个文件都被 append 进去', async () => {
    let captured: FormData | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured = init?.body as FormData;
      return jsonResponse(SAMPLE_RESULT);
    });

    const files = [makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')];
    await importPhotos(files, { baseUrl: BASE, fetchImpl });

    expect(captured).toBeInstanceOf(FormData);
    const entries = captured!.getAll('files') as File[];
    expect(entries).toHaveLength(3);
    expect(entries.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('没有注入 fetch 时回落到全局 fetch（stubGlobal 可拦截）', async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(SAMPLE_RESULT),
    );
    vi.stubGlobal('fetch', fetchImpl);
    setPhotosApi({ baseUrl: BASE });

    await expect(importPhotos([makeFile('a.jpg')])).resolves.toMatchObject({ imported: 3 });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/photos/import');
  });
});

/** 后端 `GET /api/v1/trips` 真实返回的 snake_case 形状（客户端会折成 camelCase）。 */
const TRIPS = {
  trips: [
    {
      id: 't1',
      title: '上海三日',
      started_at: '2026-04-03T10:20:00Z',
      ended_at: '2026-04-05T18:00:00Z',
      source: 'cluster',
      item_count: 2,
      items: [
        {
          id: 'i1',
          photo_id: 'p1',
          taken_at: '2026-04-03T10:20:00Z',
          lat: 31.2304,
          lng: 121.4737,
          semantic_tag: 'metropolis',
          semantic_label: '都市风光',
        },
      ],
    },
  ],
};

describe('listTrips', () => {
  it('正常响应解析成 TripView[]', async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(TRIPS),
    );
    const trips = await listTrips({ baseUrl: BASE, fetchImpl });

    expect(trips).toHaveLength(1);
    expect(trips[0].title).toBe('上海三日');
    expect(trips[0].source).toBe('cluster');
    expect(trips[0].itemCount).toBe(2);
    expect(trips[0].items[0].semanticLabel).toBe('都市风光');
    expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/trips');
  });

  it('响应缺 trips 字段时不炸，退化成空数组（还没导入过照片是正常状态）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(listTrips({ baseUrl: BASE, fetchImpl })).resolves.toEqual([]);
  });

  it('非 2xx 抛错并带上响应体', async () => {
    const fetchImpl = vi.fn(async () => textResponse('行程服务未就绪', 503));
    await expect(listTrips({ baseUrl: BASE, fetchImpl })).rejects.toThrow(
      /获取行程列表失败：HTTP 503[\s\S]*行程服务未就绪/,
    );
  });

  it('fetch reject 时抛带中文上下文的错，且模块级注入生效', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    setTripsApi({ baseUrl: BASE });

    await expect(listTrips()).rejects.toThrow(/获取行程列表失败：网络请求异常（ECONNREFUSED）/);
  });
});

describe('renameTrip', () => {
  it('打的是 PATCH /api/v1/trips/{id}，body 带 title', async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ trip: TRIPS.trips[0] }),
    );
    await renameTrip('t1', '洛阳两日', { baseUrl: BASE, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/trips/t1');
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: '洛阳两日' });
  });

  it('正常响应解析成 TripView', async () => {
    vi.stubGlobal(
      'fetch',
      async () => jsonResponse({ trip: { ...TRIPS.trips[0], title: '改过的名字', source: 'manual' } }),
    );
    const trip = await renameTrip('t1', '改过的名字', { baseUrl: BASE });
    expect(trip.title).toBe('改过的名字');
    // 后端会把 source 提升成 manual（改名的行程退出自动重建），前端必须照显示
    expect(trip.source).toBe('manual');
  });

  it('404 时错误信息说人话（行程不存在 / 开关没开）', async () => {
    vi.stubGlobal('fetch', async () => new Response('不存在', { status: 404 }));
    await expect(renameTrip('t1', 'x', { baseUrl: BASE })).rejects.toThrow(
      /重命名失败：该行程不存在/,
    );
  });

  it('非 2xx 抛错并带上响应体', async () => {
    vi.stubGlobal('fetch', async () => textResponse('标题太长', 422));
    await expect(renameTrip('t1', 'x', { baseUrl: BASE })).rejects.toThrow(/HTTP 422/);
  });

  it('id 里的特殊字符被编码，不会把 URL 拼坏', async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ trip: TRIPS.trips[0] }),
    );
    await renameTrip('a/b c', 'x', { baseUrl: BASE, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/trips/a%2Fb%20c');
  });
});
