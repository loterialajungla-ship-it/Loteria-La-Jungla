/**
 * Integration: reporte diario ADMIN.
 * Solo vía `npm run test:integration` (`RUN_INTEGRATION=1`).
 * Aislamiento FASE 7.74: owned-ticket-domain (sin wipe global).
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { createTicket } from "@/lib/tickets/create-ticket";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { getDailyReport } from "@/lib/reports/get-daily-report";
import { sumMoneyStrings } from "@/lib/reports/aggregate-sales";
import { HORAS_SORTEO, hoyYYYYMMDD } from "@/lib/fecha";
import { InvalidGameDateError } from "@/lib/tickets/errors";
import {
  AHORA_VE_MANANA,
  createIntegrationPrismaClient,
  newIdempotencyKey,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";
import {
  cleanupOwnedTicketDomain,
  createOwnedTestUser,
  createOwnedTicketDomain,
  trackFixtureTicketCounter,
  trackOwnedResultadoId,
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

const ENABLED = process.env.RUN_INTEGRATION === "1";

function moneyAdd(a: string, b: string): string {
  return (Number(a) + Number(b)).toFixed(2);
}

describe("integración PostgreSQL — reportes diarios", { skip: !ENABLED }, () => {
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
    runTag = `rp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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
      nombre: "Carlos",
      rol: "VENDEDOR",
    });
    vendedorB = await createOwnedTestUser(db, domain, {
      usuario: `${runTag}_vb`.slice(0, 40),
      nombre: "José",
      rol: "VENDEDOR",
    });
    admin = await createOwnedTestUser(db, domain, {
      usuario: `${runTag}_ad`.slice(0, 40),
      nombre: "Admin Rep",
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

  it("fecha inválida → InvalidGameDateError", async () => {
    await assert.rejects(
      () => getDailyReport(db, "2026-13-40"),
      InvalidGameDateError,
    );
  });

  it("emitidos/anulados, total jugado, vendedores, horas, animales, exposición", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const baseline = await getDailyReport(db, fecha);

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
      db,
    );
    trackOwnedTicketId(domain, t1.ticket.id);

    const t2 = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorB.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "7.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    trackOwnedTicketId(domain, t2.ticket.id);

    // Histórico sin vendedor — track explícito (no recuperable por userId).
    const hist = await db.ticket.create({
      data: {
        numeroVisible: `${fecha.replace(/-/g, "")}-9${runTag.slice(-5)}`,
        codigoPublico: `hist${runTag}`,
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
    trackOwnedTicketId(domain, hist.id);

    const toAnular = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "05", importe: "100.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    trackOwnedTicketId(domain, toAnular.ticket.id);
    await anularTicket(db, {
      id: toAnular.ticket.id,
      motivo: "Prueba reporte",
      anuladoPorId: admin.id,
    });

    const reporte = await getDailyReport(db, fecha);

    assert.equal(reporte.fechaJuego, fecha);
    assert.equal(
      reporte.tickets.emitidos,
      baseline.tickets.emitidos + 3,
    );
    assert.equal(
      reporte.tickets.anulados,
      baseline.tickets.anulados + 1,
    );
    // aporte propio: 10+5 + 7 + 3 = 25
    assert.equal(
      reporte.ventas.totalJugado,
      moneyAdd(baseline.ventas.totalJugado, "25.00"),
    );

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
    assert.ok(Number(sin.totalJugado) >= 3);

    assert.equal(reporte.porHora.length, HORAS_SORTEO.length);
    assert.equal(reporte.porHora.length, 11);

    const h14Base =
      baseline.porHora.find((h) => h.hora === 14)?.totalJugado ?? "0.00";
    assert.equal(
      reporte.porHora.find((h) => h.hora === 14)!.totalJugado,
      moneyAdd(h14Base, "17.00"),
    );
    const h15Base =
      baseline.porHora.find((h) => h.hora === 15)?.totalJugado ?? "0.00";
    assert.equal(
      reporte.porHora.find((h) => h.hora === 15)!.totalJugado,
      moneyAdd(h15Base, "5.00"),
    );

    const animalCount = await db.animal.count();
    assert.equal(reporte.porAnimal.length, animalCount);

    const a03Base =
      baseline.porAnimal.find((a) => a.numeroAnimal === "03")?.totalJugado ??
      "0.00";
    assert.equal(
      reporte.porAnimal.find((a) => a.numeroAnimal === "03")!.totalJugado,
      moneyAdd(a03Base, "17.00"),
    );
    const a05Base =
      baseline.porAnimal.find((a) => a.numeroAnimal === "05")?.totalJugado ??
      "0.00";
    assert.equal(
      reporte.porAnimal.find((a) => a.numeroAnimal === "05")!.totalJugado,
      moneyAdd(a05Base, "5.00"),
    );

    assert.equal(reporte.exposicion.length, 11);
    assert.doesNotMatch(JSON.stringify(reporte), /passwordHash/);
    assert.ok(t1.ticket.totalApostado);
  });

  it("ganadores / pendientes derivados; Decimal en DB", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const baseline = await getDailyReport(db, fecha);

    const created = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    trackOwnedTicketId(domain, created.ticket.id);

    const reporte = await getDailyReport(db, fecha);
    assert.equal(
      reporte.tickets.pendientes,
      baseline.tickets.pendientes + 1,
    );

    const existingRes = await db.resultado.findUnique({
      where: {
        fecha_hora: {
          fecha: new Date(Date.UTC(2026, 9, 2)),
          hora: 14,
        },
      },
    });
    if (existingRes) {
      // Slot ajeno ocupado: no borrar; validar solo Decimal del ticket propio.
      const row = await db.ticket.findUniqueOrThrow({
        where: { id: created.ticket.id },
      });
      assert.ok(row.totalApostado instanceof Prisma.Decimal);
      return;
    }

    const res = await db.resultado.create({
      data: {
        fecha: new Date(Date.UTC(2026, 9, 2)),
        hora: 14,
        numero: "03",
      },
    });
    trackOwnedResultadoId(domain, res.id);

    const afterRes = await getDailyReport(db, fecha);
    // El resultado cierra el slot para todos los tickets EMITIDOS coincidentes
    // (propios y ajenos). Solo exigimos que el nuestro deje de ser pendiente
    // y que ganadores no bajen respecto al baseline tras crear el ticket.
    assert.ok(
      afterRes.tickets.ganadores >= reporte.tickets.ganadores + 1,
      `ganadores: ${afterRes.tickets.ganadores} vs prev ${reporte.tickets.ganadores}`,
    );
    assert.ok(
      afterRes.tickets.pendientes <= reporte.tickets.pendientes - 1,
      `pendientes: ${afterRes.tickets.pendientes} vs prev ${reporte.tickets.pendientes}`,
    );

    const row = await db.ticket.findUniqueOrThrow({
      where: { id: created.ticket.id },
    });
    assert.ok(row.totalApostado instanceof Prisma.Decimal);
  });
});
