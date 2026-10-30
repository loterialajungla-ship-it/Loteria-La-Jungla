import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma, type RolUsuario } from "@prisma/client";
import { actualizarCreditosConfig } from "@/lib/creditos/config";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
} from "@/lib/creditos/operaciones";
import { createMemoryCreditosStore } from "@/lib/creditos/store";
import { fechaAYYYYMMDD, fechaHoyParaPrisma, hoyYYYYMMDD } from "@/lib/fecha";
import {
  assertEmisorPuedeCrearTicket,
  assertEmisorRowPuedeCrearTicket,
  createTicket,
  lockAndAssertEmisorPuedeCrearTicket,
} from "@/lib/tickets/create-ticket";
import { TicketSellerNotAllowedError } from "@/lib/tickets/errors";
import { buildIdempotencyRequestHash } from "@/lib/tickets/idempotency";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";

function fakeUsuarioDb(user: {
  id: string;
  rol: RolUsuario;
  activo: boolean;
} | null) {
  let findCalls = 0;
  return {
    findCalls: () => findCalls,
    usuario: {
      async findUnique(args: { where: { id: string } }) {
        findCalls += 1;
        if (!user || args.where.id !== user.id) return null;
        return { id: user.id, rol: user.rol, activo: user.activo };
      },
    },
  };
}

describe("H3 assertEmisorPuedeCrearTicket", () => {
  it("VENDEDOR activo → permitido", async () => {
    const db = fakeUsuarioDb({
      id: "v1",
      rol: "VENDEDOR",
      activo: true,
    });
    await assertEmisorPuedeCrearTicket(db, {
      vendedorId: "v1",
      actorRol: "VENDEDOR",
    });
    assert.equal(db.findCalls(), 1);
  });

  it("VENDEDOR inactivo → rechazo de dominio", async () => {
    const db = fakeUsuarioDb({
      id: "v1",
      rol: "VENDEDOR",
      activo: false,
    });
    await assert.rejects(
      () =>
        assertEmisorPuedeCrearTicket(db, {
          vendedorId: "v1",
          actorRol: "VENDEDOR",
        }),
      (e: unknown) => e instanceof TicketSellerNotAllowedError,
    );
  });

  it("usuario inexistente → rechazo", async () => {
    const db = fakeUsuarioDb(null);
    await assert.rejects(
      () =>
        assertEmisorPuedeCrearTicket(db, {
          vendedorId: "missing",
          actorRol: "VENDEDOR",
        }),
      (e: unknown) =>
        e instanceof TicketSellerNotAllowedError &&
        e.message.includes("no encontrado"),
    );
  });

  it("rol incompatible (sesión VENDEDOR, DB ADMIN) → rechazo", async () => {
    const db = fakeUsuarioDb({
      id: "a1",
      rol: "ADMIN",
      activo: true,
    });
    await assert.rejects(
      () =>
        assertEmisorPuedeCrearTicket(db, {
          vendedorId: "a1",
          actorRol: "VENDEDOR",
        }),
      (e: unknown) => e instanceof TicketSellerNotAllowedError,
    );
  });

  it("ADMIN activo → permitido (exención de créditos intacta a nivel de rol)", async () => {
    const db = fakeUsuarioDb({
      id: "admin-1",
      rol: "ADMIN",
      activo: true,
    });
    await assertEmisorPuedeCrearTicket(db, {
      vendedorId: "admin-1",
      actorRol: "ADMIN",
    });
  });

  it("ADMIN inactivo → rechazo", async () => {
    const db = fakeUsuarioDb({
      id: "admin-1",
      rol: "ADMIN",
      activo: false,
    });
    await assert.rejects(
      () =>
        assertEmisorPuedeCrearTicket(db, {
          vendedorId: "admin-1",
          actorRol: "ADMIN",
        }),
      (e: unknown) => e instanceof TicketSellerNotAllowedError,
    );
  });

  it("HTTP mapea SELLER_NOT_ALLOWED a 403", () => {
    const mapped = mapTicketErrorToHttp(
      new TicketSellerNotAllowedError("El usuario emisor está inactivo."),
    );
    assert.equal(mapped.status, 403);
    assert.equal(mapped.body.error.code, "SELLER_NOT_ALLOWED");
  });
});

