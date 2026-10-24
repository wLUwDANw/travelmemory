/** 行程列表客户端（后端 `GET /api/v1/trips`）。
 *
 * ## 为什么 trip 是后端聚类出来的，前端只读
 *
 * `services/trip_cluster.py` 按「时间相邻 + 空间相邻」单遍扫描切分行程，这套规则要
 * 读全部照片的 `taken_at` 与坐标。前端手上只有当次导入的几张，拿一半数据聚类就会
 * 出现"同一趟旅行被切成三段"。所以前端只消费结果，`source` 字段（cluster / manual）
 * 标出这条行程是算出来的还是用户手改的——手改过的下次不能被聚类覆盖掉。
 *
 * ## 错误处理与注入点
 *
 * 与 `photos.ts` 完全同构：非 2xx 抛 Error 并带上响应体；支持
 * `listTrips({ baseUrl, fetchImpl })` 与 `setTripsApi({ ... })`（传 `null` 复位）两级注入，
 * 兜底 `import.meta.env.VITE_API_BASE` + `globalThis.fetch`。
 */

export interface TripItemView {
  id: string;
  photoId: string;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  semanticTag: string | null;
  semanticLabel: string | null;
}

export interface TripView {
  id: string;
  title: string;
  startedAt: string | null;
  endedAt: string | null;
  /** "cluster"（自动聚类）| "manual"（用户手改过，后续重算不覆盖）。 */
  source: string;
  itemCount: number;
  items: TripItemView[];
}

export interface TripListResponse {
  trips: TripView[];
}

/** 线格式（后端 snake_case）。与 `ImportedPhoto` 分离的理由同上。 */
export interface RawTripItemView {
  id?: unknown;
  photo_id?: unknown;
  taken_at?: unknown;
  lat?: unknown;
  lng?: unknown;
  semantic_tag?: unknown;
  semantic_label?: unknown;
}

export interface RawTripView {
  id?: unknown;
  title?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  source?: unknown;
  item_count?: unknown;
  items?: unknown;
}

export interface RawTripListResponse {
  trips?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function toTripItemView(raw: RawTripItemView | null | undefined): TripItemView {
  const source: RawTripItemView = raw ?? {};
  return {
    id: asString(source.id) ?? '',
    photoId: asString(source.photo_id) ?? '',
    takenAt: asString(source.taken_at),
    lat: asNumber(source.lat),
    lng: asNumber(source.lng),
    semanticTag: asString(source.semantic_tag),
    semanticLabel: asString(source.semantic_label),
  };
}

export function toTripView(raw: RawTripView | null | undefined): TripView {
  const source: RawTripView = raw ?? {};
  const items = asArray(source.items).map((item) =>
    toTripItemView(item as RawTripItemView | null),
  );
  return {
    id: asString(source.id) ?? '',
    title: asString(source.title) ?? '',
    startedAt: asString(source.started_at),
    endedAt: asString(source.ended_at),
    source: asString(source.source) ?? 'cluster',
    itemCount: asNumber(source.item_count) ?? items.length,
    items,
  };
}

/** 可注入的客户端配置。留空则回落到环境变量 / 全局 fetch。 */
export interface TripsApiOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** 错误信息里最多带多少响应体（同 `photos.ts`，防止错误页撑爆日志）。 */
const MAX_ERROR_BODY = 500;

let override: TripsApiOptions | null = null;

/** 设置模块级默认配置（`null` = 复位回环境变量 + 全局 fetch）。 */
export function setTripsApi(options: TripsApiOptions | null): void {
  override = options;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function excerpt(body: string): string {
  const text = body.trim().replace(/\s+/g, ' ');
  return text.length > MAX_ERROR_BODY ? `${text.slice(0, MAX_ERROR_BODY)}…` : text;
}

function resolveBaseUrl(options?: TripsApiOptions): string {
  const raw = options?.baseUrl ?? override?.baseUrl ?? import.meta.env.VITE_API_BASE ?? '';
  return raw.replace(/\/+$/, '');
}

function resolveFetch(options?: TripsApiOptions): typeof fetch {
  const impl = options?.fetchImpl ?? override?.fetchImpl ?? globalThis.fetch;
  if (typeof impl !== 'function') {
    throw new Error('获取行程列表失败：当前环境没有 fetch，请通过 setTripsApi 注入 fetchImpl');
  }
  return impl;
}

/** 拉取当前用户的全部行程。空列表是正常结果（还没导入过照片），不抛错。 */
export async function listTrips(options?: TripsApiOptions): Promise<TripView[]> {
  const url = `${resolveBaseUrl(options)}/api/v1/trips`;
  let response: Response;
  try {
    response = await resolveFetch(options)(url, { method: 'GET' });
  } catch (err) {
    throw new Error(`获取行程列表失败：网络请求异常（${describeError(err)}）`);
  }

  if (!response.ok) {
    const body = excerpt(await response.text());
    throw new Error(`获取行程列表失败：HTTP ${response.status}${body ? ` —— ${body}` : ''}`);
  }

  // 后端返回 snake_case（`started_at` / `item_count` / `trip_ids`），
  // 前端内部一律 camelCase —— 归一化只在客户端这一层做一次。
  const payload = (await response.json()) as Partial<RawTripListResponse>;
  return asArray(payload.trips).map((item) => toTripView(item as RawTripView | null));
}
