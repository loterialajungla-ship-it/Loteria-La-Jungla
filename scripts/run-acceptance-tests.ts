/**
 * Runner: npm run test:acceptance
 * Requiere TEST_DATABASE_URL aislada. Si falta → SKIPPED (exit 0).
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

runDbTestSuite({
  runFlag: "RUN_ACCEPTANCE",
  testFiles: listAcceptanceFiles(),
  missingUrlMode: "skip",
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
