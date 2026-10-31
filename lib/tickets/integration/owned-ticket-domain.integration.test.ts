/**
 * Integración TEST: TicketCounter ajeno/compartido sobrevive al cleanup.
 * Solo vía `npm run test:integration` (RUN_INTEGRATION=1).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createIntegrationPrismaClient,
  fechaJuegoDate,
} from "@/lib/tickets/integration/harness";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";
import {
  assertExclusiveTicketFechaOrAbort,
  cleanupOwnedTicketDomain,
  createOwnedTicketDomain,
  trackFixtureTicketCounter,
} from "@/lib/tickets/integration/owned-ticket-domain";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";

const ENABLED = process.env.RUN_INTEGRATION === "1";

/** Fecha dedicada a este caso (no solapa con ventas 2026-10-02). */
const FECHA_AJENA = new Date(Date.UTC(2099, 11, 28));

describe(
  "owned-ticket-domain — TicketCounter ownership (TEST DB)",
  { skip: !ENABLED },
  () => {
    let db: ReturnType<typeof createIntegrationPrismaClient>;
    let plantedIdempotent = false;

    before(async () => {
      const ep = assertIntegrationPointsAtTestDatabase();
      assert.equal(ep, NEON_ENDPOINTS.TEST);
      db = createIntegrationPrismaClient();
    });

    after(async () => {
      // No borrar el contador ajeno plantado: demuestra supervivencia entre runs.
      // Solo desconectar.
      await db?.$disconnect();
    });

    it("contador ajeno (fecha exclusiva, 0 tickets) sobrevive al cleanup", async () => {
      await db.ticketCounter.upsert({
        where: { fechaJuego: FECHA_AJENA },
        create: { fechaJuego: FECHA_AJENA, ultimoNumero: 42 },
        update: { ultimoNumero: 42 },
      });
      plantedIdempotent = true;

      const domain = createOwnedTicketDomain();
      // Simula suite que trackea fechas de fixture (incluye la ajena a mano).
      domain.ticketCounterFechas.add(FECHA_AJENA.toISOString());
      trackFixtureTicketCounter(domain);

      const ticketsBefore = await db.ticket.count({
        where: { fechaJuego: FECHA_AJENA },
      });
      assert.equal(ticketsBefore, 0);

      const report = await cleanupOwnedTicketDomain(db, domain);
      assert.equal(report.deletedTicketCounters, 0);

      const row = await db.ticketCounter.findUnique({
        where: { fechaJuego: FECHA_AJENA },
      });
      assert.ok(row, "contador ajeno debe sobrevivir");
      assert.equal(row.ultimoNumero, 42);
      void plantedIdempotent;
    });

    it("contador compartido de fecha fixture sobrevive con 0 tickets propios", async () => {
      const fecha = fechaJuegoDate();
      const before = await db.ticketCounter.findUnique({
        where: { fechaJuego: fecha },
      });
      const sentinel = before?.ultimoNumero ?? 7;
      await db.ticketCounter.upsert({
        where: { fechaJuego: fecha },
        create: { fechaJuego: fecha, ultimoNumero: sentinel },
        update: {},
      });

      const domain = createOwnedTicketDomain();
      trackFixtureTicketCounter(domain);
      // Sin tickets propios en domain → cleanup no debe tocar el contador.
      const report = await cleanupOwnedTicketDomain(db, domain);
      assert.equal(report.deletedTicketCounters, 0);

      const after = await db.ticketCounter.findUnique({
        where: { fechaJuego: fecha },
      });
      assert.ok(after);
      assert.equal(after.ultimoNumero, sentinel);
    });

    it("cleanup idempotente sobre dominio vacío", async () => {
      const domain = createOwnedTicketDomain();
      const a = await cleanupOwnedTicketDomain(db, domain);
      const b = await cleanupOwnedTicketDomain(db, domain);
      assert.equal(a.deletedTicketCounters, 0);
      assert.equal(b.deletedTicketCounters, 0);
    });

    it("assertExclusive permite fecha con solo TicketCounter residual", async () => {
      const domain = createOwnedTicketDomain();
      await assertExclusiveTicketFechaOrAbort(db, domain, FECHA_AJENA);
      const row = await db.ticketCounter.findUnique({
        where: { fechaJuego: FECHA_AJENA },
      });
      assert.ok(row, "contador residual sigue intacto tras assertExclusive");
    });
  },
);
