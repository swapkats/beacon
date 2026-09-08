const REQUIRED = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_HANDLE",
  "PUBLIC_INGEST_URL",
  "CF_ACCOUNT_ID",
  "CF_AE_TOKEN",
] as const;

export function validateEnv(env: Record<string, unknown>): void {
  const missing = REQUIRED.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.join(", ")}. Set them in wrangler vars/secrets or .dev.vars.`
    );
  }
}
