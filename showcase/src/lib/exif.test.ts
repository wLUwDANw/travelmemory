import { describe, expect, it } from 'vitest';
import { parseExifBuffer, parseExifDate } from './exif';

const TIFF_LENGTH = 190;
const TIFF_START = 12;

/**
 * 手工构造一个最小 JPEG：
 *   SOI + APP1("Exif\0\0" + TIFF)
 * TIFF 是小端，IFD0 → Exif IFD + GPS IFD。
 * 写入 lat = 39°54'00" N (=39.9)、lng = 116°24'00" E (=116.4)、
 * DateTimeOriginal = "2026:07:12 08:30:00"、Orientation = 6。
 */
function buildExifJpeg(): ArrayBuffer {
  const buffer = new ArrayBuffer(TIFF_START + TIFF_LENGTH);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // SOI
  view.setUint8(0, 0xff);
  view.setUint8(1, 0xd8);
  // APP1
  view.setUint8(2, 0xff);
  view.setUint8(3, 0xe1);
  view.setUint16(4, 2 + 6 + TIFF_LENGTH, false); // 段长（大端，含自身 2 字节）
  // "Exif\0\0"
  bytes[6] = 0x45;
  bytes[7] = 0x78;
  bytes[8] = 0x69;
  bytes[9] = 0x66;
  bytes[10] = 0x00;
  bytes[11] = 0x00;

  const t = TIFF_START;
  const u8 = (offset: number, value: number): void => {
    view.setUint8(t + offset, value);
  };
  const u16 = (offset: number, value: number): void => {
    view.setUint16(t + offset, value, true);
  };
  const u32 = (offset: number, value: number): void => {
    view.setUint32(t + offset, value, true);
  };

  // TIFF 头
  u8(0, 0x49); // 'I'
  u8(1, 0x49); // 'I' → 小端
  u16(2, 0x002a);
  u32(4, 8); // IFD0 偏移

  // ── IFD0 @8：3 个条目 ────────────────────────────────────────
  u16(8, 3);
  // Orientation: tag 0x0112 type 3 count 1 value 6
  u16(10, 0x0112);
  u16(12, 3);
  u32(14, 1);
  u16(18, 6);
  u16(20, 0);
  // Exif IFD 指针: tag 0x8769 type 4 count 1 value 50
  u16(22, 0x8769);
  u16(24, 4);
  u32(26, 1);
  u32(30, 50);
  // GPS IFD 指针: tag 0x8825 type 4 count 1 value 68
  u16(34, 0x8825);
  u16(36, 4);
  u32(38, 1);
  u32(42, 68);
  // 下一个 IFD
  u32(46, 0);

  // ── Exif IFD @50：1 个条目 ───────────────────────────────────
  u16(50, 1);
  // DateTimeOriginal: tag 0x9003 type 2(ASCII) count 20 offset 170
  u16(52, 0x9003);
  u16(54, 2);
  u32(56, 20);
  u32(60, 170);
  u32(64, 0);

  // ── GPS IFD @68：4 个条目 ───────────────────────────────────
  u16(68, 4);
  // 纬度参考 "N\0"（内联）
  u16(70, 0x0001);
  u16(72, 2);
  u32(74, 2);
  u8(78, 0x4e);
  u8(79, 0x00);
  // 纬度 RATIONAL[3] @122
  u16(82, 0x0002);
  u16(84, 5);
  u32(86, 3);
  u32(90, 122);
  // 经度参考 "E\0"（内联）
  u16(94, 0x0003);
  u16(96, 2);
  u32(98, 2);
  u8(102, 0x45);
  u8(103, 0x00);
  // 经度 RATIONAL[3] @146
  u16(106, 0x0004);
  u16(108, 5);
  u32(110, 3);
  u32(114, 146);
  u32(118, 0);

  // ── RATIONAL 数据 @122 ─────────────────────────────────────
  const rational = (offset: number, numerator: number, denominator: number): void => {
    u32(offset, numerator);
    u32(offset + 4, denominator);
  };
  rational(122, 39, 1); // 39°
  rational(130, 54, 1); // 54'
  rational(138, 0, 1); // 0"
  rational(146, 116, 1); // 116°
  rational(154, 24, 1); // 24'
  rational(162, 0, 1); // 0"

  // ── 日期字符串 @170（20 字节） ──────────────────────────────
  const text = '2026:07:12 08:30:00';
  for (let i = 0; i < text.length; i += 1) u8(170 + i, text.charCodeAt(i));
  u8(170 + text.length, 0);

  return buffer;
}

