const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShop(input: string | null | undefined): string | null {
  if (!input) return null;
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!SHOP_RE.test(host)) return null;
  return host;
}

export const SHOPIFY_SCOPES = "write_pixels,read_customer_events";

export function buildAuthorizeUrl(shop: string, opts: {
  apiKey: string;
  redirectUri: string;
  state: string;
  scopes: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.apiKey,
    scope: opts.scopes,
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

async function hmacHex(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyOauthCallback(
  params: URLSearchParams,
  apiSecret: string
): Promise<boolean> {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  pairs.sort();
  const digest = await hmacHex(apiSecret, pairs.join("&"));
  const provided = hexToBytes(hmac);
  return timingSafeEqual(digest, provided);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) return new Uint8Array(0);
    out[i] = b;
  }
  return out;
}

export interface StatePayload {
  shop: string;
  nonce: string;
  ts: number;
}

export async function signState(payload: StatePayload, secret: string): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const digest = await hmacHex(secret, body);
  return `${body}.${toHex(digest)}`;
}

export async function readState(
  value: string | undefined,
  secret: string,
  maxAgeSeconds = 600
): Promise<StatePayload | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sigHex = value.slice(dot + 1);
  const expected = await hmacHex(secret, body);
  if (!timingSafeEqual(expected, hexToBytes(sigHex))) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (
      typeof json.shop !== "string" ||
      typeof json.nonce !== "string" ||
      typeof json.ts !== "number"
    ) {
      return null;
    }
    if (Date.now() - json.ts > maxAgeSeconds * 1000) return null;
    return json as StatePayload;
  } catch {
    return null;
  }
}

function b64urlEncode(bytes: Uint8Array): string {
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const raw = atob(b64 + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export interface OAuthTokenResponse {
  access_token: string;
  scope?: string;
}

export async function exchangeCodeForToken(
  shop: string,
  code: string,
  opts: { apiKey: string; apiSecret: string }
): Promise<OAuthTokenResponse | null> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: opts.apiKey,
      client_secret: opts.apiSecret,
      code,
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string; scope?: string };
  if (!body.access_token) return null;
  return { access_token: body.access_token, scope: body.scope };
}

export async function verifyWebhookHmac(
  rawBody: string,
  apiSecret: string,
  headerHmac: string
): Promise<boolean> {
  const digest = await hmacHex(apiSecret, rawBody);
  const digestB64 = btoa(String.fromCharCode(...digest));
  return timingSafeEqual(
    new TextEncoder().encode(digestB64),
    new TextEncoder().encode(headerHmac)
  );
}
