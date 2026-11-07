/**
 * C3: createTicket + obligaciones de Caja + atribución ADMIN (fake DB).
 * Atomicidad real de TX / concurrencia → requiere DB TEST (ver notas al final).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { moneyFixed2 } from "@/lib/caja/money";
import {
  CajaNotFoundError,
  CajaValidationError,
} from "@/lib/caja/errors";
import { actualizarCreditosConfig } from "@/lib/creditos/config";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
} from "@/lib/creditos/operaciones";
import { createMemoryCreditosStore } from "@/lib/creditos/store";
import { hoyYYYYMMDD } from "@/lib/fecha";
import { createTicket } from "@/lib/tickets/create-ticket";
import { TicketSellerNotAllowedError } from "@/lib/tickets/errors";
import { parseCreateTicketBody } from "@/lib/tickets/parse-create-ticket-body";

type UserRow = { id: string; rol: "ADMIN" | "VENDEDOR"; activo: boolean };

type ObligacionRow = {
  id: string;
  ticketId: string;
  vendedorId: string;
  bruto: Prisma.Decimal;
  comisionPorcentaje: Prisma.Decimal;
  comisionImporte: Prisma.Decimal;
  importeAdmin: Prisma.Decimal;
  createdAt: Date;
};

function makeCreateTicketCajaHarness(opts: {
  users: UserRow[];
  ahora: Date;
  caja?: {
    activa: boolean;
    activadaEn: Date | null;
  };
  comisiones?: Record<string, string>;
  /** Si true, create de obligación lanza tras crear ticket (simula fallo). */
  failObligacion?: boolean;
  /** Si true, ticket.create lanza (simula fallo previo). */
  failTicket?: boolean;
}) {
  const users = new Map(opts.users.map((u) => [u.id, u]));
  const ticketsByIdem = new Map<string, Record<string, unknown>>();
  const ticketsById = new Map<string, Record<string, unknown>>();
  const obligaciones = new Map<string, ObligacionRow>();
  const obligacionesByTicket = new Map<string, string>();
  const comisiones = new Map<string, { porcentaje: Prisma.Decimal }>();
  for (const [vid, pct] of Object.entries(opts.comisiones ?? {})) {
    comisiones.set(vid, { porcentaje: new Prisma.Decimal(pct) });
  }
  const auditRows: unknown[] = [];
  let ticketSeq = 0;
  let rolledBack = false;

  const cajaConfig =
    opts.caja == null
      ? null
      : {
          id: 1,
          activa: opts.caja.activa,
          activadaEn: opts.caja.activadaEn,
          activadaPorAdminId: opts.caja.activa ? "admin-1" : null,
          updatedAt: opts.ahora,
        };

  function buildTx() {
    return {
      async $queryRaw(...args: unknown[]) {
        const sql = args[0] as { strings?: readonly string[] } | undefined;
        const text = Array.isArray(sql?.strings)
          ? sql!.strings!.join(" ")
          : String(sql ?? "");
        if (text.includes('"Usuario"') && text.includes("FOR UPDATE")) {
          const id = args[1] as string;
          const u = users.get(id);
          if (!u) return [];
          return [{ id: u.id, rol: u.rol, activo: u.activo }];
        }
        if (
          text.includes('"VendedorComision"') &&
          text.includes("FOR UPDATE")
        ) {
          const id = args[1] as string;
          const row = comisiones.get(id);
          if (!row) return [];
          return [
            {
              vendedorId: id,
              porcentaje: row.porcentaje,
              updatedAt: opts.ahora,
              updatedByAdminId: null,
            },
          ];
        }
        return [{ ultimoNumero: ++ticketSeq }];
      },
      configNegocio: {
        async findUnique() {
          return { clave: "MULTIPLICADOR_PREMIO", valorInt: 30 };
        },
      },
      resultado: {
        async findMany() {
          return [];
        },
      },
      animal: {
        async findMany(args: { where: { numero: { in: string[] } } }) {
          return args.where.numero.in.map((numero) => ({
            numero,
            nombre: `Animal-${numero}`,
          }));
        },
      },
      usuario: {
        async findUnique(args: { where: { id: string }; select?: unknown }) {
          const u = users.get(args.where.id);
          if (!u) return null;
          return { id: u.id, rol: u.rol, activo: u.activo };
        },
      },
      cajaConfig: {
        async findUnique() {
          return cajaConfig ? { ...cajaConfig } : null;
        },
      },
      vendedorComision: {
        async findUnique(args: { where: { vendedorId: string } }) {
          const row = comisiones.get(args.where.vendedorId);
          if (!row) return null;
          return {
            vendedorId: args.where.vendedorId,
            porcentaje: row.porcentaje,
            updatedAt: opts.ahora,
            updatedByAdminId: null,
          };
        },
        async create(args: {
          data: {
            vendedorId: string;
            porcentaje: Prisma.Decimal;
            updatedAt: Date;
            updatedByAdminId: string | null;
          };
        }) {
          comisiones.set(args.data.vendedorId, {
            porcentaje: new Prisma.Decimal(args.data.porcentaje),
          });
          return {
            vendedorId: args.data.vendedorId,
            porcentaje: new Prisma.Decimal(args.data.porcentaje),
            updatedAt: args.data.updatedAt,
            updatedByAdminId: args.data.updatedByAdminId,
          };
        },
      },
      vendedorComisionHistorial: {
        async create(args: { data: unknown }) {
          return args.data;
        },
      },
      cajaObligacion: {
        async create(args: {
          data: {
            id: string;
            ticketId: string;
            vendedorId: string;
            bruto: Prisma.Decimal;
            comisionPorcentaje: Prisma.Decimal;
            comisionImporte: Prisma.Decimal;
            importeAdmin: Prisma.Decimal;
            createdAt?: Date;
          };
        }) {
          if (opts.failObligacion) {
            throw new Error("simulated obligacion failure");
          }
          if (obligacionesByTicket.has(args.data.ticketId)) {
            const err = Object.assign(new Error("Unique"), {
              code: "P2002",
              meta: { target: ["ticketId"] },
            });
            throw err;
          }
          const row: ObligacionRow = {
            id: args.data.id,
            ticketId: args.data.ticketId,
            vendedorId: args.data.vendedorId,
            bruto: new Prisma.Decimal(args.data.bruto),
            comisionPorcentaje: new Prisma.Decimal(
              args.data.comisionPorcentaje,
            ),
            comisionImporte: new Prisma.Decimal(args.data.comisionImporte),
            importeAdmin: new Prisma.Decimal(args.data.importeAdmin),
            createdAt: args.data.createdAt ?? opts.ahora,
          };
          obligaciones.set(row.id, row);
          obligacionesByTicket.set(row.ticketId, row.id);
          return { ...row };
        },
        async findUnique(args: { where: { ticketId: string } }) {
          const id = obligacionesByTicket.get(args.where.ticketId);
          if (!id) return null;
          return obligaciones.get(id) ?? null;
        },
      },
      ticket: {
        async findUnique(args: {
          where: { codigoPublico?: string; idempotencyKey?: string };
        }) {
          if (args.where.codigoPublico) return null;
          if (args.where.idempotencyKey) {
            return ticketsByIdem.get(args.where.idempotencyKey) ?? null;
          }
          return null;
        },
        async create(args: {
          data: {
            numeroVisible: string;
            codigoPublico: string;
            fechaJuego: Date;
            vendedorId: string;
            totalApostado: Prisma.Decimal;
            estado: "EMITIDO";
            multiplicadorUsado: number;
            idempotencyKey: string;
            idempotencyRequestHash: string;
            lineas: {
              create: {
                fechaJuego: Date;
                hora: number;
                numeroAnimal: string;
                nombreAnimalSnapshot: string;
                importe: Prisma.Decimal;
              }[];
            };
          };
        }) {
          if (opts.failTicket) {
            throw new Error("simulated ticket failure");
          }
          const id = `tk-${ticketsById.size + 1}`;
          const created = {
            id,
            numeroVisible: args.data.numeroVisible,
            codigoPublico: args.data.codigoPublico,
            fechaJuego: args.data.fechaJuego,
            vendedorId: args.data.vendedorId,
            totalApostado: args.data.totalApostado,
            multiplicadorUsado: args.data.multiplicadorUsado,
            estado: args.data.estado,
            createdAt: opts.ahora,
            idempotencyKey: args.data.idempotencyKey,
            idempotencyRequestHash: args.data.idempotencyRequestHash,
            lineas: args.data.lineas.create.map((l, i) => ({
              id: `${id}-ln-${i}`,
              hora: l.hora,
              numeroAnimal: l.numeroAnimal,
              nombreAnimalSnapshot: l.nombreAnimalSnapshot,
              importe: l.importe,
            })),
          };
          // Staging: solo se confirma al salir de $transaction sin error.
          (created as { __staged?: boolean }).__staged = true;
          return created;
        },
      },
      auditoria: {
        async create(args: { data: unknown }) {
          auditRows.push(args.data);
          return {};
        },
      },
    };
  }

  const db = {
    obligaciones,
    obligacionesByTicket,
    auditRows,
    ticketsByIdem,
    get rolledBack() {
      return rolledBack;
    },
    usuario: {
      async findUnique(args: { where: { id: string } }) {
        const u = users.get(args.where.id);
        if (!u) return null;
        return { id: u.id, rol: u.rol, activo: u.activo };
      },
    },
    ticket: {
      async findUnique(args: {
        where: { idempotencyKey?: string };
        include?: unknown;
      }) {
        if (args.where.idempotencyKey) {
          return ticketsByIdem.get(args.where.idempotencyKey) ?? null;
        }
        return null;
      },
    },
    async $transaction(
      fn: (tx: ReturnType<typeof buildTx>) => Promise<unknown>,
    ) {
      const stagedTickets: Record<string, unknown>[] = [];
      const stagedObligIds: string[] = [];
      const tx = buildTx();
      const origTicketCreate = tx.ticket.create.bind(tx.ticket);
      tx.ticket.create = async (args) => {
        const created = await origTicketCreate(args);
        stagedTickets.push(created as Record<string, unknown>);
        return created;
      };
      const origObligCreate = tx.cajaObligacion.create.bind(tx.cajaObligacion);
      tx.cajaObligacion.create = async (args) => {
        const created = await origObligCreate(args);
        stagedObligIds.push(created.id);
        return created;
      };
      try {
        const result = await fn(tx);
        for (const t of stagedTickets) {
          ticketsByIdem.set(String(t.idempotencyKey), t);
          ticketsById.set(String(t.id), t);
        }
        return result;
      } catch (error) {
        rolledBack = true;
        for (const oid of stagedObligIds) {
          const row = obligaciones.get(oid);
          if (row) {
            obligaciones.delete(oid);
            obligacionesByTicket.delete(row.ticketId);
          }
        }
        // tickets no se confirman en maps → no quedan huérfanos
        throw error;
      }
    },
  };

  return db;
}

