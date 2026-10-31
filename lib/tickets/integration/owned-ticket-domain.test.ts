/**
 * Unit: cleanupOwnedTicketDomain nunca borra TicketCounter
 * (sin ownership demostrable en el modelo).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";
import { INTEGRATION_PRISMA_BRAND } from "@/lib/tickets/integration/harness";
import {
  assertExclusiveTicketFechaOrAbort,
  cleanupOwnedTicketDomain,
  createOwnedTicketDomain,
  trackFixtureTicketCounter,
} from "@/lib/tickets/integration/owned-ticket-domain";

const SECRET = "owned-domain-unit-secret";

function neonUrl(endpoint: string): string {
  return `postgresql://u:${SECRET}@${endpoint}.c-6.us-east-2.aws.neon.tech/neondb`;
}

function brandedMock(partial: Record<string, unknown>): PrismaClient {
  return {
    [INTEGRATION_PRISMA_BRAND]: NEON_ENDPOINTS.TEST,
    ...partial,
  } as unknown as PrismaClient;
}

describe("owned-ticket-domain — TicketCounter no se borra", () => {
  const testEnv = {
    TEST_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
    DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
    DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
  };

  it("cleanup no llama ticketCounter.deleteMany aunque haya fechas trackeadas y 0 tickets", async () => {
    const prev = { ...process.env };
    Object.assign(process.env, testEnv);
    try {
      let ticketCounterDeleteCalls = 0;
      let ticketCountCalls = 0;
      const domain = createOwnedTicketDomain();
      trackFixtureTicketCounter(domain);
      assert.ok(domain.ticketCounterFechas.size >= 1);

      const db = brandedMock({
        creditoMovimiento: { findMany: async () => [] },
        vendedorCreditoCuenta: { findMany: async () => [] },
        usuarioSesion: { findMany: async () => [] },
        ticketLinea: { findMany: async () => [] },
        auditoria: { findMany: async () => [] },
        ticket: {
          findMany: async () => [],
          findUnique: async () => null,
          count: async () => {
            ticketCountCalls += 1;
            return 0;
          },
          deleteMany: async () => ({ count: 0 }),
        },
        resultado: { deleteMany: async () => ({ count: 0 }) },
        usuario: { deleteMany: async () => ({ count: 0 }) },
        ticketCounter: {
          deleteMany: async () => {
            ticketCounterDeleteCalls += 1;
            return { count: 1 };
          },
        },
      });

      const report = await cleanupOwnedTicketDomain(db, domain);
      assert.equal(report.deletedTicketCounters, 0);
      assert.equal(
        ticketCounterDeleteCalls,
        0,
        "TicketCounter.deleteMany no debe invocarse",
      );
      // Ya no se consulta count para decidir borrar el contador.
      assert.equal(ticketCountCalls, 0);
      assert.equal(domain.ticketCounterFechas.size, 0);
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in prev)) delete process.env[k];
      }
      Object.assign(process.env, prev);
    }
  });

  it("cleanup es idempotente (segunda pasada sin IDs → ceros)", async () => {
    const prev = { ...process.env };
    Object.assign(process.env, testEnv);
    try {
      const domain = createOwnedTicketDomain();
      const db = brandedMock({
        creditoMovimiento: { findMany: async () => [] },
        vendedorCreditoCuenta: { findMany: async () => [] },
        usuarioSesion: { findMany: async () => [] },
        ticketLinea: { findMany: async () => [] },
        auditoria: { findMany: async () => [] },
        ticket: {
          findMany: async () => [],
          findUnique: async () => null,
          count: async () => 0,
          deleteMany: async () => ({ count: 0 }),
        },
        resultado: { deleteMany: async () => ({ count: 0 }) },
        usuario: { deleteMany: async () => ({ count: 0 }) },
        ticketCounter: {
          deleteMany: async () => {
            throw new Error("no debe llamarse");
          },
        },
      });

      const a = await cleanupOwnedTicketDomain(db, domain);
      const b = await cleanupOwnedTicketDomain(db, domain);
      assert.equal(a.deletedTicketCounters, 0);
      assert.equal(b.deletedTicketCounters, 0);
      assert.deepEqual(a, b);
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in prev)) delete process.env[k];
      }
      Object.assign(process.env, prev);
    }
  });

  it("assertExclusiveTicketFechaOrAbort aborta con tickets ajenos", async () => {
    const prev = { ...process.env };
    Object.assign(process.env, testEnv);
    try {
      const domain = createOwnedTicketDomain();
      domain.ticketIds.add("owned-1");
      const fecha = new Date(Date.UTC(2099, 0, 1));
      const db = brandedMock({
        ticket: {
          findMany: async () => [
            { id: "owned-1", vendedorId: "u1", numeroVisible: "000001" },
            { id: "foreign-9", vendedorId: "u2", numeroVisible: "000009" },
          ],
        },
      });
      await assert.rejects(
        () => assertExclusiveTicketFechaOrAbort(db, domain, fecha),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /ABORT: fecha fixture no exclusiva/);
          assert.match(err.message, /foreign-9/);
          return true;
        },
      );
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in prev)) delete process.env[k];
      }
      Object.assign(process.env, prev);
    }
  });

  it("assertExclusiveTicketFechaOrAbort permite contador residual sin tickets", async () => {
    const prev = { ...process.env };
    Object.assign(process.env, testEnv);
    try {
      const domain = createOwnedTicketDomain();
      const fecha = new Date(Date.UTC(2099, 0, 2));
      const db = brandedMock({
        ticket: { findMany: async () => [] },
        ticketCounter: {
          findUnique: async () => ({
            fechaJuego: fecha,
            ultimoNumero: 99,
          }),
        },
      });
      await assertExclusiveTicketFechaOrAbort(db, domain, fecha);
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in prev)) delete process.env[k];
      }
      Object.assign(process.env, prev);
    }
  });
});
