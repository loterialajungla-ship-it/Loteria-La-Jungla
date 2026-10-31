/**
 * Runner oficial: `npm run test:acceptance`
 *
 * - Requiere `TEST_DATABASE_URL` = endpoint TEST allowlisted (mismo guard que
 *   integración vía `runDbTestSuite` / `assertSafeTestDatabase`).
 * - Si **falta** `TEST_DATABASE_URL`:
 *     - Por defecto → exit 1 (FAIL). Una validación de release no puede
 *       interpretarse como aprobada si la suite no se ejecutó.
 *     - Solo con `ALLOW_ACCEPTANCE_SKIP=1` → SKIPPED exit 0, con banner
 *       `ACCEPTANCE_RESULT=SKIPPED (not a PASS)` para diferenciarlo de PASS.
 * - Si la URL existe pero es inválida / no allowlisted / colisiona con prod →
 *   exit 1 (no skip). Nunca fallback a producción.
 * - Suites: `*.acceptance.test.ts` (excluidas de `npm test`).
 * - No registra URLs, passwords ni tokens.
 */

import fs from "node:fs";
import path from "node:path";
import { ROOT, runDbTestSuite } from "./db-test-env";

function listAcceptanceFiles(): string[] {
  const dir = path.join(ROOT, "lib", "acceptance");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".acceptance.test.ts"))
    .map((name) => path.join(dir, name));
}

/** Solo uso local explícito; CI/release deben omitir esta variable. */
const allowLocalSkip = process.env.ALLOW_ACCEPTANCE_SKIP === "1";

runDbTestSuite({
  runFlag: "RUN_ACCEPTANCE",
  testFiles: listAcceptanceFiles(),
  missingUrlMode: allowLocalSkip ? "skip" : "fail",
  suiteLabel: "acceptance",
  beforeRun: () => {
    // Compat: si el .env local aún tiene ADMIN_PASSWORD, mapear a bootstrap
    // (solo tests; el runtime de la app no lee ADMIN_PASSWORD).
    if (
      !process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() &&
      process.env.ADMIN_PASSWORD?.trim()
    ) {
      process.env.ADMIN_BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD;
    }
  },
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
