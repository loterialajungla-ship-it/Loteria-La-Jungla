/**
 * Integración créditos ↔ venta/anulación en PostgreSQL TEST.
 *
 * REQUISITO: migración `20261029170000_add_vendedor_creditos` aplicada en TEST
 * y `RUN_INTEGRATION=1` con destino allowlisted.
 * Si las tablas no existen, cada caso se omite (no aplica migrate, no toca prod).
 *
 * Animales del harness: 03 / 05 (no inventar 01/02).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { consumirCreditosTrasEmitirTicket } from "@/lib/creditos/aplicar-en-venta";
import { actualizarCreditosConfig } from "@/lib/creditos/config";
import { InsufficientCreditoSaldoError } from "@/lib/creditos/errors";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
} from "@/lib/creditos/operaciones";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import type { CreditosStore } from "@/lib/creditos/store";
import { createTicket } from "@/lib/tickets/create-ticket";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import {
  AHORA_VE_MANANA,
  createIntegrationPrismaClient,
  createTestUser,
  newIdempotencyKey,
  resetTicketDomain,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";
import { hoyYYYYMMDD } from "@/lib/fecha";

const ENABLED = process.env.RUN_INTEGRATION === "1";

/** Animales presentes en seedMinimalBusiness. */
const ANIMAL_A = "03";
const ANIMAL_B = "05";

