import type { APIRoute } from "astro";
import { getStoreRecord, type ShopifyCred } from "../../core/kv";
import { getEnv } from "../../lib/env";
import {
  exchangeCodeForToken,
  normalizeShop,
  readState,
  verifyOauthCallback,
} from "../../platforms/shopify/oauth";
import { ensureWebPixel } from "../../platforms/shopify/admin";
import { provisionShopStore } from "../../platforms/shopify/provision";

function fail(message: string): Response {
  return new Response(`Installation failed: ${message}`, { status: 400 });
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ svc: "web", ts: new Date().toISOString(), ...fields }));
}

export const GET: APIRoute = async (ctx) => {
  const env = getEnv(ctx.locals);
  const url = new URL(ctx.request.url);

  const shop = normalizeShop(url.searchParams.get("shop"));
  if (!shop) return fail("invalid shop parameter");

  const cookieState = ctx.cookies.get("beacon_oauth")?.value;
  ctx.cookies.delete("beacon_oauth", { path: "/" });

  const state = await readState(cookieState, env.SHOPIFY_API_SECRET);
  if (!state || state.shop !== shop) return fail("invalid or expired state");

  if (!(await verifyOauthCallback(url.searchParams, env.SHOPIFY_API_SECRET))) {
    return fail("callback HMAC verification failed");
  }

  const code = url.searchParams.get("code");
  if (!code) return fail("missing authorization code");

  const token = await exchangeCodeForToken(shop, code, {
    apiKey: env.SHOPIFY_API_KEY,
    apiSecret: env.SHOPIFY_API_SECRET,
  });
  if (!token) return fail("token exchange failed");

  const provisioned = await provisionShopStore(env, shop, {
    access_token: token.access_token,
    scope: token.scope,
    updated_at: new Date().toISOString(),
  } satisfies ShopifyCred);

  const pixel = await ensureWebPixel(shop, token.access_token, {
    ingestUrl: env.PUBLIC_INGEST_URL,
    storeToken: provisioned.ingest_token,
  });
  if (!pixel.ok) {
    log({ evt: "install.pixel_failed", shop, store_id: provisioned.store_id, detail: pixel.detail });
    return fail(`web pixel setup failed: ${pixel.detail}`);
  }

  log({ evt: "install.complete", shop, store_id: provisioned.store_id, pixel: pixel.detail });
  return ctx.redirect(`https://${shop}/admin/apps/${env.SHOPIFY_APP_HANDLE}`, 302);
};
