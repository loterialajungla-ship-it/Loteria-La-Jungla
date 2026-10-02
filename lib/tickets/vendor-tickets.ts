import type { PrismaClient, EstadoTicket, RolUsuario } from "@prisma/client";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import { parseAdminListTicketsQuery } from "@/lib/tickets/admin-ticket-query";
import { TicketNotFoundError } from "@/lib/tickets/errors";
import {
  calcularPremioTotalPublico,
  derivarEstadoTicketPublico,
  liquidarLineaPublica,
  moneyToFixed2,
  type EstadoTicketPublico,
  type LineaPublicaLiquidada,
  type ResultadoSorteoRef,
} from "@/lib/tickets/ticket-liquidation";

type Db = Pick<PrismaClient, "ticket" | "resultado">;

export type VendorTicketListItem = {
  id: string;
  numeroVisible: string;
  fechaJuego: string;
  createdAt: string;
  totalApostado: string;
  estado: EstadoTicket;
  estadoDerivado: EstadoTicketPublico;
};

export type ListVendorTicketsResult = {
  tickets: VendorTicketListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type VendorTicketDetalle = {
  id: string;
  numeroVisible: string;
  codigoPublico: string;
  fechaJuego: string;
  createdAt: string;
  totalApostado: string;
  estado: EstadoTicket;
  estadoDerivado: EstadoTicketPublico;
  premioTotal: string;
  liquidacionCompleta: boolean;
  lineas: LineaPublicaLiquidada[];
};

export type VendorTicketActor = {
  userId: string;
  rol: RolUsuario;
};

/**
 * Listado de tickets para área /venta.
 * VENDEDOR: solo vendedorId === userId (nunca null históricos).
 * ADMIN: todos.
 * Ignora cualquier vendedorId del query del cliente.
 */
export async function listVendorTickets(
  db: Db,
  actor: VendorTicketActor,
  query: {
    fecha?: string | null;
    estado?: string | null;
    numero?: string | null;
    page?: string | number | null;
    pageSize?: string | number | null;
  },
): Promise<ListVendorTicketsResult> {
  const filters = parseAdminListTicketsQuery(query);

  const where = {
    ...(actor.rol === "VENDEDOR" ? { vendedorId: actor.userId } : {}),
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

  const resultadoMap = new Map<string, ResultadoSorteoRef>();
  for (const r of resultados) {
    resultadoMap.set(`${fechaAYYYYMMDD(r.fecha)}|${r.hora}`, {
      numero: r.numero,
      nombre: r.animal.nombre,
    });
  }

  const items: VendorTicketListItem[] = tickets.map((ticket) => {
    const ticketAnulado = ticket.estado === "ANULADO";
    const fechaStr = fechaAYYYYMMDD(ticket.fechaJuego);
    const lineas = ticket.lineas.map((linea) =>
      liquidarLineaPublica({
        ticketAnulado,
        multiplicadorUsado: ticket.multiplicadorUsado,
        resultado: resultadoMap.get(`${fechaStr}|${linea.hora}`) ?? null,
        linea: {
          id: linea.id,
          hora: linea.hora,
          numeroAnimal: linea.numeroAnimal,
          nombreAnimalSnapshot: linea.nombreAnimalSnapshot,
          importe: linea.importe,
        },
      }),
    );

    return {
      id: ticket.id,
      numeroVisible: ticket.numeroVisible,
      fechaJuego: fechaStr,
      createdAt: ticket.createdAt.toISOString(),
      totalApostado: moneyToFixed2(ticket.totalApostado),
      estado: ticket.estado,
      estadoDerivado: derivarEstadoTicketPublico({
        ticketAnulado,
        estadosLineas: lineas.map((l) => l.estado),
      }),
    };
  });

  const totalPages =
    total === 0 ? 0 : Math.ceil(total / filters.pageSize);

  return {
    tickets: items,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages,
    },
  };
}

/**
 * Detalle para /venta/tickets/[id].
 * VENDEDOR: 404 si no es dueño o vendedorId null.
 * ADMIN: cualquier ticket.
 * No incluye multiplicadorUsado / vendedorId / anuladoPorId.
 */
export async function getVendorTicketById(
  db: Db,
  actor: VendorTicketActor,
  id: string,
): Promise<VendorTicketDetalle> {
  const ticketId = id.trim();
  if (!ticketId) throw new TicketNotFoundError();

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      lineas: {
        orderBy: [{ hora: "asc" }, { numeroAnimal: "asc" }],
      },
    },
  });

  if (!ticket) throw new TicketNotFoundError();

  if (actor.rol === "VENDEDOR") {
    if (!ticket.vendedorId || ticket.vendedorId !== actor.userId) {
      throw new TicketNotFoundError();
    }
  }

  const horas = Array.from(new Set(ticket.lineas.map((l) => l.hora)));
  const resultados =
    horas.length === 0
      ? []
      : await db.resultado.findMany({
          where: {
            fecha: ticket.fechaJuego,
            hora: { in: horas },
          },
          include: {
            animal: { select: { numero: true, nombre: true } },
          },
        });

  const resultadoPorHora = new Map<number, ResultadoSorteoRef>();
  for (const r of resultados) {
    resultadoPorHora.set(r.hora, {
      numero: r.numero,
      nombre: r.animal.nombre,
    });
  }

  const ticketAnulado = ticket.estado === "ANULADO";
  const lineas = ticket.lineas.map((linea) =>
    liquidarLineaPublica({
      ticketAnulado,
      multiplicadorUsado: ticket.multiplicadorUsado,
      resultado: resultadoPorHora.get(linea.hora) ?? null,
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

  const { premioTotal, liquidacionCompleta } = calcularPremioTotalPublico({
    ticketAnulado,
    lineas,
  });

  return {
    id: ticket.id,
    numeroVisible: ticket.numeroVisible,
    codigoPublico: ticket.codigoPublico,
    fechaJuego: fechaAYYYYMMDD(ticket.fechaJuego),
    createdAt: ticket.createdAt.toISOString(),
    totalApostado: moneyToFixed2(ticket.totalApostado),
    estado: ticket.estado,
    estadoDerivado,
    premioTotal,
    liquidacionCompleta,
    lineas,
  };
}

/** Regla pura para tests: ¿puede el actor ver este ticket? */
export function puedeVerTicketVenta(args: {
  rol: RolUsuario;
  actorUserId: string;
  ticketVendedorId: string | null;
}): boolean {
  if (args.rol === "ADMIN") return true;
  return (
    args.ticketVendedorId != null &&
    args.ticketVendedorId === args.actorUserId
  );
}
