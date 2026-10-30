/**
 * Runner de unit tests.
 *
 * - Inventario explícito por directorio + filtro de sufijo (no globs opacos).
 * - Nunca incluye `*.integration.test.ts`, `*.acceptance.test.ts` ni
 *   `*.functional.test.ts`, aunque existan untracked en el working tree.
 * - No acepta rutas por argv: solo el inventario de `listUnitTestFiles`.
 * - No carga `.env`.
 * - No propaga DATABASE_URL / DIRECT_URL / TEST_DATABASE_URL ni flags
 *   RUN_INTEGRATION / RUN_ACCEPTANCE al proceso hijo.
 * - No crea PrismaClient ni ejecuta migraciones.
 * - Spawn sin shell: cada ruta es un argv distinto (espacios seguros en Windows).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildUnitTestChildEnv,
  isExcludedUnitTestFileName,
  listUnitTestFiles,
} from "../lib/dev/unit-test-file-list";

const ROOT = path.resolve(__dirname, "..");

/**
 * CLI local de tsx (`node_modules/tsx/dist/cli.mjs`).
 * Se invoca con `process.execPath` + `shell: false` para no partir rutas
 * con espacios (fallo típico de `npx … shell:true` en Windows/cmd).
 */
function resolveLocalTsxCli(projectRoot: string): string {
  const cli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(cli)) {
    throw new Error(
      "run-unit-tests: no se encontró node_modules/tsx/dist/cli.mjs. Ejecuta npm install en el proyecto.",
    );
  }
  return cli;
}

const files = listUnitTestFiles(ROOT);
if (files.length === 0) {
  console.error("run-unit-tests: no se encontraron archivos unitarios.");
  process.exit(1);
}

// Cinturón de seguridad: misma fuente de verdad que el inventario (sufijos).
const leaked = files.filter((f) =>
  isExcludedUnitTestFileName(path.basename(f)),
);
if (leaked.length > 0) {
  console.error(
    "run-unit-tests: inventario unitario contiene exclusiones; abortando.",
  );
  for (const f of leaked) {
    console.error(`  - ${path.relative(ROOT, f)}`);
  }
  process.exit(1);
}

let tsxCli: string;
try {
  tsxCli = resolveLocalTsxCli(ROOT);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

const env = buildUnitTestChildEnv(process.env);

const result = spawnSync(
  process.execPath,
  [tsxCli, "--test", ...files],
  {
    cwd: ROOT,
    env,
    stdio: "inherit",
    shell: false,
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
