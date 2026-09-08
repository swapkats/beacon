/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface Env {
  STORES: KVNamespace;
  ASSETS?: Fetcher;
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_APP_HANDLE: string;
  PUBLIC_INGEST_URL: string;
  AE_DATASET: string;
  CF_ACCOUNT_ID: string;
  CF_AE_TOKEN: string;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: Env;
      cf: unknown;
      caches: unknown;
      ctx: { waitUntil(promise: Promise<unknown>): void };
    };
  }
}
