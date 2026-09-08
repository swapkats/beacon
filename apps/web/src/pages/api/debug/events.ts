import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { verifySessionToken } from "../../../core/session-token";
import { getStoreByShop } from "../../../core/kv";
import { aeQuery } from "../../../core/ae";

export const GET: APIRoute = async (ctx) => {
  const env = getEnv(ctx.locals);

  const match = /^Bearer\s+(\S+)$/i.exec(ctx.request.headers.get("authorization") ?? "");
  if (!match) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const session = await verifySessionToken(match[1], env.SHOPIFY_API_KEY, env.SHOPIFY_API_SECRET);
  if (!session.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const index = await getStoreByShop(env, session.shop);
  if (!index) {
    return Response.json({ error: "store_not_registered" }, { status: 404 });
  }

  const hours = Math.min(168, Math.max(1, Number(ctx.url.searchParams.get("hours") ?? "24") || 24));
  const dataset = env.AE_DATASET || "beacon_events";

  try {
    const result = await aeQuery(
      env,
      `SELECT blob1 AS event_type, blob2 AS product_id, count() AS n
       FROM ${dataset}
       WHERE index1 = '${index.store_id}' AND timestamp > NOW() - INTERVAL '${hours}' HOUR
       GROUP BY blob1, blob2
       ORDER BY n DESC
       LIMIT 100`
    );
    return Response.json({ shop: session.shop, hours, rows: result.data });
  } catch (e) {
    console.log(
      JSON.stringify({
        svc: "web",
        evt: "debug.error",
        store_id: index.store_id,
        err: e instanceof Error ? e.message : String(e),
      })
    );
    return Response.json({ error: "debug_unavailable" }, { status: 502 });
  }
};
