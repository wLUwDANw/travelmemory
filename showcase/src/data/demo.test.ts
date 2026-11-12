import { describe, expect, it } from 'vitest';
import { DEMO_JIANGNAN, DEMO_QINGGAN } from './demoJourneys';
import { buildJourney } from '@travelmemory/trail';

describe('demo data sanity', () => {
  it('青甘跨 7 天、江南跨 4 天', () => {
    const a = buildJourney({ id: 'a', title: 'a', subtitle: 'a', photos: DEMO_QINGGAN.photos });
    const b = buildJourney({ id: 'b', title: 'b', subtitle: 'b', photos: DEMO_JIANGNAN.photos });
    expect(a.photos.length).toBe(32);
    expect(b.photos.length).toBe(16);
    expect(a.days.length).toBe(7);
    expect(b.days.length).toBe(4);
    expect(a.totalMeters / 1000).toBeGreaterThan(1500);
    expect(b.totalMeters / 1000).toBeGreaterThan(250);
  });

  /**
   * P0 回归：`suggestedZoom` 曾经恒等于 13（夹取上界）。
   * 原因：同一景点的两张照片抖动约 1.3km，而当时按 50m 去重，
   * 于是「一个景点」被算成两个站点，站间距中位数被拉到 ~1km，
   * zoom 顶到 13（视野只有 22km）→ 照片卡片全在屏幕外、镜头滞后被放大到 500px+、
   * 底图每帧平移 2600px 导致瓦片请求全被取消。
   * 这条用真实演示数据钉住「视距必须落在合理区间」。
   */
  it('suggestedZoom 落在合理视距（P0 回归：不能顶到 13）', () => {
    const a = buildJourney({ id: 'a', title: 'a', subtitle: 'a', photos: DEMO_QINGGAN.photos });
    const b = buildJourney({ id: 'b', title: 'b', subtitle: 'b', photos: DEMO_JIANGNAN.photos });
    expect(a.suggestedZoom).toBeGreaterThanOrEqual(8.5);
    expect(a.suggestedZoom).toBeLessThanOrEqual(10.5);
    expect(b.suggestedZoom).toBeGreaterThanOrEqual(9);
    expect(b.suggestedZoom).toBeLessThanOrEqual(12);
  });

  /**
   * 演示路线必须真的"交通工具不止一种"。
   *
   * 否则两种退化会悄悄发生而没人发现：① 数据里 `transportToNext` 被删掉，
   * 全线路退回默认自驾；② 继承规则写错，所有段都继承成同一个值。
   * 两种情况都不会报错，只会让播放时那条线重新变成一种颜色。
   */
  it('两条演示线各自都用了 ≥2 种交通工具', () => {
    for (const trip of [DEMO_QINGGAN, DEMO_JIANGNAN]) {
      const journey = buildJourney({ id: trip.id, title: trip.title, subtitle: trip.subtitle, photos: trip.photos });
      const modes = new Set(journey.segments.map((s) => s.mode));
      expect(modes.size).toBeGreaterThanOrEqual(2);
      // 每段都必须是合法值，不能有 undefined 漏进渲染器
      for (const segment of journey.segments) {
        expect(typeof segment.mode).toBe('string');
        expect(segment.endS).toBeGreaterThan(segment.startS);
      }
    }
  });
});
