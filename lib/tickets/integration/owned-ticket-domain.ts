/**
 * Aislamiento por ownership para suites que antes usaban `resetTicketDomain`.
 *
 * Solo borra IDs registrados (o recuperados con prueba de pertenencia).
 * Nunca: deleteMany globales, CreditosConfig, Animal, ConfigNegocio, filas ajenas.
 *
 * TicketCounter: el modelo solo tiene PK `fechaJuego` (sin owner/runId). No se
 * puede demostrar ownership exclusivo. Cleanup **nunca** borra TicketCounter
 * (ni por fecha ni por “0 tickets”). Las filas residuales en TEST son inocuas:
 * `createTicket` hace UPSERT +1 y las suites leen `ultimoNumero` como base.
 */
import type { PrismaClient } from "@prisma/client";
import {
  assertIntegrationPrismaClient,
  createTestUser,
  fechaJuegoDate,
} from "@/lib/tickets/integration/harness";

export type OwnedTicketDomain = {
  userIds: Set<string>;
  ticketIds: Set<string>;
  resultadoIds: Set<string>;
  /**
   * Fechas fixture observadas (telemetría / compat). No se usan para borrar
   * TicketCounter — ver comentario de cabecera.
   */
  ticketCounterFechas: Set<string>;
};

export type OwnedCleanupReport = {
  deletedMovimientos: number;
  deletedCuentas: number;
  deletedTicketLineas: number;
  deletedAuditorias: number;
  deletedSessions: number;
  deletedTickets: number;
  deletedResultados: number;
  deletedUsers: number;
  deletedTicketCounters: number;
};

export function createOwnedTicketDomain(): OwnedTicketDomain {
  return {
    userIds: new Set(),
    ticketIds: new Set(),
    resultadoIds: new Set(),
    ticketCounterFechas: new Set(),
  };
}

export function clearOwnedTicketDomain(domain: OwnedTicketDomain): void {
  domain.userIds.clear();
  domain.ticketIds.clear();
  domain.resultadoIds.clear();
  domain.ticketCounterFechas.clear();
}

export function trackOwnedUserId(
  domain: OwnedTicketDomain,
  userId: string,
): void {
  domain.userIds.add(userId);
}

export function trackOwnedTicketId(
  domain: OwnedTicketDomain,
  ticketId: string,
): void {
  domain.ticketIds.add(ticketId);
}

export function trackOwnedResultadoId(
  domain: OwnedTicketDomain,
  resultadoId: string,
): void {
  domain.resultadoIds.add(resultadoId);
}

/**
 * Registra la fecha fixture de ventas (compat con suites existentes).
 * No autoriza borrado de TicketCounter.
 */
export function trackFixtureTicketCounter(domain: OwnedTicketDomain): void {
  domain.ticketCounterFechas.add(fechaJuegoDate().toISOString());
}

/**
 * Si la suite necesita una fecha “exclusiva” (p. ej. numeración absoluta desde 0
 * o ausencia total de tickets ajenos), aborta al detectar tickets no owned.
 * Un TicketCounter residual solo NO es motivo de abort (opción A).
 */
export async function assertExclusiveTicketFechaOrAbort(
  db: PrismaClient,
  domain: OwnedTicketDomain,
  fecha: Date,
): Promise<void> {
  assertIntegrationPrismaClient(db);
  const rows = await db.ticket.findMany({
    where: { fechaJuego: fecha },
    select: { id: true, vendedorId: true, numeroVisible: true },
  });
  const foreign = rows.filter((t) => !domain.ticketIds.has(t.id));
  if (foreign.length === 0) return;
  const detail = foreign
    .slice(0, 5)
    .map(
      (t) =>
        `id=${t.id} num=${t.numeroVisible} vend=${t.vendedorId ?? "null"}`,
    )
    .join("; ");
  throw new Error(
    `[owned-ticket-domain] ABORT: fecha fixture no exclusiva ` +
      `(tickets ajenos=${foreign.length}). No se borran tickets ni TicketCounter. ` +
      `${detail}`,
  );
}

