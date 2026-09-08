import type { Env } from "../../env";
import { getStoreByShop, getStoreRecord, provisionStore } from "../../core/kv";
import { randomHex, ulid } from "../../core/ids";
import type { ShopifyCred } from "../../core/kv";

export interface ProvisionedStore {
  store_id: string;
  ingest_token: string;
  created: boolean;
}

export async function provisionShopStore(
  env: Env,
  shop: string,
  cred: ShopifyCred
): Promise<ProvisionedStore> {
  const existingIndex = await getStoreByShop(env, shop);
  if (existingIndex) {
    const existingSalt = (await getStoreRecord(env, existingIndex.store_id))?.salt ?? randomHex(32);
    await provisionStore(env, {
      record: {
        store_id: existingIndex.store_id,
        platform: "shopify",
        external_id: shop,
        salt: existingSalt,
        created_at: new Date().toISOString(),
      },
      ingestToken: existingIndex.ingest_token,
      cred,
    });
    return {
      store_id: existingIndex.store_id,
      ingest_token: existingIndex.ingest_token,
      created: false,
    };
  }

  const storeId = ulid();
  const ingestToken = randomHex(24);
  await provisionStore(env, {
    record: {
      store_id: storeId,
      platform: "shopify",
      external_id: shop,
      salt: randomHex(32),
      created_at: new Date().toISOString(),
    },
    ingestToken,
    cred,
  });
  return { store_id: storeId, ingest_token: ingestToken, created: true };
}
