/**
 * Runner focalizado: integración aislada de programación de resultados (Fase 3A).
 *
 * Orden de seguridad:
 *   1. Carga `.env` en memoria (sin imprimir valores).
 *   2. `assertSafeTestDatabase` sobre el entorno padre (antes de igualar URLs).
 *   3. Env hijo: DATABASE_URL / DIRECT_URL / TEST_DATABASE_URL = URL TEST validada.
 *   4. `assertIntegrationWriteTarget` sobre el hijo.
 *   5. Spawn exclusivo de `lib/resultados/schedule-result.integration.test.ts`.
 *
 * No ejecuta migrate deploy, seeds ni el runner general de integración.
 * No registra connection strings, passwords ni tokens.
 *
 * Uso (cuando esté autorizado):
 *   npx tsx scripts/run-schedule-integration.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  assertIntegrationWriteTarget,
  NEON_ENDPOINTS,
} from "../lib/db/neon-endpoint-guard";
import { assertSafeTestDatabase } from "../lib/tickets/integration/safe-test-db";

const ROOT = path.resolve(__dirname, "..");

const SUITE_REL = path.join(
  "lib",
  "resultados",
  "schedule-result.integration.test.ts",
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

/** Neon pooler no soporta bien TX interactivas Prisma — preferir host directo. */
function preferDirectPostgresUrl(url: string): string {
  return url.replace(/-pooler\./i, ".");
}

function resolveLocalTsxCli(projectRoot: string): string {
  const cli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(cli)) {
    throw new Error(
      "run-schedule-integration: falta node_modules/tsx/dist/cli.mjs (npm install).",
    );
  }
  return cli;
}

function main(): never {
  loadEnvFile(path.join(ROOT, ".env"));

  let testUrl: string;
  try {
    testUrl = assertSafeTestDatabase(process.env);
  } catch (e) {
    console.error(
      `Guard assertSafeTestDatabase falló (se espera TEST aislado, endpoint ${NEON_ENDPOINTS.TEST}).`,
    );
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const suiteFile = path.join(ROOT, SUITE_REL);
  if (!fs.existsSync(suiteFile)) {
    console.error(`No se encontró la suite: ${SUITE_REL}`);
    process.exit(1);
  }

  const directUrl = preferDirectPostgresUrl(testUrl);
  const usingDirect = directUrl !== testUrl;

  const testEnv: NodeJS.ProcessEnv = {
    ...process.env,
    TEST_DATABASE_URL: testUrl,
    DATABASE_URL: usingDirect ? directUrl : testUrl,
    DIRECT_URL: usingDirect ? directUrl : testUrl,
    RUN_INTEGRATION: "1",
    PRISMA_DISABLE_WARNINGS: "1",
  };

  try {
    const target = assertIntegrationWriteTarget(testEnv);
    if (target.databaseEndpointId !== NEON_ENDPOINTS.TEST) {
      console.error(
        `Guard assertIntegrationWriteTarget: endpoint efectivo no es TEST (esperado ${NEON_ENDPOINTS.TEST}).`,
      );
      process.exit(1);
    }
  } catch (e) {
    console.error(
      `Guard assertIntegrationWriteTarget falló (esperado endpoint ${NEON_ENDPOINTS.TEST}).`,
    );
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  let tsxCli: string;
  try {
    tsxCli = resolveLocalTsxCli(ROOT);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  console.log(
    `→ schedule-integration: destino TEST confirmado (${NEON_ENDPOINTS.TEST}); ejecutando suite exclusiva`,
  );
  if (usingDirect) {
    console.log(
      "→ usando host directo (sin -pooler) para transacciones/concurrencia",
    );
  }

  const result = spawnSync(
    process.execPath,
    [tsxCli, "--test", "--test-force-exit", suiteFile],
    {
      cwd: ROOT,
      env: testEnv,
      stdio: "inherit",
      shell: false,
    },
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
