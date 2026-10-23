/**
 * Lógica pura para `ensure:test-admin`.
 * Sin Prisma, sin red, sin lectura de .env (eso va en el runner).
 */

import {
  assertPasswordPolicy,
  PasswordValidationError,
} from "@/lib/auth/password";
import {
  isValidUsuarioFormat,
  normalizeUsuario,
} from "@/lib/auth/username";

export const ENSURE_TEST_ADMIN_OPT_IN_KEY = "ENSURE_TEST_ADMIN";
export const ENSURE_TEST_ADMIN_OPT_IN_VALUE = "1";

export const ENSURE_TEST_ADMIN_MISSING_OPT_IN =
  "Se abortó ensure:test-admin: define ENSURE_TEST_ADMIN=1 para autorizar la escritura únicamente en TEST.";

export const ENSURE_TEST_ADMIN_MISSING_USER =
  "Se abortó ensure:test-admin: falta MANUAL_TEST_ADMIN_USER.";

export const ENSURE_TEST_ADMIN_INVALID_USER =
  "Se abortó ensure:test-admin: MANUAL_TEST_ADMIN_USER no tiene un formato de login válido.";

export const ENSURE_TEST_ADMIN_MISSING_PASSWORD =
  "Se abortó ensure:test-admin: falta MANUAL_TEST_ADMIN_PASSWORD.";

export const ENSURE_TEST_ADMIN_ROLE_CONFLICT =
  "Se abortó ensure:test-admin: el usuario indicado ya existe con un rol distinto de ADMIN. No se promociona automáticamente.";

export const ENSURE_TEST_ADMIN_DEFAULT_NOMBRE = "Admin Manual Test";

export class EnsureTestAdminError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EnsureTestAdminError";
    this.code = code;
  }
}

export type EnsureTestAdminCredentials = {
  usuario: string;
  password: string;
};

export type ExistingUsuarioForEnsure = {
  id: string;
  usuario: string;
  rol: string;
  activo: boolean;
  nombre: string;
};

/** Campos que el script puede escribir en un UPDATE (lista blanca). */
export type EnsureTestAdminUpdateFields = {
  passwordHash: string;
  rol: "ADMIN";
  activo: true;
};

/** Campos mínimos de CREATE. */
export type EnsureTestAdminCreateFields = {
  nombre: string;
  usuario: string;
  passwordHash: string;
  rol: "ADMIN";
  activo: true;
};

export type EnsureTestAdminPlan =
  | {
      action: "create";
      fields: EnsureTestAdminCreateFields;
    }
  | {
      action: "update";
      userId: string;
      fields: EnsureTestAdminUpdateFields;
      /** Campos existentes que no se tocan (solo documentación / tests). */
      preserved: {
        nombre: string;
        usuario: string;
        lastLoginAt: "unchanged";
        createdAt: "unchanged";
      };
    };

/**
 * Opt-in explícito. Debe ser exactamente "1".
 */
export function assertEnsureTestAdminOptIn(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
  const raw = env[ENSURE_TEST_ADMIN_OPT_IN_KEY]?.trim() ?? "";
  if (raw !== ENSURE_TEST_ADMIN_OPT_IN_VALUE) {
    throw new EnsureTestAdminError(
      "MISSING_OPT_IN",
      ENSURE_TEST_ADMIN_MISSING_OPT_IN,
    );
  }
}

/**
 * Lee y valida usuario + contraseña de prueba.
 * No registra ni devuelve secretos en mensajes de error.
 */
export function parseEnsureTestAdminCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): EnsureTestAdminCredentials {
  const userRaw = env.MANUAL_TEST_ADMIN_USER?.trim() ?? "";
  if (!userRaw) {
    throw new EnsureTestAdminError(
      "MISSING_USER",
      ENSURE_TEST_ADMIN_MISSING_USER,
    );
  }

  const usuario = normalizeUsuario(userRaw);
  if (!isValidUsuarioFormat(usuario)) {
    throw new EnsureTestAdminError(
      "INVALID_USER",
      ENSURE_TEST_ADMIN_INVALID_USER,
    );
  }

  const password = env.MANUAL_TEST_ADMIN_PASSWORD?.trim() ?? "";
  if (!password) {
    throw new EnsureTestAdminError(
      "MISSING_PASSWORD",
      ENSURE_TEST_ADMIN_MISSING_PASSWORD,
    );
  }

  try {
    assertPasswordPolicy(password);
  } catch (e) {
    if (e instanceof PasswordValidationError) {
      throw new EnsureTestAdminError("INVALID_PASSWORD", e.message);
    }
    throw e;
  }

  return { usuario, password };
}

/**
 * Decide create vs update y qué campos se escriben.
 * Si existe con rol ≠ ADMIN → error (sin promoción silenciosa).
 * `passwordHash` ya debe venir hasheado por el caller (no se hashea aquí
 * para no acoplar bcrypt a tests síncronos; el runner hashea antes).
 */
export function planEnsureTestAdminUser(args: {
  existing: ExistingUsuarioForEnsure | null;
  usuario: string;
  passwordHash: string;
  nombreForCreate?: string;
}): EnsureTestAdminPlan {
  const { existing, usuario, passwordHash } = args;
  const nombre =
    args.nombreForCreate?.trim() || ENSURE_TEST_ADMIN_DEFAULT_NOMBRE;

  if (!existing) {
    return {
      action: "create",
      fields: {
        nombre,
        usuario,
        passwordHash,
        rol: "ADMIN",
        activo: true,
      },
    };
  }

  if (existing.rol !== "ADMIN") {
    throw new EnsureTestAdminError(
      "ROLE_CONFLICT",
      ENSURE_TEST_ADMIN_ROLE_CONFLICT,
    );
  }

  return {
    action: "update",
    userId: existing.id,
    fields: {
      passwordHash,
      rol: "ADMIN",
      activo: true,
    },
    preserved: {
      nombre: existing.nombre,
      usuario: existing.usuario,
      lastLoginAt: "unchanged",
      createdAt: "unchanged",
    },
  };
}

/** Claves que un update de ensure:test-admin nunca debe incluir. */
export const ENSURE_TEST_ADMIN_FORBIDDEN_UPDATE_KEYS = [
  "nombre",
  "usuario",
  "id",
  "createdAt",
  "updatedAt",
  "lastLoginAt",
] as const;

export function assertEnsureUpdateFieldsSafe(
  fields: EnsureTestAdminUpdateFields,
): void {
  const keys = Object.keys(fields);
  for (const forbidden of ENSURE_TEST_ADMIN_FORBIDDEN_UPDATE_KEYS) {
    if (keys.includes(forbidden)) {
      throw new EnsureTestAdminError(
        "FORBIDDEN_FIELD",
        `Se abortó ensure:test-admin: el update no puede incluir el campo ${forbidden}.`,
      );
    }
  }
  if (fields.rol !== "ADMIN" || fields.activo !== true) {
    throw new EnsureTestAdminError(
      "INVALID_UPDATE_SHAPE",
      "Se abortó ensure:test-admin: el update debe fijar rol ADMIN y activo=true.",
    );
  }
  if (typeof fields.passwordHash !== "string" || !fields.passwordHash) {
    throw new EnsureTestAdminError(
      "INVALID_UPDATE_SHAPE",
      "Se abortó ensure:test-admin: falta passwordHash en el update.",
    );
  }
}
