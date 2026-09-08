import type { APIRoute } from "astro";
import { getEnv } from "../../lib/env";
import { verifySessionToken } from "../../core/session-token";
import { getStoreByShop } from "../../core/kv";
import { fetchEngagement } from "../../core/ae";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "X-Shopify-Retry-Invalid-Session-Request": "1",
    },
  });
}

export const GET: APIRoute = async (ctx) => {
  const env = getEnv(ctx.locals);

  const match = /^Bearer\s+(\S+)$/i.exec(ctx.request.headers.get("authorization") ?? "");
  if (!match) return unauthorized();

  const session = await verifySessionToken(match[1], env.SHOPIFY_API_KEY, env.SHOPIFY_API_SECRET);
  if (!session.ok) return unauthorized();

  const index = await getStoreByShop(env, session.shop);
  if (!index) {
    return Response.json({ error: "store_not_registered" }, { status: 404 });
  }

  const days = ctx.url.searchParams.get("days") === "30" ? 30 : 7;

  try {
    const engagement = await fetchEngagement(env, index.store_id, days);
    return Response.json({
      shop: session.shop,
      store_id: index.store_id,
      days,
      ...engagement,
    });
  } catch (e) {
    console.log(
      JSON.stringify({
        svc: "web",
        evt: "stats.error",
        store_id: index.store_id,
        err: e instanceof Error ? e.message : String(e),
      })
    );
    return Response.json({ error: "stats_unavailable" }, { status: 502 });
  }
};
