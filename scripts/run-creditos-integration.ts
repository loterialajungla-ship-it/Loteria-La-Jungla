/**
 * Runner exclusivo: solo `lib/creditos/creditos-venta.integration.test.ts`.
 *
 * Seguridad (igual que el runner general, sin migrate ni terminate):
 *   1. Carga `.env` sin sobrescribir env ya definida.
 *   2. `assertSafeTestDatabase` — exige TEST_DATABASE_URL allowlisted.
 *   3. Reescribe TEST/DATABASE/DIRECT del hijo al endpoint TEST.
 *   4. `assertIntegrationWriteTarget`.
 *   5. Spawn de un único archivo de test.
 *
 * NO ejecuta: migrate deploy, pg_terminate_backend, otras suites.
 * NO hace fallback a DATABASE_URL de producción.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertIntegrationWriteTarget } from "../lib/db/neon-endpoint-guard";
import { assertSafeTestDatabase } from "../lib/tickets/integration/safe-test-db";

const ROOT = path.resolve(__dirname, "..");
const ONLY_FILE = path.join(
  ROOT,
  "lib",
  "creditos",
  "creditos-venta.integration.test.ts",
);

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
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

function preferDirectPostgresUrl(url: string): string {
  return url.replace(/-pooler\./i, ".");
}

function quoteForCmd(filePath: string): string {
  return `"${filePath.replace(/"/g, '""')}"`;
}

function main(): void {
  loadEnvFile(path.join(ROOT, ".env"));

  let testUrl: string;
  try {
    testUrl = assertSafeTestDatabase(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (!fs.existsSync(ONLY_FILE)) {
    console.error(`No se encontró ${path.relative(ROOT, ONLY_FILE)}`);
    process.exit(1);
  }

  const directUrl = preferDirectPostgresUrl(testUrl);
  const usingDirect = directUrl !== testUrl;

  const testEnv = {
    ...process.env,
    TEST_DATABASE_URL: testUrl,
    DATABASE_URL: usingDirect ? directUrl : testUrl,
    DIRECT_URL: usingDirect ? directUrl : testUrl,
    RUN_INTEGRATION: "1",
    PRISMA_DISABLE_WARNINGS: "1",
  };

  try {
    assertIntegrationWriteTarget(testEnv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (usingDirect) {
    console.log(
      "→ créditos-integration: endpoint directo (sin -pooler) para TX/concurrencia",
    );
  }

  console.log(
    `→ ejecutando SOLO ${path.relative(ROOT, ONLY_FILE)} (sin migrate / sin terminate)`,
  );

  const result = spawnSync(
    `npx tsx --test --test-force-exit ${quoteForCmd(ONLY_FILE)}`,
    {
      cwd: ROOT,
      env: testEnv,
      stdio: "inherit",
      shell: true,
    },
  );
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
