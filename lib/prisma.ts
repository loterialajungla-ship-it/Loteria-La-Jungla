import { PrismaClient } from "@prisma/client";
import { assertPrismaProcessEnvAllowed } from "@/lib/db/prisma-process-guard";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Singleton de la app.
 *
 * En procesos con `RUN_INTEGRATION=1` o `RUN_ACCEPTANCE=1` valida el destino
 * TEST allowlisted **antes** de `new PrismaClient()`. Sin flags (prod/dev)
 * el comportamiento es el histórico.
 *
 * Las suites deben preferir `createIntegrationPrismaClient` e inyectar ese
 * cliente en APIs de dominio; este guard cierra el camino residual de
 * `@/lib/prisma` si alguna API aún usa el singleton.
 */
function createPrismaClient(): PrismaClient {
  assertPrismaProcessEnvAllowed(process.env);
  return new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
