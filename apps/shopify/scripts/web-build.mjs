import { spawn } from "node:child_process";

const webDir = new URL("../../apps/web/", import.meta.url).pathname;
const child = spawn("npx", ["astro", "build"], {
  cwd: webDir,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
