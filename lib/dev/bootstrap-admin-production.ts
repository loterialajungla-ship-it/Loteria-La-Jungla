/**
 * Lógica de dominio para `bootstrap:admin:production`.
 * Sin PrismaClient en import; dependencias inyectables (tests con fakes).
 */
import { Prisma } from "@prisma/client";
import type { AccionAuditoria } from "@prisma/client";
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
import { bootstrapAdminUser } from "@/lib/auth/constants";

/** Acción tipada añadida al enum (tras migrate). Cast hasta regenerar client. */
export const ACCION_CREAR_ADMIN = "CREAR_ADMIN" as AccionAuditoria;

export class BootstrapAdminProductionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BootstrapAdminProductionError";
    this.code = code;
  }
}

export type BootstrapAdminProductionCredentials = {
  usuario: string;
  password: string;
};

export type BootstrapAdminProductionResult =
  | {
      status: "created";
      id: string;
      usuario: string;
    }
  | {
      status: "already_exists";
      id: string;
      usuario: string;
    };

type UsuarioRow = {
  id: string;
  usuario: string;
  rol: string;
};

export type BootstrapAdminProductionDb = {
  usuario: {
    findFirst: (args: {
      where: { rol: "ADMIN" };
      select: { id: true; usuario: true };
    }) => Promise<{ id: string; usuario: string } | null>;
    findUnique: (args: {
      where: { usuario: string };
      select: { id: true; usuario: true; rol: true };
    }) => Promise<UsuarioRow | null>;
    create: (args: {
      data: {
        nombre: string;
        usuario: string;
        passwordHash: string;
        rol: "ADMIN";
        activo: true;
      };
      select: { id: true; usuario: true; rol: true };
    }) => Promise<{ id: string; usuario: string; rol: string }>;
  };
  auditoria: {
    create: (args: {
      data: {
        usuarioId: string | null;
        accion: AccionAuditoria;
        entidad: "USUARIO";
        entidadId: string;
        detalle: string | null;
      };
    }) => Promise<unknown>;
  };
  $transaction: <T>(
    fn: (tx: BootstrapAdminProductionDb) => Promise<T>,
  ) => Promise<T>;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Lee credenciales de env (sin loguear valores).
 */
export function parseProductionBootstrapCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): BootstrapAdminProductionCredentials {
  const password = env.ADMIN_BOOTSTRAP_PASSWORD?.trim() ?? "";
  if (!password) {
    throw new BootstrapAdminProductionError(
      "MISSING_PASSWORD",
      "Bootstrap de producción abortado: falta ADMIN_BOOTSTRAP_PASSWORD.",
    );
  }
  try {
    assertPasswordPolicy(password);
  } catch (e) {
    if (e instanceof PasswordValidationError) {
      throw new BootstrapAdminProductionError("INVALID_PASSWORD", e.message);
    }
    throw e;
  }

  const rawUser =
    env.ADMIN_BOOTSTRAP_USER !== undefined
      ? String(env.ADMIN_BOOTSTRAP_USER)
      : bootstrapAdminUser();
  const usuario = normalizeUsuario(rawUser);
  if (!usuario || !isValidUsuarioFormat(usuario)) {
    throw new BootstrapAdminProductionError(
      "INVALID_USER",
      "Bootstrap de producción abortado: ADMIN_BOOTSTRAP_USER no tiene un formato de login válido.",
    );
  }

  return { usuario, password };
}

export type BootstrapAdminProductionDeps = {
  hashPassword?: (password: string) => Promise<string>;
};

/**
 * Crea el primer ADMIN o no-op si ya existe alguno.
 * Create + auditoría CREAR_ADMIN (usuarioId null) en la misma TX.
 */
export async function runBootstrapAdminProduction(
  db: BootstrapAdminProductionDb,
  credentials: BootstrapAdminProductionCredentials,
  deps: BootstrapAdminProductionDeps = {},
): Promise<BootstrapAdminProductionResult> {
  const hashFn = deps.hashPassword ?? defaultHashPassword;
  const { usuario, password } = credentials;

  const existingAdmin = await db.usuario.findFirst({
    where: { rol: "ADMIN" },
    select: { id: true, usuario: true },
  });
  if (existingAdmin) {
    return {
      status: "already_exists",
      id: existingAdmin.id,
      usuario: existingAdmin.usuario,
    };
  }

  const conflict = await db.usuario.findUnique({
    where: { usuario },
    select: { id: true, usuario: true, rol: true },
  });
  if (conflict) {
    if (conflict.rol === "ADMIN") {
      return {
        status: "already_exists",
        id: conflict.id,
        usuario: conflict.usuario,
      };
    }
    throw new BootstrapAdminProductionError(
      "ROLE_CONFLICT",
      `Bootstrap de producción abortado: el usuario solicitado ya existe con rol ${conflict.rol}. No se modifica.`,
    );
  }

  const passwordHash = await hashFn(password);

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.usuario.create({
        data: {
          nombre: "Administrador",
          usuario,
          passwordHash,
          rol: "ADMIN",
          activo: true,
        },
        select: { id: true, usuario: true, rol: true },
      });

      await recordAuditEvent(tx, {
        usuarioId: null,
        accion: ACCION_CREAR_ADMIN,
        entidad: "USUARIO",
        entidadId: row.id,
        detalle: {
          nombre: "Administrador",
          usuario: row.usuario,
          rol: row.rol,
          origen: "bootstrap:admin:production",
        },
      });

      return row;
    });

    return {
      status: "created",
      id: created.id,
      usuario: created.usuario,
    };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const adminAfter = await db.usuario.findFirst({
      where: { rol: "ADMIN" },
      select: { id: true, usuario: true },
    });
    if (adminAfter) {
      return {
        status: "already_exists",
        id: adminAfter.id,
        usuario: adminAfter.usuario,
      };
    }

    const loginAfter = await db.usuario.findUnique({
      where: { usuario },
      select: { id: true, usuario: true, rol: true },
    });
    if (loginAfter && loginAfter.rol !== "ADMIN") {
      throw new BootstrapAdminProductionError(
        "ROLE_CONFLICT",
        `Bootstrap de producción abortado: el usuario solicitado ya existe con rol ${loginAfter.rol}. No se modifica.`,
      );
    }

    throw new BootstrapAdminProductionError(
      "UNIQUE_RACE",
      "Bootstrap de producción abortado: conflicto de unicidad sin ADMIN resultante. No se reporta éxito.",
    );
  }
}
