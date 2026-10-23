/**
 * Bootstrap del primer Usuario ADMIN — SOLO producción (allowlist).
 *
 * Uso (opt-in dual; NUNCA en esta tarea de implementación):
 *   BOOTSTRAP_TARGET=production
 *   CONFIRM_PRODUCTION_BOOTSTRAP=I_UNDERSTAND_THIS_WRITES_PRODUCTION
 *   DATABASE_URL / DIRECT_URL → endpoint PRODUCTION
 *   ADMIN_BOOTSTRAP_PASSWORD (+ opcional ADMIN_BOOTSTRAP_USER)
 *   npm run bootstrap:admin:production
 *
 * No debilita bootstrap:admin (dev-from-recovery).
 * No imprime passwords, hashes ni URLs.
 */

import { PrismaClient } from "@prisma/client";
import {
  assertProductionBootstrapTarget,
  PRODUCTION_BOOTSTRAP_TARGET,
} from "../lib/db/neon-endpoint-guard";
import {
  BootstrapAdminProductionError,
  parseProductionBootstrapCredentials,
  runBootstrapAdminProduction,
} from "../lib/dev/bootstrap-admin-production";

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    console.error(
      "bootstrap:admin:production no acepta argumentos. Usa solo variables de entorno.",
    );
    process.exit(1);
  }

  let endpointId: string;
  try {
    endpointId = assertProductionBootstrapTarget(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  let credentials;
  try {
    credentials = parseProductionBootstrapCredentials(process.env);
  } catch (e) {
    if (e instanceof BootstrapAdminProductionError) {
      console.error(e.message);
    } else {
      console.error("Bootstrap de producción abortado: credenciales inválidas.");
    }
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const result = await runBootstrapAdminProduction(prisma, credentials);
    if (result.status === "already_exists") {
      console.log(
        `Ya existe un ADMIN (usuario="${result.usuario}"). Bootstrap omitido. endpoint=${endpointId} target=${PRODUCTION_BOOTSTRAP_TARGET}.`,
      );
      return;
    }
    console.log(
      `ADMIN creado: usuario="${result.usuario}" id=${result.id} endpoint=${endpointId}. Usa /login. Retira ADMIN_BOOTSTRAP_* y CONFIRM_PRODUCTION_BOOTSTRAP del entorno.`,
    );
  } catch (e) {
    if (e instanceof BootstrapAdminProductionError) {
      console.error(e.message);
    } else {
      console.error("Bootstrap de producción falló.");
      console.error(e instanceof Error ? e.message : e);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Bootstrap de producción falló.");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
