/**
 * Integración aislada créditos × tickets (PostgreSQL TEST).
 *
 * - Sin deleteMany({}), sin resetTicketDomain, sin mutar CreditosConfig.
 * - Config de control inyectada vía wrapStoreWithVirtualConfig.
 * - Limpieza solo por IDs del run (`creditos_qa_<runId>_…`).
 *
 * Ejecutar SOLO con: `npm run test:integration:creditos`
 * (no usar `npm run test:integration` para esta política de aislamiento).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { consumirCreditosTrasEmitirTicket } from "@/lib/creditos/aplicar-en-venta";
import {
  CreditoValidationError,
  InsufficientCreditoSaldoError,
} from "@/lib/creditos/errors";
import {
  ANIMAL_A,
  ANIMAL_B,
  boomOnInsertTipo,
  bootstrapIsolatedCreditos,
  buildVirtualCreditosConfig,
  wrapStoreWithVirtualConfig,
  type IsolatedCreditosContext,
} from "@/lib/creditos/integration/isolated-harness";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
  registrarCorreccionCredito,
} from "@/lib/creditos/operaciones";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { createTicket } from "@/lib/tickets/create-ticket";
import { newIdempotencyKey } from "@/lib/tickets/integration/harness";
import { hoyYYYYMMDD } from "@/lib/fecha";

const ENABLED = process.env.RUN_INTEGRATION === "1";

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
    const delta =
      m.tipo === "CORRECCION"
        ? m.saldoPosterior.minus(m.saldoAnterior)
        : m.tipo === "CONSUMO_VENTA" || m.tipo === "RETIRO"
          ? m.importe.negated()
          : m.importe;
    assert.equal(
      m.saldoPosterior.toFixed(2),
      m.saldoAnterior.plus(delta).toFixed(2),
      `movimiento ${m.tipo} incoherente`,
    );
    neto = neto.plus(delta);
  }
  assert.equal(saldo.toFixed(2), neto.toFixed(2));
}

describe(
  "integración aislada — créditos × tickets",
  { skip: !ENABLED },
  () => {
    let ctx: IsolatedCreditosContext;
    let vendedor: { id: string; usuario: string };
    let admin: { id: string; usuario: string };
    let bootstrapError: string | null = null;

    before(async () => {
      try {
        ctx = await bootstrapIsolatedCreditos();
        console.log(
          `[creditos-isolated] run=${ctx.registry.runId} prefix=${ctx.registry.prefix}`,
        );
      } catch (e) {
        bootstrapError = e instanceof Error ? e.message : String(e);
        console.warn(`[creditos-isolated] bootstrap BLOCKED: ${bootstrapError}`);
      }
    });

    beforeEach(async () => {
      if (!ctx || bootstrapError) return;
      // Usuarios frescos por caso: evita acumulación de saldo entre tests
      // sin wipe global.
      admin = await ctx.createAdmin();
      vendedor = await ctx.createVendedor();
    });

    after(async () => {
      if (!ctx) return;
      try {
        const report = await ctx.cleanupOwn();
        console.log(
          `[creditos-isolated] cleanup OK mov=${report.deletedMovimientos} ` +
            `cuentas=${report.deletedCuentas} tickets=${report.deletedTickets} ` +
            `users=${report.deletedUsers}`,
        );
      } catch (e) {
        console.error(
          "[creditos-isolated] cleanup ABORT:",
          e instanceof Error ? e.message : e,
        );
        throw e;
      } finally {
        await ctx.disconnect();
      }
    });

    function requireCtx(t: { skip: (msg?: string) => void }): boolean {
      if (bootstrapError || !ctx) {
        t.skip(bootstrapError ?? "bootstrap no disponible");
        return false;
      }
      return true;
    }

    async function trackAfterAssign(vendedorId: string) {
      ctx.trackCuenta(vendedorId);
      await ctx.refreshOwnedMovimientosForVendedor(vendedorId);
    }

    async function emitVenta(args: {
      vendedorId: string;
      actorRol: "VENDEDOR" | "ADMIN";
      lineas: Array<{ hora: number; numeroAnimal: string; importe: string }>;
      idempotencyKey?: string;
      control?: "on" | "off" | "future";
      bindExtra?: (
        base: ReturnType<IsolatedCreditosContext["bindCreditsWithVirtualConfig"]>,
      ) => ReturnType<IsolatedCreditosContext["bindCreditsWithVirtualConfig"]>;
    }) {
      let config = ctx.virtualControlOn;
      if (args.control === "off") config = ctx.virtualControlOff;
      if (args.control === "future") {
        config = buildVirtualCreditosConfig({
          controlActivo: true,
          inicioEn: new Date(Date.now() + 3600_000),
        });
      }
      let binder = ctx.bindCreditsWithVirtualConfig(config);
      if (args.bindExtra) binder = args.bindExtra(binder);

      const key = args.idempotencyKey ?? newIdempotencyKey();
      const created = await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(ctx.ahora),
          vendedorId: args.vendedorId,
          idempotencyKey: key,
          lineas: args.lineas,
        },
        ctx.ahora,
        ctx.db,
        { actorRol: args.actorRol, bindCreditsStore: binder },
      );
      ctx.trackTicket(created.ticket.id);
      await ctx.refreshOwnedTicketArtifacts(created.ticket.id);
      await ctx.refreshOwnedMovimientosForVendedor(args.vendedorId);
      return { created, key };
    }

    it("saldo insuficiente: no crea ticket ni movimiento", async (t) => {
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: vendedor.id,
        importe: "3.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(vendedor.id);

      const key = newIdempotencyKey();
      await assert.rejects(
        () =>
          emitVenta({
            vendedorId: vendedor.id,
            actorRol: "VENDEDOR",
            idempotencyKey: key,
            lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "5.00" }],
          }),
        (e: unknown) => e instanceof InsufficientCreditoSaldoError,
      );

      const ticket = await ctx.db.ticket.findUnique({
        where: { idempotencyKey: key },
      });
      assert.equal(ticket, null);
      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        ctx.credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "3.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        0,
      );
    });

    it("venta + consumo + anulación + devolución atómicas e idempotentes", async (t) => {
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: vendedor.id,
        importe: "50.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(vendedor.id);

      const key = newIdempotencyKey();
      const { created } = await emitVenta({
        vendedorId: vendedor.id,
        actorRol: "VENDEDOR",
        idempotencyKey: key,
        lineas: [
          { hora: 14, numeroAnimal: ANIMAL_A, importe: "4.00" },
          { hora: 15, numeroAnimal: ANIMAL_B, importe: "6.00" },
        ],
      });
      assert.equal(created.ticket.totalApostado, "10.00");

      const replay = await createTicket(
        {
          fechaJuego: hoyYYYYMMDD(ctx.ahora),
          vendedorId: vendedor.id,
          idempotencyKey: key,
          lineas: [
            { hora: 14, numeroAnimal: ANIMAL_A, importe: "4.00" },
            { hora: 15, numeroAnimal: ANIMAL_B, importe: "6.00" },
          ],
        },
        ctx.ahora,
        ctx.db,
        {
          actorRol: "VENDEDOR",
          bindCreditsStore: ctx.bindCreditsWithVirtualConfig(
            ctx.virtualControlOn,
          ),
        },
      );
      assert.equal(replay.idempotentReplay, true);

      let hist = await consultarSaldoYHistorial(ctx.credits, vendedor.id);
      assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "40.00");
      assert.equal(
        hist.movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        1,
      );
      assertSaldoCoincideLibro(hist.cuenta!.saldoDisponible, hist.movimientos);

      await anularTicket(
        ctx.db,
        {
          id: created.ticket.id,
          motivo: "prueba créditos aislada",
          anuladoPorId: admin.id,
          ahora: ctx.ahora,
        },
        {
          bindCreditsStore: ctx.bindCreditsWithVirtualConfig(
            ctx.virtualControlOn,
          ),
        },
      );
      await ctx.refreshOwnedTicketArtifacts(created.ticket.id);
      await ctx.refreshOwnedMovimientosForVendedor(vendedor.id);

      await assert.rejects(() =>
        anularTicket(
          ctx.db,
          {
            id: created.ticket.id,
            motivo: "reintento",
            anuladoPorId: admin.id,
          },
          {
            bindCreditsStore: ctx.bindCreditsWithVirtualConfig(
              ctx.virtualControlOn,
            ),
          },
        ),
      );

      hist = await consultarSaldoYHistorial(ctx.credits, vendedor.id);
      assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "50.00");
      assert.equal(
        hist.movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION")
          .length,
        1,
      );
      assertSaldoCoincideLibro(hist.cuenta!.saldoDisponible, hist.movimientos);
    });

    it("ADMIN exento de consumo", async (t) => {
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: admin.id,
        importe: "1.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(admin.id);

      await emitVenta({
        vendedorId: admin.id,
        actorRol: "ADMIN",
        lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "20.00" }],
      });

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        ctx.credits,
        admin.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "1.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        0,
      );
    });

    it("dos ventas concurrentes no dejan saldo negativo", async (t) => {
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: vendedor.id,
        importe: "10.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(vendedor.id);

      const binder = ctx.bindCreditsWithVirtualConfig(ctx.virtualControlOn);
      const results = await Promise.allSettled([
        createTicket(
          {
            fechaJuego: hoyYYYYMMDD(ctx.ahora),
            vendedorId: vendedor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "7.00" }],
          },
          ctx.ahora,
          ctx.db,
          { actorRol: "VENDEDOR", bindCreditsStore: binder },
        ),
        createTicket(
          {
            fechaJuego: hoyYYYYMMDD(ctx.ahora),
            vendedorId: vendedor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 15, numeroAnimal: ANIMAL_B, importe: "7.00" }],
          },
          ctx.ahora,
          ctx.db,
          { actorRol: "VENDEDOR", bindCreditsStore: binder },
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

      for (const r of ok) {
        if (r.status === "fulfilled") {
          ctx.trackTicket(r.value.ticket.id);
          await ctx.refreshOwnedTicketArtifacts(r.value.ticket.id);
        }
      }
      await ctx.refreshOwnedMovimientosForVendedor(vendedor.id);

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        ctx.credits,
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
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: vendedor.id,
        importe: "30.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(vendedor.id);

      const key = newIdempotencyKey();
      const payload = {
        fechaJuego: hoyYYYYMMDD(ctx.ahora),
        vendedorId: vendedor.id,
        idempotencyKey: key,
        lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "8.00" }],
      };
      const binder = ctx.bindCreditsWithVirtualConfig(ctx.virtualControlOn);

      const results = await Promise.allSettled([
        createTicket(payload, ctx.ahora, ctx.db, {
          actorRol: "VENDEDOR",
          bindCreditsStore: binder,
        }),
        createTicket(payload, ctx.ahora, ctx.db, {
          actorRol: "VENDEDOR",
          bindCreditsStore: binder,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      assert.ok(fulfilled.length >= 1);
      const ticketId = (
        fulfilled[0] as PromiseFulfilledResult<{ ticket: { id: string } }>
      ).value.ticket.id;
      for (const r of fulfilled) {
        assert.equal(r.status, "fulfilled");
        assert.equal(r.value.ticket.id, ticketId);
      }
      ctx.trackTicket(ticketId);
      await ctx.refreshOwnedTicketArtifacts(ticketId);
      await ctx.refreshOwnedMovimientosForVendedor(vendedor.id);

      const tickets = await ctx.db.ticket.findMany({
        where: { idempotencyKey: key },
      });
      assert.equal(tickets.length, 1);

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        ctx.credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "22.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        1,
      );
      assertSaldoCoincideLibro(cuenta!.saldoDisponible, movimientos);
    });

    it("control virtual off / inicio futuro no consumen", async (t) => {
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: vendedor.id,
        importe: "20.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(vendedor.id);

      await emitVenta({
        vendedorId: vendedor.id,
        actorRol: "VENDEDOR",
        control: "off",
        lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "5.00" }],
      });
      await emitVenta({
        vendedorId: vendedor.id,
        actorRol: "VENDEDOR",
        control: "future",
        lineas: [{ hora: 15, numeroAnimal: ANIMAL_B, importe: "5.00" }],
      });

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        ctx.credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "20.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        0,
      );
    });

    it("corte exacto vía consumo explícito con config virtual", async (t) => {
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: vendedor.id,
        importe: "15.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(vendedor.id);

      const { created } = await emitVenta({
        vendedorId: vendedor.id,
        actorRol: "VENDEDOR",
        control: "off",
        lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "3.00" }],
      });

      const ticket = await ctx.db.ticket.findUniqueOrThrow({
        where: { id: created.ticket.id },
      });
      const store = wrapStoreWithVirtualConfig(
        createPrismaCreditosStore(ctx.db),
        buildVirtualCreditosConfig({
          controlActivo: true,
          inicioEn: ticket.createdAt,
        }),
      );
      const r = await consumirCreditosTrasEmitirTicket(store, {
        actorRol: "VENDEDOR",
        vendedorId: vendedor.id,
        ticketId: ticket.id,
        ticketCreatedAt: ticket.createdAt,
        totalApostado: ticket.totalApostado,
      });
      assert.equal(r.status, "consumed");
      await ctx.refreshOwnedMovimientosForVendedor(vendedor.id);

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        ctx.credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "12.00");
      assertSaldoCoincideLibro(cuenta!.saldoDisponible, movimientos);
    });

    it("fallo al insertar CONSUMO_VENTA revierte ticket y saldo", async (t) => {
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: vendedor.id,
        importe: "25.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(vendedor.id);

      const key = newIdempotencyKey();
      await assert.rejects(
        () =>
          emitVenta({
            vendedorId: vendedor.id,
            actorRol: "VENDEDOR",
            idempotencyKey: key,
            lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "4.00" }],
            bindExtra: (binder) => (tx) =>
              boomOnInsertTipo(binder(tx), "CONSUMO_VENTA"),
          }),
        /forced-fail:CONSUMO_VENTA/,
      );

      assert.equal(
        await ctx.db.ticket.findUnique({ where: { idempotencyKey: key } }),
        null,
      );
      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        ctx.credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "25.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        0,
      );
    });

    it("fallo al insertar DEVOLUCION revierte anulación", async (t) => {
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: vendedor.id,
        importe: "20.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(vendedor.id);

      const { created } = await emitVenta({
        vendedorId: vendedor.id,
        actorRol: "VENDEDOR",
        lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "6.00" }],
      });

      await assert.rejects(
        () =>
          anularTicket(
            ctx.db,
            {
              id: created.ticket.id,
              motivo: "rollback devolucion",
              anuladoPorId: admin.id,
            },
            {
              bindCreditsStore: (tx) =>
                boomOnInsertTipo(
                  ctx.bindCreditsWithVirtualConfig(ctx.virtualControlOn)(tx),
                  "DEVOLUCION_ANULACION",
                ),
            },
          ),
        /forced-fail:DEVOLUCION_ANULACION/,
      );

      const ticket = await ctx.db.ticket.findUnique({
        where: { id: created.ticket.id },
      });
      assert.equal(ticket?.estado, "EMITIDO");

      const { cuenta, movimientos } = await consultarSaldoYHistorial(
        ctx.credits,
        vendedor.id,
      );
      assert.equal(cuenta?.saldoDisponible.toFixed(2), "14.00");
      assert.equal(
        movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
        0,
      );
    });

    it("corrección sobre CONSUMO se rechaza; anulación posterior reembolsa íntegro", async (t) => {
      if (!requireCtx(t)) return;
      await asignarCreditos(ctx.credits, {
        vendedorId: vendedor.id,
        importe: "50.00",
        actorAdminId: admin.id,
      });
      await trackAfterAssign(vendedor.id);

      const histTrasAsignacion = await consultarSaldoYHistorial(
        ctx.credits,
        vendedor.id,
      );
      const saldoInicial = histTrasAsignacion.cuenta!.saldoDisponible.toFixed(2);
      assert.equal(saldoInicial, "50.00");

      const { created } = await emitVenta({
        vendedorId: vendedor.id,
        actorRol: "VENDEDOR",
        lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "8.00" }],
      });

      const histAntes = await consultarSaldoYHistorial(ctx.credits, vendedor.id);
      const consumo = histAntes.movimientos.find(
        (m) => m.tipo === "CONSUMO_VENTA" && m.ticketId === created.ticket.id,
      );
      assert.ok(consumo);

      await assert.rejects(
        () =>
          registrarCorreccionCredito(ctx.credits, {
            vendedorId: vendedor.id,
            importe: "8.00",
            efecto: "AUMENTAR",
            actorAdminId: admin.id,
            movimientoOrigenId: consumo.id,
            idempotencyKey: newIdempotencyKey(),
          }),
        (e: unknown) =>
          e instanceof CreditoValidationError &&
          e.code === "CREDITO_ORIGEN_NO_CORREGIBLE",
      );

      const histTrasRechazo = await consultarSaldoYHistorial(
        ctx.credits,
        vendedor.id,
      );
      assert.equal(
        histTrasRechazo.cuenta?.saldoDisponible.toFixed(2),
        histAntes.cuenta?.saldoDisponible.toFixed(2),
      );
      assert.equal(
        histTrasRechazo.movimientos.filter(
          (m) =>
            m.tipo === "CORRECCION" && m.movimientoOrigenId === consumo.id,
        ).length,
        0,
      );

      const anulado = await anularTicket(
        ctx.db,
        {
          id: created.ticket.id,
          motivo: "anulacion tras correccion rechazada",
          anuladoPorId: admin.id,
          ahora: ctx.ahora,
        },
        {
          bindCreditsStore: ctx.bindCreditsWithVirtualConfig(
            ctx.virtualControlOn,
          ),
        },
      );
      assert.equal(anulado.id, created.ticket.id);
      assert.equal(anulado.estado, "ANULADO");
      await ctx.refreshOwnedTicketArtifacts(created.ticket.id);
      await ctx.refreshOwnedMovimientosForVendedor(vendedor.id);

      const ticketDb = await ctx.db.ticket.findUnique({
        where: { id: created.ticket.id },
        select: { id: true, estado: true },
      });
      assert.equal(ticketDb?.estado, "ANULADO");

      const histFinal = await consultarSaldoYHistorial(ctx.credits, vendedor.id);
      const movsDelTicket = histFinal.movimientos.filter(
        (m) => m.ticketId === created.ticket.id,
      );
      assert.equal(
        movsDelTicket.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        1,
      );
      assert.equal(
        movsDelTicket.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
        1,
      );
      assert.equal(
        histFinal.movimientos.filter(
          (m) =>
            m.tipo === "CORRECCION" && m.movimientoOrigenId === consumo.id,
        ).length,
        0,
      );
      assert.equal(histFinal.cuenta?.saldoDisponible.toFixed(2), saldoInicial);
      assertSaldoCoincideLibro(
        histFinal.cuenta!.saldoDisponible,
        histFinal.movimientos,
      );
    });
  },
);
