/**
 * Lógica de dominio para `reset-admin-password:production`.
 * Sin PrismaClient en import; dependencias inyectables (tests con fakes).
 * Solo actualiza passwordHash del ADMIN objetivo + invalida sus sesiones + audita.
 */
import type { AccionAuditoria, EntidadAuditoria } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  assertPasswordPolicy,
  PasswordValidationError,
  hashPassword as defaultHashPassword,
} from "@/lib/auth/password";
import {
  isValidUsuarioFormat,
  normalizeUsuario,
} from "@/lib/auth/username";

export class ResetAdminPasswordProductionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ResetAdminPasswordProductionError";
    this.code = code;
  }
}

export type ResetAdminPasswordProductionInput = {
  usuario: string;
  password: string;
};

export type ResetAdminPasswordProductionResult = {
  status: "reset";
  id: string;
  usuario: string;
  sessionsInvalidated: number;
};

type TargetUsuarioRow = {
  id: string;
  usuario: string;
  rol: string;
  activo: boolean;
};

export type ResetAdminPasswordProductionDb = {
  usuario: {
    findMany: (args: {
      where: { usuario: string };
      select: {
        id: true;
        usuario: true;
        rol: true;
        activo: true;
      };
    }) => Promise<TargetUsuarioRow[]>;
    update: (args: {
      where: { id: string };
      data: { passwordHash: string };
      select: { id: true; usuario: true };
    }) => Promise<{ id: string; usuario: string }>;
  };
  usuarioSesion: {
    deleteMany: (args: {
      where: { usuarioId: string };
    }) => Promise<{ count: number }>;
  };
  auditoria: {
    create: (args: {
      data: {
        usuarioId: string | null;
        accion: AccionAuditoria;
        entidad: EntidadAuditoria;
        entidadId: string;
        detalle: string | null;
      };
    }) => Promise<unknown>;
  };
  $transaction: <T>(
    fn: (tx: ResetAdminPasswordProductionDb) => Promise<T>,
  ) => Promise<T>;
};

/**
 * Lee login + nueva contraseña desde env (sin loguear valores).
 * Sin default de password. Usuario obligatorio (sin default "admin").
 */
export function parseProductionAdminPasswordResetInput(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ResetAdminPasswordProductionInput {
  const rawUser = env.ADMIN_PASSWORD_RESET_USER;
  if (rawUser === undefined || String(rawUser).trim() === "") {
    throw new ResetAdminPasswordProductionError(
      "MISSING_USER",
      "Reset de contraseña ADMIN de producción abortado: falta ADMIN_PASSWORD_RESET_USER.",
    );
  }

  const usuario = normalizeUsuario(String(rawUser));
  if (!usuario || !isValidUsuarioFormat(usuario)) {
    throw new ResetAdminPasswordProductionError(
      "INVALID_USER",
      "Reset de contraseña ADMIN de producción abortado: ADMIN_PASSWORD_RESET_USER no tiene un formato de login válido.",
    );
  }

  const password = env.ADMIN_PASSWORD_RESET_PASSWORD?.trim() ?? "";
  if (!password) {
    throw new ResetAdminPasswordProductionError(
      "MISSING_PASSWORD",
      "Reset de contraseña ADMIN de producción abortado: falta ADMIN_PASSWORD_RESET_PASSWORD.",
    );
  }

  try {
    assertPasswordPolicy(password);
  } catch (e) {
    if (e instanceof PasswordValidationError) {
      throw new ResetAdminPasswordProductionError("INVALID_PASSWORD", e.message);
    }
    throw e;
  }

  return { usuario, password };
}

/**
 * Resuelve exactamente un ADMIN activo por login normalizado.
 * No crea usuarios; no altera identidad.
 */
export function resolveProductionAdminPasswordResetTarget(
  rows: TargetUsuarioRow[],
): TargetUsuarioRow {
  if (rows.length === 0) {
    throw new ResetAdminPasswordProductionError(
      "TARGET_NOT_FOUND",
      "Reset de contraseña ADMIN de producción abortado: no hay un usuario con ese login.",
    );
  }
  if (rows.length > 1) {
    throw new ResetAdminPasswordProductionError(
      "TARGET_AMBIGUOUS",
      "Reset de contraseña ADMIN de producción abortado: más de un usuario coincide con el login. No se modifica nada.",
    );
  }

  const target = rows[0]!;
  if (target.rol !== "ADMIN") {
    throw new ResetAdminPasswordProductionError(
      "TARGET_NOT_ADMIN",
      "Reset de contraseña ADMIN de producción abortado: el usuario indicado no tiene rol ADMIN. No se modifica.",
    );
  }
  if (!target.activo) {
    throw new ResetAdminPasswordProductionError(
      "TARGET_INACTIVE",
      "Reset de contraseña ADMIN de producción abortado: el ADMIN indicado no está activo. No se modifica.",
    );
  }

  return target;
}

export type ResetAdminPasswordProductionDeps = {
  hashPassword?: (password: string) => Promise<string>;
};

/**
 * Actualiza solo passwordHash del ADMIN objetivo, invalida sus sesiones y audita.
 * bcrypt fuera de la TX; update + deleteMany + auditoría atómicos.
 */
export async function runResetAdminPasswordProduction(
  db: ResetAdminPasswordProductionDb,
  input: ResetAdminPasswordProductionInput,
  deps: ResetAdminPasswordProductionDeps = {},
): Promise<ResetAdminPasswordProductionResult> {
  const hashFn = deps.hashPassword ?? defaultHashPassword;
  const { usuario, password } = input;

  const rows = await db.usuario.findMany({
    where: { usuario },
    select: {
      id: true,
      usuario: true,
      rol: true,
      activo: true,
    },
  });

  const target = resolveProductionAdminPasswordResetTarget(rows);

  const passwordHash = await hashFn(password);

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.usuario.update({
      where: { id: target.id },
      data: { passwordHash },
      select: { id: true, usuario: true },
    });

    const deleted = await tx.usuarioSesion.deleteMany({
      where: { usuarioId: target.id },
    });

    await recordAuditEvent(tx, {
      usuarioId: null,
      accion: "RESET_PASSWORD",
      entidad: "USUARIO",
      entidadId: target.id,
      detalle: {
        usuarioObjetivo: target.usuario,
        evento: "admin_password_reset_production",
        origen: "reset-admin-password-production",
      },
    });

    return {
      status: "reset" as const,
      id: updated.id,
      usuario: updated.usuario,
      sessionsInvalidated: deleted.count,
    };
  });

  return result;
}
