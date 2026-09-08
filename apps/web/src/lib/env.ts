import type { Env } from "../env";
import { validateEnv } from "./validate-env";

export function getEnv(locals: App.Locals): Env {
  const runtime = (locals as unknown as { runtime?: { env?: Env } }).runtime;
  if (!runtime?.env) throw new Error("Cloudflare runtime is not available");
  validateEnv(runtime.env as unknown as Record<string, unknown>);
  return runtime.env;
}
