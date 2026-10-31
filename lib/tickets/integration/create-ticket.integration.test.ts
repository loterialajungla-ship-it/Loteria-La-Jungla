/**
 * Integración REAL contra PostgreSQL (endpoint TEST allowlisted).
 * Ejecutar solo vía: `npm run test:integration`.
 *
 * Sin `RUN_INTEGRATION=1` la suite se salta (también excluida de `npm test`).
 * Cliente: `createIntegrationPrismaClient` tras assert de destino TEST.
 * Aislamiento FASE 7.74: solo limpia IDs propios (owned-ticket-domain).
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { createTicket } from "@/lib/tickets/create-ticket";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { AnimalNotFoundError, IdempotencyConflictError } from "@/lib/tickets/errors";
import {
  AHORA_VE_MANANA,
  createIntegrationPrismaClient,
  fechaJuegoDate,
  fechaJuegoTest,
  newIdempotencyKey,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";
import {
  cleanupOwnedTicketDomain,
  createOwnedTestUser,
  createOwnedTicketDomain,
  trackFixtureTicketCounter,
  trackOwnedTicketId,
  type OwnedTicketDomain,
} from "@/lib/tickets/integration/owned-ticket-domain";
import {
  beginTemporaryCreditosControlOff,
  readCreditosConfigSnapshot,
  restoreCreditosConfigBaseline,
  restoreCreditosConfigLease,
  type CreditosConfigLease,
  type CreditosConfigSnapshot,
} from "@/lib/tickets/integration/creditos-config-test-fixture";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";
import { hoyYYYYMMDD } from "@/lib/fecha";

const ENABLED = process.env.RUN_INTEGRATION === "1";

describe("integración PostgreSQL — createTicket", { skip: !ENABLED }, () => {
  let db: ReturnType<typeof createIntegrationPrismaClient>;
  let domain: OwnedTicketDomain;
  let runTag: string;
  let vendedorA: { id: string };
  let vendedorB: { id: string };
  let admin: { id: string };
  let suiteCreditosSnap: CreditosConfigSnapshot = { existed: false };
  let testCreditosLease: CreditosConfigLease | null = null;

  before(async () => {
    assertIntegrationPointsAtTestDatabase();
    db = createIntegrationPrismaClient();
    runTag = `ct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await seedMinimalBusiness(db);
    suiteCreditosSnap = await readCreditosConfigSnapshot(db);
  });

  beforeEach(async () => {
    assertIntegrationPointsAtTestDatabase();
    if (domain) {
      await cleanupOwnedTicketDomain(db, domain);
    }
    domain = createOwnedTicketDomain();
    trackFixtureTicketCounter(domain);
    await seedMinimalBusiness(db);
    testCreditosLease = await beginTemporaryCreditosControlOff(db);
    vendedorA = await createOwnedTestUser(db, domain, {
      usuario: `${runTag}_va`.slice(0, 40),
      nombre: "Vendedor A",
      rol: "VENDEDOR",
    });
    vendedorB = await createOwnedTestUser(db, domain, {
      usuario: `${runTag}_vb`.slice(0, 40),
      nombre: "Vendedor B",
      rol: "VENDEDOR",
    });
    admin = await createOwnedTestUser(db, domain, {
      usuario: `${runTag}_ad`.slice(0, 40),
      nombre: "Admin IT",
      rol: "ADMIN",
    });
  });

  afterEach(async () => {
    if (testCreditosLease) {
      await restoreCreditosConfigLease(db, testCreditosLease);
      testCreditosLease = null;
    }
  });

  after(async () => {
    try {
      if (domain) await cleanupOwnedTicketDomain(db, domain);
    } finally {
      try {
        await restoreCreditosConfigBaseline(db, suiteCreditosSnap);
      } catch {
        /* ignore */
      }
      await db.$disconnect();
    }
  });

  async function countOwnTickets(): Promise<number> {
    return db.ticket.count({
      where: { vendedorId: { in: [vendedorA.id, vendedorB.id] } },
    });
  }

  it("creación básica: ticket, líneas, snapshot, multiplicador", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const result = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [
          { hora: 14, numeroAnimal: "03", importe: "2.00" },
          { hora: 15, numeroAnimal: "05", importe: "3.00" },
          { hora: 16, numeroAnimal: "15", importe: "5.00" },
        ],
      },
      AHORA_VE_MANANA,
      db,
    );

    assert.equal(result.idempotentReplay, false);
    const t = result.ticket;
    trackOwnedTicketId(domain, t.id);
    assert.match(t.numeroVisible, /^LJ-\d{8}-\d{6}$/);
    assert.ok(t.codigoPublico.length > 8);
    assert.equal(t.totalApostado, "10.00");
    assert.equal(t.multiplicadorUsado, 30);
    assert.equal(t.vendedorId, vendedorA.id);
    assert.equal(t.lineas.length, 3);

    const linea03 = t.lineas.find((l) => l.numeroAnimal === "03");
    assert.ok(linea03);
    assert.equal(linea03!.nombreAnimalSnapshot, "Ciempiés");

    const enDb = await db.ticket.findUnique({
      where: { id: t.id },
      include: { lineas: true },
    });
    assert.ok(enDb);
    assert.equal(enDb!.lineas.length, 3);
  });

  it("decimales exactos: 2.10 + 3.25 + 0.01 = 5.36", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const result = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [
          { hora: 14, numeroAnimal: "03", importe: "2.10" },
          { hora: 15, numeroAnimal: "05", importe: "3.25" },
          { hora: 16, numeroAnimal: "15", importe: "0.01" },
        ],
      },
      AHORA_VE_MANANA,
      db,
    );

    trackOwnedTicketId(domain, result.ticket.id);
    assert.equal(result.ticket.totalApostado, "5.36");
    const row = await db.ticket.findUniqueOrThrow({
      where: { id: result.ticket.id },
    });
    assert.equal(row.totalApostado.toFixed(2), "5.36");
    assert.ok(row.totalApostado instanceof Prisma.Decimal);
  });

  it("contador secuencial 000001, 000002, 000003", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const counterBefore = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    const base = counterBefore?.ultimoNumero ?? 0;

    const nums: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await createTicket(
        {
          fechaJuego: fecha,
          vendedorId: vendedorA.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
        },
        AHORA_VE_MANANA,
        db,
      );
      trackOwnedTicketId(domain, r.ticket.id);
      nums.push(r.ticket.numeroVisible);
    }

    const sufijos = nums.map((n) => n.split("-").pop()!);
    const expected = [base + 1, base + 2, base + 3].map((n) =>
      String(n).padStart(6, "0"),
    );
    assert.deepEqual(sufijos, expected);
    assert.equal(new Set(nums).size, 3);
  });

  it("concurrencia del contador: 20 creaciones → 20 numeroVisible únicos", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const counterBefore = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    const base = counterBefore?.ultimoNumero ?? 0;
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        createTicket(
          {
            fechaJuego: fecha,
            vendedorId: vendedorA.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [
              {
                hora: 14 + (i % 5),
                numeroAnimal: i % 2 === 0 ? "03" : "05",
                importe: "1.00",
              },
            ],
          },
          AHORA_VE_MANANA,
          db,
        ),
      ),
    );

    for (const r of results) trackOwnedTicketId(domain, r.ticket.id);

    const visibles = results.map((r) => r.ticket.numeroVisible);
    assert.equal(new Set(visibles).size, N);
    assert.equal(results.every((r) => !r.idempotentReplay), true);

    assert.equal(await countOwnTickets(), N);

    const conLineas = await db.ticket.findMany({
      where: { vendedorId: vendedorA.id },
      include: { lineas: true },
    });
    assert.equal(conLineas.every((t) => t.lineas.length === 1), true);

    const counter = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    assert.ok(counter);
    assert.equal(counter!.ultimoNumero, base + N);
  });

  it("idempotencia: misma key+usuario+body → replay, un solo ticket", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const key = newIdempotencyKey();
    const input = {
      fechaJuego: fecha,
      vendedorId: vendedorA.id,
      idempotencyKey: key,
      lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
    };

    const first = await createTicket(input, AHORA_VE_MANANA, db);
    trackOwnedTicketId(domain, first.ticket.id);
    const second = await createTicket(input, AHORA_VE_MANANA, db);

    assert.equal(first.idempotentReplay, false);
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.ticket.id, first.ticket.id);
    assert.equal(second.ticket.numeroVisible, first.ticket.numeroVisible);
    assert.equal(second.ticket.totalApostado, first.ticket.totalApostado);
    assert.equal(await countOwnTickets(), 1);
  });

  it("idempotencia: misma key + body distinto → 409, ticket intacto", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const key = newIdempotencyKey();

    const first = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: key,
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    trackOwnedTicketId(domain, first.ticket.id);

    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fecha,
            vendedorId: vendedorA.id,
            idempotencyKey: key,
            lineas: [{ hora: 14, numeroAnimal: "03", importe: "20.00" }],
          },
          AHORA_VE_MANANA,
          db,
        ),
      IdempotencyConflictError,
    );

    assert.equal(await countOwnTickets(), 1);
    const row = await db.ticket.findUniqueOrThrow({
      where: { id: first.ticket.id },
    });
    assert.equal(row.totalApostado.toFixed(2), "2.00");
  });

  it("idempotencia: misma key + usuario distinto → 409 sin filtrar ticket", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const key = newIdempotencyKey();

    const first = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: key,
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    trackOwnedTicketId(domain, first.ticket.id);

    await assert.rejects(
      async () => {
        try {
          await createTicket(
            {
              fechaJuego: fecha,
              vendedorId: vendedorB.id,
              idempotencyKey: key,
              lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
            },
            AHORA_VE_MANANA,
            db,
          );
        } catch (e) {
          assert.ok(e instanceof IdempotencyConflictError);
          assert.match(e.message, /no puede reutilizarse/);
          assert.doesNotMatch(e.message, /LJ-/);
          throw e;
        }
      },
      IdempotencyConflictError,
    );

    assert.equal(await countOwnTickets(), 1);
  });

  it("concurrencia de idempotencia: 10 parallel → exactamente 1 ticket", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const key = newIdempotencyKey();
    const counterBefore = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    const base = counterBefore?.ultimoNumero ?? 0;
    const input = {
      fechaJuego: fecha,
      vendedorId: vendedorA.id,
      idempotencyKey: key,
      lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => createTicket(input, AHORA_VE_MANANA, db)),
    );

    for (const r of results) trackOwnedTicketId(domain, r.ticket.id);

    const ids = new Set(results.map((r) => r.ticket.id));
    assert.equal(ids.size, 1);
    assert.equal(await countOwnTickets(), 1);

    const creates = results.filter((r) => !r.idempotentReplay).length;
    const replays = results.filter((r) => r.idempotentReplay).length;
    assert.equal(creates, 1);
    assert.equal(replays, 9);

    const counter = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    assert.ok(counter);
    assert.equal(counter!.ultimoNumero, base + 1);
  });

  it("rollback: animal inexistente → sin ticket ni avance de contador", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const counterBefore = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fecha,
            vendedorId: vendedorA.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 14, numeroAnimal: "99", importe: "1.00" }],
          },
          AHORA_VE_MANANA,
          db,
        ),
      AnimalNotFoundError,
    );

    assert.equal(await countOwnTickets(), 0);
    assert.equal(
      await db.ticketLinea.count({
        where: { ticket: { vendedorId: vendedorA.id } },
      }),
      0,
    );
    const counterAfter = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    assert.equal(
      counterAfter?.ultimoNumero ?? null,
      counterBefore?.ultimoNumero ?? null,
    );
  });

  it("anulación guarda anuladoPorId del admin", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const created = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    trackOwnedTicketId(domain, created.ticket.id);

    const anulado = await anularTicket(db, {
      id: created.ticket.id,
      motivo: "Error de digitación en prueba de integración",
      anuladoPorId: admin.id,
    });

    assert.equal(anulado.estado, "ANULADO");
    assert.equal(anulado.anuladoPorId, admin.id);

    const row = await db.ticket.findUniqueOrThrow({
      where: { id: created.ticket.id },
    });
    assert.equal(row.estado, "ANULADO");
    assert.equal(row.anuladoPorId, admin.id);
    assert.ok(row.anuladoAt);
    const lineas = await db.ticketLinea.count({
      where: { ticketId: created.ticket.id },
    });
    assert.equal(lineas, 1);
  });

  it("ticket histórico conceptual: idempotencyKey null permitido en schema", async () => {
    const fecha = fechaJuegoDate();
    await db.ticketCounter.upsert({
      where: { fechaJuego: fecha },
      create: { fechaJuego: fecha, ultimoNumero: 1 },
      update: {},
    });
    const t = await db.ticket.create({
      data: {
        numeroVisible: `LJ-${fechaJuegoTest().replace(/-/g, "")}-h${runTag.slice(-5)}`,
        codigoPublico: `hist_${runTag}`,
        fechaJuego: fecha,
        vendedorId: null,
        totalApostado: new Prisma.Decimal("1.00"),
        multiplicadorUsado: 30,
        estado: "EMITIDO",
        idempotencyKey: null,
        idempotencyRequestHash: null,
        lineas: {
          create: {
            fechaJuego: fecha,
            hora: 14,
            numeroAnimal: "03",
            nombreAnimalSnapshot: "Ciempiés",
            importe: new Prisma.Decimal("1.00"),
          },
        },
      },
    });
    trackOwnedTicketId(domain, t.id);
    assert.equal(t.idempotencyKey, null);
    assert.equal(t.vendedorId, null);
  });
});
