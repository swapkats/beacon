import type { APIRoute } from "astro";
import { getEnv } from "../../lib/env";
import { removeStore } from "../../core/kv";
import { verifyWebhookHmac } from "../../platforms/shopify/oauth";

const GDPR_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ svc: "web", ts: new Date().toISOString(), ...fields }));
}

export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx.locals);
  const raw = await ctx.request.text();
  const hmacHeader = ctx.request.headers.get("x-shopify-hmac-sha256") ?? "";

  if (!hmacHeader || !(await verifyWebhookHmac(raw, env.SHOPIFY_API_SECRET, hmacHeader))) {
    log({ evt: "webhook.reject", reason: "bad_hmac" });
    return new Response(null, { status: 401 });
  }

  const topic = ctx.request.headers.get("x-shopify-topic") ?? "";
  const shop = ctx.request.headers.get("x-shopify-shop-domain") ?? "";

  if (topic === "app/uninstalled") {
    const removed = await removeStore(env, shop);
    log({ evt: "webhook.uninstalled", shop, removed });
  } else if (GDPR_TOPICS.has(topic)) {
    log({ evt: "webhook.gdpr", topic, shop, note: "no PII stored; no action required" });
  } else {
    log({ evt: "webhook.ignored", topic, shop });
  }

  return new Response(null, { status: 200 });
};
