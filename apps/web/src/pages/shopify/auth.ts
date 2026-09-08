import type { APIRoute } from "astro";
import { ulid } from "../../core/ids";
import { getEnv } from "../../lib/env";
import {
  SHOPIFY_SCOPES,
  buildAuthorizeUrl,
  normalizeShop,
  signState,
} from "../../platforms/shopify/oauth";

export const GET: APIRoute = async (ctx) => {
  const env = getEnv(ctx.locals);
  const url = new URL(ctx.request.url);
  const shop = normalizeShop(url.searchParams.get("shop"));
  if (!shop) {
    return new Response("invalid shop parameter", { status: 400 });
  }

  const state = await signState({ shop, nonce: ulid(), ts: Date.now() }, env.SHOPIFY_API_SECRET);
  ctx.cookies.set("beacon_oauth", state, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
  });

  const redirectUri = `${url.origin}/shopify/callback`;
  return ctx.redirect(
    buildAuthorizeUrl(shop, {
      apiKey: env.SHOPIFY_API_KEY,
      redirectUri,
      state,
      scopes: SHOPIFY_SCOPES,
    }),
    302
  );
};
