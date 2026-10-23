/** 坐标转换单测。
 *
 * 测试向量与后端 `tests/test_tools.py` 的"天安门往返"是**同一个点**：
 * 前端按逐位对齐的移植应该得到同样的数。哪天有人改了某一侧的公式，
 * 这里会先红 —— 而两端对不上比任何一侧"看起来对"都严重。
 */

import { describe, expect, it } from 'vitest';
import { gcj02ToWgs84, wgs84ToGcj02 } from './coords';

describe('wgs84ToGcj02', () => {
  it('天安门：与后端 app/utils/coords.py 逐位一致', () => {
    // 后端实测：LngLat(lng=116.403672, lat=39.910634)
    const gcj = wgs84ToGcj02(116.397428, 39.90923);
    expect(gcj.lng).toBe(116.403672);
    expect(gcj.lat).toBe(39.910634);
  });

  it('洛阳（偏移量小一些但同样存在）', () => {
    // 后端实测：LngLat(lng=112.440498, lat=34.662648)
    const gcj = wgs84ToGcj02(112.4342, 34.6636);
    expect(gcj.lng).toBe(112.440498);
    expect(gcj.lat).toBe(34.662648);
  });

  it('境外直通，不加偏移', () => {
    const london = wgs84ToGcj02(-0.1276, 51.5072);
    expect(london.lng).toBe(-0.1276);
    expect(london.lat).toBe(51.5072);
  });
});

describe('gcj02ToWgs84', () => {
  it('往返收敛：转过去再转回来，误差 < 1e-4', () => {
    const original = { lng: 116.397428, lat: 39.90923 };
    const gcj = wgs84ToGcj02(original.lng, original.lat);
    // 先确认"确实偏了"（偏移量有几百米），再确认"能转回来"
    expect(Math.abs(gcj.lng - original.lng)).toBeGreaterThan(1e-4);
    const back = gcj02ToWgs84(gcj.lng, gcj.lat);
    expect(Math.abs(back.lng - original.lng)).toBeLessThan(1e-4);
    expect(Math.abs(back.lat - original.lat)).toBeLessThan(1e-4);
  });

  it('境外同样直通', () => {
    const back = gcj02ToWgs84(-0.1276, 51.5072);
    expect(back.lng).toBe(-0.1276);
    expect(back.lat).toBe(51.5072);
  });
});
