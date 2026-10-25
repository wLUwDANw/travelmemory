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

/** `POST /api/v1/trips` 的响应体（后端 `TripCreateResponse`）。 */
export interface RawTripCreateResponse {
  trip?: unknown;
}

/**
 * 手工创建一个**空**行程，返回后端给的那一条（`source = 'manual'`）。
 *
 * ## 为什么这里不自己拼一个 TripView 返回
 *
 * 后端要生成的只有 id 和主键，但"这次到底建成了什么"只有后端知道：
 * `source` 是不是真的 `manual`、`started_at` 是不是 `null`、标题被剥成什么样。
 * 前端按入参自己拼一份，等于把"创建成功"变成一个**本地断言** ——
 * 哪天后端改了降级策略（比如开关没开时返回 404），前端照样报"创建成功"。
 *
 * ## 404 的错误信息为什么要说人话
 *
 * 后端 `photo_import` 开关关着时返回 404（能力不存在，不是权限问题）。
 * 直接把 `HTTP 404` 抛给上层，用户看到的是一句看不懂的数字；
 * 而这是**可预期的运营状态**，不是 bug —— 所以在这里翻译成一句能行动的话。
 */
export async function createTrip(title: string, options?: TripsApiOptions): Promise<TripView> {
  const url = `${resolveBaseUrl(options)}/api/v1/trips`;
  let response: Response;
  try {
    response = await resolveFetch(options)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  } catch (err) {
    throw new Error(`新建旅程失败：网络请求异常（${describeError(err)}）`);
  }

  if (response.status === 404) {
    throw new Error('新建旅程失败：后端尚未启用照片导入能力（photo_import 开关未开）');
  }

  if (!response.ok) {
    const body = excerpt(await response.text());
    throw new Error(`新建旅程失败：HTTP ${response.status}${body ? ` —— ${body}` : ''}`);
  }

  const payload = (await response.json()) as Partial<RawTripCreateResponse>;
  return toTripView(payload.trip as RawTripView | null);
}

/**
 * 重命名一趟行程（`PATCH /api/v1/trips/{id}`）。
 *
 * ## 为什么返回刷新后的那一条，而不是把入参回显
 *
 * 后端会把 `source` 从 `cluster` 提升成 `manual`（改名的行程从此退出自动重建，
 * 否则下次导入会把用户敲的标题冲掉）。这个副作用**只有后端知道** ——
 * 前端按入参拼一个返回值，就会在界面上继续显示"聚类"徽章，
 * 而下一次导入后标题变了，用户完全看不出为什么。
 *
 * 404 的错误信息与 `createTrip` 同样翻译成人话：行程不存在与能力没开
 * 都走这个码，而后者是**可预期的运营状态**。
 */
export async function renameTrip(
  id: string,
  title: string,
  options?: TripsApiOptions,
): Promise<TripView> {
  const url = `${resolveBaseUrl(options)}/api/v1/trips/${encodeURIComponent(id)}`;
  let response: Response;
  try {
    response = await resolveFetch(options)(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  } catch (err) {
    throw new Error(`重命名失败：网络请求异常（${describeError(err)}）`);
  }

  if (response.status === 404) {
    throw new Error('重命名失败：该行程不存在，或后端尚未启用照片导入能力');
  }
  if (!response.ok) {
    const body = excerpt(await response.text());
    throw new Error(`重命名失败：HTTP ${response.status}${body ? ` —— ${body}` : ''}`);
  }

  const payload = (await response.json()) as Partial<RawTripCreateResponse>;
  return toTripView(payload.trip as RawTripView | null);
}
