/**
 * Runner oficial: `npm run test:integration`
 *
 * Orden de seguridad (antes de Prisma / migrate / writes):
 *   1. Carga `.env` solo en process.env (no imprime valores).
 *   2. `assertSafeTestDatabase` — exige `TEST_DATABASE_URL` = endpoint TEST
 *      allowlisted; rechaza prod/recovery/dev-recovery y URLs no Neon TEST.
 *      Si falta o es inválida → exit 1 (NO skip, NO fallback a DATABASE_URL).
 *   3. Reescribe `TEST_DATABASE_URL` / `DATABASE_URL` / `DIRECT_URL` del hijo
 *      a la URL TEST validada (DIRECT preferido sin `-pooler` en la suite).
 *   4. `assertIntegrationWriteTarget` sobre migrateEnv y testEnv.
 *   5. Recién entonces `prepareTestDatabase` / `migrate deploy` / spawn.
 *
 * Las suites viven en `*.integration.test.ts` (excluidas de `npm test`).
 * No registrar connection strings, passwords ni tokens.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertIntegrationWriteTarget } from "../lib/db/neon-endpoint-guard";
import { assertSafeTestDatabase } from "../lib/tickets/integration/safe-test-db";

const ROOT = path.resolve(__dirname, "..");

/** Carga .env sin sobrescribir variables ya definidas en el proceso. */
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

function listIntegrationTestFiles(): string[] {
  const dirs = [
    // Resultados automáticos primero: no depende del reloj real de ventas.
    path.join(ROOT, "lib", "resultados"),
    path.join(ROOT, "lib", "creditos"),
    path.join(ROOT, "lib", "tickets", "integration"),
    path.join(ROOT, "lib", "auth"),
    path.join(ROOT, "lib", "reports"),
    path.join(ROOT, "lib", "audit"),
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".integration.test.ts")) {
        files.push(path.join(dir, name));
      }
    }
  }
  return files;
}

function listLocalMigrationNames(): string[] {
  const migrationsDir = path.join(ROOT, "prisma", "migrations");
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((name) =>
      fs.statSync(path.join(migrationsDir, name)).isDirectory(),
    )
    .sort();
}

/**
 * Neon pooler (-pooler.) no soporta bien transacciones interactivas Prisma.
 * Preferimos el host de cómputo directo para la suite de integración.
 */
function preferDirectPostgresUrl(url: string): string {
  return url.replace(/-pooler\./i, ".");
}

/** Escapa un path para cmd.exe cuando shell:true (espacios en rutas). */
function quoteForCmd(filePath: string): string {
  return `"${filePath.replace(/"/g, '""')}"`;
}

function run(command: string, env: NodeJS.ProcessEnv): number {
  const result = spawnSync(command, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    shell: true,
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Limpia sesiones colgadas y decide si hace falta migrate deploy.
 * Evita P1002 (advisory lock) cuando un deploy anterior quedó a medias.
 */
async function prepareTestDatabase(testUrl: string): Promise<"skip-migrate" | "need-migrate"> {
  const db = new PrismaClient({
    datasources: { db: { url: testUrl } },
  });
  try {
    await db.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND (
          state = 'idle in transaction'
          OR state = 'idle in transaction (aborted)'
          OR query ILIKE '%pg_advisory_lock%'
        )
    `);

    const local = listLocalMigrationNames();
    const applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT "migration_name" FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL
    `;
    const appliedSet = new Set(applied.map((r) => r.migration_name));
    const pending = local.filter((name) => !appliedSet.has(name));
    if (pending.length === 0) {
      console.log(
        `→ schema al día (${applied.length} migraciones); se omite migrate deploy`,
      );
      return "skip-migrate";
    }
    console.log(`→ migraciones pendientes: ${pending.join(", ")}`);
    return "need-migrate";
  } catch (error) {
    console.log(
      "→ no se pudo verificar migraciones aplicadas; se intentará migrate deploy",
      error instanceof Error ? `(${error.message})` : "",
    );
    return "need-migrate";
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env"));

  let testUrl: string;
  try {
    testUrl = assertSafeTestDatabase(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const testFiles = listIntegrationTestFiles();
  if (testFiles.length === 0) {
    console.error("No se encontraron archivos *.integration.test.ts");
    process.exit(1);
  }

  const directUrl = preferDirectPostgresUrl(testUrl);
  const usingDirect = directUrl !== testUrl;

  const migrateEnv = {
    ...process.env,
    TEST_DATABASE_URL: testUrl,
    DATABASE_URL: testUrl,
    DIRECT_URL: testUrl,
    PRISMA_DISABLE_WARNINGS: "1",
  };

  const testEnv = {
    ...process.env,
    TEST_DATABASE_URL: testUrl,
    DATABASE_URL: usingDirect ? directUrl : testUrl,
    DIRECT_URL: usingDirect ? directUrl : testUrl,
    RUN_INTEGRATION: "1",
    PRISMA_DISABLE_WARNINGS: "1",
  };

  try {
    assertIntegrationWriteTarget(migrateEnv);
    assertIntegrationWriteTarget(testEnv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (usingDirect) {
    console.log(
      "→ tests usarán endpoint directo (sin -pooler) para transacciones/concurrencia",
    );
  }

  const migratePlan = await prepareTestDatabase(testUrl);
  if (migratePlan === "need-migrate") {
    console.log("→ prisma migrate deploy (TEST_DATABASE_URL)…");
    const migrateStatus = run("npx prisma migrate deploy", migrateEnv);
    if (migrateStatus !== 0) {
      console.error("migrate deploy falló sobre la DB de test.");
      process.exit(migrateStatus);
    }
  }

  console.log(`→ ejecutando suite de integración (${testFiles.length} archivo(s))…`);
  // OBLIGATORIO: un proceso por archivo, en serie (nunca `tsx --test a b` juntos).
  // Evita carreras entre cleanups owned / registries y propaga el primer fallo
  // con process.exit(status) sin continuar el resto.
  for (const file of testFiles) {
    console.log(`→ ${path.relative(ROOT, file)}`);
    const testStatus = run(
      `npx tsx --test --test-force-exit ${quoteForCmd(file)}`,
      testEnv,
    );
    if (testStatus !== 0) {
      console.error(
        `→ ABORT integración: ${path.relative(ROOT, file)} exit=${testStatus}`,
      );
      process.exit(testStatus);
    }
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
