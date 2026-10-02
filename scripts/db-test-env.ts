/**
 * Helpers compartidos para runners de tests contra TEST_DATABASE_URL.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase } from "../lib/tickets/integration/safe-test-db";

export const ROOT = path.resolve(__dirname, "..");

export function loadEnvFile(filePath: string): void {
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

export function preferDirectPostgresUrl(url: string): string {
  return url.replace(/-pooler\./i, ".");
}

export function quoteForCmd(filePath: string): string {
  return `"${filePath.replace(/"/g, '""')}"`;
}

export function runShell(command: string, env: NodeJS.ProcessEnv): number {
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

export async function prepareTestDatabase(
  testUrl: string,
): Promise<"skip-migrate" | "need-migrate"> {
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

export type DbSuiteOptions = {
  /** Variable de entorno que activa la suite (p. ej. RUN_ACCEPTANCE). */
  runFlag: string;
  /** Archivos de test absolutos. */
  testFiles: string[];
  /** Si falta TEST_DATABASE_URL: exit 0 (skip) o exit 1 (fail). */
  missingUrlMode: "skip" | "fail";
  suiteLabel: string;
  /** Hook opcional tras cargar .env / validar URL. */
  beforeRun?: () => void;
};

/**
 * Runner común: guard → migrate si hace falta → tsx --test.
 */
export async function runDbTestSuite(opts: DbSuiteOptions): Promise<never> {
  loadEnvFile(path.join(ROOT, ".env"));

  let testUrl: string;
  try {
    testUrl = assertSafeTestDatabase(process.env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      opts.missingUrlMode === "skip" &&
      msg.includes("Falta TEST_DATABASE_URL")
    ) {
      console.log(`SKIPPED (${opts.suiteLabel}): ${msg}`);
      process.exit(0);
    }
    console.error(msg);
    process.exit(1);
  }

  if (opts.testFiles.length === 0) {
    console.error(`No se encontraron archivos de test para ${opts.suiteLabel}`);
    process.exit(1);
  }

  opts.beforeRun?.();

  const directUrl = preferDirectPostgresUrl(testUrl);
  const usingDirect = directUrl !== testUrl;

  const migrateEnv = {
    ...process.env,
    DATABASE_URL: testUrl,
    DIRECT_URL: testUrl,
    PRISMA_DISABLE_WARNINGS: "1",
  };

  const testEnv = {
    ...process.env,
    DATABASE_URL: usingDirect ? directUrl : testUrl,
    DIRECT_URL: usingDirect ? directUrl : testUrl,
    [opts.runFlag]: "1",
    PRISMA_DISABLE_WARNINGS: "1",
  };

  if (usingDirect) {
    console.log(
      "→ tests usarán endpoint directo (sin -pooler) para transacciones/concurrencia",
    );
  }

  const migratePlan = await prepareTestDatabase(testUrl);
  if (migratePlan === "need-migrate") {
    console.log("→ prisma migrate deploy (TEST_DATABASE_URL)…");
    const migrateStatus = runShell("npx prisma migrate deploy", migrateEnv);
    if (migrateStatus !== 0) {
      console.error("migrate deploy falló sobre la DB de test.");
      process.exit(migrateStatus);
    }
  }

  const filesArg = opts.testFiles.map(quoteForCmd).join(" ");
  console.log(
    `→ ejecutando ${opts.suiteLabel} (${opts.testFiles.length} archivo(s))…`,
  );
  const testStatus = runShell(
    `npx tsx --test --test-force-exit ${filesArg}`,
    testEnv,
  );
  process.exit(testStatus);
}
