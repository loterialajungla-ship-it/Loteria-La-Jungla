/**
 * Integración: bloqueo FOR UPDATE del emisor y serialización vs desactivación.
 * Solo vía `npm run test:integration` (TEST allowlisted).
 *
 * Concurrencia determinista con barreras (sin sleep arbitrario):
 * - Venta adquiere FOR UPDATE y publica "locked".
 * - Desactivación se lanza y queda bloqueada hasta que la venta libera.
 * - Tras commit de venta, desactivación completa.
 * - Tras desactivación previa, venta rechaza sin ticket.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTicket } from "@/lib/tickets/create-ticket";
import { TicketSellerNotAllowedError } from "@/lib/tickets/errors";
import { InsufficientCreditoSaldoError } from "@/lib/creditos/errors";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
} from "@/lib/creditos/operaciones";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import { desactivarUsuario } from "@/lib/users/admin-users";
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
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";

const ENABLED = process.env.RUN_INTEGRATION === "1";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe(
  "integración — FOR UPDATE emisor (anti-TOCTOU)",
  { skip: !ENABLED },
  () => {
    let db: ReturnType<typeof createIntegrationPrismaClient>;
    let db2: ReturnType<typeof createIntegrationPrismaClient>;
    let admin: { id: string };

    before(async () => {
      assertIntegrationPointsAtTestDatabase();
      const ep =
        process.env.DATABASE_URL?.match(/ep-[a-z0-9-]+/)?.[0]?.replace(
          /-pooler$/,
          "",
        ) ?? "";
      assert.equal(
        ep,
        NEON_ENDPOINTS.TEST,
        `integración exige endpoint TEST; recibido ${ep || "(vacío)"}`,
      );
      db = createIntegrationPrismaClient();
      db2 = createIntegrationPrismaClient();
      await seedMinimalBusiness(db);
    });

    beforeEach(async () => {
      assertIntegrationPointsAtTestDatabase();
      await resetTicketDomain(db);
      await seedMinimalBusiness(db);
      // CreditosConfig singleton: control OFF por defecto (fail-closed explícito).
      await db.$executeRaw`
        INSERT INTO "CreditosConfig"
          ("id", "controlActivo", "inicioEn", "umbralSaldoBajo", "updatedAt", "updatedByAdminId")
        VALUES (1, false, NULL, NULL, NOW(), NULL)
        ON CONFLICT ("id") DO UPDATE SET
          "controlActivo" = false,
          "inicioEn" = NULL,
          "updatedAt" = NOW()
      `;
      admin = await createTestUser(db, {
        usuario: "admin_lock",
        nombre: "Admin Lock",
        rol: "ADMIN",
      });
    });

    after(async () => {
      // Dejar TEST con control desactivado (estado seguro post-suite).
      try {
        await db.$executeRaw`
          UPDATE "CreditosConfig"
          SET "controlActivo" = false, "inicioEn" = NULL, "updatedAt" = NOW()
          WHERE "id" = 1
        `;
      } catch {
        /* ignore */
      }
      await db.$disconnect();
      await db2.$disconnect();
    });

    it("usuario activo autorizado: creación permitida", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_ok",
        nombre: "Vend OK",
        rol: "VENDEDOR",
      });
      const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
      const result = await createTicket(
        {
          fechaJuego: fecha,
          vendedorId: vendedor.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "VENDEDOR" },
      );
      assert.equal(result.idempotentReplay, false);
      const count = await db.ticket.count({ where: { vendedorId: vendedor.id } });
      assert.equal(count, 1);
    });

    it("usuario inactivo antes de TX: rechazo sin ticket", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_off",
        nombre: "Vend Off",
        rol: "VENDEDOR",
      });
      await db.usuario.update({
        where: { id: vendedor.id },
        data: { activo: false },
      });
      const before = await db.ticket.count();
      await assert.rejects(
        () =>
          createTicket(
            {
              fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
              vendedorId: vendedor.id,
              idempotencyKey: newIdempotencyKey(),
              lineas: [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
            },
            AHORA_VE_MANANA,
            db,
            { actorRol: "VENDEDOR" },
          ),
        (e: unknown) => e instanceof TicketSellerNotAllowedError,
      );
      assert.equal(await db.ticket.count(), before);
    });

    it("rol incompatible tras lectura bloqueada: rechazo", async () => {
      const user = await createTestUser(db, {
        usuario: "vend_rol",
        nombre: "Vend Rol",
        rol: "VENDEDOR",
      });
      // Sesión afirma ADMIN pero fila es VENDEDOR
      await assert.rejects(
        () =>
          createTicket(
            {
              fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
              vendedorId: user.id,
              idempotencyKey: newIdempotencyKey(),
              lineas: [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
            },
            AHORA_VE_MANANA,
            db,
            { actorRol: "ADMIN" },
          ),
        (e: unknown) => e instanceof TicketSellerNotAllowedError,
      );
      assert.equal(await db.ticket.count({ where: { vendedorId: user.id } }), 0);
    });

    it("usuario inexistente: rechazo", async () => {
      await assert.rejects(
        () =>
          createTicket(
            {
              fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
              vendedorId: "missing-user-id-000",
              idempotencyKey: newIdempotencyKey(),
              lineas: [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
            },
            AHORA_VE_MANANA,
            db,
            { actorRol: "VENDEDOR" },
          ),
        (e: unknown) => e instanceof TicketSellerNotAllowedError,
      );
    });

    it("ADMIN activo: creación sin exigir cuenta de créditos", async () => {
      const result = await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: admin.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: "05", importe: "3.00" }],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "ADMIN" },
      );
      assert.equal(result.ticket.vendedorId, admin.id);
      const movs = await db.creditoMovimiento.count({
        where: { ticketId: result.ticket.id },
      });
      assert.equal(movs, 0);
    });

    it("VENDEDOR: sin consumo cuando control está desactivado", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_nocred",
        nombre: "Vend NoCred",
        rol: "VENDEDOR",
      });
      const movsBefore = await db.creditoMovimiento.count();
      const result = await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendedor.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "4.00" }],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "VENDEDOR" },
      );
      assert.ok(result.ticket.id);
      assert.equal(await db.creditoMovimiento.count(), movsBefore);
      assert.equal(
        await db.vendedorCreditoCuenta.count({
          where: { vendedorId: vendedor.id },
        }),
        0,
      );
    });

    it("VENDEDOR: consumo correcto cuando control activo y fecha aplica", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_cred",
        nombre: "Vend Cred",
        rol: "VENDEDOR",
      });
      await db.creditosConfig.update({
        where: { id: 1 },
        data: {
          controlActivo: true,
          inicioEn: new Date("2020-01-01T00:00:00.000Z"),
        },
      });
      const credits = createPrismaCreditosStore(db);
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "50.00",
        actorAdminId: admin.id,
      });
      const before = await consultarSaldoYHistorial(credits, vendedor.id);
      assert.equal(before.cuenta!.saldoDisponible.toFixed(2), "50.00");

      const result = await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendedor.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "5.00" }],
        },
        AHORA_VE_MANANA,
        db,
        { actorRol: "VENDEDOR" },
      );
      const after = await consultarSaldoYHistorial(credits, vendedor.id);
      assert.equal(after.cuenta!.saldoDisponible.toFixed(2), "45.00");
      const consumos = await db.creditoMovimiento.count({
        where: { ticketId: result.ticket.id, tipo: "CONSUMO_VENTA" },
      });
      assert.equal(consumos, 1);
    });

    it("fallo de consumo (saldo insuficiente): rollback sin ticket ni movimiento", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_insuf",
        nombre: "Vend Insuf",
        rol: "VENDEDOR",
      });
      await db.creditosConfig.update({
        where: { id: 1 },
        data: {
          controlActivo: true,
          inicioEn: new Date("2020-01-01T00:00:00.000Z"),
        },
      });
      const credits = createPrismaCreditosStore(db);
      await asignarCreditos(credits, {
        vendedorId: vendedor.id,
        importe: "1.00",
        actorAdminId: admin.id,
      });
      const key = newIdempotencyKey();
      const ticketsBefore = await db.ticket.count();
      const movsBefore = await db.creditoMovimiento.count({
        where: { tipo: "CONSUMO_VENTA" },
      });

      await assert.rejects(
        () =>
          createTicket(
            {
              fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
              vendedorId: vendedor.id,
              idempotencyKey: key,
              lineas: [{ hora: 14, numeroAnimal: "03", importe: "5.00" }],
            },
            AHORA_VE_MANANA,
            db,
            { actorRol: "VENDEDOR" },
          ),
        (e: unknown) => e instanceof InsufficientCreditoSaldoError,
      );

      assert.equal(await db.ticket.count(), ticketsBefore);
      assert.equal(
        await db.ticket.count({ where: { idempotencyKey: key } }),
        0,
      );
      assert.equal(
        await db.creditoMovimiento.count({ where: { tipo: "CONSUMO_VENTA" } }),
        movsBefore,
      );
      const after = await consultarSaldoYHistorial(credits, vendedor.id);
      assert.equal(after.cuenta!.saldoDisponible.toFixed(2), "1.00");
    });

    it("desactivación previa al FOR UPDATE: venta rechazada sin residuos", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_pre",
        nombre: "Vend Pre",
        rol: "VENDEDOR",
      });
      await desactivarUsuario(db, {
        id: vendedor.id,
        actorUserId: admin.id,
      });
      const ticketsBefore = await db.ticket.count();
      const movsBefore = await db.creditoMovimiento.count();
      await assert.rejects(
        () =>
          createTicket(
            {
              fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
              vendedorId: vendedor.id,
              idempotencyKey: newIdempotencyKey(),
              lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
            },
            AHORA_VE_MANANA,
            db,
            { actorRol: "VENDEDOR" },
          ),
        TicketSellerNotAllowedError,
      );
      assert.equal(await db.ticket.count(), ticketsBefore);
      assert.equal(await db.creditoMovimiento.count(), movsBefore);
    });

    it("concurrencia A: venta bloquea Usuario; desactivación espera; venta OK luego off", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_hold",
        nombre: "Vend Hold",
        rol: "VENDEDOR",
      });

      const locked = deferred();
      const release = deferred();
      const deactivateStarted = deferred();

      let deactivateResolved = false;
      const salePromise = createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendedor.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
        },
        AHORA_VE_MANANA,
        db,
        {
          actorRol: "VENDEDOR",
          afterEmisorLocked: async () => {
            locked.resolve();
            await release.promise;
          },
        },
      );

      await locked.promise;

      const deactivatePromise = (async () => {
        deactivateStarted.resolve();
        await desactivarUsuario(db2, {
          id: vendedor.id,
          actorUserId: admin.id,
        });
        deactivateResolved = true;
      })();

      await deactivateStarted.promise;
      // Ceder al event loop para que desactivar intente el UPDATE y espere el lock.
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));

      const mid = await db.usuario.findUniqueOrThrow({
        where: { id: vendedor.id },
      });
      assert.equal(mid.activo, true);
      assert.equal(
        deactivateResolved,
        false,
        "desactivación no debe completar mientras la venta retiene FOR UPDATE",
      );

      release.resolve();
      const sale = await salePromise;
      assert.equal(sale.idempotentReplay, false);
      assert.equal(
        await db.ticket.count({ where: { id: sale.ticket.id } }),
        1,
      );

      await deactivatePromise;
      assert.equal(deactivateResolved, true);

      const row = await db.usuario.findUniqueOrThrow({
        where: { id: vendedor.id },
      });
      assert.equal(row.activo, false);
    });

    it("concurrencia B: desactivación confirma primero; venta posterior rechaza", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_first",
        nombre: "Vend First",
        rol: "VENDEDOR",
      });
      await desactivarUsuario(db, {
        id: vendedor.id,
        actorUserId: admin.id,
      });

      const ticketsBefore = await db.ticket.count();
      await assert.rejects(
        () =>
          createTicket(
            {
              fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
              vendedorId: vendedor.id,
              idempotencyKey: newIdempotencyKey(),
              lineas: [{ hora: 15, numeroAnimal: "03", importe: "1.00" }],
            },
            AHORA_VE_MANANA,
            db2,
            { actorRol: "VENDEDOR" },
          ),
        TicketSellerNotAllowedError,
      );
      assert.equal(await db.ticket.count(), ticketsBefore);
    });

    it("cambio de rol no autorizado: venta rechaza sin residuos", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_roleflip",
        nombre: "Vend RoleFlip",
        rol: "VENDEDOR",
      });

      // Flip confirmado antes de que la venta adquiera el bloqueo.
      await db.usuario.update({
        where: { id: vendedor.id },
        data: { rol: "ADMIN" },
      });

      const ticketsBefore = await db.ticket.count();
      const movsBefore = await db.creditoMovimiento.count();
      await assert.rejects(
        () =>
          createTicket(
            {
              fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
              vendedorId: vendedor.id,
              idempotencyKey: newIdempotencyKey(),
              lineas: [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
            },
            AHORA_VE_MANANA,
            db,
            { actorRol: "VENDEDOR" },
          ),
        TicketSellerNotAllowedError,
      );
      assert.equal(await db.ticket.count(), ticketsBefore);
      assert.equal(await db.creditoMovimiento.count(), movsBefore);
    });

    it("idempotencia: misma key no duplica tras éxito", async () => {
      const vendedor = await createTestUser(db, {
        usuario: "vend_idem",
        nombre: "Vend Idem",
        rol: "VENDEDOR",
      });
      const key = newIdempotencyKey();
      const input = {
        fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
        vendedorId: vendedor.id,
        idempotencyKey: key,
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
      };
      const a = await createTicket(input, AHORA_VE_MANANA, db, {
        actorRol: "VENDEDOR",
      });
      const b = await createTicket(input, AHORA_VE_MANANA, db, {
        actorRol: "VENDEDOR",
      });
      assert.equal(a.idempotentReplay, false);
      assert.equal(b.idempotentReplay, true);
      assert.equal(a.ticket.id, b.ticket.id);
      assert.equal(await db.ticket.count({ where: { idempotencyKey: key } }), 1);
    });
  },
);
