import type { BeaconEvent, EventType } from "@beacon/protocol";

export interface CollectorStorage {
  get(key: string): string | null | undefined;
  set(key: string, value: string, maxAgeSeconds: number): void;
}

export interface BeaconTransport {
  send(payload: string): boolean;
}

export interface CollectorOptions {
  endpoint: string;
  storeToken: string;
  storage: CollectorStorage;
  transport?: BeaconTransport;
  sessionTtlSeconds?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  now?: () => number;
  uuid?: () => string;
  onError?: (reason: string) => void;
}

export interface TrackInput {
  type: EventType;
  clientId: string;
  productId?: string | null;
  variantId?: string | null;
  title?: string | null;
  price?: number | null;
  currency?: string | null;
  quantity?: number | null;
  path?: string | null;
  referrer?: string | null;
}

export interface Collector {
  track(input: TrackInput): void;
  flush(): void;
}

const SESSION_KEY = "bs_sess";
const PAGE_NUM_KEY = "bs_pn";
const LANDING_KEY = "bs_land";
const DEFAULT_SESSION_TTL_SECONDS = 1800;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 1500;

function defaultUuid(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function defaultTransport(endpoint: string, onError?: (reason: string) => void): BeaconTransport {
  return {
    send(payload: string): boolean {
      try {
        if (
          typeof navigator !== "undefined" &&
          typeof navigator.sendBeacon === "function" &&
          navigator.sendBeacon(endpoint, payload)
        ) {
          return true;
        }
      } catch (e) {
        onError?.(`sendBeacon failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        if (typeof fetch === "function") {
          void fetch(endpoint, { method: "POST", body: payload, keepalive: true }).catch(() => {});
          return true;
        }
      } catch (e) {
        onError?.(`fetch fallback failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return false;
    },
  };
}

export function initCollector(options: CollectorOptions): Collector {
  const ttl = options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const uuid = options.uuid ?? defaultUuid;
  const storage = options.storage;
  const transport =
    options.transport ?? defaultTransport(options.endpoint, options.onError);
  const onError = options.onError;

  const queue: BeaconEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pageInstanceCounted = false;

  function refresh(key: string, value: string): void {
    storage.set(key, value, ttl);
  }

  function resolveSession(): string {
    const existing = storage.get(SESSION_KEY);
    if (existing) {
      refresh(SESSION_KEY, existing);
      return existing;
    }
    const sid = uuid();
    refresh(SESSION_KEY, sid);
    return sid;
  }

  function resolveLanding(firstEventProductId: string | undefined): string {
    const existing = storage.get(LANDING_KEY);
    if (existing !== null && existing !== undefined) {
      refresh(LANDING_KEY, existing);
      return existing;
    }
    const value = firstEventProductId ?? "";
    refresh(LANDING_KEY, value);
    return value;
  }

  function nextPageNum(): number {
    const current = Number.parseInt(storage.get(PAGE_NUM_KEY) ?? "0", 10);
    const value = Number.isFinite(current) && current > 0 ? current : 0;
    if (pageInstanceCounted) {
      refresh(PAGE_NUM_KEY, String(value === 0 ? 1 : value));
      return value === 0 ? 1 : value;
    }
    pageInstanceCounted = true;
    const next = value + 1;
    refresh(PAGE_NUM_KEY, String(next));
    return next;
  }

  function enqueue(event: BeaconEvent): void {
    queue.push(event);
    if (queue.length >= batchSize) {
      flush();
      return;
    }
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, flushIntervalMs);
    }
  }

  function flush(): void {
    if (queue.length === 0) return;
    const batch = queue.splice(0, batchSize);
    try {
      const ok = transport.send(JSON.stringify({ token: options.storeToken, events: batch }));
      if (!ok) {
        onError?.(`transport rejected batch of ${batch.length} event(s)`);
      }
    } catch (e) {
      onError?.(`flush failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function track(input: TrackInput): void {
    if (!input || !input.type || !input.clientId) {
      onError?.("track called without type/clientId; event dropped");
      return;
    }
    const sessionId = resolveSession();
    const landing =
      input.type === "product.viewed" && input.productId
        ? input.productId
        : undefined;
    const landingProductId = resolveLanding(landing);
    const pageNum = nextPageNum();

    const props: Record<string, string | number> = {};
    if (input.path) props.path = String(input.path);
    if (input.referrer) props.referrer = String(input.referrer);
    if (input.productId) props.product_id = String(input.productId);
    if (input.variantId) props.variant_id = String(input.variantId);
    if (input.title) props.title = String(input.title);
    if (typeof input.price === "number" && Number.isFinite(input.price)) props.price = input.price;
    if (input.currency) props.currency = String(input.currency);
    if (typeof input.quantity === "number" && Number.isInteger(input.quantity)) {
      props.quantity = input.quantity;
    }

    enqueue({
      event_id: uuid(),
      event_type: input.type,
      ts: new Date(now()).toISOString(),
      session_id: sessionId,
      client_id: input.clientId,
      page_num: pageNum,
      landing_product_id: landingProductId === "" ? null : landingProductId,
      ...(Object.keys(props).length > 0 ? { props } : {}),
    });
  }

  return {
    track,
    flush,
  };
}
