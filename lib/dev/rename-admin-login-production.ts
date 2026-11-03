/**
 * Cambia Usuario.usuario del único ADMIN activo (p. ej. → adminlajungla).
 * Conserva id, passwordHash, rol, activo, nombre.
 */
import {
  isValidUsuarioFormat,
  normalizeUsuario,
} from "@/lib/auth/username";

/** Login objetivo documentado para producción (normalizado). */
export const PRODUCTION_ADMIN_LOGIN_TARGET = "adminlajungla";

export class RenameAdminLoginProductionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RenameAdminLoginProductionError";
    this.code = code;
  }
}

export type RenameAdminLoginProductionResult =
  | {
      status: "renamed";
      id: string;
      usuarioAnterior: string;
      usuarioNuevo: string;
    }
  | {
      status: "already_target";
      id: string;
      usuario: string;
    };

type AdminRow = {
  id: string;
  usuario: string;
  rol: string;
  activo: boolean;
  passwordHash: string;
  nombre: string;
};

export type RenameAdminLoginProductionDb = {
  usuario: {
    findMany: (args: {
      where: { rol: "ADMIN"; activo: true };
      select: {
        id: true;
        usuario: true;
        rol: true;
        activo: true;
        passwordHash: true;
        nombre: true;
      };
    }) => Promise<AdminRow[]>;
    findUnique: (args: {
      where: { usuario: string };
      select: { id: true; usuario: true; rol: true };
    }) => Promise<{ id: string; usuario: string; rol: string } | null>;
    update: (args: {
      where: { id: string };
      data: { usuario: string };
      select: {
        id: true;
        usuario: true;
        rol: true;
        activo: true;
        passwordHash: true;
        nombre: true;
      };
    }) => Promise<AdminRow>;
  };
  $transaction: <T>(
    fn: (tx: RenameAdminLoginProductionDb) => Promise<T>,
  ) => Promise<T>;
};

/**
 * Nuevo login desde env (debe ser exactamente adminlajungla tras normalizar)
 * o default canónico PRODUCTION_ADMIN_LOGIN_TARGET.
 */
export function parseRenameAdminLoginTarget(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string {
  const raw =
    env.RENAME_ADMIN_LOGIN_NEW_USER !== undefined
      ? String(env.RENAME_ADMIN_LOGIN_NEW_USER)
      : PRODUCTION_ADMIN_LOGIN_TARGET;
  const usuario = normalizeUsuario(raw);
  if (!usuario || !isValidUsuarioFormat(usuario)) {
    throw new RenameAdminLoginProductionError(
      "INVALID_USER",
      "Renombre de login ADMIN abortado: RENAME_ADMIN_LOGIN_NEW_USER no tiene formato de login válido.",
    );
  }
  if (usuario !== PRODUCTION_ADMIN_LOGIN_TARGET) {
    throw new RenameAdminLoginProductionError(
      "UNEXPECTED_TARGET",
      `Renombre de login ADMIN abortado: el login objetivo debe ser "${PRODUCTION_ADMIN_LOGIN_TARGET}".`,
    );
  }
  return usuario;
}

export function resolveSingleActiveAdmin(rows: AdminRow[]): AdminRow {
  if (rows.length === 0) {
    throw new RenameAdminLoginProductionError(
      "NO_ADMIN",
      "Renombre de login ADMIN abortado: no hay un ADMIN activo.",
    );
  }
  if (rows.length > 1) {
    throw new RenameAdminLoginProductionError(
      "MULTIPLE_ADMINS",
      "Renombre de login ADMIN abortado: hay más de un ADMIN activo. No se modifica nada.",
    );
  }
  const admin = rows[0]!;
  if (admin.rol !== "ADMIN" || !admin.activo) {
    throw new RenameAdminLoginProductionError(
      "NOT_ACTIVE_ADMIN",
      "Renombre de login ADMIN abortado: el candidato no es un ADMIN activo.",
    );
  }
  return admin;
}

export async function runRenameAdminLoginProduction(
  db: RenameAdminLoginProductionDb,
  newUsuario: string,
): Promise<RenameAdminLoginProductionResult> {
  const target = normalizeUsuario(newUsuario);
  if (target !== PRODUCTION_ADMIN_LOGIN_TARGET) {
    throw new RenameAdminLoginProductionError(
      "UNEXPECTED_TARGET",
      `Renombre de login ADMIN abortado: el login objetivo debe ser "${PRODUCTION_ADMIN_LOGIN_TARGET}".`,
    );
  }

  const admins = await db.usuario.findMany({
    where: { rol: "ADMIN", activo: true },
    select: {
      id: true,
      usuario: true,
      rol: true,
      activo: true,
      passwordHash: true,
      nombre: true,
    },
  });
  const admin = resolveSingleActiveAdmin(admins);

  if (admin.usuario === target) {
    return {
      status: "already_target",
      id: admin.id,
      usuario: admin.usuario,
    };
  }

  const conflict = await db.usuario.findUnique({
    where: { usuario: target },
    select: { id: true, usuario: true, rol: true },
  });
  if (conflict && conflict.id !== admin.id) {
    throw new RenameAdminLoginProductionError(
      "LOGIN_TAKEN",
      "Renombre de login ADMIN abortado: el login objetivo ya está ocupado por otro usuario. No se modifica nada.",
    );
  }

  const preserved = {
    id: admin.id,
    passwordHash: admin.passwordHash,
    rol: admin.rol,
    activo: admin.activo,
    nombre: admin.nombre,
  };

  return db.$transaction(async (tx) => {
    const updated = await tx.usuario.update({
      where: { id: admin.id },
      data: { usuario: target },
      select: {
        id: true,
        usuario: true,
        rol: true,
        activo: true,
        passwordHash: true,
        nombre: true,
      },
    });

    if (
      updated.id !== preserved.id ||
      updated.passwordHash !== preserved.passwordHash ||
      updated.rol !== "ADMIN" ||
      updated.activo !== true ||
      updated.nombre !== preserved.nombre ||
      updated.usuario !== target
    ) {
      throw new RenameAdminLoginProductionError(
        "POST_UPDATE_INVARIANT",
        "Renombre de login ADMIN abortado: invariantes de identidad no se cumplieron (rollback).",
      );
    }

    return {
      status: "renamed" as const,
      id: updated.id,
      usuarioAnterior: admin.usuario,
      usuarioNuevo: updated.usuario,
    };
  });
}
