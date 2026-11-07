/**
 * Activación operativa de Caja — SOLO producción (allowlist).
 *
 * NO ejecutar en C7.2. Requiere autorización expresa posterior (C7.3+).
 *
 * Uso (opt-in dual; nunca implícito):
 *   ACTIVATE_CAJA_TARGET=production
 *   CONFIRM_PRODUCTION_ACTIVATE_CAJA=I_UNDERSTAND_THIS_ACTIVATES_CAJA_IN_PRODUCTION
 *   DATABASE_URL / DIRECT_URL → endpoint PRODUCTION
 *   ACTIVATE_CAJA_ADMIN_USER_ID=<id ADMIN>  (obligatorio si hay >1 ADMIN activo)
 *   npm run activate:caja:production
 *
 * Seguro por defecto: sin opt-in → exit 1.
 * No imprime URLs, passwords ni secretos.
 * No crea endpoint HTTP. No se invoca en build/start/migrate.
 */

import { PrismaClient } from "@prisma/client";
import {
  assertProductionActivateCajaTarget,
  CONFIRM_PRODUCTION_ACTIVATE_CAJA_VALUE,
  NEON_ENDPOINTS,
  PRODUCTION_ACTIVATE_CAJA_TARGET,
} from "../lib/db/neon-endpoint-guard";
import {
  ActivateCajaProductionError,
  resolveActivateCajaAdminId,
  runActivateCajaProduction,
} from "../lib/dev/activate-caja-production";

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    console.error(
      "activate:caja:production no acepta argumentos. Usa solo variables de entorno.",
    );
    process.exit(1);
  }

  let endpointId: string;
  try {
    endpointId = assertProductionActivateCajaTarget(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (endpointId !== NEON_ENDPOINTS.PRODUCTION) {
    console.error(
      "Activación de Caja abortada: el endpoint resuelto no es PRODUCTION.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const actorAdminId = await resolveActivateCajaAdminId(prisma, process.env);
    const result = await runActivateCajaProduction(prisma, { actorAdminId });

    console.log(
      [
        "Caja activación OK.",
        `endpoint=${endpointId}`,
        `target=${PRODUCTION_ACTIVATE_CAJA_TARGET}`,
        `alreadyActive=${result.alreadyActive}`,
        `activa=${result.activa}`,
        `activadaEnUtc=${result.activadaEnIso}`,
        `actorAdminId=${result.activadaPorAdminId ?? actorAdminId}`,
        `comisionesInicializadas=${result.comisionesInicializadas}`,
        `vendedoresConComision=${result.vendedoresConComision}`,
        `vendedoresSinComision=${result.vendedoresSinComision}`,
        `defaultPct=${result.comisionDefault}`,
        `confirmPhraseRequired=${CONFIRM_PRODUCTION_ACTIVATE_CAJA_VALUE}`,
      ].join(" "),
    );
    console.log(
      "Retira ACTIVATE_CAJA_TARGET, CONFIRM_PRODUCTION_ACTIVATE_CAJA y ACTIVATE_CAJA_ADMIN_USER_ID del entorno.",
    );
  } catch (e) {
    if (e instanceof ActivateCajaProductionError) {
      console.error(e.message);
    } else {
      console.error("Activación de Caja falló.");
      console.error(e instanceof Error ? e.message : e);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Activación de Caja falló.");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
