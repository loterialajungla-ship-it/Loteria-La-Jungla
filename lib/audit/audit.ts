import type {
  AccionAuditoria,
  EntidadAuditoria,
  PrismaClient,
} from "@prisma/client";

/** Claves prohibidas en detalle (nunca persistir). */
export const AUDIT_FORBIDDEN_DETAIL_KEYS = [
  "password",
  "passwordHash",
  "currentPassword",
  "newPassword",
  "token",
  "tokenHash",
  "cookie",
  "cookies",
  "secret",
  "secrets",
  "idempotencyKey",
  "idempotencyRequestHash",
  "sessionToken",
  "authorization",
] as const;

export type AuditDetalle = Record<string, unknown>;

export type RecordAuditEventInput = {
  usuarioId: string;
  accion: AccionAuditoria;
  entidad: EntidadAuditoria;
  entidadId: string;
  detalle?: AuditDetalle | null;
};

export type AuditListItem = {
  id: string;
  createdAt: string;
  usuarioId: string;
  usuarioNombre: string;
  usuarioLogin: string;
  accion: AccionAuditoria;
  entidad: EntidadAuditoria;
  entidadId: string;
  detalle: AuditDetalle | null;
  detalleLegible: string;
};

export type ListAuditoriaQuery = {
  fecha?: string | null;
  accion?: string | null;
  usuarioId?: string | null;
  entidad?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
};

export type ListAuditoriaResult = {
  items: AuditListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const AUDIT_PAGE_SIZE_DEFAULT = 20;
export const AUDIT_PAGE_SIZE_MAX = 100;

type AuditoriaCreateClient = {
  auditoria: {
    create: (args: {
      data: {
        usuarioId: string;
        accion: AccionAuditoria;
        entidad: EntidadAuditoria;
        entidadId: string;
        detalle: string | null;
      };
    }) => Promise<unknown>;
  };
};

export type AuditDb = Pick<
  PrismaClient,
  "auditoria" | "usuario" | "animal"
> & {
  $transaction?: PrismaClient["$transaction"];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Elimina claves sensibles de un objeto (recursivo superficial + un nivel anidado). */
export function sanitizeAuditDetalle(
  detalle: AuditDetalle | null | undefined,
): AuditDetalle | null {
  if (detalle == null) return null;
  if (!isPlainObject(detalle)) return null;

  const forbidden = new Set(
    AUDIT_FORBIDDEN_DETAIL_KEYS.map((k) => k.toLowerCase()),
  );

  function scrub(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (forbidden.has(key.toLowerCase())) continue;
      if (isPlainObject(value) && depth < 2) {
        out[key] = scrub(value, depth + 1);
      } else if (Array.isArray(value)) {
        out[key] = value.map((item) =>
          isPlainObject(item) && depth < 2 ? scrub(item, depth + 1) : item,
        );
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  const cleaned = scrub(detalle, 0);
  return Object.keys(cleaned).length === 0 ? null : cleaned;
}

export function serializeAuditDetalle(
  detalle: AuditDetalle | null | undefined,
): string | null {
  const clean = sanitizeAuditDetalle(detalle);
  if (!clean) return null;
  return JSON.stringify(clean);
}

export function parseAuditDetalle(raw: string | null): AuditDetalle | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    return sanitizeAuditDetalle(parsed);
  } catch {
    return null;
  }
}

/**
 * Persiste un evento de auditoría.
 * Usar el mismo cliente/TX que la acción crítica para atomicidad.
 */
export async function recordAuditEvent(
  db: AuditoriaCreateClient,
  input: RecordAuditEventInput,
): Promise<void> {
  const usuarioId = input.usuarioId?.trim();
  const entidadId = input.entidadId?.trim();
  if (!usuarioId) {
    throw new Error("Auditoría: usuarioId obligatorio.");
  }
  if (!entidadId) {
    throw new Error("Auditoría: entidadId obligatorio.");
  }

  await db.auditoria.create({
    data: {
      usuarioId,
      accion: input.accion,
      entidad: input.entidad,
      entidadId,
      detalle: serializeAuditDetalle(input.detalle),
    },
  });
}

/**
 * LOGIN/LOGOUT: best-effort fuera de TX de sesión.
 * Si falla la auditoría, se registra en consola y no se revierte el login/logout
 * (la sesión ya se creó/eliminó; no hay TX de negocio que revertir).
 */
export async function recordAuthAuditBestEffort(
  db: AuditoriaCreateClient,
  input: RecordAuditEventInput,
): Promise<void> {
  try {
    await recordAuditEvent(db, input);
  } catch (error) {
    console.error("[audit] auth event failed", {
      accion: input.accion,
      usuarioId: input.usuarioId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