describe('exif.parseExifBuffer', () => {
  it('解析出 GPS / 时间 / 方向', () => {
    const result = parseExifBuffer(buildExifJpeg());
    expect(result.lat).not.toBeNull();
    expect(result.lng).not.toBeNull();
    expect(result.lat as number).toBeCloseTo(39.9, 6);
    expect(result.lng as number).toBeCloseTo(116.4, 6);
    expect(result.takenAt).toBe(Date.UTC(2026, 6, 12, 8, 30, 0));
    expect(result.orientation).toBe(6);
  });

  it('非 JPEG 输入返回全 null 且不抛错', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const result = parseExifBuffer(png.buffer as ArrayBuffer);
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
    expect(result.takenAt).toBeNull();
    expect(result.orientation).toBe(1);
  });

  it('截断的 JPEG 头不会抛错', () => {
    const full = new Uint8Array(buildExifJpeg());
    for (const length of [2, 6, 20, 60]) {
      const part = full.slice(0, length);
      expect(() => parseExifBuffer(part.buffer as ArrayBuffer)).not.toThrow();
    }
  });

  it('parseExifDate 手工解析，不依赖 new Date(str)', () => {
    expect(parseExifDate('2026:07:12 08:30:00')).toBe(Date.UTC(2026, 6, 12, 8, 30, 0));
    expect(parseExifDate('2026:07:12T08:30:00')).toBe(Date.UTC(2026, 6, 12, 8, 30, 0));
    expect(parseExifDate('  2026:12:31 23:59:59  ')).toBe(Date.UTC(2026, 11, 31, 23, 59, 59));
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDate('2026:13:01 00:00:00')).toBeNull();
    expect(parseExifDate('not a date')).toBeNull();
    expect(parseExifDate('')).toBeNull();
  });

  it('空 buffer 安全返回', () => {
    const result = parseExifBuffer(new ArrayBuffer(0));
    expect(result.lat).toBeNull();
    expect(result.orientation).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════
 * QA 补充用例：字节序 / 越界 / 退化输入
 *
 * 与上面的夹具相比，这里的夹具把字节序做成参数，其余布局逐字节一致，
 * 这样才能证明「MM 与 II 只差字节序」而不是两套不同的数据。
 * ══════════════════════════════════════════════════════════════ */

/** TIFF 块内固定偏移（与首个小端夹具同一套布局） */
const TIFF_OFFSET = 12;
const TIFF_BLOCK = 190;
const OFF_IFD0 = 8;
const OFF_EXIF_IFD = 50;
const OFF_GPS_IFD = 68;
const OFF_LAT_RATIONAL = 122;
const OFF_LNG_RATIONAL = 146;
const OFF_DATE = 170;
const SEGMENT_LENGTH = 2 + 6 + TIFF_BLOCK;

interface ExifFixtureOptions {
  littleEndian: boolean;
  latDms: [number, number, number];
  latRef: 'N' | 'S';
  lngDms: [number, number, number];
  lngRef: 'E' | 'W';
  date: string;
  orientation: number;
  /** 经纬度 RATIONAL 的分母（用于构造分母为 0 的坏数据） */
  rationalDenominator?: number;
}

function buildExifFixture(options: ExifFixtureOptions): ArrayBuffer {
  const buffer = new ArrayBuffer(TIFF_OFFSET + TIFF_BLOCK);
  const view = new DataView(buffer);
  const little = options.littleEndian;
  const denominator = options.rationalDenominator ?? 1;

  const w8 = (offset: number, value: number): void => {
    view.setUint8(TIFF_OFFSET + offset, value);
  };
  const w16 = (offset: number, value: number): void => {
    view.setUint16(TIFF_OFFSET + offset, value, little);
  };
  const w32 = (offset: number, value: number): void => {
    view.setUint32(TIFF_OFFSET + offset, value, little);
  };
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) w8(offset + i, text.charCodeAt(i));
    w8(offset + text.length, 0);
  };
  const rational = (offset: number, numerator: number, den: number): void => {
    w32(offset, numerator);
    w32(offset + 4, den);
  };

  // SOI + APP1（段长字段永远是 JPEG 规定的大端，与 TIFF 字节序无关）
  view.setUint8(0, 0xff);
  view.setUint8(1, 0xd8);
  view.setUint8(2, 0xff);
  view.setUint8(3, 0xe1);
  view.setUint16(4, SEGMENT_LENGTH, false);
  const exifMark = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  for (let i = 0; i < exifMark.length; i += 1) view.setUint8(6 + i, exifMark[i]);

  // TIFF 头
  const order = little ? 0x49 : 0x4d;
  w8(0, order);
  w8(1, order);
  w16(2, 0x002a);
  w32(4, OFF_IFD0);

  // IFD0：Orientation（SHORT×1 = 2 字节 → 内联）+ 两个子 IFD 指针
  w16(OFF_IFD0, 3);
  w16(OFF_IFD0 + 2, 0x0112);
  w16(OFF_IFD0 + 4, 3);
  w32(OFF_IFD0 + 6, 1);
  w16(OFF_IFD0 + 10, options.orientation);
  w16(OFF_IFD0 + 14, 0x8769);
  w16(OFF_IFD0 + 16, 4);
  w32(OFF_IFD0 + 18, 1);
  w32(OFF_IFD0 + 22, OFF_EXIF_IFD);
  w16(OFF_IFD0 + 26, 0x8825);
  w16(OFF_IFD0 + 28, 4);
  w32(OFF_IFD0 + 30, 1);
  w32(OFF_IFD0 + 34, OFF_GPS_IFD);
  w32(OFF_IFD0 + 38, 0);

  // Exif IFD：DateTimeOriginal（ASCII×20 = 20 字节 > 4 → 走偏移）
  w16(OFF_EXIF_IFD, 1);
  w16(OFF_EXIF_IFD + 2, 0x9003);
  w16(OFF_EXIF_IFD + 4, 2);
  w32(OFF_EXIF_IFD + 6, options.date.length + 1);
  w32(OFF_EXIF_IFD + 10, OFF_DATE);
  w32(OFF_EXIF_IFD + 14, 0);

  // GPS IFD：2 个参考（ASCII×2 内联）+ 2 个 RATIONAL×3（24 字节 → 走偏移）
  w16(OFF_GPS_IFD, 4);
  w16(OFF_GPS_IFD + 2, 0x0001);
  w16(OFF_GPS_IFD + 4, 2);
  w32(OFF_GPS_IFD + 6, 2);
  ascii(OFF_GPS_IFD + 10, options.latRef);
  w16(OFF_GPS_IFD + 14, 0x0002);
  w16(OFF_GPS_IFD + 16, 5);
  w32(OFF_GPS_IFD + 18, 3);
  w32(OFF_GPS_IFD + 22, OFF_LAT_RATIONAL);
  w16(OFF_GPS_IFD + 26, 0x0003);
  w16(OFF_GPS_IFD + 28, 2);
  w32(OFF_GPS_IFD + 30, 2);
  ascii(OFF_GPS_IFD + 34, options.lngRef);
  w16(OFF_GPS_IFD + 38, 0x0004);
  w16(OFF_GPS_IFD + 40, 5);
  w32(OFF_GPS_IFD + 42, 3);
  w32(OFF_GPS_IFD + 46, OFF_LNG_RATIONAL);
  w32(OFF_GPS_IFD + 50, 0);

  rational(OFF_LAT_RATIONAL, options.latDms[0], denominator);
  rational(OFF_LAT_RATIONAL + 8, options.latDms[1], denominator);
  rational(OFF_LAT_RATIONAL + 16, options.latDms[2], denominator);
  rational(OFF_LNG_RATIONAL, options.lngDms[0], denominator);
  rational(OFF_LNG_RATIONAL + 8, options.lngDms[1], denominator);
  rational(OFF_LNG_RATIONAL + 16, options.lngDms[2], denominator);

  ascii(OFF_DATE, options.date);

  return buffer;
}

