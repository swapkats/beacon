import { execFileSync } from "node:child_process";

const TOKEN = process.env.DEV_INGEST_TOKEN ?? "devtoken_0000000000000000000000";
const BASE = process.env.INGEST_URL ?? "http://127.0.0.1:8787";

let pass = 0;
let fail = 0;

async function call(name, expectStatus, init) {
  const res = await fetch(`${BASE}/v1/events`, init);
  const ok = res.status === expectStatus;
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL ${name}: expected ${expectStatus}, got ${res.status} — ${await res.text()}`);
  }
}

const futureOk = new Date(Date.now() - 5_000).toISOString();

const validBatch = {
  token: TOKEN,
  events: [
    {
      event_id: "fx_evt_001",
      event_type: "page.viewed",
      ts: futureOk,
      session_id: "fx_sess_001",
      client_id: "fx_client_001",
      page_num: 1,
      props: { path: "/" },
    },
    {
      event_id: "fx_evt_002",
      event_type: "product.viewed",
      ts: futureOk,
      session_id: "fx_sess_001",
      client_id: "fx_client_001",
      page_num: 1,
      landing_product_id: "fx_prod_1",
      props: { product_id: "fx_prod_1", title: "Fixture Product", price: 24.5, currency: "USD" },
    },
  ],
};

{
  const res = await fetch(`${BASE}/healthz`);
  if (res.status === 204) pass++;
  else { fail++; console.error(`FAIL healthz: got ${res.status}`); }
}

await call("401 no token", 401, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(validBatch.events),
});

await call("400 invalid json", 400, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{not json",
});

await call("400 invalid event", 400, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: TOKEN, events: [{ event_id: "x" }] }),
});

await call("413 oversized", 413, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: TOKEN, events: [{ pad: "x".repeat(20 * 1024) }] }),
});

await call("204 valid batch (body token)", 204, {
  method: "POST",
  headers: { "content-type": "text/plain" },
  body: JSON.stringify(validBatch),
});

await call("204 valid batch (bearer)", 204, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ events: validBatch.events }),
});

await call("400 stale ts", 400, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    token: TOKEN,
    events: [{ ...validBatch.events[0], ts: new Date(Date.now() - 3_600_000).toISOString() }],
  }),
});

{
  const res = await fetch(`${BASE}/nope`, { method: "POST" });
  if (res.status === 404) pass++;
  else {
    fail++;
    console.error(`FAIL 404 unknown path: got ${res.status}`);
  }
}

console.log(`\nfixtures: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
