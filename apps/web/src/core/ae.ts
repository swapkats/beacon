import type { Env } from "../env";

export interface AeQueryResult {
  data: Array<Record<string, unknown>>;
}

export async function aeQuery(env: Env, sql: string): Promise<AeQueryResult> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CF_AE_TOKEN}`,
        "content-type": "text/plain",
      },
      body: sql,
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`AE SQL API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
  return { data: body.data ?? [] };
}

export interface ProductEngagement {
  product_id: string;
  title: string;
  views: number;
  cart_adds: number;
  checkouts: number;
  sessions: number;
  bounced: number;
  bounce_rate: number | null;
  score: number;
}

export interface StoreEngagement {
  sessions: number;
  bounced: number;
  bounce_rate: number | null;
}

export async function fetchEngagement(
  env: Env,
  storeId: string,
  days: number
): Promise<{ products: ProductEngagement[]; store: StoreEngagement }> {
  const dataset = env.AE_DATASET || "beacon_events";

  const engagement = await aeQuery(
    env,
    `SELECT blob2 AS product_id, blob7 AS title,
            SUM(if(blob1 = 'product.viewed', _sample_interval, 0)) AS views,
            SUM(if(blob1 = 'cart.added', _sample_interval, 0)) AS cart_adds,
            SUM(if(blob1 = 'checkout.started', _sample_interval, 0)) AS checkouts
     FROM ${dataset}
     WHERE index1 = '${storeId}' AND timestamp > NOW() - INTERVAL '${days}' DAY AND blob2 != ''
     GROUP BY blob2, blob7
     ORDER BY views DESC
     LIMIT 500`
  );

  const sessionsByLanding = await aeQuery(
    env,
    `SELECT lp AS landing_product_id, count() AS sessions, SUM(if(maxpn = 1, 1, 0)) AS bounced
     FROM (
       SELECT blob5 AS lp, blob3 AS sid, MAX(double1) AS maxpn
       FROM ${dataset}
       WHERE index1 = '${storeId}' AND timestamp > NOW() - INTERVAL '${days}' DAY
       GROUP BY lp, sid
     )
     GROUP BY lp
     ORDER BY sessions DESC
     LIMIT 200`
  );

  const bounceByProduct = new Map<string, { sessions: number; bounced: number }>();
  const store: StoreEngagement = { sessions: 0, bounced: 0, bounce_rate: null };
  for (const row of sessionsByLanding.data) {
    const lp = String(row.landing_product_id ?? "");
    const sessions = Number(row.sessions ?? 0);
    const bounced = Number(row.bounced ?? 0);
    if (lp === "") {
      store.sessions = sessions;
      store.bounced = bounced;
      store.bounce_rate = sessions > 0 ? bounced / sessions : null;
      continue;
    }
    bounceByProduct.set(lp, { sessions, bounced });
  }

  const byProduct = new Map<string, ProductEngagement>();
  for (const row of engagement.data) {
    const productId = String(row.product_id ?? "");
    if (productId === "") continue;
    const title = String(row.title ?? "");
    const views = Number(row.views ?? 0);
    const cartAdds = Number(row.cart_adds ?? 0);
    const checkouts = Number(row.checkouts ?? 0);
    const existing = byProduct.get(productId);
    if (existing) {
      existing.views += views;
      existing.cart_adds += cartAdds;
      existing.checkouts += checkouts;
      if (existing.title === "" && title !== "") existing.title = title;
    } else {
      byProduct.set(productId, {
        product_id: productId,
        title,
        views,
        cart_adds: cartAdds,
        checkouts,
        sessions: 0,
        bounced: 0,
        bounce_rate: null,
        score: 0,
      });
    }
  }

  const products = [...byProduct.values()];
  for (const p of products) {
    const bounce = bounceByProduct.get(p.product_id);
    p.sessions = bounce?.sessions ?? 0;
    p.bounced = bounce?.bounced ?? 0;
    p.bounce_rate = bounce && p.sessions > 0 ? p.bounced / p.sessions : null;
    p.score = p.views + 5 * p.cart_adds + 20 * p.checkouts;
  }

  products.sort((a, b) => b.score - a.score);
  return { products, store };
}
