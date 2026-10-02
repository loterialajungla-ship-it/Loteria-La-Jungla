import type { PrismaClient } from "@prisma/client";
import {
  ForbiddenError,
  UserNotFoundError,
  UserValidationError,
} from "@/lib/auth/errors";
import {
  assertPasswordPolicy,
  hashPassword,
  PasswordValidationError,
  verifyPassword,
} from "@/lib/auth/password";
import { recordAuditEvent } from "@/lib/audit/audit";

type Db = Pick<
  PrismaClient,
  "usuario" | "usuarioSesion" | "auditoria" | "$transaction"
>;

function mapPasswordPolicyError(e: unknown): never {
  if (e instanceof PasswordValidationError) {
    throw new UserValidationError(e.message, "INVALID_PASSWORD");
  }
  throw e;
}

/**
 * Cambio de contraseña del usuario autenticado.
 * bcrypt fuera de la TX (lento); update + invalidación de sesiones atómicos.
 */
export async function changeOwnPassword(
  db: Db,
  args: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  },
): Promise<void> {
  const currentPassword = args.currentPassword;
  const newPassword = args.newPassword;

  if (typeof currentPassword !== "string" || !currentPassword) {
    throw new UserValidationError(
      "La contraseña actual es obligatoria.",
      "INVALID_CURRENT_PASSWORD",
    );
  }
  if (typeof newPassword !== "string" || !newPassword) {
    throw new UserValidationError(
      "La nueva contraseña es obligatoria.",
      "INVALID_PASSWORD",
    );
  }

  try {
    assertPasswordPolicy(newPassword);
  } catch (e) {
    mapPasswordPolicyError(e);
  }

  if (currentPassword === newPassword) {
    throw new UserValidationError(
      "La nueva contraseña debe ser diferente de la actual.",
      "PASSWORD_UNCHANGED",
    );
  }

  const user = await db.usuario.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      activo: true,
      passwordHash: true,
    },
  });

  if (!user) {
    throw new UserNotFoundError();
  }
  if (!user.activo) {
    throw new ForbiddenError("Usuario inactivo.");
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    throw new UserValidationError(
      "La contraseña actual no es correcta.",
      "INVALID_CURRENT_PASSWORD",
    );
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new UserValidationError(
      "La nueva contraseña debe ser diferente de la actual.",
      "PASSWORD_UNCHANGED",
    );
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(newPassword);
  } catch (e) {
    mapPasswordPolicyError(e);
  }

  await db.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    await tx.usuarioSesion.deleteMany({ where: { usuarioId: user.id } });
    await recordAuditEvent(tx, {
      usuarioId: user.id,
      accion: "CAMBIAR_PASSWORD",
      entidad: "AUTH",
      entidadId: user.id,
      detalle: { evento: "password_changed" },
    });
  });

  console.info("[auth] password_changed", {
    userId: args.userId,
    at: new Date().toISOString(),
  });
}

/**
 * ADMIN restablece contraseña de un VENDEDOR.
 * bcrypt fuera de la TX; no reactiva inactivos.
 */
export async function resetVendorPassword(
  db: Db,
  args: {
    actorUserId: string;
    targetUserId: string;
    newPassword: string;
  },
): Promise<void> {
  const newPassword = args.newPassword;
  if (typeof newPassword !== "string" || !newPassword) {
    throw new UserValidationError(
      "La nueva contraseña es obligatoria.",
      "INVALID_PASSWORD",
    );
  }

  try {
    assertPasswordPolicy(newPassword);
  } catch (e) {
    mapPasswordPolicyError(e);
  }

  const targetId = args.targetUserId.trim();
  if (!targetId) throw new UserNotFoundError();

  if (args.actorUserId === targetId) {
    throw new UserValidationError(
      "Para cambiar tu propia contraseña usa Mi cuenta.",
      "USE_CHANGE_PASSWORD",
    );
  }

  const target = await db.usuario.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      rol: true,
      activo: true,
      usuario: true,
    },
  });

  if (!target) {
    throw new UserNotFoundError();
  }

  if (target.rol !== "VENDEDOR") {
    throw new ForbiddenError(
      "Solo se puede restablecer la contraseña de vendedores.",
    );
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(newPassword);
  } catch (e) {
    mapPasswordPolicyError(e);
  }

  await db.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: target.id },
      data: { passwordHash },
    });
    await tx.usuarioSesion.deleteMany({ where: { usuarioId: target.id } });
    await recordAuditEvent(tx, {
      usuarioId: args.actorUserId,
      accion: "RESET_PASSWORD",
      entidad: "USUARIO",
      entidadId: target.id,
      detalle: {
        usuarioObjetivo: target.usuario,
        evento: "password_reset",
      },
    });
  });

  console.info("[auth] vendor_password_reset", {
    actorUserId: args.actorUserId,
    targetUserId: targetId,
    at: new Date().toISOString(),
  });
}

/** Parsing de body change-password (sin confiar en userId del cliente). */
export function parseChangePasswordBody(raw: unknown): {
  currentPassword: string;
  newPassword: string;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UserValidationError("El body debe ser un objeto JSON.");
  }
  const body = raw as Record<string, unknown>;
  if ("passwordHash" in body || "userId" in body || "id" in body) {
    throw new UserValidationError("Campo no permitido.");
  }
  if (typeof body.currentPassword !== "string") {
    throw new UserValidationError(
      "La contraseña actual es obligatoria.",
      "INVALID_CURRENT_PASSWORD",
    );
  }
  if (typeof body.newPassword !== "string") {
    throw new UserValidationError(
      "La nueva contraseña es obligatoria.",
      "INVALID_PASSWORD",
    );
  }
  return {
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  };
}

export function parseResetPasswordBody(raw: unknown): { newPassword: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UserValidationError("El body debe ser un objeto JSON.");
  }
  const body = raw as Record<string, unknown>;
  if ("passwordHash" in body || "userId" in body || "rol" in body) {
    throw new UserValidationError("Campo no permitido.");
  }
  if (typeof body.newPassword !== "string") {
    throw new UserValidationError(
      "La nueva contraseña es obligatoria.",
      "INVALID_PASSWORD",
    );
  }
  return { newPassword: body.newPassword };
}

/** Re-export tipado para tests. */
export type PasswordDb = Db;