describe("H3 createTicket no entra en TX si falla validación", () => {
  it("VENDEDOR inactivo: no llama $transaction ni créditos", async () => {
    let txCalls = 0;
    let creditsBindCalls = 0;
    const ahora = new Date("2026-11-02T12:00:00.000Z"); // 08:00 America/Caracas
    const hoy = hoyYYYYMMDD(ahora);

    const db = {
      usuario: {
        async findUnique() {
          return { id: "v-inact", rol: "VENDEDOR" as const, activo: false };
        },
      },
      ticket: {
        async findUnique() {
          return null;
        },
      },
      async $transaction() {
        txCalls += 1;
        throw new Error("no debe entrar en TX");
      },
    };

    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: hoy,
            idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
            vendedorId: "v-inact",
            lineas: [{ hora: 19, numeroAnimal: "00", importe: "1.00" }],
          },
          ahora,
          db as never,
          {
            actorRol: "VENDEDOR",
            bindCreditsStore: () => {
              creditsBindCalls += 1;
              throw new Error("no debe bind créditos");
            },
          },
        ),
      (e: unknown) => e instanceof TicketSellerNotAllowedError,
    );

    assert.equal(txCalls, 0);
    assert.equal(creditsBindCalls, 0);
  });
});

describe("H3 dominio: replay idempotente con vendedor inactivo", () => {
  /**
   * Prueba de dominio (createTicket), no sustituye la autenticación HTTP:
   * en producción un vendedor inactivo no obtiene sesión válida
   * (resolveSessionByToken → null). Aquí se documenta el fast-path:
   * si ya existe ticket para la clave, el replay ocurre antes del assert H3.
   */
  it("misma clave → replay sin nueva TX ni consumo aunque el emisor esté inactivo", async () => {
    const ahora = new Date("2026-11-02T12:00:00.000Z");
    const fechaJuego = fechaHoyParaPrisma(ahora);
    const fechaStr = hoyYYYYMMDD(ahora);
    const vendedorId = "vend-prev";
    const idempotencyKey = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const lineasInput = [
      { hora: 19, numeroAnimal: "05", importe: "2.50" as const },
    ];
    const requestHash = buildIdempotencyRequestHash({
      fechaJuego: fechaStr,
      lineas: lineasInput.map((l) => ({
        hora: l.hora,
        numeroAnimal: l.numeroAnimal,
        importe: l.importe,
      })),
    });

    let usuarioLookups = 0;
    let txCalls = 0;
    let creditsBindCalls = 0;

    const existing = {
      id: "tk-existing",
      numeroVisible: "LJ-20261102-000001",
      codigoPublico: "ABC123XYZ",
      fechaJuego,
      vendedorId,
      totalApostado: new Prisma.Decimal("2.50"),
      multiplicadorUsado: 30,
      estado: "EMITIDO" as const,
      createdAt: ahora,
      idempotencyKey,
      idempotencyRequestHash: requestHash,
      lineas: [
        {
          id: "ln-1",
          hora: 19,
          numeroAnimal: "05",
          nombreAnimalSnapshot: "Culebra",
          importe: new Prisma.Decimal("2.50"),
        },
      ],
    };

    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: new Date("2026-11-01T04:00:00.000Z"),
      updatedByAdminId: "admin",
    });
    await asignarCreditos(credits, {
      vendedorId,
      importe: "100",
      actorAdminId: "admin",
    });
    const saldoAntes = (await consultarSaldoYHistorial(credits, vendedorId))
      .cuenta!.saldoDisponible.toFixed(2);

    const db = {
      usuario: {
        async findUnique() {
          usuarioLookups += 1;
          return { id: vendedorId, rol: "VENDEDOR" as const, activo: false };
        },
      },
      ticket: {
        async findUnique(args: { where: { idempotencyKey?: string } }) {
          if (args.where.idempotencyKey === idempotencyKey) {
            return existing;
          }
          return null;
        },
      },
      async $transaction() {
        txCalls += 1;
        throw new Error("replay no debe abrir TX de creación");
      },
    };

    const result = await createTicket(
      {
        fechaJuego: fechaStr,
        idempotencyKey,
        vendedorId,
        lineas: lineasInput,
      },
      ahora,
      db as never,
      {
        actorRol: "VENDEDOR",
        bindCreditsStore: () => {
          creditsBindCalls += 1;
          return credits;
        },
      },
    );

    assert.equal(result.idempotentReplay, true);
    assert.equal(result.ticket.id, "tk-existing");
    assert.equal(txCalls, 0);
    assert.equal(creditsBindCalls, 0);
    // Fast-path: no se invoca assertEmisor (usuario inactivo no bloquea replay).
    assert.equal(usuarioLookups, 0);

    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      vendedorId,
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), saldoAntes);
    assert.equal(
      movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      0,
    );
  });
});

