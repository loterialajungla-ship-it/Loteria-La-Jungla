/**
 * Arranca Next.js para Playwright E2E exclusivamente contra TEST.
 * Reutiliza prepareTestDevEnv (mismos guards que `npm run dev:test`).
 * Puerto dedicado 3100. No modifica .env.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prepareTestDevEnv } from "../lib/dev/test-dev-env";
import {
  NEON_ENDPOINTS,
  assertIntegrationWriteTarget,
  extractNeonEndpointId,
} from "../lib/db/neon-endpoint-guard";

const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.E2E_PORT?.trim() || "3100";

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, ".env"));

const prepared = prepareTestDevEnv(process.env);
if (!prepared.ok) {
  console.error(prepared.reason);
  process.exit(1);
}

const childEnv: NodeJS.ProcessEnv = {
  ...prepared.childEnv,
  PORT,
  PRISMA_DISABLE_WARNINGS: "1",
};

try {
  const g = assertIntegrationWriteTarget(childEnv);
  if (g.databaseEndpointId !== NEON_ENDPOINTS.TEST) {
    console.error("E2E webserver ABORT: destino no es TEST.");
    process.exit(1);
  }
  console.log(`E2E webserver → TEST ${g.databaseEndpointId} puerto ${PORT}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

const dbEp = extractNeonEndpointId(childEnv.DATABASE_URL ?? "");
if (!dbEp.ok || dbEp.endpointId !== NEON_ENDPOINTS.TEST) {
  console.error("E2E webserver ABORT: DATABASE_URL hijo no es TEST.");
  process.exit(1);
}

const nextCli = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
if (!fs.existsSync(nextCli)) {
  console.error("Falta next en node_modules.");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [nextCli, "dev", "-H", "127.0.0.1", "-p", PORT],
  { cwd: ROOT, env: childEnv, stdio: "inherit" },
);

const forward = (signal: NodeJS.Signals) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
child.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});
