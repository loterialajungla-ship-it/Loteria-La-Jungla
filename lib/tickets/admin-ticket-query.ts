/**
 * Validación y helpers del módulo admin de tickets.
 * Sin dependencia de Prisma Client en runtime de tests puros.
 */

import {
  InvalidAnulacionMotivoError,
  InvalidGameDateError,
  TicketValidationError,
} from "@/lib/tickets/errors";
import { parseFechaYYYYMMDD } from "@/lib/fecha";
import {
  ADMIN_TICKETS_PAGE_SIZE_DEFAULT,
  ADMIN_TICKETS_PAGE_SIZE_MAX,
  MOTIVO_ANULACION_MAX,
} from "@/lib/tickets/admin-ticket-constants";

export {
  ADMIN_TICKETS_PAGE_SIZE_DEFAULT,
  ADMIN_TICKETS_PAGE_SIZE_MAX,
  MOTIVO_ANULACION_MAX,
} from "@/lib/tickets/admin-ticket-constants";

export type AdminTicketEstadoFiltro = "EMITIDO" | "ANULADO" | "TODOS";

export type AdminListTicketsQuery = {
  fecha?: string | null;
  estado?: string | null;
  /** Búsqueda exacta por numeroVisible (alias: numero). */
  numero?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
};

export type AdminListTicketsFilters = {
  fechaJuego: Date | null;
  fechaJuegoStr: string | null;
  estado: AdminTicketEstadoFiltro;
  numeroVisible: string | null;
  page: number;
  pageSize: number;
};

function parsePositiveInt(
  raw: string | number | null | undefined,
  fallback: number,
): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new TicketValidationError(
      "Parámetro de paginación inválido.",
      "INVALID_QUERY",
    );
  }
  return n;
}

/**
 * Parsea y valida query de listado admin.
 * fecha opcional YYYY-MM-DD; estado EMITIDO|ANULADO|vacío=TODOS.
 */
export function parseAdminListTicketsQuery(
  query: AdminListTicketsQuery,
): AdminListTicketsFilters {
  let fechaJuego: Date | null = null;
  let fechaJuegoStr: string | null = null;

  const fechaRaw = typeof query.fecha === "string" ? query.fecha.trim() : "";
  if (fechaRaw) {
    const parsed = parseFechaYYYYMMDD(fechaRaw);
    if (!parsed) {
      throw new InvalidGameDateError("Fecha inválida. Use YYYY-MM-DD.");
    }
    fechaJuego = parsed;
    fechaJuegoStr = fechaRaw;
  }

  const estadoRaw =
    typeof query.estado === "string" ? query.estado.trim().toUpperCase() : "";
  let estado: AdminTicketEstadoFiltro = "TODOS";
  if (estadoRaw === "EMITIDO" || estadoRaw === "ANULADO") {
    estado = estadoRaw;
  } else if (estadoRaw && estadoRaw !== "TODOS" && estadoRaw !== "ALL") {
    throw new TicketValidationError(
      "Estado inválido. Use EMITIDO, ANULADO o vacío.",
      "INVALID_QUERY",
    );
  }

  const numeroRaw =
    typeof query.numero === "string" ? query.numero.trim() : "";
  const numeroVisible = numeroRaw ? numeroRaw.toUpperCase() : null;

  const page = parsePositiveInt(query.page, 1);
  let pageSize = parsePositiveInt(
    query.pageSize,
    ADMIN_TICKETS_PAGE_SIZE_DEFAULT,
  );
  if (pageSize > ADMIN_TICKETS_PAGE_SIZE_MAX) {
    pageSize = ADMIN_TICKETS_PAGE_SIZE_MAX;
  }

  return {
    fechaJuego,
    fechaJuegoStr,
    estado,
    numeroVisible,
    page,
    pageSize,
  };
}

/** Motivo de anulación: requerido, trim, 1–500 chars. */
export function validarMotivoAnulacion(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new InvalidAnulacionMotivoError();
  }
  const motivo = raw.trim();
  if (!motivo) {
    throw new InvalidAnulacionMotivoError("El motivo de anulación es obligatorio.");
  }
  if (motivo.length > MOTIVO_ANULACION_MAX) {
    throw new InvalidAnulacionMotivoError(
      `El motivo no puede superar ${MOTIVO_ANULACION_MAX} caracteres.`,
    );
  }
  return motivo;
}

export function parseAnularTicketBody(raw: unknown): { motivo: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TicketValidationError("JSON inválido.", "INVALID_JSON");
  }
  const body = raw as Record<string, unknown>;
  return { motivo: validarMotivoAnulacion(body.motivo) };
}
