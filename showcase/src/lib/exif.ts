/**
 * 手写 JPEG EXIF 解析（只依赖 DataView）。
 *
 * 只读文件头部 512KB：APP1 段紧跟 SOI，永远不会超出这个范围，
 * 避免把几百兆的原始文件整个读进内存。
 *
 * 任何异常都会被吞掉并返回空结果——一张坏图绝不能让整批导入挂掉。
 */

export interface ExifResult {
  lat: number | null;
  lng: number | null;
  takenAt: number | null;
  orientation: number;
}

/** 读取上限：512KB */
const HEAD_LIMIT = 512 * 1024;

/** EXIF 类型 → 单值字节数 */
const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;

const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;

const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LNG_REF = 0x0003;
const TAG_GPS_LNG = 0x0004;

function emptyResult(): ExifResult {
  return { lat: null, lng: null, takenAt: null, orientation: 1 };
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** 单值字节数 */
  unit: number;
  /** 值字节总长 */
  total: number;
  /** 值在文件中（DataView 内）的绝对偏移 */
  valuePos: number;
  /** 4 字节 value/offset 字段的原始数值 */
  raw: number;
}

/** 解析 "YYYY:MM:DD HH:MM:SS"，手工构造 UTC 毫秒（不依赖各引擎对字符串的解析差异） */
export function parseExifDate(text: string): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 60) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 解析已读入的 JPEG 头部字节。
 * 单独导出便于测试直接喂一个手工构造的 ArrayBuffer。
 */
