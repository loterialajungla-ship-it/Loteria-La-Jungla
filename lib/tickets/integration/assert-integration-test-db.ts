import { assertIntegrationWriteTarget } from "@/lib/db/neon-endpoint-guard";

/**
 * Guard de suites `*.integration.test.ts` / `*.acceptance.test.ts`.
 *
 * El runner oficial reescribe `DATABASE_URL` / `DIRECT_URL` al endpoint TEST
 * allowlisted (o su host directo sin `-pooler`) y fija `TEST_DATABASE_URL`.
 * Las suites deben crear el cliente solo con `createIntegrationPrismaClient`
 * tras este assert — nunca con `@/lib/prisma` a ciegas.
 *
 * Delega en `assertIntegrationWriteTarget` (allowlist TEST + denylist
 * prod/recovery/dev-recovery por ID de endpoint). No registra URLs ni secretos.
 *
 * @returns ID del endpoint TEST autorizado (nunca la connection string).
 */
export function assertIntegrationPointsAtTestDatabase(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const result = assertIntegrationWriteTarget(env);
  return result.testEndpointId;
}
