/**
 * Detección ADMIN de sorteos atrasados (solo lectura).
 * Fuente de verdad de publicación: tabla Resultado @@unique([fecha, hora]).
 * No crea resultados, no materializa programaciones, no elige animales.
 */

import type {
  EstadoResultadoProgramado,
  PrismaClient,
} from "@prisma/client";
import { UserValidationError } from "@/lib/auth/errors";
import {
  HORAS_SORTEO,
  fechaAYYYYMMDD,
  fechaHoyParaPrisma,
  parseFechaYYYYMMDD,
  sumarDiasUTC,
} from "@/lib/fecha";

export const ATRASADOS_PAGE_SIZE_DEFAULT = 22;
export const ATRASADOS_PAGE_SIZE_MAX = 110;
/** Tope de días del intervalo pedido (inclusive). Evita barridos ilimitados. */
export const ATRASADOS_RANGE_DAYS_MAX = 62;
/** Ventana por defecto al omitir desde/hasta: N días hasta ayer (Caracas). */
export const ATRASADOS_DEFAULT_LOOKBACK_DAYS = 7;

export type AtrasadoProgramacionInfo = {
  estado: EstadoResultadoProgramado;
  /** Número programado; útil si ADMIN quiere publicar ese valor. */
  numero: string;
};

export type AtrasadoSlotItem = {
  fecha: string;
  hora: number;
  /** Siempre false en este listado: solo franjas sin Resultado. */
  tieneResultado: false;
  requiereIntervencionAdmin: true;
  programacion: AtrasadoProgramacionInfo | null;
  tieneProgramacionPendiente: boolean;
};

export type AtrasadosResumen = {
  totalSinResultado: number;
  totalConProgramacionPendiente: number;
  totalSinProgramacionPendiente: number;
};

export type ListAtrasadosResult = {
  items: AtrasadoSlotItem[];
  resumen: AtrasadosResumen;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rango: { desde: string; hasta: string };
  /**
   * Mínima fecha de negocio observada en Resultado, ResultadoProgramado o Ticket.
   * null si no hay datos históricos — no se inventa un origen.
   */
  inicioOperativo: string | null;
};

export type ListAtrasadosQuery = {
  desde?: string | null;
  hasta?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
};

export type AtrasadosDb = Pick<
  PrismaClient,
  "resultado" | "resultadoProgramado" | "ticket"
>;

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

function diasInclusive(desde: Date, hasta: Date): number {
  const ms = hasta.getTime() - desde.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

function slotKey(fecha: Date, hora: number): string {
  return `${fechaAYYYYMMDD(fecha)}|${hora}`;
}

function minDate(dates: Date[]): Date | null {
  if (dates.length === 0) return null;
  let min = dates[0]!;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i]!.getTime() < min.getTime()) min = dates[i]!;
  }
  return min;
}

/**
 * Fecha de inicio operativa = mínima observada en datos reales.
 * No usa constantes de negocio inventadas.
 */
export async function resolveInicioOperativo(
  db: AtrasadosDb,
): Promise<Date | null> {
  const [resultado, programacion, ticket] = await Promise.all([
    db.resultado.findFirst({
      orderBy: { fecha: "asc" },
      select: { fecha: true },
    }),
    db.resultadoProgramado.findFirst({
      orderBy: { fecha: "asc" },
      select: { fecha: true },
    }),
    db.ticket.findFirst({
      orderBy: { fechaJuego: "asc" },
      select: { fechaJuego: true },
    }),
  ]);

  const candidatos: Date[] = [];
  if (resultado) candidatos.push(resultado.fecha);
  if (programacion) candidatos.push(programacion.fecha);
  if (ticket) candidatos.push(ticket.fechaJuego);
  return minDate(candidatos);
}

