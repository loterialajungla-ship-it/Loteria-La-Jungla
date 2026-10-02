import type { PrismaClient, EstadoTicket } from "@prisma/client";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import {
  parseAdminListTicketsQuery,
  type AdminListTicketsQuery,
} from "@/lib/tickets/admin-ticket-query";
import {
  calcularPremioTotalPublico,
  derivarEstadoTicketPublico,
  liquidarLineaPublica,
  moneyToFixed2,
  type EstadoTicketPublico,
  type ResultadoSorteoRef,
} from "@/lib/tickets/ticket-liquidation";

type Db = Pick<PrismaClient, "ticket" | "resultado">;

export type AdminTicketListItem = {
  id: string;
  numeroVisible: string;
  fechaJuego: string;
  createdAt: string;
  totalApostado: string;
  /** Estado persistido: EMITIDO | ANULADO */
  estado: EstadoTicket;
  /** Estado derivado de liquidación */
  estadoDerivado: EstadoTicketPublico;
};

export type AdminListTicketsResult = {
  items: AdminTicketListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/**
 * Listado admin paginado. Orden: createdAt DESC.
 * Estado derivado vía liquidación (no duplicar reglas en UI).
 */
export async function listAdminTickets(
  db: Db,
  query: AdminListTicketsQuery,
): Promise<AdminListTicketsResult> {
  const filters = parseAdminListTicketsQuery(query);

  const where = {
    ...(filters.fechaJuego ? { fechaJuego: filters.fechaJuego } : {}),
    ...(filters.estado !== "TODOS" ? { estado: filters.estado } : {}),
    ...(filters.numeroVisible
      ? { numeroVisible: filters.numeroVisible }
      : {}),
  };

  const skip = (filters.page - 1) * filters.pageSize;

  const [total, tickets] = await Promise.all([
    db.ticket.count({ where }),
    db.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: filters.pageSize,
      include: {
        lineas: {
          select: {
            id: true,
            hora: true,
            numeroAnimal: true,
            nombreAnimalSnapshot: true,
            importe: true,
          },
        },
      },
    }),
  ]);

  const fechas = Array.from(
    new Set(tickets.map((t) => t.fechaJuego.getTime())),
  ).map((ms) => new Date(ms));

  const resultados =
    fechas.length === 0
      ? []
      : await db.resultado.findMany({
          where: { fecha: { in: fechas } },
          include: {
            animal: { select: { numero: true, nombre: true } },
          },
        });

  /** clave: `${fechaISO}|${hora}` */
  const resultadoMap = new Map<string, ResultadoSorteoRef>();
  for (const r of resultados) {
    const key = `${fechaAYYYYMMDD(r.fecha)}|${r.hora}`;
    resultadoMap.set(key, {
      numero: r.numero,
      nombre: r.animal.nombre,
    });
  }

  const items: AdminTicketListItem[] = tickets.map((ticket) => {
    const ticketAnulado = ticket.estado === "ANULADO";
    const fechaStr = fechaAYYYYMMDD(ticket.fechaJuego);
    const lineas = ticket.lineas.map((linea) =>
      liquidarLineaPublica({
        ticketAnulado,
        multiplicadorUsado: ticket.multiplicadorUsado,
        resultado:
          resultadoMap.get(`${fechaStr}|${linea.hora}`) ?? null,
        linea: {
          id: linea.id,
          hora: linea.hora,
          numeroAnimal: linea.numeroAnimal,
          nombreAnimalSnapshot: linea.nombreAnimalSnapshot,
          importe: linea.importe,
        },
      }),
    );

    const estadoDerivado = derivarEstadoTicketPublico({
      ticketAnulado,
      estadosLineas: lineas.map((l) => l.estado),
    });

    return {
      id: ticket.id,
      numeroVisible: ticket.numeroVisible,
      fechaJuego: fechaStr,
      createdAt: ticket.createdAt.toISOString(),
      totalApostado: moneyToFixed2(ticket.totalApostado),
      estado: ticket.estado,
      estadoDerivado,
    };
  });

  const totalPages =
    total === 0 ? 0 : Math.ceil(total / filters.pageSize);

  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages,
  };
}

/** Expone premioTotal en listado interno si se necesita (detalle lo usa). */
export function calcularPremioDerivadoDeLineas(
  ticketAnulado: boolean,
  lineas: Parameters<typeof calcularPremioTotalPublico>[0]["lineas"],
) {
  return calcularPremioTotalPublico({ ticketAnulado, lineas });
}
