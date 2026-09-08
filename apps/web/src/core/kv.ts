export interface StoreRecord {
  store_id: string;
  platform: string;
  external_id: string;
  salt: string;
  created_at: string;
}

export interface StoreIndex {
  store_id: string;
  ingest_token: string;
}

export interface ShopifyCred {
  access_token: string;
  scope?: string;
  updated_at: string;
}

export async function getStoreByShop(
  env: Env,
  externalId: string
): Promise<StoreIndex | null> {
  return env.STORES.get<StoreIndex>(`store_by_shop:shopify:${externalId}`, "json");
}

export async function getStoreRecord(
  env: Env,
  storeId: string
): Promise<StoreRecord | null> {
  return env.STORES.get<StoreRecord>(`store:${storeId}`, "json");
}

export async function getShopifyCred(
  env: Env,
  storeId: string
): Promise<ShopifyCred | null> {
  return env.STORES.get<ShopifyCred>(`cred:shopify:${storeId}`, "json");
}

export interface StoreProvisionInput {
  record: StoreRecord;
  ingestToken: string;
  cred: ShopifyCred;
}

export async function provisionStore(env: Env, input: StoreProvisionInput): Promise<void> {
  const { record, ingestToken, cred } = input;
  await env.STORES.put(`store:${record.store_id}`, JSON.stringify(record));
  await env.STORES.put(
    `cred:shopify:${record.store_id}`,
    JSON.stringify(cred)
  );
  await env.STORES.put(
    `store_by_shop:shopify:${record.external_id}`,
    JSON.stringify({ store_id: record.store_id, ingest_token: ingestToken })
  );
  await env.STORES.put(
    `store_by_token:${ingestToken}`,
    JSON.stringify(record)
  );
}

export async function removeStore(env: Env, externalId: string): Promise<boolean> {
  const index = await getStoreByShop(env, externalId);
  if (!index) return false;
  await env.STORES.delete(`store_by_shop:shopify:${externalId}`);
  await env.STORES.delete(`store_by_token:${index.ingest_token}`);
  await env.STORES.delete(`cred:shopify:${index.store_id}`);
  await env.STORES.delete(`store:${index.store_id}`);
  return true;
}