describe("C3 createTicket + CajaObligacion", () => {
  const ahora = new Date("2026-11-06T16:00:00.000Z"); // VE tarde → hora 19 abierta
  const fechaStr = hoyYYYYMMDD(ahora);
  const activadaEn = new Date("2026-11-06T15:00:00.000Z");

  it("caja desactivada: VENDEDOR crea ticket sin obligación", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: false,
      inicioEn: null,
      updatedByAdminId: "admin-1",
    });
    const db = makeCreateTicketCajaHarness({
      users: [{ id: "vend-1", rol: "VENDEDOR", activo: true }],
      ahora,
      caja: { activa: false, activadaEn: null },
      comisiones: { "vend-1": "20.00" },
    });
    const r = await createTicket(
      {
        fechaJuego: fechaStr,
        idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001",
        vendedorId: "vend-1",
        lineas: [{ hora: 19, numeroAnimal: "00", importe: "1000.00" }],
      },
      ahora,
      db as never,
      { actorRol: "VENDEDOR", bindCreditsStore: () => credits },
    );
    assert.equal(r.idempotentReplay, false);
    assert.equal(db.obligaciones.size, 0);
    assert.equal(r.ticket.vendedorId, "vend-1");
  });

  it("ticket posterior a activación: genera obligación 20 %", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: false,
      inicioEn: null,
      updatedByAdminId: "admin-1",
    });
    const db = makeCreateTicketCajaHarness({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
      ahora,
      caja: { activa: true, activadaEn },
      comisiones: { "vend-1": "20.00" },
    });
    const r = await createTicket(
      {
        fechaJuego: fechaStr,
        idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002",
        vendedorId: "vend-1",
        lineas: [{ hora: 19, numeroAnimal: "00", importe: "1000.00" }],
      },
      ahora,
      db as never,
      { actorRol: "VENDEDOR", bindCreditsStore: () => credits },
    );
    assert.equal(db.obligaciones.size, 1);
    const o = [...db.obligaciones.values()][0]!;
    assert.equal(o.ticketId, r.ticket.id);
    assert.equal(o.vendedorId, "vend-1");
    assert.equal(moneyFixed2(o.bruto), "1000.00");
    assert.equal(moneyFixed2(o.comisionPorcentaje), "20.00");
    assert.equal(moneyFixed2(o.comisionImporte), "200.00");
    assert.equal(moneyFixed2(o.importeAdmin), "800.00");
  });

  it("createdAt === activadaEn → genera (inclusión ≥)", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: false,
      inicioEn: null,
      updatedByAdminId: "admin-1",
    });
    const exact = new Date(activadaEn.getTime());
    const db = makeCreateTicketCajaHarness({
      users: [{ id: "vend-1", rol: "VENDEDOR", activo: true }],
      ahora: exact,
      caja: { activa: true, activadaEn },
      comisiones: { "vend-1": "10.00" },
    });
    await createTicket(
      {
        fechaJuego: hoyYYYYMMDD(exact),
        idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0003",
        vendedorId: "vend-1",
        lineas: [{ hora: 19, numeroAnimal: "00", importe: "1000.00" }],
      },
      exact,
      db as never,
      { actorRol: "VENDEDOR", bindCreditsStore: () => credits },
    );
    assert.equal(db.obligaciones.size, 1);
    const o = [...db.obligaciones.values()][0]!;
    assert.equal(moneyFixed2(o.comisionImporte), "100.00");
    assert.equal(moneyFixed2(o.importeAdmin), "900.00");
  });

  it("VENDEDOR no puede atribuir a otro", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: false,
      inicioEn: null,
      updatedByAdminId: "admin-1",
    });
    const db = makeCreateTicketCajaHarness({
      users: [
        { id: "vend-1", rol: "VENDEDOR", activo: true },
        { id: "vend-2", rol: "VENDEDOR", activo: true },
      ],
      ahora,
      caja: { activa: true, activadaEn },
    });
    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fechaStr,
            idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0004",
            vendedorId: "vend-1",
            atribuidoAVendedorId: "vend-2",
            lineas: [{ hora: 19, numeroAnimal: "00", importe: "10.00" }],
          },
          ahora,
          db as never,
          {
            actorRol: "VENDEDOR",
            atribuidoAVendedorId: "vend-2",
            bindCreditsStore: () => credits,
          },
        ),
      TicketSellerNotAllowedError,
    );
    assert.equal(db.obligaciones.size, 0);
  });

  it("ADMIN sin atribución: ticket propio, sin obligación", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: new Date("2026-11-01T04:00:00.000Z"),
      updatedByAdminId: "admin-1",
    });
    const db = makeCreateTicketCajaHarness({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
      ahora,
      caja: { activa: true, activadaEn },
      comisiones: { "vend-1": "20.00" },
    });
    const r = await createTicket(
      {
        fechaJuego: fechaStr,
        idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0005",
        vendedorId: "admin-1",
        lineas: [{ hora: 19, numeroAnimal: "00", importe: "1000.00" }],
      },
      ahora,
      db as never,
      { actorRol: "ADMIN", actorUserId: "admin-1", bindCreditsStore: () => credits },
    );
    assert.equal(r.ticket.vendedorId, "admin-1");
    assert.equal(db.obligaciones.size, 0);
  });

  it("ADMIN atribuye a VENDEDOR activo: obligación para ese vendedor", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: new Date("2026-11-01T04:00:00.000Z"),
      updatedByAdminId: "admin-1",
    });
    await asignarCreditos(credits, {
      vendedorId: "vend-1",
      importe: "500.00",
      actorAdminId: "admin-1",
    });
    const saldoAntes = (await consultarSaldoYHistorial(credits, "vend-1"))
      .cuenta!.saldoDisponible.toFixed(2);

    const db = makeCreateTicketCajaHarness({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
      ahora,
      caja: { activa: true, activadaEn },
      comisiones: { "vend-1": "20.00" },
    });
    const r = await createTicket(
      {
        fechaJuego: fechaStr,
        idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0006",
        vendedorId: "admin-1",
        atribuidoAVendedorId: "vend-1",
        lineas: [{ hora: 19, numeroAnimal: "00", importe: "1000.00" }],
      },
      ahora,
      db as never,
      {
        actorRol: "ADMIN",
        actorUserId: "admin-1",
        atribuidoAVendedorId: "vend-1",
        bindCreditsStore: () => credits,
      },
    );
    assert.equal(r.ticket.vendedorId, "vend-1");
    assert.equal(db.obligaciones.size, 1);
    const o = [...db.obligaciones.values()][0]!;
    assert.equal(o.vendedorId, "vend-1");
    assert.equal(moneyFixed2(o.importeAdmin), "800.00");

    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      "vend-1",
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), saldoAntes);
    assert.equal(
      movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      0,
    );
  });

  it("ADMIN atribuye a ADMIN / inexistente / inactivo → rechazo", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: false,
      inicioEn: null,
      updatedByAdminId: "admin-1",
    });
    const db = makeCreateTicketCajaHarness({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "admin-2", rol: "ADMIN", activo: true },
        { id: "vend-off", rol: "VENDEDOR", activo: false },
      ],
      ahora,
      caja: { activa: true, activadaEn },
    });

    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fechaStr,
            idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0007",
            vendedorId: "admin-1",
            atribuidoAVendedorId: "admin-2",
            lineas: [{ hora: 19, numeroAnimal: "00", importe: "10.00" }],
          },
          ahora,
          db as never,
          {
            actorRol: "ADMIN",
            actorUserId: "admin-1",
            atribuidoAVendedorId: "admin-2",
            bindCreditsStore: () => credits,
          },
        ),
      CajaValidationError,
    );

    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fechaStr,
            idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0008",
            vendedorId: "admin-1",
            atribuidoAVendedorId: "ghost",
            lineas: [{ hora: 19, numeroAnimal: "00", importe: "10.00" }],
          },
          ahora,
          db as never,
          {
            actorRol: "ADMIN",
            actorUserId: "admin-1",
            atribuidoAVendedorId: "ghost",
            bindCreditsStore: () => credits,
          },
        ),
      CajaNotFoundError,
    );

    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fechaStr,
            idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0009",
            vendedorId: "admin-1",
            atribuidoAVendedorId: "vend-off",
            lineas: [{ hora: 19, numeroAnimal: "00", importe: "10.00" }],
          },
          ahora,
          db as never,
          {
            actorRol: "ADMIN",
            actorUserId: "admin-1",
            atribuidoAVendedorId: "vend-off",
            bindCreditsStore: () => credits,
          },
        ),
      CajaValidationError,
    );
    assert.equal(db.obligaciones.size, 0);
  });

  it("fallo al crear obligación → no queda ticket (rollback simulado)", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: false,
      inicioEn: null,
      updatedByAdminId: "admin-1",
    });
    const db = makeCreateTicketCajaHarness({
      users: [{ id: "vend-1", rol: "VENDEDOR", activo: true }],
      ahora,
      caja: { activa: true, activadaEn },
      comisiones: { "vend-1": "20.00" },
      failObligacion: true,
    });
    await assert.rejects(() =>
      createTicket(
        {
          fechaJuego: fechaStr,
          idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0010",
          vendedorId: "vend-1",
          lineas: [{ hora: 19, numeroAnimal: "00", importe: "10.00" }],
        },
        ahora,
        db as never,
        { actorRol: "VENDEDOR", bindCreditsStore: () => credits },
      ),
    );
    assert.equal(db.ticketsByIdem.size, 0);
    assert.equal(db.obligaciones.size, 0);
    assert.equal(db.rolledBack, true);
  });

  it("fallo al crear ticket → no queda obligación", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: false,
      inicioEn: null,
      updatedByAdminId: "admin-1",
    });
    const db = makeCreateTicketCajaHarness({
      users: [{ id: "vend-1", rol: "VENDEDOR", activo: true }],
      ahora,
      caja: { activa: true, activadaEn },
      comisiones: { "vend-1": "20.00" },
      failTicket: true,
    });
    await assert.rejects(() =>
      createTicket(
        {
          fechaJuego: fechaStr,
          idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0011",
          vendedorId: "vend-1",
          lineas: [{ hora: 19, numeroAnimal: "00", importe: "10.00" }],
        },
        ahora,
        db as never,
        { actorRol: "VENDEDOR", bindCreditsStore: () => credits },
      ),
    );
    assert.equal(db.obligaciones.size, 0);
  });

  it("reintento idempotente: no duplica ticket ni obligación", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: false,
      inicioEn: null,
      updatedByAdminId: "admin-1",
    });
    const db = makeCreateTicketCajaHarness({
      users: [{ id: "vend-1", rol: "VENDEDOR", activo: true }],
      ahora,
      caja: { activa: true, activadaEn },
      comisiones: { "vend-1": "20.00" },
    });
    const key = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0012";
    const input = {
      fechaJuego: fechaStr,
      idempotencyKey: key,
      vendedorId: "vend-1",
      lineas: [{ hora: 19, numeroAnimal: "00", importe: "100.00" }],
    };
    const r1 = await createTicket(input, ahora, db as never, {
      actorRol: "VENDEDOR",
      bindCreditsStore: () => credits,
    });
    const r2 = await createTicket(input, ahora, db as never, {
      actorRol: "VENDEDOR",
      bindCreditsStore: () => credits,
    });
    assert.equal(r1.idempotentReplay, false);
    assert.equal(r2.idempotentReplay, true);
    assert.equal(r2.ticket.id, r1.ticket.id);
    assert.equal(db.obligaciones.size, 1);
    assert.equal(db.ticketsByIdem.size, 1);
  });

  it("VENDEDOR con control créditos: conserva consumo actual (actor)", async () => {
    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: new Date("2026-11-01T04:00:00.000Z"),
      updatedByAdminId: "admin-1",
    });
    await asignarCreditos(credits, {
      vendedorId: "vend-1",
      importe: "200.00",
      actorAdminId: "admin-1",
    });
    const db = makeCreateTicketCajaHarness({
      users: [{ id: "vend-1", rol: "VENDEDOR", activo: true }],
      ahora,
      caja: { activa: true, activadaEn },
      comisiones: { "vend-1": "20.00" },
    });
    await createTicket(
      {
        fechaJuego: fechaStr,
        idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0013",
        vendedorId: "vend-1",
        lineas: [{ hora: 19, numeroAnimal: "00", importe: "50.00" }],
      },
      ahora,
      db as never,
      { actorRol: "VENDEDOR", bindCreditsStore: () => credits },
    );
    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      "vend-1",
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "150.00");
    assert.equal(
      movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      1,
    );
    assert.equal(db.obligaciones.size, 1);
  });

  it("parseCreateTicketBody: body.vendedorId → atribuidoAVendedorId", () => {
    const parsed = parseCreateTicketBody({
      fechaJuego: "2026-11-06",
      vendedorId: "vend-xyz",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440099",
      lineas: [{ hora: 10, numeroAnimal: "03", importe: "2.00" }],
    });
    assert.equal(parsed.vendedorId, null);
    assert.equal(parsed.atribuidoAVendedorId, "vend-xyz");
  });
});

/*
 * Pruebas pendientes que requieren base de datos TEST (no ejecutadas aquí):
 * - Atomicidad real Postgres (BEGIN/COMMIT/ROLLBACK) ticket+obligación.
 * - Concurrencia: dos creates con misma idempotencyKey → una obligación.
 * - Restricción UNIQUE SQL + CHECK importeAdmin = bruto - comisión.
 * No conectar producción / Neon prod para estas pruebas.
 */
