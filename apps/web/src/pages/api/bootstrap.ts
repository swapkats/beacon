import type { APIRoute } from "astro";
import { getEnv } from "../../lib/env";
import { verifySessionToken } from "../../core/session-token";
import { provisionShopStore } from "../../platforms/shopify/provision";
import { ensureWebPixel } from "../../platforms/shopify/admin";
import { exchangeIdTokenForOfflineToken } from "../../platforms/shopify/oauth";

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ svc: "web", ts: new Date().toISOString(), ...fields }));
}

function jsonError(status: number, error: string, detail?: string): Response {
  return Response.json(detail ? { error, detail } : { error }, { status });
}

export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx.locals);

  const match = /^Bearer\s+(\S+)$/i.exec(ctx.request.headers.get("authorization") ?? "");
  if (!match) return jsonError(401, "unauthorized");

  const session = await verifySessionToken(match[1], env.SHOPIFY_API_KEY, env.SHOPIFY_API_SECRET);
  if (!session.ok) {
    log({ evt: "bootstrap.reject", reason: session.reason });
    return jsonError(401, "unauthorized", session.reason);
  }
  const shop = session.shop;

  const cred = await exchangeIdTokenForOfflineToken(shop, match[1], {
    apiKey: env.SHOPIFY_API_KEY,
    apiSecret: env.SHOPIFY_API_SECRET,
  });
  if (!cred) {
    log({ evt: "bootstrap.exchange_failed", shop });
    return jsonError(502, "token_exchange_failed");
  }

  const provisioned = await provisionShopStore(env, shop, {
    access_token: cred.access_token,
    scope: cred.scope,
    updated_at: new Date().toISOString(),
  });

  const pixel = await ensureWebPixel(shop, cred.access_token, {
    ingestUrl: env.PUBLIC_INGEST_URL,
    storeToken: provisioned.ingest_token,
  });
  if (!pixel.ok) {
    log({ evt: "bootstrap.pixel_failed", shop, store_id: provisioned.store_id, detail: pixel.detail });
    return jsonError(502, "pixel_setup_failed", pixel.detail);
  }

  log({
    evt: "bootstrap.complete",
    shop,
    store_id: provisioned.store_id,
    created: provisioned.created,
    pixel: pixel.detail,
  });
  return Response.json({
    ok: true,
    shop,
    store_id: provisioned.store_id,
    pixel: pixel.detail,
  });
};
