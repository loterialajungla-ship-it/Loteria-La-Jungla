import type { AccionAuditoria, EntidadAuditoria, PrismaClient } from "@prisma/client";
import { parseFechaYYYYMMDD, fechaAYYYYMMDD } from "@/lib/fecha";
import {
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZE_MAX,
  parseAuditDetalle,
  type AuditDb,
  type AuditListItem,
  type ListAuditoriaQuery,
  type ListAuditoriaResult,
} from "@/lib/audit/audit";
import { formatAuditDetalleLegible } from "@/lib/audit/format-detalle";
import { UserValidationError } from "@/lib/auth/errors";

const ACCIONES = new Set<string>([
  "LOGIN",
  "LOGOUT",
  "CREAR_TICKET",
  "ANULAR_TICKET",
  "CREAR_VENDEDOR",
  "ACTIVAR_VENDEDOR",
  "DESACTIVAR_VENDEDOR",
  "RESET_PASSWORD",
  "CAMBIAR_PASSWORD",
  "CREAR_RESULTADO",
  "MODIFICAR_RESULTADO",
]);

const ENTIDADES = new Set<string>(["TICKET", "USUARIO", "RESULTADO", "AUTH"]);

function parsePositiveInt(
  value: string | number | null | undefined,
  fallback: number,
): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new UserValidationError("Paginación inválida.", "INVALID_QUERY");
  }
  return n;
}

export function parseListAuditoriaQuery(query: ListAuditoriaQuery): {
  fecha: Date | null;
  accion: AccionAuditoria | null;
  usuarioId: string | null;
  entidad: EntidadAuditoria | null;
  page: number;
  pageSize: number;
} {
  let fecha: Date | null = null;
  if (typeof query.fecha === "string" && query.fecha.trim()) {
    const parsed = parseFechaYYYYMMDD(query.fecha.trim());
    if (!parsed) {
      throw new UserValidationError("Fecha inválida.", "INVALID_QUERY");
    }
    fecha = parsed;
  }

  let accion: AccionAuditoria | null = null;
  if (typeof query.accion === "string" && query.accion.trim()) {
    const a = query.accion.trim().toUpperCase();
    if (!ACCIONES.has(a)) {
      throw new UserValidationError("Acción inválida.", "INVALID_QUERY");
    }
    accion = a as AccionAuditoria;
  }

  let entidad: EntidadAuditoria | null = null;
  if (typeof query.entidad === "string" && query.entidad.trim()) {
    const e = query.entidad.trim().toUpperCase();
    if (!ENTIDADES.has(e)) {
      throw new UserValidationError("Entidad inválida.", "INVALID_QUERY");
    }
    entidad = e as EntidadAuditoria;
  }

  const usuarioId =
    typeof query.usuarioId === "string" && query.usuarioId.trim()
      ? query.usuarioId.trim()
      : null;

  const page = parsePositiveInt(query.page, 1);
  let pageSize = parsePositiveInt(query.pageSize, AUDIT_PAGE_SIZE_DEFAULT);
  if (pageSize > AUDIT_PAGE_SIZE_MAX) pageSize = AUDIT_PAGE_SIZE_MAX;

  return { fecha, accion, usuarioId, entidad, page, pageSize };
}

type ListDb = Pick<PrismaClient, "auditoria" | "animal">;

/**
 * Listado ADMIN de auditoría. Orden createdAt DESC.
 */
export async function listAuditoria(
  db: ListDb,
  query: ListAuditoriaQuery,
): Promise<ListAuditoriaResult> {
  const filters = parseListAuditoriaQuery(query);

  const where: {
    createdAt?: { gte: Date; lt: Date };
    accion?: AccionAuditoria;
    usuarioId?: string;
    entidad?: EntidadAuditoria;
  } = {};

  if (filters.fecha) {
    const start = filters.fecha;
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    where.createdAt = { gte: start, lt: end };
  }
  if (filters.accion) where.accion = filters.accion;
  if (filters.usuarioId) where.usuarioId = filters.usuarioId;
  if (filters.entidad) where.entidad = filters.entidad;

  const skip = (filters.page - 1) * filters.pageSize;

  const [total, rows, animales] = await Promise.all([
    db.auditoria.count({ where }),
    db.auditoria.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: filters.pageSize,
      include: {
        usuario: {
          select: { id: true, nombre: true, usuario: true },
        },
      },
    }),
    db.animal.findMany({ select: { numero: true, nombre: true } }),
  ]);

  const nombrePorNumero = new Map(animales.map((a) => [a.numero, a.nombre]));

  const items: AuditListItem[] = rows.map((row) => {
    const detalle = parseAuditDetalle(row.detalle);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      usuarioId: row.usuarioId,
      usuarioNombre: row.usuario.nombre,
      usuarioLogin: row.usuario.usuario,
      accion: row.accion,
      entidad: row.entidad,
      entidadId: row.entidadId,
      detalle,
      detalleLegible: formatAuditDetalleLegible({
        accion: row.accion,
        entidad: row.entidad,
        entidadId: row.entidadId,
        detalle,
        nombrePorNumero,
      }),
    };
  });

  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.pageSize);

  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages,
  };
}

/** Re-export útil para UI de fecha filtro. */
export { fechaAYYYYMMDD };

export type { AuditDb };
