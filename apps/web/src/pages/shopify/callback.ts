import type { APIRoute } from "astro";
import { getStoreByShop, getStoreRecord, provisionStore, type ShopifyCred } from "../../core/kv";
import { randomHex, ulid } from "../../core/ids";
import { getEnv } from "../../lib/env";
import {
  exchangeCodeForToken,
  normalizeShop,
  readState,
  verifyOauthCallback,
} from "../../platforms/shopify/oauth";
import { ensureWebPixel } from "../../platforms/shopify/admin";

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

  const existingIndex = await getStoreByShop(env, shop);
  let storeId: string;
  let ingestToken: string;
  let salt: string;
  if (existingIndex) {
    storeId = existingIndex.store_id;
    ingestToken = existingIndex.ingest_token;
    salt = (await getStoreRecord(env, storeId))?.salt ?? randomHex(32);
  } else {
    storeId = ulid();
    ingestToken = randomHex(24);
    salt = randomHex(32);
  }

  const cred: ShopifyCred = {
    access_token: token.access_token,
    scope: token.scope,
    updated_at: new Date().toISOString(),
  };
  await provisionStore(env, {
    record: {
      store_id: storeId,
      platform: "shopify",
      external_id: shop,
      salt,
      created_at: new Date().toISOString(),
    },
    ingestToken,
    cred,
  });

  const pixel = await ensureWebPixel(shop, token.access_token, {
    ingestUrl: env.PUBLIC_INGEST_URL,
    storeToken: ingestToken,
  });
  if (!pixel.ok) {
    log({ evt: "install.pixel_failed", shop, store_id: storeId, detail: pixel.detail });
    return fail(`web pixel setup failed: ${pixel.detail}`);
  }

  log({ evt: "install.complete", shop, store_id: storeId, pixel: pixel.detail });
  return ctx.redirect(`https://${shop}/admin/apps/${env.SHOPIFY_APP_HANDLE}`, 302);
};
