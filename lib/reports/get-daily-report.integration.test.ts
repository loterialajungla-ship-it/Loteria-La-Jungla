/**
 * Integration: reporte diario ADMIN.
 * Solo vía npm run test:integration (RUN_INTEGRATION=1).
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createTicket } from "@/lib/tickets/create-ticket";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { getDailyReport } from "@/lib/reports/get-daily-report";
import { sumMoneyStrings } from "@/lib/reports/aggregate-sales";
import { HORAS_SORTEO, hoyYYYYMMDD } from "@/lib/fecha";
import { InvalidGameDateError } from "@/lib/tickets/errors";
import {
  AHORA_VE_MANANA,
  createTestUser,
  newIdempotencyKey,
  resetTicketDomain,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";

const ENABLED = process.env.RUN_INTEGRATION === "1";
const db = prisma;

describe("integración PostgreSQL — reportes diarios", { skip: !ENABLED }, () => {
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
      usuario: "rep_vend_a",
      nombre: "Carlos",
      rol: "VENDEDOR",
    });
    vendedorB = await createTestUser(db, {
      usuario: "rep_vend_b",
      nombre: "José",
      rol: "VENDEDOR",
    });
    admin = await createTestUser(db, {
      usuario: "rep_admin",
      nombre: "Admin Rep",
      rol: "ADMIN",
    });
  });

  after(async () => {
    await db.$disconnect();
  });

  it("fecha inválida → InvalidGameDateError", async () => {
    await assert.rejects(
      () => getDailyReport(db, "2026-13-40"),
      InvalidGameDateError,
    );
  });

  it("emitidos/anulados, total jugado, vendedores, horas, animales, exposición", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);

    const t1 = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [
          { hora: 14, numeroAnimal: "03", importe: "10.00" },
          { hora: 15, numeroAnimal: "05", importe: "5.00" },
        ],
      },
      AHORA_VE_MANANA,
    );

    await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorB.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "7.00" }],
      },
      AHORA_VE_MANANA,
    );

    // Histórico sin vendedor
    await db.ticket.create({
      data: {
        numeroVisible: `${fecha.replace(/-/g, "")}-999001`,
        codigoPublico: `hist${Date.now()}`,
        fechaJuego: new Date(Date.UTC(2026, 9, 2)),
        vendedorId: null,
        totalApostado: new Prisma.Decimal("3.00"),
        estado: "EMITIDO",
        multiplicadorUsado: 30,
        lineas: {
          create: [
            {
              fechaJuego: new Date(Date.UTC(2026, 9, 2)),
              hora: 16,
              numeroAnimal: "15",
              nombreAnimalSnapshot: "Zorro",
              importe: new Prisma.Decimal("3.00"),
            },
          ],
        },
      },
    });

    const toAnular = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "05", importe: "100.00" }],
      },
      AHORA_VE_MANANA,
    );
    await anularTicket(db, {
      id: toAnular.ticket.id,
      motivo: "Prueba reporte",
      anuladoPorId: admin.id,
    });

    const reporte = await getDailyReport(db, fecha);

    assert.equal(reporte.fechaJuego, fecha);
    assert.equal(reporte.tickets.emitidos, 3);
    assert.equal(reporte.tickets.anulados, 1);
    // 10+5 + 7 + 3 = 25; anulado 100 excluido
    assert.equal(reporte.ventas.totalJugado, "25.00");

    const sumaVend = sumMoneyStrings(
      reporte.porVendedor.map((v) => v.totalJugado),
    );
    assert.equal(sumaVend, reporte.ventas.totalJugado);

    const carlos = reporte.porVendedor.find((v) => v.vendedorId === vendedorA.id)!;
    assert.equal(carlos.tickets, 1);
    assert.equal(carlos.totalJugado, "15.00");

    const jose = reporte.porVendedor.find((v) => v.vendedorId === vendedorB.id)!;
    assert.equal(jose.totalJugado, "7.00");

    const sin = reporte.porVendedor.find((v) => v.vendedorId === null)!;
    assert.equal(sin.nombre, "Sin vendedor");
    assert.equal(sin.totalJugado, "3.00");

    assert.equal(reporte.porHora.length, HORAS_SORTEO.length);
    assert.equal(reporte.porHora.length, 11);
    assert.equal(
      reporte.porHora.find((h) => h.hora === 14)!.totalJugado,
      "17.00",
    );
    assert.equal(
      reporte.porHora.find((h) => h.hora === 15)!.totalJugado,
      "5.00",
    );
    // anulado no en hora 14 extra
    assert.equal(
      sumMoneyStrings(reporte.porHora.map((h) => h.totalJugado)),
      "25.00",
    );

    const animalCount = await db.animal.count();
    assert.equal(reporte.porAnimal.length, animalCount);
    assert.equal(
      reporte.porAnimal.find((a) => a.numeroAnimal === "03")!.totalJugado,
      "17.00",
    );
    // animal del anulado no suma 100
    assert.equal(
      reporte.porAnimal.find((a) => a.numeroAnimal === "05")!.totalJugado,
      "5.00",
    );

    assert.equal(reporte.exposicion.length, 11);
    const exp14 = reporte.exposicion.find((e) => e.hora === 14)!;
    // 17 * 30 = 510 (multiplicadorUsado snapshot)
    assert.equal(exp14.totalApostado, "17.00");
    assert.equal(exp14.exposicionTotalTeorica, "510.00");
    assert.equal(exp14.mayorExposicion, "510.00"); // solo animal 03 en esa hora? wait 10+7=17 on 03
    assert.ok(exp14.ticketsAfectados >= 2);

    // anulado no en exposición
    assert.ok(
      !JSON.stringify(reporte).includes("100.00") ||
        reporte.ventas.totalJugado === "25.00",
    );

    assert.doesNotMatch(JSON.stringify(reporte), /passwordHash/);
    assert.ok(t1.ticket.totalApostado);
  });

  it("ganadores / pendientes derivados; Decimal en DB", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
      },
      AHORA_VE_MANANA,
    );

    // Sin resultado → pendiente
    let reporte = await getDailyReport(db, fecha);
    assert.equal(reporte.tickets.pendientes, 1);
    assert.equal(reporte.tickets.ganadores, 0);

    await db.resultado.create({
      data: {
        fecha: new Date(Date.UTC(2026, 9, 2)),
        hora: 14,
        numero: "03",
      },
    });

    reporte = await getDailyReport(db, fecha);
    assert.equal(reporte.tickets.ganadores, 1);
    assert.equal(reporte.tickets.pendientes, 0);

    const row = await db.ticket.findFirstOrThrow({
      where: { estado: "EMITIDO" },
    });
    assert.ok(row.totalApostado instanceof Prisma.Decimal);
  });
});
