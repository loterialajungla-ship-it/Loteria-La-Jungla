/**
 * Renombra el login del único ADMIN activo → adminlajungla (SOLO producción).
 *
 *   RENAME_ADMIN_LOGIN_TARGET=production
 *   CONFIRM_PRODUCTION_RENAME_ADMIN_LOGIN=I_UNDERSTAND_THIS_RENAMES_PRODUCTION_ADMIN_LOGIN
 *   DATABASE_URL / DIRECT_URL → PRODUCTION
 *   RENAME_ADMIN_LOGIN_NEW_USER=adminlajungla  (opcional; default adminlajungla)
 *   npm run rename-admin-login:production
 *
 * Conserva id, passwordHash, rol, activo, nombre. No crea usuarios.
 */

import { PrismaClient } from "@prisma/client";
import {
  assertProductionRenameAdminLoginTarget,
  PRODUCTION_RENAME_ADMIN_LOGIN_TARGET,
} from "../lib/db/neon-endpoint-guard";
import {
  RenameAdminLoginProductionError,
  parseRenameAdminLoginTarget,
  runRenameAdminLoginProduction,
} from "../lib/dev/rename-admin-login-production";

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    console.error(
      "rename-admin-login:production no acepta argumentos. Usa solo variables de entorno.",
    );
    process.exit(1);
  }

  let endpointId: string;
  try {
    endpointId = assertProductionRenameAdminLoginTarget(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  let newUsuario: string;
  try {
    newUsuario = parseRenameAdminLoginTarget(process.env);
  } catch (e) {
    if (e instanceof RenameAdminLoginProductionError) {
      console.error(e.message);
    } else {
      console.error("Renombre de login ADMIN abortado: entrada inválida.");
    }
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const result = await runRenameAdminLoginProduction(
      prisma as unknown as Parameters<typeof runRenameAdminLoginProduction>[0],
      newUsuario,
    );
    if (result.status === "already_target") {
      console.log(
        `Login ADMIN ya era el objetivo (usuario="${result.usuario}") endpoint=${endpointId} target=${PRODUCTION_RENAME_ADMIN_LOGIN_TARGET}. Retira RENAME_ADMIN_LOGIN_* y CONFIRM_PRODUCTION_RENAME_ADMIN_LOGIN.`,
      );
      return;
    }
    console.log(
      `Login ADMIN renombrado: usuarioNuevo="${result.usuarioNuevo}" endpoint=${endpointId} target=${PRODUCTION_RENAME_ADMIN_LOGIN_TARGET}. Usa /login. Retira RENAME_ADMIN_LOGIN_* y CONFIRM_PRODUCTION_RENAME_ADMIN_LOGIN.`,
    );
  } catch (e) {
    if (e instanceof RenameAdminLoginProductionError) {
      console.error(e.message);
    } else {
      console.error("Renombre de login ADMIN de producción falló.");
      console.error(e instanceof Error ? e.message : e);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Renombre de login ADMIN de producción falló.");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