export async function createOwnedTestUser(
  db: PrismaClient,
  domain: OwnedTicketDomain,
  args: {
    usuario: string;
    nombre: string;
    rol: "ADMIN" | "VENDEDOR";
    password?: string;
  },
): Promise<{ id: string; usuario: string; rol: "ADMIN" | "VENDEDOR" }> {
  const row = await createTestUser(db, args);
  domain.userIds.add(row.id);
  return row;
}

function auditoriaOwned(
  a: { usuarioId: string | null; entidad: string; entidadId: string },
  domain: OwnedTicketDomain,
): boolean {
  if (a.usuarioId != null && domain.userIds.has(a.usuarioId)) return true;
  if (a.entidad === "USUARIO" && domain.userIds.has(a.entidadId)) return true;
  if (a.entidad === "TICKET" && domain.ticketIds.has(a.entidadId)) return true;
  if (a.entidad === "RESULTADO" && domain.resultadoIds.has(a.entidadId)) {
    return true;
  }
  return false;
}

/**
 * Expande el registry con filas ligadas a userIds ya conocidos.
 * Tickets históricos (vendedorId null) solo entran si ya están en ticketIds.
 */
export async function recoverOwnedTicketDomain(
  db: PrismaClient,
  domain: OwnedTicketDomain,
): Promise<void> {
  assertIntegrationPrismaClient(db);
  const userList = [...domain.userIds];
  if (userList.length === 0) return;

  const tickets = await db.ticket.findMany({
    where: {
      OR: [
        { vendedorId: { in: userList } },
        { anuladoPorId: { in: userList } },
      ],
    },
    select: { id: true, vendedorId: true },
  });
  for (const t of tickets) {
    // Solo adoptar si el vendedor es propio (anuladoPor ajeno no basta).
    if (t.vendedorId != null && domain.userIds.has(t.vendedorId)) {
      domain.ticketIds.add(t.id);
    }
  }
}

/**
 * Limpia únicamente registros con ownership demostrado.
 * Ejecutar también en `after` / cuando un test falle.
 */
