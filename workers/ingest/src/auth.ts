import type { StoreRecord } from "./env.js";

export function extractToken(
  authHeader: string | null,
  bodyToken: unknown
): string | null {
  if (authHeader) {
    const m = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
    if (m && m[1]) return m[1];
  }
  if (typeof bodyToken === "string" && bodyToken.length > 0 && bodyToken.length <= 128) {
    return bodyToken;
  }
  return null;
}

export async function resolveStore(
  stores: KVNamespace,
  token: string
): Promise<StoreRecord | null> {
  const raw = await stores.get(`store_by_token:${token}`, "json");
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Partial<StoreRecord>;
  if (
    typeof rec.store_id !== "string" ||
    typeof rec.salt !== "string" ||
    rec.store_id.length === 0 ||
    rec.salt.length < 32
  ) {
    return null;
  }
  return rec as StoreRecord;
}
