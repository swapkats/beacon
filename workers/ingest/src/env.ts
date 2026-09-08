export interface RateLimiterBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  EVENTS: AnalyticsEngineDataset;
  STORES: KVNamespace;
  RATE_LIMITER?: RateLimiterBinding;
  INGEST_RATE_LIMIT_PER_MIN?: string;
}

export interface StoreRecord {
  store_id: string;
  platform: string;
  external_id: string;
  salt: string;
  created_at: string;
}
