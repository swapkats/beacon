function b64urlToJson(input: string): Record<string, unknown> {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const json = atob(b64 + pad);
  return JSON.parse(json);
}

function b64urlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const raw = atob(b64 + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const CLOCK_LEEWAY_SECONDS = 5;

export type SessionTokenResult =
  | { ok: true; shop: string }
  | { ok: false; reason: string };

export async function verifySessionToken(
  token: string,
  apiKey: string,
  apiSecret: string
): Promise<SessionTokenResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = b64urlToJson(headerB64);
    claims = b64urlToJson(payloadB64);
  } catch {
    return { ok: false, reason: "undecodable token" };
  }
  if (header.alg !== "HS256") return { ok: false, reason: "unexpected alg" };

  const key = await hmacKey(apiSecret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!valid) return { ok: false, reason: "bad signature" };

  const now = Date.now() / 1000;
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  const nbf = typeof claims.nbf === "number" ? claims.nbf : 0;
  if (exp < now - CLOCK_LEEWAY_SECONDS) return { ok: false, reason: "expired token" };
  if (nbf > now + CLOCK_LEEWAY_SECONDS) return { ok: false, reason: "token not yet valid" };

  const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
  if (aud !== apiKey) return { ok: false, reason: "audience mismatch" };

  const dest = typeof claims.dest === "string" ? claims.dest : "";
  const iss = typeof claims.iss === "string" ? claims.iss : "";
  if (!dest.startsWith("https://") || !iss.startsWith("https://")) {
    return { ok: false, reason: "dest/iss must be https" };
  }
  const destOrigin = new URL(dest).origin;
  const issOrigin = new URL(iss).origin;
  if (destOrigin !== issOrigin) return { ok: false, reason: "dest/iss mismatch" };
  const host = new URL(destOrigin).hostname;
  if (!host.endsWith(".myshopify.com")) {
    return { ok: false, reason: "unexpected shop host" };
  }
  return { ok: true, shop: host };
}