async function creditosSchemaReady(
  client: ReturnType<typeof createIntegrationPrismaClient>,
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'CreditosConfig'
    ) AS "exists"
  `;
  return Boolean(rows[0]?.exists);
}

/**
 * Coherencia saldo ↔ libro sin exigir orden cronológico de createdAt:
 * en tests, consumo usa `ahora` sintético (AHORA_VE_MANANA) y asignación
 * usa reloj real → orderBy createdAt no refleja la secuencia lógica.
 */
function assertSaldoCoincideLibro(
  saldo: Prisma.Decimal,
  movimientos: Array<{
    tipo: string;
    importe: Prisma.Decimal;
    saldoAnterior: Prisma.Decimal;
    saldoPosterior: Prisma.Decimal;
  }>,
): void {
  assert.ok(movimientos.length > 0, "libro vacío");
  let neto = new Prisma.Decimal(0);
  for (const m of movimientos) {
    const delta = deltaDeTipo(m);
    assert.equal(
      m.saldoPosterior.toFixed(2),
      m.saldoAnterior.plus(delta).toFixed(2),
      `movimiento ${m.tipo} incoherente`,
    );
    neto = neto.plus(delta);
  }
  assert.equal(saldo.toFixed(2), neto.toFixed(2));
}

function deltaDeTipo(m: {
  tipo: string;
  importe: Prisma.Decimal;
  saldoAnterior: Prisma.Decimal;
  saldoPosterior: Prisma.Decimal;
}): Prisma.Decimal {
  if (m.tipo === "CORRECCION") {
    return m.saldoPosterior.minus(m.saldoAnterior);
  }
  if (m.tipo === "CONSUMO_VENTA" || m.tipo === "RETIRO") {
    return m.importe.negated();
  }
  return m.importe;
}

function boomOnInsertTipo(
  base: CreditosStore,
  tipoBoom: string,
): CreditosStore {
  const wrapped: CreditosStore = {
    ...base,
    async runInTransaction(fn) {
      // Re-envolver el store que entrega runInTransaction (el original
      // ignora el wrapper al hacer fn(store) con alreadyInTransaction).
      return base.runInTransaction((tx) => fn(boomOnInsertTipo(tx, tipoBoom)));
    },
    async insertMovimiento(mov) {
      if (mov.tipo === tipoBoom) {
        throw new Error(`forced-fail:${tipoBoom}`);
      }
      return base.insertMovimiento(mov);
    },
  };
  return wrapped;
}

describe(
  "integración PostgreSQL — créditos × tickets",
  { skip: !ENABLED },
  () => {
    let db: ReturnType<typeof createIntegrationPrismaClient>;
    let schemaOk = false;
    let vendedor: { id: string };
    let admin: { id: string };

    before(async () => {
      assertIntegrationPointsAtTestDatabase();
      db = createIntegrationPrismaClient();
      schemaOk = await creditosSchemaReady(db);
      if (!schemaOk) {
        console.warn(
          "[creditos-venta.integration] Schema de créditos ausente en TEST. " +
            "Autorizar y aplicar migrate 20261029170000_add_vendedor_creditos en TEST.",
        );
      } else {
        await seedMinimalBusiness(db);
      }
    });

    beforeEach(async () => {
      if (!schemaOk) return;
      assertIntegrationPointsAtTestDatabase();
      // Créditos primero: FKs RESTRICT hacia Usuario/Ticket bloquean resetTicketDomain.
      await db.creditoMovimiento.deleteMany({});
      await db.vendedorCreditoCuenta.deleteMany({});
      await db.creditosConfig.deleteMany({});
      await resetTicketDomain(db);
      await seedMinimalBusiness(db);
      vendedor = await createTestUser(db, {
        usuario: "vend_cred",
        nombre: "Vendedor Cred",
        rol: "VENDEDOR",
      });
      admin = await createTestUser(db, {
        usuario: "admin_cred",
        nombre: "Admin Cred",
        rol: "ADMIN",
      });
    });

    after(async () => {
      if (db) await db.$disconnect();
    });

    it("saldo insuficiente: no crea ticket ni movimiento", async (t) => {
      if (!schemaOk) {
        t.skip("migración de créditos no aplicada en TEST");
        return;
      }
      const credits = createPrismaCreditosStore(db);
      await actualizarCreditosConfig(credits, {
        controlActivo: true,
        inicioEn: new Date(AHORA_VE_MANANA.getTime() - 3600_000),
        updatedByAdminId: admin.id,
      });
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "3.00",
        actorAdminId: admin.id,
      });

      const key = newIdempotencyKey();
      await assert.rejects(
        () =>
          createTicket(
            {
              fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
              vendedorId: vendedor.id,
              idempotencyKey: key,
              lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "5.00" }],
            },
            AHORA_VE_MANANA,
            db,
            { actorRol: "VENDEDOR" },
          ),
        (e: unknown) => e instanceof InsufficientCreditoSaldoError,
      );

      const ticket = await db.ticket.findUnique({
        where: { idempotencyKey: key },
      });
      assert.equal(ticket, null);
      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "3.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        0,
      );
    });

    it("venta + consumo + anulación + devolución atómicas e idempotentes", async (t) => {
      if (!schemaOk) {
        t.skip("migración de créditos no aplicada en TEST");
        return;
      }
      const credits = createPrismaCreditosStore(db);
      await actualizarCreditosConfig(credits, {
        controlActivo: true,
        inicioEn: new Date(AHORA_VE_MANANA.getTime() - 3600_000),
        updatedByAdminId: admin.id,
      });
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "50.00",
        actorAdminId: admin.id,
      });

      const key = newIdempotencyKey();
      const created = await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendedor.id,
          idempotencyKey: key,
          lineas: [
            { hora: 14, numeroAnimal: ANIMAL_A, importe: "4.00" },
            { hora: 15, numeroAnimal: ANIMAL_B, importe: "6.00" },
          ],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "VENDEDOR" },
      );
      assert.equal(created.ticket.totalApostado, "10.00");

      const replay = await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendedor.id,
          idempotencyKey: key,
          lineas: [
            { hora: 14, numeroAnimal: ANIMAL_A, importe: "4.00" },
            { hora: 15, numeroAnimal: ANIMAL_B, importe: "6.00" },
          ],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "VENDEDOR" },
      );
      assert.equal(replay.idempotentReplay, true);

      let hist = await consultarSaldoYHistorial(credits, vendedor.id);
      assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "40.00");
      assert.equal(
        hist.movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        1,
      );
      assertSaldoCoincideLibro(hist.cuenta!.saldoDisponible, hist.movimientos);

      await anularTicket(db, {
        id: created.ticket.id,
        motivo: "prueba créditos",
        anuladoPorId: admin.id,
        ahora: AHORA_VE_MANANA,
      });
      await assert.rejects(() =>
        anularTicket(db, {
          id: created.ticket.id,
          motivo: "reintento",
          anuladoPorId: admin.id,
        }),
      );

      hist = await consultarSaldoYHistorial(credits, vendedor.id);
      assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "50.00");
      assert.equal(
        hist.movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION")
          .length,
        1,
      );
      assertSaldoCoincideLibro(hist.cuenta!.saldoDisponible, hist.movimientos);
    });

    it("ADMIN exento de consumo", async (t) => {
      if (!schemaOk) {
        t.skip("migración de créditos no aplicada en TEST");
        return;
      }
      const credits = createPrismaCreditosStore(db);
      await actualizarCreditosConfig(credits, {
        controlActivo: true,
        inicioEn: new Date(AHORA_VE_MANANA.getTime() - 3600_000),
        updatedByAdminId: admin.id,
      });
      await asignarCreditos(credits, {
        vendedorId: admin.id,
        importe: "1.00",
        actorAdminId: admin.id,
      });

      await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: admin.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "20.00" }],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "ADMIN" },
      );

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        credits,
        admin.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "1.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        0,
      );
    });

    it("dos ventas concurrentes no dejan saldo negativo", async (t) => {
      if (!schemaOk) {
        t.skip("migración de créditos no aplicada en TEST");
        return;
      }
      const credits = createPrismaCreditosStore(db);
      await actualizarCreditosConfig(credits, {
        controlActivo: true,
        inicioEn: new Date(AHORA_VE_MANANA.getTime() - 3600_000),
        updatedByAdminId: admin.id,
      });
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "10.00",
        actorAdminId: admin.id,
      });

      const results = await Promise.allSettled([
        createTicket(
          {
            fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
            vendedorId: vendedor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "7.00" }],
          },
          AHORA_VE_MANANA,
          db,
          { actorRol: "VENDEDOR" },
        ),
        createTicket(
          {
            fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
            vendedorId: vendedor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 15, numeroAnimal: ANIMAL_B, importe: "7.00" }],
          },
          AHORA_VE_MANANA,
          db,
          { actorRol: "VENDEDOR" },
        ),
      ]);

      const ok = results.filter((r) => r.status === "fulfilled");
      const fail = results.filter((r) => r.status === "rejected");
      assert.equal(ok.length, 1);
      assert.equal(fail.length, 1);
      assert.ok(
        fail[0]!.status === "rejected" &&
          fail[0].reason instanceof InsufficientCreditoSaldoError,
      );

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        credits,
        vendedor.id,
      );
      assert.ok(cuenta!.saldoDisponible.gte(0));
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "3.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        1,
      );
      assertSaldoCoincideLibro(cuenta!.saldoDisponible, movimientos);
    });

    it("reintentos concurrentes misma clave: un solo consumo", async (t) => {
      if (!schemaOk) {
        t.skip("migración de créditos no aplicada en TEST");
        return;
      }
      const credits = createPrismaCreditosStore(db);
      await actualizarCreditosConfig(credits, {
        controlActivo: true,
        inicioEn: new Date(Date.now() - 3600_000),
        updatedByAdminId: admin.id,
      });
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "30.00",
        actorAdminId: admin.id,
      });

      const key = newIdempotencyKey();
      const payload = {
        fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
        vendedorId: vendedor.id,
        idempotencyKey: key,
        lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "8.00" }],
      };

      const results = await Promise.allSettled([
        createTicket(payload, AHORA_VE_MANANA, db, { actorRol: "VENDEDOR" }),
        createTicket(payload, AHORA_VE_MANANA, db, { actorRol: "VENDEDOR" }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      assert.ok(fulfilled.length >= 1);
      for (const r of fulfilled) {
        assert.equal(r.status, "fulfilled");
        assert.equal(r.value.ticket.id, (fulfilled[0] as PromiseFulfilledResult<{ ticket: { id: string } }>).value.ticket.id);
      }

      const tickets = await db.ticket.findMany({
        where: { idempotencyKey: key },
      });
      assert.equal(tickets.length, 1);

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "22.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        1,
      );
      assertSaldoCoincideLibro(cuenta!.saldoDisponible, movimientos);
    });

    it("control desactivado y venta anterior al corte no consumen", async (t) => {
      if (!schemaOk) {
        t.skip("migración de créditos no aplicada en TEST");
        return;
      }
      const credits = createPrismaCreditosStore(db);
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "20.00",
        actorAdminId: admin.id,
      });

      // Control off (default tras deleteMany).
      await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendedor.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "5.00" }],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "VENDEDOR" },
      );

      // Corte en el futuro → createdAt (now()) < inicioEn.
      await actualizarCreditosConfig(credits, {
        controlActivo: true,
        inicioEn: new Date(Date.now() + 3600_000),
        updatedByAdminId: admin.id,
      });
      await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendedor.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 15, numeroAnimal: ANIMAL_B, importe: "5.00" }],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "VENDEDOR" },
      );

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "20.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        0,
      );
    });

    it("corte exacto: consumo cuando createdAt === inicioEn (Prisma store)", async (t) => {
      if (!schemaOk) {
        t.skip("migración de créditos no aplicada en TEST");
        return;
      }
      // createTicket fija createdAt con now() de PG; se emite sin control,
      // luego se activa con inicioEn = createdAt del ticket y se consume.
      const credits = createPrismaCreditosStore(db);
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "15.00",
        actorAdminId: admin.id,
      });

      const created = await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendedor.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "3.00" }],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "VENDEDOR" },
      );

      const ticket = await db.ticket.findUniqueOrThrow({
        where: { id: created.ticket.id },
      });
      await actualizarCreditosConfig(credits, {
        controlActivo: true,
        inicioEn: ticket.createdAt,
        updatedByAdminId: admin.id,
      });

      const r = await consumirCreditosTrasEmitirTicket(credits, {
        actorRol: "VENDEDOR",
        vendedorId: vendedor.id,
        ticketId: ticket.id,
        ticketCreatedAt: ticket.createdAt,
        totalApostado: ticket.totalApostado,
      });
      assert.equal(r.status, "consumed");

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "12.00");
      assertSaldoCoincideLibro(cuenta!.saldoDisponible, movimientos);
    });

    it("fallo al insertar CONSUMO_VENTA revierte ticket y saldo", async (t) => {
      if (!schemaOk) {
        t.skip("migración de créditos no aplicada en TEST");
        return;
      }
      const credits = createPrismaCreditosStore(db);
      await actualizarCreditosConfig(credits, {
        controlActivo: true,
        inicioEn: new Date(Date.now() - 3600_000),
        updatedByAdminId: admin.id,
      });
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "25.00",
        actorAdminId: admin.id,
      });

      const key = newIdempotencyKey();
      await assert.rejects(
        () =>
          createTicket(
            {
              fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
              vendedorId: vendedor.id,
              idempotencyKey: key,
              lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "4.00" }],
            },
            AHORA_VE_MANANA,
            db,
            {
              actorRol: "VENDEDOR",
              bindCreditsStore: (tx) =>
                boomOnInsertTipo(
                  createPrismaCreditosStore(tx, { alreadyInTransaction: true }),
                  "CONSUMO_VENTA",
                ),
            },
          ),
        /forced-fail:CONSUMO_VENTA/,
      );

      assert.equal(
        await db.ticket.findUnique({ where: { idempotencyKey: key } }),
        null,
      );
      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "25.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        0,
      );
    });

    it("fallo al insertar DEVOLUCION revierte anulación", async (t) => {
      if (!schemaOk) {
        t.skip("migración de créditos no aplicada en TEST");
        return;
      }
      const credits = createPrismaCreditosStore(db);
      await actualizarCreditosConfig(credits, {
        controlActivo: true,
        inicioEn: new Date(Date.now() - 3600_000),
        updatedByAdminId: admin.id,
      });
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "20.00",
        actorAdminId: admin.id,
      });

      const created = await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendedor.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "6.00" }],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "VENDEDOR" },
      );

      await assert.rejects(
        () =>
          anularTicket(
            db,
            {
              id: created.ticket.id,
              motivo: "rollback devolucion",
              anuladoPorId: admin.id,
            },
            {
              bindCreditsStore: (tx) =>
                boomOnInsertTipo(
                  createPrismaCreditosStore(tx, { alreadyInTransaction: true }),
                  "DEVOLUCION_ANULACION",
                ),
            },
          ),
        /forced-fail:DEVOLUCION_ANULACION/,
      );

      const ticket = await db.ticket.findUnique({
        where: { id: created.ticket.id },
      });
      assert.equal(ticket?.estado, "EMITIDO");

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "14.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
        0,
      );
    });
  },
);
