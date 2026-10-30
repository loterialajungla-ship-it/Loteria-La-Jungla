/**
 * Bootstrap operativo idempotente de CreditosConfig (id=1).
 *
 * Uso (TEST):
 *   $env:CREDITS_ENSURE_TARGET="test"
 *   $env:CREDITS_ENSURE_DATABASE_URL="…"   # solo endpoint TEST; no se imprime
 *   npm run credits:ensure-config
 *   npm run credits:ensure-config -- --dry-run
 *
 * Uso (producción — doble opt-in):
 *   $env:CREDITS_ENSURE_TARGET="production"
 *   $env:CREDITS_ENSURE_PRODUCTION="1"
 *   $env:CONFIRM_CREDITS_ENSURE_PRODUCTION="I_UNDERSTAND_THIS_WRITES_PRODUCTION"
 *   $env:CREDITS_ENSURE_DATABASE_URL="…"   # solo endpoint PRODUCTION
 *   npm run credits:ensure-config
 *
 * - No usa DATABASE_URL / DIRECT_URL / TEST_DATABASE_URL
 * - No activa controlActivo ni fija inicioEn
 * - Si la fila existe, no modifica ningún campo
 * - Nunca imprime URLs ni secretos
 */

import { PrismaClient } from "@prisma/client";
import { runEnsureCreditosConfig } from "../lib/creditos/ensure-creditos-config";

async function main(): Promise<number> {
  const result = await runEnsureCreditosConfig({
    env: process.env,
    argv: process.argv.slice(2),
    createDb: (guard) => {
      const prisma = new PrismaClient({
        datasources: { db: { url: guard.databaseUrl } },
      });
      return {
        async findConfigSingleton() {
          return prisma.creditosConfig.findUnique({
            where: { id: 1 },
            select: {
              id: true,
              controlActivo: true,
              inicioEn: true,
              umbralSaldoBajo: true,
              updatedByAdminId: true,
            },
          });
        },
        async insertBootstrapIfAbsent() {
          const inserted = await prisma.$executeRaw`
            INSERT INTO "CreditosConfig"
              ("id", "controlActivo", "inicioEn", "umbralSaldoBajo", "updatedAt", "updatedByAdminId")
            VALUES
              (1, false, NULL, NULL, NOW(), NULL)
            ON CONFLICT ("id") DO NOTHING
          `;
          return Number(inserted);
        },
        async disconnect() {
          await prisma.$disconnect();
        },
      };
    },
    log: (m) => {
      if (
        m.includes("abortado") ||
        m.includes("fallida") ||
        m.includes("inesperado")
      ) {
        console.error(m);
      } else {
        console.log(m);
      }
    },
  });

  return result.exitCode;
}

void main().then(
  (code) => {
    process.exit(code);
  },
  () => {
    console.error(
      "credits:ensure-config: error inesperado. Verifica CREDITS_ENSURE_TARGET, CREDITS_ENSURE_DATABASE_URL y (en prod) CREDITS_ENSURE_PRODUCTION + CONFIRM_CREDITS_ENSURE_PRODUCTION. No se mostraron detalles internos.",
    );
    process.exit(1);
  },
);
