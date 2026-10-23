/**
 * Runner de unit tests: NUNCA activa integración PostgreSQL.
 * Evita que un RUN_INTEGRATION residual en el shell ejecute
 * *.integration.test.ts contra DATABASE_URL (p. ej. producción).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

const env = { ...process.env };
delete env.RUN_INTEGRATION;

const globs = [
  "lib/tickets/*.test.ts",
  "lib/tickets/integration/*.test.ts",
  "lib/auth/**/*.test.ts",
  "lib/users/**/*.test.ts",
  "lib/reports/**/*.test.ts",
  "lib/audit/**/*.test.ts",
  "lib/dev/**/*.test.ts",
  "lib/db/**/*.test.ts",
  "lib/http/**/*.test.ts",
  "lib/resultados/**/*.test.ts",
  "components/tickets/**/*.test.ts",
  "app/admin/**/*.test.ts",
];

const result = spawnSync(
  "npx",
  ["tsx", "--test", ...globs],
  {
    cwd: ROOT,
    env,
    stdio: "inherit",
    shell: true,
  },
);

process.exit(result.status ?? 1);