/** 默认：北京天安门附近，2026-07-12 08:30:00，方向 6 */
function defaultFixture(overrides: Partial<ExifFixtureOptions> = {}): ArrayBuffer {
  return buildExifFixture({
    littleEndian: true,
    latDms: [39, 54, 0],
    latRef: 'N',
    lngDms: [116, 24, 0],
    lngRef: 'E',
    date: '2026:07:12 08:30:00',
    orientation: 6,
    ...overrides,
  });
}

/** 固定种子的线性同余伪随机，避免 Math.random 造成不可复现的失败 */
function pseudoRandom(seed: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = (state >>> 24) & 0xff;
  }
  return bytes;
}

describe('exif 字节序', () => {
  it('大端（MM）能解析出正确的 lat / lng / takenAt', () => {
    const result = parseExifBuffer(defaultFixture({ littleEndian: false }));
    expect(result.lat as number).toBeCloseTo(39.9, 6);
    expect(result.lng as number).toBeCloseTo(116.4, 6);
    expect(result.takenAt).toBe(Date.UTC(2026, 6, 12, 8, 30, 0));
    expect(result.orientation).toBe(6);
  });

  it('同一份数据在大端与小端下解析结果完全一致', () => {
    const little = parseExifBuffer(defaultFixture({ littleEndian: true }));
    const big = parseExifBuffer(defaultFixture({ littleEndian: false }));
    expect(big.lat).toBe(little.lat);
    expect(big.lng).toBe(little.lng);
    expect(big.takenAt).toBe(little.takenAt);
    expect(big.orientation).toBe(little.orientation);
  });

  it('大端下的 RATIONAL 多值（度分秒）逐个正确', () => {
    const result = parseExifBuffer(
      defaultFixture({
        littleEndian: false,
        latDms: [30, 15, 36],
        lngDms: [120, 7, 12],
      }),
    );
    // 30 + 15/60 + 36/3600 = 30.26
    expect(result.lat as number).toBeCloseTo(30.26, 9);
    // 120 + 7/60 + 12/3600 = 120.12
    expect(result.lng as number).toBeCloseTo(120.12, 9);
  });
});

