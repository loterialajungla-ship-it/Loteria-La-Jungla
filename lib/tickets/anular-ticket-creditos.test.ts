import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { actualizarCreditosConfig } from "@/lib/creditos/config";
import { CreditosSchemaUnavailableError } from "@/lib/creditos/errors";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
  consumirCreditosPorVenta,
} from "@/lib/creditos/operaciones";
import {
  createMemoryCreditosStore,
  type CreditosStore,
} from "@/lib/creditos/store";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { TicketAlreadyAnuladoError } from "@/lib/tickets/errors";

const FECHA = new Date(Date.UTC(2026, 10, 2));
const INICIO = new Date("2026-11-01T04:00:00.000Z");

function fakeAnularDb(opts: {
  ticket: {
    id: string;
    numeroVisible: string;
    fechaJuego: Date;
    totalApostado: string;
    estado: "EMITIDO" | "ANULADO";
    anuladoAt: Date | null;
    anuladoPorId: string | null;
    motivoAnulacion: string | null;
  };
}) {
  let estado = opts.ticket.estado;
  let anuladoAt = opts.ticket.anuladoAt;
  let anuladoPorId = opts.ticket.anuladoPorId;
  let motivoAnulacion = opts.ticket.motivoAnulacion;

  return {
    getEstado: () => estado,
    async $transaction<T>(fn: (tx: never) => Promise<T>) {
      const snap = {
        estado,
        anuladoAt,
        anuladoPorId,
        motivoAnulacion,
      };
      const tx = {
        ticket: {
          async updateMany(args: {
            where: { id: string; estado: string };
            data: {
              estado: "ANULADO";
              anuladoAt: Date;
              motivoAnulacion: string;
              anuladoPorId: string | null;
            };
          }) {
            if (
              args.where.id === opts.ticket.id &&
              args.where.estado === "EMITIDO" &&
              estado === "EMITIDO"
            ) {
              estado = "ANULADO";
              anuladoAt = args.data.anuladoAt;
              anuladoPorId = args.data.anuladoPorId;
              motivoAnulacion = args.data.motivoAnulacion;
              return { count: 1 };
            }
            return { count: 0 };
          },
          async findUnique() {
            return {
              id: opts.ticket.id,
              numeroVisible: opts.ticket.numeroVisible,
              fechaJuego: opts.ticket.fechaJuego,
              totalApostado: opts.ticket.totalApostado,
              estado,
              anuladoAt,
              anuladoPorId,
              motivoAnulacion,
            };
          },
        },
        auditoria: {
          async create() {
            return {};
          },
        },
      };
      try {
        return await fn(tx as never);
      } catch (e) {
        estado = snap.estado;
        anuladoAt = snap.anuladoAt;
        anuladoPorId = snap.anuladoPorId;
        motivoAnulacion = snap.motivoAnulacion;
        throw e;
      }
    },
  };
}