describe("H3 dominio: emisión ADMIN sin consumo de créditos", () => {
  it("ADMIN activo crea ticket y no registra CONSUMO_VENTA", async () => {
    const ahora = new Date("2026-11-02T12:00:00.000Z"); // 08:00 VE → hora 19 abierta
    const fechaJuego = fechaHoyParaPrisma(ahora);
    const fechaStr = hoyYYYYMMDD(ahora);
    const adminId = "admin-emisor";
    const idempotencyKey = "cccccccc-dddd-4eee-8fff-000000000001";

    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: new Date("2026-11-01T04:00:00.000Z"),
      updatedByAdminId: adminId,
    });
    await asignarCreditos(credits, {
      vendedorId: adminId,
      importe: "80.00",
      actorAdminId: adminId,
    });

    let ticketCreates = 0;
    const db = {
      usuario: {
        async findUnique(args: { where: { id: string } }) {
          if (args.where.id !== adminId) return null;
          return { id: adminId, rol: "ADMIN" as const, activo: true };
        },
      },
      ticket: {
        async findUnique() {
          return null;
        },
      },
      async $transaction(
        fn: (tx: Record<string, unknown>) => Promise<unknown>,
      ) {
        const tx = {
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
          async $queryRaw(...args: unknown[]) {
            const sql = args[0] as { strings?: readonly string[] } | undefined;
            const text = Array.isArray(sql?.strings)
              ? sql!.strings!.join(" ")
              : String(sql ?? "");
            if (text.includes('"Usuario"') && text.includes("FOR UPDATE")) {
              return [{ id: adminId, rol: "ADMIN", activo: true }];
            }
            return [{ ultimoNumero: 1 }];
          },
          ticket: {
            async findUnique() {
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
              ticketCreates += 1;
              return {
                id: "tk-admin-1",
                numeroVisible: args.data.numeroVisible,
                codigoPublico: args.data.codigoPublico,
                fechaJuego: args.data.fechaJuego,
                vendedorId: args.data.vendedorId,
                totalApostado: args.data.totalApostado,
                multiplicadorUsado: args.data.multiplicadorUsado,
                estado: args.data.estado,
                createdAt: ahora,
                idempotencyKey: args.data.idempotencyKey,
                idempotencyRequestHash: args.data.idempotencyRequestHash,
                lineas: args.data.lineas.create.map((l, i) => ({
                  id: `ln-admin-${i}`,
                  hora: l.hora,
                  numeroAnimal: l.numeroAnimal,
                  nombreAnimalSnapshot: l.nombreAnimalSnapshot,
                  importe: l.importe,
                })),
              };
            },
          },
          auditoria: {
            async create() {
              return {};
            },
          },
        };
        return fn(tx);
      },
    };

    const result = await createTicket(
      {
        fechaJuego: fechaStr,
        idempotencyKey,
        vendedorId: adminId,
        lineas: [{ hora: 19, numeroAnimal: "00", importe: "5.00" }],
      },
      ahora,
      db as never,
      {
        actorRol: "ADMIN",
        bindCreditsStore: () => credits,
      },
    );

    assert.equal(result.idempotentReplay, false);
    assert.equal(result.ticket.id, "tk-admin-1");
    assert.equal(result.ticket.vendedorId, adminId);
    assert.equal(ticketCreates, 1);
    // fechaJuego del ticket mapeado es YYYY-MM-DD del Date @db.Date
    assert.equal(result.ticket.fechaJuego, fechaAYYYYMMDD(fechaJuego));

    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      adminId,
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "80.00");
    assert.equal(
      movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      0,
    );
  });
});

