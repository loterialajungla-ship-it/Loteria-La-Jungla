/**
 * Reset controlado de contraseña del ADMIN activo existente — SOLO producción.
 *
 * Uso (opt-in dual; NUNCA ejecutar sin autorización humana explícita):
 *   ADMIN_PASSWORD_RESET_TARGET=production
 *   CONFIRM_PRODUCTION_ADMIN_PASSWORD_RESET=I_UNDERSTAND_THIS_RESETS_PRODUCTION_ADMIN_PASSWORD
 *   DATABASE_URL / DIRECT_URL → endpoint PRODUCTION
 *   ADMIN_PASSWORD_RESET_USER → login del ADMIN (normalizado como en /login)
 *   ADMIN_PASSWORD_RESET_PASSWORD → nueva contraseña (mín. política; no se imprime)
 *   npm run reset-admin-password:production
 *
 * - No crea usuarios ni cambia usuario/rol/activo/nombre/id.
 * - Solo actualiza passwordHash del objetivo + invalida sus UsuarioSesion + audita.
 * - No acepta argumentos CLI (evita secretos en historial).
 * - No imprime passwords, hashes ni URLs.
 * - No debilita bootstrap ni ensure:test-admin.
 */

import { PrismaClient } from "@prisma/client";
import {
  assertProductionAdminPasswordResetTarget,
  PRODUCTION_ADMIN_PASSWORD_RESET_TARGET,
} from "../lib/db/neon-endpoint-guard";
import {
  ResetAdminPasswordProductionError,
  parseProductionAdminPasswordResetInput,
  runResetAdminPasswordProduction,
} from "../lib/dev/reset-admin-password-production";

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    console.error(
      "reset-admin-password:production no acepta argumentos. Usa solo variables de entorno.",
    );
    process.exit(1);
  }

  let endpointId: string;
  try {
    endpointId = assertProductionAdminPasswordResetTarget(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  let input;
  try {
    input = parseProductionAdminPasswordResetInput(process.env);
  } catch (e) {
    if (e instanceof ResetAdminPasswordProductionError) {
      console.error(e.message);
    } else {
      console.error(
        "Reset de contraseña ADMIN de producción abortado: entrada inválida.",
      );
    }
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const result = await runResetAdminPasswordProduction(
      prisma as unknown as Parameters<typeof runResetAdminPasswordProduction>[0],
      input,
    );
    console.log(
      `Contraseña ADMIN restablecida: usuario="${result.usuario}" sesionesInvalidated=${result.sessionsInvalidated} endpoint=${endpointId} target=${PRODUCTION_ADMIN_PASSWORD_RESET_TARGET}. Usa /login. Retira ADMIN_PASSWORD_RESET_* y CONFIRM_PRODUCTION_ADMIN_PASSWORD_RESET del entorno.`,
    );
  } catch (e) {
    if (e instanceof ResetAdminPasswordProductionError) {
      console.error(e.message);
    } else {
      console.error("Reset de contraseña ADMIN de producción falló.");
      console.error(e instanceof Error ? e.message : e);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Reset de contraseña ADMIN de producción falló.");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
