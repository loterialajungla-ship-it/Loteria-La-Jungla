/**
 * Integración REAL contra PostgreSQL (TEST_DATABASE_URL).
 * Ejecutar solo vía: npm run test:integration
 *
 * `npm test` no debe exigir PostgreSQL: esta suite se salta sin RUN_INTEGRATION=1.
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { createTicket } from "@/lib/tickets/create-ticket";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { AnimalNotFoundError, IdempotencyConflictError } from "@/lib/tickets/errors";
import {
  AHORA_VE_MANANA,
  createTestUser,
  fechaJuegoDate,
  fechaJuegoTest,
  newIdempotencyKey,
  resetTicketDomain,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";
import { hoyYYYYMMDD } from "@/lib/fecha";
import { prisma } from "@/lib/prisma";

const ENABLED = process.env.RUN_INTEGRATION === "1";
/** Mismo cliente que createTicket — un solo pool de conexiones. */
const db = prisma;

describe("integración PostgreSQL — createTicket", { skip: !ENABLED }, () => {
  let vendedorA: { id: string };
  let vendedorB: { id: string };
  let admin: { id: string };

  before(async () => {
    await seedMinimalBusiness(db);
  });

  beforeEach(async () => {
    await resetTicketDomain(db);
    await seedMinimalBusiness(db);
    vendedorA = await createTestUser(db, {
      usuario: "vend_a",
      nombre: "Vendedor A",
      rol: "VENDEDOR",
    });
    vendedorB = await createTestUser(db, {
      usuario: "vend_b",
      nombre: "Vendedor B",
      rol: "VENDEDOR",
    });
    admin = await createTestUser(db, {
      usuario: "admin_it",
      nombre: "Admin IT",
      rol: "ADMIN",
    });
  });

  after(async () => {
    await db.$disconnect();
  });

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
    );

    assert.equal(result.idempotentReplay, false);
    const t = result.ticket;
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
    );

    assert.equal(result.ticket.totalApostado, "5.36");
    const row = await db.ticket.findUniqueOrThrow({
      where: { id: result.ticket.id },
    });
    assert.equal(row.totalApostado.toFixed(2), "5.36");
    assert.ok(row.totalApostado instanceof Prisma.Decimal);
  });

  it("contador secuencial 000001, 000002, 000003", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
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
      );
      nums.push(r.ticket.numeroVisible);
    }

    const sufijos = nums.map((n) => n.split("-").pop()!);
    assert.deepEqual(sufijos, ["000001", "000002", "000003"]);
    assert.equal(new Set(nums).size, 3);
  });

  it("concurrencia del contador: 20 creaciones → 20 numeroVisible únicos", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
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
        ),
      ),
    );

    const visibles = results.map((r) => r.ticket.numeroVisible);
    assert.equal(new Set(visibles).size, N);
    assert.equal(results.every((r) => !r.idempotentReplay), true);

    const count = await db.ticket.count();
    assert.equal(count, N);

    const conLineas = await db.ticket.findMany({ include: { lineas: true } });
    assert.equal(conLineas.every((t) => t.lineas.length === 1), true);

    const counter = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    assert.ok(counter);
    assert.equal(counter!.ultimoNumero, N);
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

    const first = await createTicket(input, AHORA_VE_MANANA);
    const second = await createTicket(input, AHORA_VE_MANANA);

    assert.equal(first.idempotentReplay, false);
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.ticket.id, first.ticket.id);
    assert.equal(second.ticket.numeroVisible, first.ticket.numeroVisible);
    assert.equal(second.ticket.totalApostado, first.ticket.totalApostado);
    assert.equal(await db.ticket.count(), 1);
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
    );

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
        ),
      IdempotencyConflictError,
    );

    assert.equal(await db.ticket.count(), 1);
    const row = await db.ticket.findUniqueOrThrow({ where: { id: first.ticket.id } });
    assert.equal(row.totalApostado.toFixed(2), "2.00");
  });

  it("idempotencia: misma key + usuario distinto → 409 sin filtrar ticket", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const key = newIdempotencyKey();

    await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: key,
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
      },
      AHORA_VE_MANANA,
    );

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

    assert.equal(await db.ticket.count(), 1);
  });

  it("concurrencia de idempotencia: 10 parallel → exactamente 1 ticket", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const key = newIdempotencyKey();
    const input = {
      fechaJuego: fecha,
      vendedorId: vendedorA.id,
      idempotencyKey: key,
      lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => createTicket(input, AHORA_VE_MANANA)),
    );

    const ids = new Set(results.map((r) => r.ticket.id));
    assert.equal(ids.size, 1);
    assert.equal(await db.ticket.count(), 1);

    const creates = results.filter((r) => !r.idempotentReplay).length;
    const replays = results.filter((r) => r.idempotentReplay).length;
    assert.equal(creates, 1);
    assert.equal(replays, 9);

    const counter = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    assert.ok(counter);
    assert.equal(counter!.ultimoNumero, 1);
  });

  it("rollback: animal inexistente → sin ticket ni avance de contador", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
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
        ),
      AnimalNotFoundError,
    );

    assert.equal(await db.ticket.count(), 0);
    assert.equal(await db.ticketLinea.count(), 0);
    const counter = await db.ticketCounter.findUnique({
      where: { fechaJuego: fechaJuegoDate() },
    });
    assert.equal(counter, null);
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
    );

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
    // Histórico de líneas intacto
    const lineas = await db.ticketLinea.count({
      where: { ticketId: created.ticket.id },
    });
    assert.equal(lineas, 1);
  });

  it("ticket histórico conceptual: idempotencyKey null permitido en schema", async () => {
    // No usamos createTicket (exige key); insertamos fila mínima vía Prisma
    // para verificar UNIQUE nullable / compatibilidad.
    const fecha = fechaJuegoDate();
    await db.ticketCounter.create({
      data: { fechaJuego: fecha, ultimoNumero: 1 },
    });
    const t = await db.ticket.create({
      data: {
        numeroVisible: `LJ-${fechaJuegoTest().replace(/-/g, "")}-000099`,
        codigoPublico: "hist_test_codigo_publico_xx",
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
    assert.equal(t.idempotencyKey, null);
    assert.equal(t.vendedorId, null);
  });
});
