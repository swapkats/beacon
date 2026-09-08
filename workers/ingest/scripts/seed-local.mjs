import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const STORE_ID = "01JBEACONPOCSTORE0000000000";
const TOKEN = "devtoken_" + (process.env.DEV_INGEST_TOKEN ?? "0000000000000000000000");
const record = {
  store_id: STORE_ID,
  platform: "shopify",
  external_id: "poc-store.myshopify.com",
  salt: randomBytes(32).toString("hex"),
  created_at: new Date().toISOString(),
};

const args = [
  "kv", "key", "put",
  `store_by_token:${TOKEN}`,
  JSON.stringify(record),
  "--binding", "STORES",
  "--local",
];

execFileSync("wrangler", args, { cwd: new URL("..", import.meta.url).pathname, stdio: "inherit" });
console.log(`seeded local KV: token=${TOKEN} store=${STORE_ID}`);
