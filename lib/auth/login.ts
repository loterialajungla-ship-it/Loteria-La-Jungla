import type { PrismaClient } from "@prisma/client";
import { recordAuthAuditBestEffort } from "@/lib/audit/audit";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, type AuthUser } from "@/lib/auth/session";
import { normalizeUsuario } from "@/lib/auth/username";
import {
  LOGIN_DUMMY_BCRYPT_HASH,
  LOGIN_RATE_MAX_PAIR,
  assertLoginRateSecretDistinct,
  createPrismaLoginRateLimiter,
  loginRateKeys,
  readLoginRateSecret,
  resolveLoginClientIp,
  type LoginRateLimitStore,
} from "@/lib/auth/login-rate-limit";

type Db = Pick<PrismaClient, "usuario" | "usuarioSesion" | "auditoria" | "$transaction">;

export type LoginSuccess = {
  user: AuthUser;
  token: string;
  expiresAt: Date;
};

export type LoginFailureReason =
  | "user_not_found"
  | "user_inactive"
  | "bad_password"
  | "invalid_input";

type PasswordVerifier = (password: string, passwordHash: string) => Promise<boolean>;

export type LoginWithCredentialsArgs = {
  usuario: string;
  password: string;
  /** IP ya resuelta por el borde o por el puesto de desarrollo. */
  clientIp?: string;
  rateLimitSecret?: string;
  rateLimit?: LoginRateLimitStore;
  verifyPassword?: PasswordVerifier;
};

/**
 * Login por Usuario.usuario + contraseña.
 * Fallo externo: null. El motivo queda solo en auditoría.
 * Si el límite o su secreto fallan, también null: no se abre el login.
 * La reserva del intento ocurre antes de bcrypt.
 */
export async function loginWithCredentials(
  db: Db,
  args: LoginWithCredentialsArgs,
  ahora = new Date(),
): Promise<LoginSuccess | null> {
  const usuarioLogin = normalizeUsuario(args.usuario ?? "");
  const password = typeof args.password === "string" ? args.password : "";
  const verify = args.verifyPassword ?? verifyPassword;
  const clientIp = args.clientIp?.trim() ?? "";
  if (!clientIp) {
    console.error("[auth] login rechazado: sin IP de borde confiable");
    return null;
  }

  let secret: string;
  try {
    secret = args.rateLimitSecret
      ? assertLoginRateSecretDistinct(args.rateLimitSecret)
      : readLoginRateSecret();
  } catch (error) {
    console.error("[auth] login rechazado: límite no configurado", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }

  const store = args.rateLimit ?? createPrismaLoginRateLimiter(db);
  const keys = loginRateKeys(secret, clientIp, usuarioLogin);

  let reserved: Awaited<ReturnType<LoginRateLimitStore["reserveAttempt"]>>;
  try {
    reserved = await store.reserveAttempt(keys.ipKey, keys.pairKey, ahora);
  } catch (error) {
    console.error("[auth] login rechazado: almacén de límite no disponible", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }

  if (reserved.outcome === "limited") {
    return null;
  }

  if (!usuarioLogin || !password) {
    await verify(password, LOGIN_DUMMY_BCRYPT_HASH);
    await auditFailure(db, {
      usuario: usuarioLogin || "(vacio)",
      usuarioId: null,
      reason: "invalid_input",
      ventanaAgotada: reserved.pairFailures >= LOGIN_RATE_MAX_PAIR,
    });
    return null;
  }

  const row = await db.usuario.findUnique({
    where: { usuario: usuarioLogin },
    select: {
      id: true,
      nombre: true,
      usuario: true,
      rol: true,
      activo: true,
      passwordHash: true,
    },
  });

  const comparableHash =
    row && row.activo ? row.passwordHash : LOGIN_DUMMY_BCRYPT_HASH;
  const passwordOk = await verify(password, comparableHash);

  if (!row || !row.activo || !passwordOk) {
    const reason: LoginFailureReason = !row
      ? "user_not_found"
      : !row.activo
        ? "user_inactive"
        : "bad_password";
    await auditFailure(db, {
      usuario: usuarioLogin,
      usuarioId: row?.id ?? null,
      reason,
      ventanaAgotada: reserved.pairFailures >= LOGIN_RATE_MAX_PAIR,
    });
    return null;
  }

  try {
    await store.commitSuccess(keys.ipKey, keys.pairKey, ahora);
  } catch (error) {
    console.error("[auth] login rechazado: no se pudo cerrar el límite", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }

  const { token, expiresAt } = await createSession(db, row.id, ahora);

  await db.usuario.update({
    where: { id: row.id },
    data: { lastLoginAt: ahora },
  });

  await recordAuthAuditBestEffort(db, {
    usuarioId: row.id,
    accion: "LOGIN",
    entidad: "AUTH",
    entidadId: row.id,
    detalle: { evento: "login" },
  });

  return {
    user: {
      id: row.id,
      nombre: row.nombre,
      usuario: row.usuario,
      rol: row.rol,
      activo: row.activo,
    },
    token,
    expiresAt,
  };
}

async function auditFailure(
  db: Db,
  args: {
    usuario: string;
    usuarioId: string | null;
    reason: LoginFailureReason;
    ventanaAgotada?: boolean;
  },
): Promise<void> {
  await recordAuthAuditBestEffort(db, {
    usuarioId: args.usuarioId,
    accion: "LOGIN_FALLIDO",
    entidad: "AUTH",
    entidadId: args.usuario.slice(0, 32) || "login",
    detalle: {
      evento: "login_fallido",
      motivo: args.reason,
      usuario: args.usuario.slice(0, 32),
      ...(args.ventanaAgotada ? { ventanaAgotada: true } : {}),
    },
  });
}

export function redirectPathForRole(rol: AuthUser["rol"]): string {
  return rol === "VENDEDOR" ? "/venta" : "/admin";
}

export { resolveLoginClientIp };