export function parseExifBuffer(buffer: ArrayBuffer): ExifResult {
  const result = emptyResult();
  try {
    const view = new DataView(buffer);
    const byteLength = buffer.byteLength;
    if (byteLength < 4) return result;
    // JPEG SOI
    if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return result;

    // ── 遍历段，找 APP1/Exif ────────────────────────────────────
    let tiffStart = -1;
    let pos = 2;
    while (pos + 4 <= byteLength) {
      if (view.getUint8(pos) !== 0xff) break;
      const marker = view.getUint8(pos + 1);
      pos += 2;
      // 无载荷的标记
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0xd9) break;
      if (pos + 2 > byteLength) break;
      const segLen = view.getUint16(pos, false);
      if (segLen < 2) break;
      const segEnd = pos + segLen;
      if (segEnd > byteLength) break;
      if (marker === 0xe1) {
        const payload = pos + 2;
        // "Exif\0\0"
        if (
          payload + 6 <= segEnd &&
          view.getUint32(payload) === 0x45786966 &&
          view.getUint16(payload + 4) === 0x0000
        ) {
          tiffStart = payload + 6;
          break;
        }
      }
      pos = segEnd;
    }
    if (tiffStart < 0 || tiffStart + 8 > byteLength) return result;

    // ── TIFF 头 ─────────────────────────────────────────────────
    const byteOrder = view.getUint16(tiffStart, false);
    let little: boolean;
    if (byteOrder === 0x4949) {
      little = true;
    } else if (byteOrder === 0x4d4d) {
      little = false;
    } else {
      return result;
    }
    if (view.getUint16(tiffStart + 2, little) !== 0x002a) return result;
    const ifd0Offset = view.getUint32(tiffStart + 4, little);

    const u16 = (offset: number): number =>
      offset >= 0 && offset + 2 <= byteLength ? view.getUint16(offset, little) : -1;
    const u32 = (offset: number): number =>
      offset >= 0 && offset + 4 <= byteLength ? view.getUint32(offset, little) : -1;

    const readIfd = (relativeOffset: number): IfdEntry[] => {
      const entries: IfdEntry[] = [];
      if (relativeOffset <= 0) return entries;
      const base = tiffStart + relativeOffset;
      if (base + 2 > byteLength) return entries;
      const countEntries = u16(base);
      if (countEntries < 0 || countEntries > 4096) return entries;
      for (let i = 0; i < countEntries; i += 1) {
        const entryPos = base + 2 + i * 12;
        if (entryPos + 12 > byteLength) break;
        const tag = u16(entryPos);
        const type = u16(entryPos + 2);
        const count = u32(entryPos + 4);
        const raw = u32(entryPos + 8);
        if (tag < 0 || type < 0 || count < 0 || raw < 0) continue;
        const unit = TYPE_SIZE[type] ?? 1;
        const total = unit * count;
        const valuePos = total <= 4 ? entryPos + 8 : tiffStart + raw;
        entries.push({ tag, type, count, unit, total, valuePos, raw });
      }
      return entries;
    };

    const findEntry = (entries: IfdEntry[], tag: number): IfdEntry | null => {
      for (let i = 0; i < entries.length; i += 1) {
        if (entries[i].tag === tag) return entries[i];
      }
      return null;
    };

    const readAscii = (entry: IfdEntry | null): string => {
      if (!entry) return '';
      const chars: string[] = [];
      for (let i = 0; i < entry.count; i += 1) {
        const at = entry.valuePos + i;
        if (at >= byteLength) break;
        const code = view.getUint8(at);
        if (code === 0) break;
        chars.push(String.fromCharCode(code));
      }
      return chars.join('').trim();
    };

    /** 读一个 RATIONAL（num/den），失败返回 null */
    const readRationalAt = (offset: number): number | null => {
      const num = u32(offset);
      const den = u32(offset + 4);
      if (num < 0 || den <= 0) return null;
      return num / den;
    };

    /** 度分秒三元组 → 十进制度 */
    const readDms = (entry: IfdEntry | null): number | null => {
      if (!entry || entry.count < 3) return null;
      const d = readRationalAt(entry.valuePos);
      const m = readRationalAt(entry.valuePos + 8);
      const s = readRationalAt(entry.valuePos + 16);
      if (d === null || m === null || s === null) return null;
      return d + m / 60 + s / 3600;
    };

    // ── IFD0 ────────────────────────────────────────────────────
    const ifd0 = readIfd(ifd0Offset);
    const orientationEntry = findEntry(ifd0, TAG_ORIENTATION);
    if (orientationEntry) {
      const value = u16(orientationEntry.valuePos);
      if (value >= 1 && value <= 8) result.orientation = value;
    }

    // ── 时间 ────────────────────────────────────────────────────
    const exifIfdEntry = findEntry(ifd0, TAG_EXIF_IFD);
    if (exifIfdEntry) {
      const exifIfd = readIfd(exifIfdEntry.raw);
      let raw = readAscii(findEntry(exifIfd, TAG_DATE_TIME_ORIGINAL));
      if (raw.length === 0) raw = readAscii(findEntry(exifIfd, TAG_DATE_TIME_DIGITIZED));
      if (raw.length > 0) result.takenAt = parseExifDate(raw);
    }

    // ── GPS ─────────────────────────────────────────────────────
    const gpsIfdEntry = findEntry(ifd0, TAG_GPS_IFD);
    if (gpsIfdEntry) {
      const gps = readIfd(gpsIfdEntry.raw);
      const latRef = readAscii(findEntry(gps, TAG_GPS_LAT_REF)).toUpperCase();
      const lngRef = readAscii(findEntry(gps, TAG_GPS_LNG_REF)).toUpperCase();
      let lat = readDms(findEntry(gps, TAG_GPS_LAT));
      let lng = readDms(findEntry(gps, TAG_GPS_LNG));

      if (lat !== null && (latRef === 'S' || latRef === 's')) lat = -lat;
      if (lng !== null && (lngRef === 'W' || lngRef === 'w')) lng = -lng;

      const validLat = lat !== null && Number.isFinite(lat) && Math.abs(lat) <= 90;
      const validLng = lng !== null && Number.isFinite(lng) && Math.abs(lng) <= 180;
      // GPS 芯片未定位时会写 0,0，这是无效值
      const notNullIsland = !(lat === 0 && lng === 0);
      if (validLat && validLng && notNullIsland) {
        result.lat = lat;
        result.lng = lng;
      }
    }
  } catch {
    return emptyResult();
  }
  return result;
}

/** 从 File 读 EXIF（只取头部 512KB） */
export async function readExif(file: File): Promise<ExifResult> {
  try {
    const head = await file.slice(0, HEAD_LIMIT).arrayBuffer();
    return parseExifBuffer(head);
  } catch {
    return emptyResult();
  }
}
