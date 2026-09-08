import type { BeaconEvent } from "@beacon/protocol";

const MAX_BLOBS = 20;
const MAX_INDEX_BYTES = 96;

export interface MappedEvent {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

const encoder = new TextEncoder();

function clip(value: string, maxBytes: number): string {
  if (encoder.encode(value).length <= maxBytes) return value;
  let out = value;
  while (encoder.encode(out).length > maxBytes && out.length > 0) {
    out = out.slice(0, Math.floor(out.length / 2));
  }
  return out;
}

export function hashClientId(key: CryptoKey, clientId: string): Promise<string> {
  return crypto.subtle
    .sign("HMAC", key, new TextEncoder().encode(clientId))
    .then(hex);
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function importStoreKey(salt: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export function mapEvent(
  storeId: string,
  event: BeaconEvent,
  clientHash: string
): MappedEvent {
  const productId = event.props?.product_id ?? "";
  const path = event.props?.path ?? "";
  const title = event.props?.title ?? "";
  const blobs = [
    event.event_type,
    productId,
    event.session_id,
    clientHash,
    event.landing_product_id ?? "",
    path,
    title,
  ];
  if (blobs.length > MAX_BLOBS) throw new Error("too many blobs");
  return {
    indexes: [clip(storeId, MAX_INDEX_BYTES)],
    blobs,
    doubles: [event.page_num, event.props?.quantity ?? 0],
  };
}

export function writeMapped(
  dataset: AnalyticsEngineDataset,
  mapped: MappedEvent
): void {
  dataset.writeDataPoint({
    indexes: mapped.indexes,
    blobs: mapped.blobs,
    doubles: mapped.doubles,
  });
}

const keyCache = new Map<string, CryptoKey>();

export async function storeKey(salt: string): Promise<CryptoKey> {
  const cached = keyCache.get(salt);
  if (cached) return cached;
  const key = await importStoreKey(salt);
  if (keyCache.size >= 100) keyCache.clear();
  keyCache.set(salt, key);
  return key;
}