describe('exif 坐标有效性', () => {
  it('GPS 为 (0, 0)（未定位哨兵值）判为无效', () => {
    const result = parseExifBuffer(
      defaultFixture({ latDms: [0, 0, 0], lngDms: [0, 0, 0] }),
    );
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
  });

  it('南纬 / 西经（S / W）解析为负数', () => {
    const result = parseExifBuffer(
      defaultFixture({ latDms: [33, 52, 0], latRef: 'S', lngDms: [70, 30, 0], lngRef: 'W' }),
    );
    expect(result.lat as number).toBeCloseTo(-(33 + 52 / 60), 9);
    expect(result.lng as number).toBeCloseTo(-(70 + 30 / 60), 9);
  });

  it('经度超出 ±180 视为无效', () => {
    const result = parseExifBuffer(defaultFixture({ lngDms: [200, 0, 0] }));
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
  });

  it('纬度超出 ±90 视为无效', () => {
    const result = parseExifBuffer(defaultFixture({ latDms: [95, 0, 0] }));
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
  });

  it('RATIONAL 分母为 0 时返回 null 而不是 Infinity / NaN', () => {
    const result = parseExifBuffer(defaultFixture({ rationalDenominator: 0 }));
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
  });
});

describe('exif 越界与损坏输入', () => {
  it('截掉最后 20 字节：不抛异常，返回全 null', () => {
    const full = new Uint8Array(defaultFixture());
    const truncated = full.slice(0, full.length - 20);
    expect(truncated.length).toBe(full.length - 20);

    let result: ReturnType<typeof parseExifBuffer> | null = null;
    expect(() => {
      result = parseExifBuffer(truncated.buffer as ArrayBuffer);
    }).not.toThrow();

    expect(result).not.toBeNull();
    expect(result!.lat).toBeNull();
    expect(result!.lng).toBeNull();
    expect(result!.takenAt).toBeNull();
    expect(result!.orientation).toBe(1);
  });

  it('截断到任意长度都不抛异常（逐字节扫描）', () => {
    const full = new Uint8Array(defaultFixture());
    for (let length = 0; length <= full.length; length += 1) {
      const part = full.slice(0, length);
      expect(() => parseExifBuffer(part.buffer as ArrayBuffer)).not.toThrow();
    }
  });

  it('200 字节伪随机输入不抛异常', () => {
    const bytes = pseudoRandom(0x5eed1234, 200);
    expect(() => parseExifBuffer(bytes.buffer as ArrayBuffer)).not.toThrow();

    const result = parseExifBuffer(bytes.buffer as ArrayBuffer);
    // 只要解析出坐标，就必须落在合法范围内（不能是 NaN / Infinity）
    if (result.lat !== null && result.lng !== null) {
      expect(Number.isFinite(result.lat)).toBe(true);
      expect(Number.isFinite(result.lng)).toBe(true);
      expect(Math.abs(result.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(result.lng)).toBeLessThanOrEqual(180);
    }
  });

  it('合法 SOI + APP1 + 合法 TIFF 头 + 随机 IFD：不抛异常', () => {
    // 强制走完段解析与 TIFF 头，把随机字节喂给 IFD 遍历（越界访问的主要入口）
    const bytes = pseudoRandom(0x0badf00d, 200);
    bytes.set([0xff, 0xd8, 0xff, 0xe1], 0);
    bytes[4] = 0x00;
    bytes[5] = 196; // 段长：4 + 196 = 200 = 缓冲区长度
    bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6);
    bytes.set([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], 12);

    expect(() => parseExifBuffer(bytes.buffer as ArrayBuffer)).not.toThrow();
  });
});

describe('exif.parseExifDate', () => {
  it('解析标准 EXIF 时间串', () => {
    expect(parseExifDate('2026:07:12 08:30:00')).toBe(Date.UTC(2026, 6, 12, 8, 30, 0));
  });

  it('非法时间串返回 null', () => {
    expect(parseExifDate('2026:13:01 00:00:00')).toBeNull();
    expect(parseExifDate('2026:00:01 00:00:00')).toBeNull();
    expect(parseExifDate('2026:07:32 00:00:00')).toBeNull();
    expect(parseExifDate('2026:07:12 24:00:00')).toBeNull();
    expect(parseExifDate('not a date')).toBeNull();
    expect(parseExifDate('')).toBeNull();
  });
});