export async function cleanupOwnedTicketDomain(
  db: PrismaClient,
  domain: OwnedTicketDomain,
): Promise<OwnedCleanupReport> {
  assertIntegrationPrismaClient(db);

  await recoverOwnedTicketDomain(db, domain);

  const userList = [...domain.userIds];
  const ticketList = [...domain.ticketIds];
  const resultadoList = [...domain.resultadoIds];

  const movimientoIds: string[] = [];
  const cuentaIds: string[] = [];
  const lineaIds: string[] = [];
  const auditoriaIds: string[] = [];
  const sessionIds: string[] = [];

  if (userList.length > 0) {
    const movs = await db.creditoMovimiento.findMany({
      where: { vendedorId: { in: userList } },
      select: { id: true, vendedorId: true },
    });
    for (const m of movs) {
      movimientoIds.push(m.id);
      cuentaIds.push(m.vendedorId);
    }

    const cuentas = await db.vendedorCreditoCuenta.findMany({
      where: { vendedorId: { in: userList } },
      select: { vendedorId: true },
    });
    for (const c of cuentas) cuentaIds.push(c.vendedorId);

    const sessions = await db.usuarioSesion.findMany({
      where: { usuarioId: { in: userList } },
      select: { id: true },
    });
    for (const s of sessions) sessionIds.push(s.id);
  }

  if (ticketList.length > 0) {
    const movTickets = await db.creditoMovimiento.findMany({
      where: { ticketId: { in: ticketList } },
      select: { id: true, vendedorId: true, ticketId: true },
    });
    for (const m of movTickets) {
      if (
        domain.userIds.has(m.vendedorId) ||
        (m.ticketId != null && domain.ticketIds.has(m.ticketId))
      ) {
        movimientoIds.push(m.id);
      }
    }

    const lineas = await db.ticketLinea.findMany({
      where: { ticketId: { in: ticketList } },
      select: { id: true, ticketId: true },
    });
    for (const l of lineas) {
      if (domain.ticketIds.has(l.ticketId)) lineaIds.push(l.id);
    }
  }

  const auditOr: Array<Record<string, unknown>> = [];
  if (userList.length > 0) {
    auditOr.push({ usuarioId: { in: userList } });
    auditOr.push({ entidad: "USUARIO", entidadId: { in: userList } });
  }
  if (ticketList.length > 0) {
    auditOr.push({ entidad: "TICKET", entidadId: { in: ticketList } });
  }
  if (resultadoList.length > 0) {
    auditOr.push({ entidad: "RESULTADO", entidadId: { in: resultadoList } });
  }
  if (auditOr.length > 0) {
    const audits = await db.auditoria.findMany({
      where: { OR: auditOr },
      select: {
        id: true,
        usuarioId: true,
        entidad: true,
        entidadId: true,
      },
    });
    for (const a of audits) {
      if (auditoriaOwned(a, domain)) auditoriaIds.push(a.id);
    }
  }

  // Tickets: vendedor propio, o histórico null trackeado explícitamente.
  const ticketsToDelete: string[] = [];
  for (const tid of ticketList) {
    const t = await db.ticket.findUnique({
      where: { id: tid },
      select: { id: true, vendedorId: true },
    });
    if (!t) continue;
    if (t.vendedorId != null && domain.userIds.has(t.vendedorId)) {
      ticketsToDelete.push(t.id);
    } else if (t.vendedorId == null) {
      ticketsToDelete.push(t.id);
    }
  }

  const unique = (ids: string[]) => [...new Set(ids)];

  let deletedMovimientos = 0;
  let deletedCuentas = 0;
  let deletedTicketLineas = 0;
  let deletedAuditorias = 0;
  let deletedSessions = 0;
  let deletedTickets = 0;
  let deletedResultados = 0;
  let deletedUsers = 0;
  let deletedTicketCounters = 0;

  const movArr = unique(movimientoIds);
  if (movArr.length > 0) {
    // Hijos de cadena (DEVOLUCION/CORRECCION) antes que orígenes (Restrict).
    const children = await db.creditoMovimiento.deleteMany({
      where: {
        id: { in: movArr },
        movimientoOrigenId: { not: null },
      },
    });
    const parents = await db.creditoMovimiento.deleteMany({
      where: { id: { in: movArr } },
    });
    deletedMovimientos = children.count + parents.count;
  }

  const cuentaArr = unique(cuentaIds).filter((id) => domain.userIds.has(id));
  if (cuentaArr.length > 0) {
    const r = await db.vendedorCreditoCuenta.deleteMany({
      where: { vendedorId: { in: cuentaArr } },
    });
    deletedCuentas = r.count;
  }

  const lineaArr = unique(lineaIds);
  if (lineaArr.length > 0) {
    const r = await db.ticketLinea.deleteMany({
      where: { id: { in: lineaArr } },
    });
    deletedTicketLineas = r.count;
  }

  const auditArr = unique(auditoriaIds);
  if (auditArr.length > 0) {
    const r = await db.auditoria.deleteMany({
      where: { id: { in: auditArr } },
    });
    deletedAuditorias = r.count;
  }

  const sessionArr = unique(sessionIds);
  if (sessionArr.length > 0) {
    const r = await db.usuarioSesion.deleteMany({
      where: { id: { in: sessionArr } },
    });
    deletedSessions = r.count;
  }

  if (ticketsToDelete.length > 0) {
    const r = await db.ticket.deleteMany({
      where: { id: { in: unique(ticketsToDelete) } },
    });
    deletedTickets = r.count;
  }

  if (resultadoList.length > 0) {
    const r = await db.resultado.deleteMany({
      where: { id: { in: resultadoList } },
    });
    deletedResultados = r.count;
  }

  if (userList.length > 0) {
    const r = await db.usuario.deleteMany({
      where: { id: { in: userList } },
    });
    deletedUsers = r.count;
  }

  // TicketCounter: nunca borrar. Sin columna de ownership no hay prueba de
  // pertenencia; "0 tickets en fecha" no implica que el contador sea propio.
  deletedTicketCounters = 0;

  clearOwnedTicketDomain(domain);

  return {
    deletedMovimientos,
    deletedCuentas,
    deletedTicketLineas,
    deletedAuditorias,
    deletedSessions,
    deletedTickets,
    deletedResultados,
    deletedUsers,
    deletedTicketCounters,
  };
}
