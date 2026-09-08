import { LIMITS, validateBatch } from "@beacon/protocol";
import { extractToken, resolveStore } from "./auth.js";
import { hashClientId, mapEvent, storeKey, writeMapped } from "./engine.js";
import type { Env } from "./env.js";

const MAX_BODY_BYTES = LIMITS.MAX_BODY_BYTES;

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ svc: "ingest", ts: new Date().toISOString(), ...fields }));
}

function tokenDigest(token: string): string {
  return token.slice(0, 12) + ":" + token.length;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const start = Date.now();
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return new Response(null, { status: 204 });
    }

    if (url.pathname !== "/v1/events") {
      return jsonError(404, "not_found", "unknown path");
    }

    if (request.method !== "POST") {
      return jsonError(405, "method_not_allowed", "use POST");
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      log({ evt: "ingest.reject", reason: "body_too_large", status: 413, dur_ms: Date.now() - start });
      return jsonError(413, "payload_too_large", `body exceeds ${MAX_BODY_BYTES} bytes`);
    }

    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return jsonError(400, "invalid_body", "could not read request body");
    }
    if (raw.length > MAX_BODY_BYTES) {
      log({ evt: "ingest.reject", reason: "body_too_large", status: 413, dur_ms: Date.now() - start });
      return jsonError(413, "payload_too_large", `body exceeds ${MAX_BODY_BYTES} bytes`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log({ evt: "ingest.reject", reason: "invalid_json", status: 400, dur_ms: Date.now() - start });
      return jsonError(400, "invalid_json", "body is not valid JSON");
    }
    if (typeof parsed !== "object" || parsed === null) {
      return jsonError(400, "invalid_body", "body must be a JSON object");
    }
    const body = parsed as Record<string, unknown>;

    const token = extractToken(request.headers.get("authorization"), body.token);
    if (!token) {
      log({ evt: "ingest.reject", reason: "missing_token", status: 401, dur_ms: Date.now() - start });
      return jsonError(401, "unauthorized", "missing ingest token");
    }

    if (env.RATE_LIMITER) {
      const perMin = Number(env.INGEST_RATE_LIMIT_PER_MIN ?? "120");
      try {
        const result = await env.RATE_LIMITER.limit({ key: tokenDigest(token) });
        if (!result.success) {
          log({ evt: "ingest.reject", reason: "rate_limited", status: 429, dur_ms: Date.now() - start });
          return jsonError(429, "rate_limited", `limit is ${perMin} requests per minute`);
        }
      } catch (e) {
        log({ evt: "ingest.ratelimit_unavailable", err: e instanceof Error ? e.message : String(e) });
      }
    }

    const store = await resolveStore(env.STORES, token);
    if (!store) {
      log({ evt: "ingest.reject", reason: "unknown_token", token: tokenDigest(token), status: 401, dur_ms: Date.now() - start });
      return jsonError(401, "unauthorized", "invalid ingest token");
    }

    const batch = validateBatch(parsed);
    if (!batch.ok) {
      log({ evt: "ingest.reject", reason: "invalid_batch", store_id: store.store_id, detail: batch.error, status: 400, dur_ms: Date.now() - start });
      return jsonError(400, "invalid_events", batch.error);
    }

    const key = await storeKey(store.salt);
    for (const event of batch.value) {
      const clientHash = await hashClientId(key, event.client_id);
      writeMapped(env.EVENTS, mapEvent(store.store_id, event, clientHash));
    }

    log({
      evt: "ingest.accept",
      store_id: store.store_id,
      platform: store.platform,
      count: batch.value.length,
      events: batch.value.map((e) => [e.event_type, e.props?.product_id ?? ""]),
      status: 204,
      dur_ms: Date.now() - start,
    });
    return new Response(null, { status: 204 });
  },
};