export function parseListAtrasadosQuery(
  query: ListAtrasadosQuery,
  ahora = new Date(),
  inicioOperativo: Date | null = null,
): {
  desde: Date;
  hasta: Date;
  page: number;
  pageSize: number;
} {
  const hoy = fechaHoyParaPrisma(ahora);
  const ayer = sumarDiasUTC(hoy, -1);

  let hasta: Date;
  if (typeof query.hasta === "string" && query.hasta.trim()) {
    const parsed = parseFechaYYYYMMDD(query.hasta.trim());
    if (!parsed) {
      throw new UserValidationError("Fecha hasta inválida.", "INVALID_QUERY");
    }
    hasta = parsed;
  } else {
    hasta = ayer;
  }

  if (hasta.getTime() >= hoy.getTime()) {
    throw new UserValidationError(
      "El intervalo no puede incluir el día actual ni fechas futuras (America/Caracas).",
      "INVALID_QUERY",
    );
  }

  let desde: Date;
  if (typeof query.desde === "string" && query.desde.trim()) {
    const parsed = parseFechaYYYYMMDD(query.desde.trim());
    if (!parsed) {
      throw new UserValidationError("Fecha desde inválida.", "INVALID_QUERY");
    }
    desde = parsed;
  } else {
    desde = sumarDiasUTC(hasta, -(ATRASADOS_DEFAULT_LOOKBACK_DAYS - 1));
    if (inicioOperativo && desde.getTime() < inicioOperativo.getTime()) {
      desde = inicioOperativo;
    }
  }

  if (desde.getTime() > hasta.getTime()) {
    throw new UserValidationError(
      "La fecha desde no puede ser posterior a hasta.",
      "INVALID_QUERY",
    );
  }

  if (diasInclusive(desde, hasta) > ATRASADOS_RANGE_DAYS_MAX) {
    throw new UserValidationError(
      `El intervalo no puede superar ${ATRASADOS_RANGE_DAYS_MAX} días. Ajusta desde/hasta.`,
      "INVALID_QUERY",
    );
  }

  const page = parsePositiveInt(query.page, 1);
  let pageSize = parsePositiveInt(query.pageSize, ATRASADOS_PAGE_SIZE_DEFAULT);
  if (pageSize > ATRASADOS_PAGE_SIZE_MAX) {
    pageSize = ATRASADOS_PAGE_SIZE_MAX;
  }

  return { desde, hasta, page, pageSize };
}

function enumerateMissingSlots(args: {
  desde: Date;
  hasta: Date;
  resultados: ReadonlySet<string>;
  programaciones: ReadonlyMap<string, AtrasadoProgramacionInfo>;
}): AtrasadoSlotItem[] {
  const items: AtrasadoSlotItem[] = [];
  for (
    let dia = args.desde;
    dia.getTime() <= args.hasta.getTime();
    dia = sumarDiasUTC(dia, 1)
  ) {
    const fechaStr = fechaAYYYYMMDD(dia);
    for (const hora of HORAS_SORTEO) {
      const key = slotKey(dia, hora);
      if (args.resultados.has(key)) continue;
      const programacion = args.programaciones.get(key) ?? null;
      items.push({
        fecha: fechaStr,
        hora,
        tieneResultado: false,
        requiereIntervencionAdmin: true,
        programacion,
        tieneProgramacionPendiente: programacion?.estado === "PENDIENTE",
      });
    }
  }
  return items;
}

function buildResumen(items: readonly AtrasadoSlotItem[]): AtrasadosResumen {
  let totalConProgramacionPendiente = 0;
  for (const item of items) {
    if (item.tieneProgramacionPendiente) totalConProgramacionPendiente += 1;
  }
  return {
    totalSinResultado: items.length,
    totalConProgramacionPendiente,
    totalSinProgramacionPendiente:
      items.length - totalConProgramacionPendiente,
  };
}

/**
 * Lista franjas de fechas anteriores a hoy (Caracas) sin registro Resultado.
 * Solo lecturas. No invoca publicación automática ni manual.
 */
export async function listSorteosAtrasados(
  db: AtrasadosDb,
  query: ListAtrasadosQuery,
  ahora = new Date(),
): Promise<ListAtrasadosResult> {
  const inicioOperativo = await resolveInicioOperativo(db);
  const { desde, hasta, page, pageSize } = parseListAtrasadosQuery(
    query,
    ahora,
    inicioOperativo,
  );

  const [resultadosRows, programacionRows] = await Promise.all([
    db.resultado.findMany({
      where: { fecha: { gte: desde, lte: hasta } },
      select: { fecha: true, hora: true },
    }),
    db.resultadoProgramado.findMany({
      where: { fecha: { gte: desde, lte: hasta } },
      select: { fecha: true, hora: true, estado: true, numero: true },
    }),
  ]);

  const resultados = new Set(
    resultadosRows.map((r) => slotKey(r.fecha, r.hora)),
  );
  const programaciones = new Map<string, AtrasadoProgramacionInfo>();
  for (const p of programacionRows) {
    programaciones.set(slotKey(p.fecha, p.hora), {
      estado: p.estado,
      numero: p.numero,
    });
  }

  const allMissing = enumerateMissingSlots({
    desde,
    hasta,
    resultados,
    programaciones,
  });
  const resumen = buildResumen(allMissing);
  const total = allMissing.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const skip = (page - 1) * pageSize;
  const items = allMissing.slice(skip, skip + pageSize);

  return {
    items,
    resumen,
    page,
    pageSize,
    total,
    totalPages,
    rango: {
      desde: fechaAYYYYMMDD(desde),
      hasta: fechaAYYYYMMDD(hasta),
    },
    inicioOperativo: inicioOperativo
      ? fechaAYYYYMMDD(inicioOperativo)
      : null,
  };
}
