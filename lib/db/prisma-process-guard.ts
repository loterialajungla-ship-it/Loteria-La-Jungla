/**
 * Guard de proceso para el singleton `@/lib/prisma`.
 *
 * Fuera de suites DB: no-op (prod/dev iguales).
 * Con `RUN_INTEGRATION=1` o `RUN_ACCEPTANCE=1`: exige destino TEST
 * allowlisted vía `assertIntegrationWriteTarget` (TEST + DATABASE + DIRECT).
 * No basta el flag solo; no hay fallback a producción si falta TEST.
 * No registra URLs ni secretos.
 */

import { assertIntegrationWriteTarget } from "@/lib/db/neon-endpoint-guard";

export function isDbSuiteProcess(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env.RUN_INTEGRATION === "1" || env.RUN_ACCEPTANCE === "1";
}

/**
 * Debe llamarse antes de `new PrismaClient()` cuando el módulo prisma
 * se carga en un proceso de suite DB.
 */
export function assertPrismaProcessEnvAllowed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  if (!isDbSuiteProcess(env)) return;
  assertIntegrationWriteTarget(env);
}