describe("anularTicket + créditos", () => {
  it("devuelve consumo exacto en la misma operación", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "admin",
    });
    await asignarCreditos(credits, {
      vendedorId: "vend",
      importe: "40",
      actorAdminId: "admin",
    });
    await consumirCreditosPorVenta(credits, {
      vendedorId: "vend",
      ticketId: "tk-1",
      importe: "12.50",
    });

    const db = fakeAnularDb({
      ticket: {
        id: "tk-1",
        numeroVisible: "LJ-20261102-000001",
        fechaJuego: FECHA,
        totalApostado: "12.50",
        estado: "EMITIDO",
        anuladoAt: null,
        anuladoPorId: null,
        motivoAnulacion: null,
      },
    });

    await anularTicket(
      db as never,
      { id: "tk-1", motivo: "error de venta", anuladoPorId: "admin" },
      { bindCreditsStore: () => credits },
    );

    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      "vend",
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "40.00");
    assert.equal(
      movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
      1,
    );
  });

  it("ticket sin consumo previo: anula sin inventar devolución", async () => {
    const credits = createMemoryCreditosStore();
    await asignarCreditos(credits, {
      vendedorId: "vend",
      importe: "10",
      actorAdminId: "admin",
    });
    const db = fakeAnularDb({
      ticket: {
        id: "tk-old",
        numeroVisible: "LJ-X",
        fechaJuego: FECHA,
        totalApostado: "5.00",
        estado: "EMITIDO",
        anuladoAt: null,
        anuladoPorId: null,
        motivoAnulacion: null,
      },
    });
    await anularTicket(
      db as never,
      { id: "tk-old", motivo: "cancel", anuladoPorId: "admin" },
      { bindCreditsStore: () => credits },
    );
    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      "vend",
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "10.00");
    assert.equal(
      movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
      0,
    );
  });

  it("segunda anulación 409 y no doble devolución", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "admin",
    });
    await asignarCreditos(credits, {
      vendedorId: "vend",
      importe: "20",
      actorAdminId: "admin",
    });
    await consumirCreditosPorVenta(credits, {
      vendedorId: "vend",
      ticketId: "tk-2",
      importe: "8",
    });
    const db = fakeAnularDb({
      ticket: {
        id: "tk-2",
        numeroVisible: "LJ-2",
        fechaJuego: FECHA,
        totalApostado: "8.00",
        estado: "EMITIDO",
        anuladoAt: null,
        anuladoPorId: null,
        motivoAnulacion: null,
      },
    });
    await anularTicket(
      db as never,
      { id: "tk-2", motivo: "dup1", anuladoPorId: "admin" },
      { bindCreditsStore: () => credits },
    );
    await assert.rejects(
      () =>
        anularTicket(
          db as never,
          { id: "tk-2", motivo: "dup2", anuladoPorId: "admin" },
          { bindCreditsStore: () => credits },
        ),
      (e: unknown) => e instanceof TicketAlreadyAnuladoError,
    );
    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      "vend",
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "20.00");
    assert.equal(
      movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
      1,
    );
  });

  it("esquema ausente con consumo previo: anulación rechazada y ticket sigue EMITIDO", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "admin",
    });
    await asignarCreditos(credits, {
      vendedorId: "vend",
      importe: "20",
      actorAdminId: "admin",
    });
    await consumirCreditosPorVenta(credits, {
      vendedorId: "vend",
      ticketId: "tk-schema",
      importe: "6",
    });

    const db = fakeAnularDb({
      ticket: {
        id: "tk-schema",
        numeroVisible: "LJ-S",
        fechaJuego: FECHA,
        totalApostado: "6.00",
        estado: "EMITIDO",
        anuladoAt: null,
        anuladoPorId: null,
        motivoAnulacion: null,
      },
    });

    const schemaBoom: CreditosStore = {
      ...credits,
      runInTransaction: async <T>(): Promise<T> => {
        throw new Prisma.PrismaClientKnownRequestError(
          'The table `public.CreditoMovimiento` does not exist in the current database.',
          {
            code: "P2021",
            clientVersion: "5.22.0",
            meta: { table: "CreditoMovimiento" },
          },
        );
      },
    };

    await assert.rejects(
      () =>
        anularTicket(
          db as never,
          { id: "tk-schema", motivo: "x", anuladoPorId: "admin" },
          { bindCreditsStore: () => schemaBoom },
        ),
      (e: unknown) => e instanceof CreditosSchemaUnavailableError,
    );

    assert.equal(db.getEstado(), "EMITIDO");
    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      "vend",
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "14.00");
    assert.equal(
      movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
      0,
    );
  });

  it("si la devolución falla, la anulación no queda confirmada (rollback TX)", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "admin",
    });
    await asignarCreditos(credits, {
      vendedorId: "vend",
      importe: "15",
      actorAdminId: "admin",
    });
    await consumirCreditosPorVenta(credits, {
      vendedorId: "vend",
      ticketId: "tk-fail",
      importe: "5",
    });

    const base = fakeAnularDb({
      ticket: {
        id: "tk-fail",
        numeroVisible: "LJ-F",
        fechaJuego: FECHA,
        totalApostado: "5.00",
        estado: "EMITIDO",
        anuladoAt: null,
        anuladoPorId: null,
        motivoAnulacion: null,
      },
    });

    // Simula fallo de devolución: store que revienta al devolver.
    const boomStore = {
      ...credits,
      runInTransaction: async <T>(): Promise<T> => {
        throw new Error("fallo forzado devolución");
      },
    };

    await assert.rejects(() =>
      anularTicket(
        base as never,
        { id: "tk-fail", motivo: "x", anuladoPorId: "admin" },
        { bindCreditsStore: () => boomStore as never },
      ),
    );

    assert.equal(base.getEstado(), "EMITIDO");
    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      "vend",
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "10.00");
    assert.equal(
      movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
      0,
    );
  });
});