describe("H3 autoridad FOR UPDATE del emisor (anti-TOCTOU)", () => {
  it("assertEmisorRowPuedeCrearTicket rechaza inactivo / rol / null", () => {
    assert.throws(
      () =>
        assertEmisorRowPuedeCrearTicket(null, {
          vendedorId: "x",
          actorRol: "VENDEDOR",
        }),
      TicketSellerNotAllowedError,
    );
    assert.throws(
      () =>
        assertEmisorRowPuedeCrearTicket(
          { id: "v1", rol: "VENDEDOR", activo: false },
          { vendedorId: "v1", actorRol: "VENDEDOR" },
        ),
      TicketSellerNotAllowedError,
    );
    assert.throws(
      () =>
        assertEmisorRowPuedeCrearTicket(
          { id: "v1", rol: "ADMIN", activo: true },
          { vendedorId: "v1", actorRol: "VENDEDOR" },
        ),
      TicketSellerNotAllowedError,
    );
  });

  it("lockAndAssertEmisorPuedeCrearTicket emite FOR UPDATE y valida fila", async () => {
    const calls: string[] = [];
    const tx = {
      async $queryRaw(...args: unknown[]) {
        const sql = args[0] as { strings?: readonly string[] } | undefined;
        const text = Array.isArray(sql?.strings)
          ? sql!.strings!.join(" ")
          : String(sql ?? "");
        calls.push(text);
        assert.match(text, /FOR UPDATE/);
        assert.match(text, /"Usuario"/);
        return [{ id: "v-lock", rol: "VENDEDOR", activo: true }];
      },
    };
    const row = await lockAndAssertEmisorPuedeCrearTicket(
      tx as Parameters<typeof lockAndAssertEmisorPuedeCrearTicket>[0],
      {
        vendedorId: "v-lock",
        actorRol: "VENDEDOR",
      },
    );
    assert.equal(row.id, "v-lock");
    assert.equal(calls.length, 1);
  });

  it("createTicket: outer activo + inner FOR UPDATE inactivo → rechazo sin ticket ni consumo", async () => {
    const ahora = new Date("2026-11-02T12:00:00.000Z");
    const fechaStr = hoyYYYYMMDD(ahora);
    const vendedorId = "v-race";
    const idempotencyKey = "dddddddd-eeee-4fff-8000-111111111111";

    const credits = createMemoryCreditosStore();
    await actualizarCreditosConfig(credits, {
      controlActivo: true,
      inicioEn: new Date("2026-11-01T04:00:00.000Z"),
      updatedByAdminId: "admin",
    });
    await asignarCreditos(credits, {
      vendedorId,
      importe: "50.00",
      actorAdminId: "admin",
    });
    const saldoAntes = (await consultarSaldoYHistorial(credits, vendedorId))
      .cuenta!.saldoDisponible.toFixed(2);

    let ticketCreates = 0;
    let creditsBindCalls = 0;
    const db = {
      usuario: {
        async findUnique() {
          return { id: vendedorId, rol: "VENDEDOR" as const, activo: true };
        },
      },
      ticket: {
        async findUnique() {
          return null;
        },
      },
      async $transaction(
        fn: (tx: Record<string, unknown>) => Promise<unknown>,
      ) {
        const tx = {
          async $queryRaw(...args: unknown[]) {
            const sql = args[0] as { strings?: readonly string[] } | undefined;
            const text = Array.isArray(sql?.strings)
              ? sql!.strings!.join(" ")
              : String(sql ?? "");
            if (text.includes('"Usuario"') && text.includes("FOR UPDATE")) {
              return [{ id: vendedorId, rol: "VENDEDOR", activo: false }];
            }
            return [{ ultimoNumero: 1 }];
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
          ticket: {
            async findUnique() {
              return null;
            },
            async create() {
              ticketCreates += 1;
              throw new Error("no debe crear ticket");
            },
          },
          auditoria: {
            async create() {
              throw new Error("no debe auditar");
            },
          },
        };
        return fn(tx);
      },
    };

    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fechaStr,
            idempotencyKey,
            vendedorId,
            lineas: [{ hora: 19, numeroAnimal: "00", importe: "5.00" }],
          },
          ahora,
          db as never,
          {
            actorRol: "VENDEDOR",
            bindCreditsStore: () => {
              creditsBindCalls += 1;
              return credits;
            },
          },
        ),
      (e: unknown) => e instanceof TicketSellerNotAllowedError,
    );

    assert.equal(ticketCreates, 0);
    assert.equal(creditsBindCalls, 0);
    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      credits,
      vendedorId,
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), saldoAntes);
    assert.equal(
      movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      0,
    );
  });
});
