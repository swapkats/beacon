import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("..", import.meta.url));
const webDir = new URL("../../apps/web/", import.meta.url).pathname;

if (existsSync(`${here}.env`)) {
  for (const line of readFileSync(`${here}.env`, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const port = process.env.PORT || "4321";

const child = spawn("npx", ["astro", "dev", "--port", port, "--strictPort"], {
  cwd: webDir,
  stdio: "inherit",
  env: process.env,
});

const forward = (signal) => {
  child.kill(signal);
  process.exit(0);
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

child.on("exit", (code) => process.exit(code ?? 1));
