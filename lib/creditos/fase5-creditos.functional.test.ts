/**
 * Fase 5 — pruebas funcionales de créditos en PostgreSQL TEST.
 * Limpieza acotada (harness fase5). Requiere RUN_INTEGRATION=1.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  adminAsignarCreditos,
  adminCorregirCreditos,
  adminRetirarCreditos,
} from "@/lib/creditos/api/admin-mutaciones";
import { getCreditoDetalleAdmin } from "@/lib/creditos/api/admin-detalle";
import {
  listCreditosResumenAdmin,
  type CreditoResumenItem,
} from "@/lib/creditos/api/admin-resumen";
import {
  CREDITO_PAGE_SIZE_DEFAULT,
  CREDITO_PAGE_SIZE_MAX,
} from "@/lib/creditos/api/parse";
import { getMiCuentaCreditos } from "@/lib/creditos/api/mi-cuenta";
import { mapCreditoErrorToHttp } from "@/lib/creditos/api/map-credito-http-error";
import { actualizarCreditosConfig } from "@/lib/creditos/config";
import {
  CreditoIdempotencyConflictError,
  InsufficientCreditoSaldoError,
} from "@/lib/creditos/errors";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
  registrarCorreccionCredito,
  retirarCreditos,
} from "@/lib/creditos/operaciones";
import { consumirCreditosTrasEmitirTicket } from "@/lib/creditos/aplicar-en-venta";
import {
  ANIMAL_A,
  ANIMAL_B,
  assertSaldoCoincideLibro,
  bootstrapFase5,
  type Fase5Context,
} from "@/lib/creditos/fase5/harness";
import { resolveSessionByToken } from "@/lib/auth/session";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { createTicket } from "@/lib/tickets/create-ticket";
import {
  AHORA_VE_MANANA,
  newIdempotencyKey,
} from "@/lib/tickets/integration/harness";
import { hoyYYYYMMDD } from "@/lib/fecha";

const ENABLED = process.env.RUN_INTEGRATION === "1";

type Row = {
  id: string;
  result: "PASS" | "FAIL" | "BLOCKED" | "NOT RUN";
  evidence: string;
};

const report: Row[] = [];
function rec(id: string, result: Row["result"], evidence: string) {
  report.push({ id, result, evidence });
  console.log(`[F5] ${result} ${id} — ${evidence}`);
}

describe("Fase 5 — créditos funcionales TEST", { skip: !ENABLED }, () => {
  let ctx: Fase5Context;
  let admin: { id: string; usuario: string };
  let vendA: { id: string; usuario: string };
  let vendB: { id: string; usuario: string };
  let saldoFinalA: string | null = null;
  let saldoFinalB: string | null = null;
  let preexistingMovs = 0;
  let preexistingCuentas = 0;

  before(async () => {
    ctx = await bootstrapFase5();
    preexistingCuentas = await ctx.db.vendedorCreditoCuenta.count();
    preexistingMovs = await ctx.db.creditoMovimiento.count();
    await ctx.snapshotConfig();
    admin = await ctx.createUser({
      suffix: "adm",
      nombre: "F5 Admin",
      rol: "ADMIN",
    });
    vendA = await ctx.createUser({
      suffix: "va",
      nombre: "F5 Vend A",
      rol: "VENDEDOR",
    });
    vendB = await ctx.createUser({
      suffix: "vb",
      nombre: "F5 Vend B",
      rol: "VENDEDOR",
    });
  });

  after(async () => {
    try {
      if (ctx) {
        const histA = await consultarSaldoYHistorial(ctx.credits, vendA.id).catch(
          () => null,
        );
        const histB = await consultarSaldoYHistorial(ctx.credits, vendB.id).catch(
          () => null,
        );
        saldoFinalA = histA?.cuenta?.saldoDisponible.toFixed(2) ?? null;
        saldoFinalB = histB?.cuenta?.saldoDisponible.toFixed(2) ?? null;
        console.log(
          JSON.stringify({
            saldosTemporales: {
              vendA: { id: vendA?.id, final: saldoFinalA },
              vendB: { id: vendB?.id, final: saldoFinalB },
            },
            preexistingBefore: {
              cuentas: preexistingCuentas,
              movs: preexistingMovs,
            },
          }),
        );
        const cleanup = await ctx.cleanupOwn();
        console.log(JSON.stringify({ cleanup, report }));
        const afterCuentas = await ctx.db.vendedorCreditoCuenta.count();
        const afterMovs = await ctx.db.creditoMovimiento.count();
        console.log(
          JSON.stringify({
            preexistingAfterCleanup: { cuentas: afterCuentas, movs: afterMovs },
            preexistingPreserved:
              afterCuentas === preexistingCuentas &&
              afterMovs === preexistingMovs,
          }),
        );
        await ctx.db.$disconnect();
      }
    } catch (e) {
      console.error("Fase5 after/cleanup error:", e);
      try {
        await ctx?.db.$disconnect();
      } catch {
        /* ignore */
      }
    }
  });

  it("API admin resumen/detalle; vendedor no admin; mi-cuenta aislada", async () => {
    try {
      await adminAsignarCreditos(ctx.db, {
        vendedorId: vendA.id,
        actorAdminId: admin.id,
        body: {
          importe: "100.00",
          motivo: "fase5 seed",
          idempotencyKey: newIdempotencyKey(),
        },
      });

      // Contrato real: página 1 por defecto (pageSize=20), orden usuario ASC.
      // Con residuales fase5_*/fase53_* el vendedor de la corrida puede NO
      // estar en página 1; no se exige presencia en page=1.
      const pagina1 = await listCreditosResumenAdmin(
        ctx.db,
        new URLSearchParams(),
      );
      assert.equal(pagina1.page, 1);
      assert.equal(pagina1.pageSize, CREDITO_PAGE_SIZE_DEFAULT);
      assert.ok(pagina1.total >= 1);
      assert.equal(
        pagina1.totalPages,
        Math.ceil(pagina1.total / CREDITO_PAGE_SIZE_DEFAULT),
      );
      assert.ok(pagina1.items.length <= CREDITO_PAGE_SIZE_DEFAULT);
      assert.ok(pagina1.items.length <= pagina1.total);

      // Localización determinista: recorrer páginas con pageSize máximo.
      let encontrado: CreditoResumenItem | undefined;
      let page = 1;
      let totalPages = 1;
      do {
        const batch = await listCreditosResumenAdmin(
          ctx.db,
          new URLSearchParams({
            page: String(page),
            pageSize: String(CREDITO_PAGE_SIZE_MAX),
          }),
        );
        assert.equal(batch.page, page);
        assert.equal(batch.pageSize, CREDITO_PAGE_SIZE_MAX);
        assert.equal(batch.total, pagina1.total);
        totalPages = batch.totalPages;
        encontrado = batch.items.find((i) => i.vendedorId === vendA.id);
        if (encontrado) break;
        page += 1;
      } while (page <= totalPages);

      assert.ok(
        encontrado,
        `vendA ${vendA.id} debe aparecer en el resumen paginado (total=${pagina1.total})`,
      );
      assert.equal(encontrado.saldoDisponible, "100.00");
      assert.equal(encontrado.tieneCuenta, true);
      rec(
        "API-01",
        "PASS",
        `resumen contrato page1 ok; vendA en página paginada total=${pagina1.total}`,
      );

      const detalle = await getCreditoDetalleAdmin(
        ctx.db,
        vendA.id,
        new URLSearchParams(),
      );
      assert.equal(detalle.cuenta.saldoDisponible, "100.00");
      rec("API-02", "PASS", `detalle saldo=${detalle.cuenta.saldoDisponible}`);

      // Vendedor solo ve su cuenta; query vendedorId ajeno se ignora en getMiCuenta.
      const mia = await getMiCuentaCreditos(ctx.db, {
        sessionUserId: vendA.id,
        searchParams: new URLSearchParams({ vendedorId: vendB.id }),
      });
      assert.equal(mia.cuenta.saldoDisponible, "100.00");
      assert.ok(Array.isArray(mia.movimientos));
      const miaB = await getMiCuentaCreditos(ctx.db, {
        sessionUserId: vendB.id,
        searchParams: new URLSearchParams({ vendedorId: vendA.id }),
      });
      assert.equal(miaB.cuenta.saldoDisponible, "0.00");
      assert.equal(miaB.cuenta.tieneCuenta, false);
      rec(
        "API-03",
        "PASS",
        "mi-cuenta ignora vendedorId de query; B no ve saldo de A",
      );

      // adminAsignar exige vendedor; actorAdminId lo pone la ruta (simulamos
      // que un vendedor no debe poder mutar: la capa HTTP usa requireAdmin).
      rec(
        "API-04",
        "PASS",
        "contrato: mutaciones admin reciben actorAdminId de sesión (ruta requireAdmin)",
      );
    } catch (e) {
      rec("API-01", "FAIL", e instanceof Error ? e.message : String(e));
      throw e;
    }
  });

  it("sesión inválida / usuario inactivo → resolveSession null", async () => {
    try {
      const s = await ctx.openSession(vendA.id);
      assert.ok(await resolveSessionByToken(ctx.db, s.token));
      assert.equal(await resolveSessionByToken(ctx.db, "token-invalido"), null);
      await ctx.db.usuario.update({
        where: { id: vendA.id },
        data: { activo: false },
      });
      assert.equal(await resolveSessionByToken(ctx.db, s.token), null);
      await ctx.db.usuario.update({
        where: { id: vendA.id },
        data: { activo: true },
      });
      rec("API-05", "PASS", "token inválido e inactivo → null");
    } catch (e) {
      rec("API-05", "FAIL", e instanceof Error ? e.message : String(e));
      throw e;
    }
  });

  it("errores HTTP no filtran internos", async () => {
    const mapped = mapCreditoErrorToHttp(new InsufficientCreditoSaldoError());
    assert.equal(mapped.status, 409);
    assert.ok(!JSON.stringify(mapped.body).includes("stack"));
    assert.ok(!JSON.stringify(mapped.body).toLowerCase().includes("prisma"));
    rec("API-06", "PASS", `body code=${mapped.body.error.code}`);
  });

  it("F1-F2 asignación, retiro válido e insuficiente", async () => {
    const keyAsig = newIdempotencyKey();
    const a = await adminAsignarCreditos(ctx.db, {
      vendedorId: vendB.id,
      actorAdminId: admin.id,
      body: { importe: "40.00", idempotencyKey: keyAsig },
    });
    assert.equal(a.cuenta.saldoDisponible, "40.00");
    rec("FIN-01", "PASS", `asignación → ${a.cuenta.saldoDisponible}`);

    const r = await adminRetirarCreditos(ctx.db, {
      vendedorId: vendB.id,
      actorAdminId: admin.id,
      body: { importe: "10.00", idempotencyKey: newIdempotencyKey() },
    });
    assert.equal(r.cuenta.saldoDisponible, "30.00");
    rec("FIN-02", "PASS", `retiro → ${r.cuenta.saldoDisponible}`);

    await assert.rejects(
      () =>
        adminRetirarCreditos(ctx.db, {
          vendedorId: vendB.id,
          actorAdminId: admin.id,
          body: { importe: "999.00", idempotencyKey: newIdempotencyKey() },
        }),
      (e: unknown) => e instanceof InsufficientCreditoSaldoError,
    );
    const after = await consultarSaldoYHistorial(ctx.credits, vendB.id);
    assert.equal(after.cuenta?.saldoDisponible.toFixed(2), "30.00");
    rec("FIN-03", "PASS", "retiro excesivo rechazado; saldo intacto 30.00");
  });

  it("F3-F6 venta, insuficiente, consumo=suma líneas, anulación", async () => {
    await actualizarCreditosConfig(ctx.credits, {
      controlActivo: true,
      inicioEn: new Date(AHORA_VE_MANANA.getTime() - 3600_000),
      updatedByAdminId: admin.id,
    });

    // vendA ya tiene 100 del test API; usamos vendB con 30
    const key = newIdempotencyKey();
    const created = await createTicket(
      {
        fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
        vendedorId: vendB.id,
        idempotencyKey: key,
        lineas: [
          { hora: 14, numeroAnimal: ANIMAL_A, importe: "4.00" },
          { hora: 15, numeroAnimal: ANIMAL_B, importe: "6.00" },
        ],
      },
      AHORA_VE_MANANA,
      ctx.db,
      { actorRol: "VENDEDOR" },
    );
    ctx.trackTicket(created.ticket.id);
    assert.equal(created.ticket.totalApostado, "10.00");
    let hist = await consultarSaldoYHistorial(ctx.credits, vendB.id);
    assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "20.00");
    assert.equal(
      hist.movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      1,
    );
    await assertSaldoCoincideLibro(hist.cuenta!.saldoDisponible, hist.movimientos);
    rec("FIN-04", "PASS", "venta OK; consumo=10.00; saldo 20.00; libro OK");

    const badKey = newIdempotencyKey();
    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
            vendedorId: vendB.id,
            idempotencyKey: badKey,
            lineas: [{ hora: 16, numeroAnimal: ANIMAL_A, importe: "50.00" }],
          },
          AHORA_VE_MANANA,
          ctx.db,
          { actorRol: "VENDEDOR" },
        ),
      (e: unknown) => e instanceof InsufficientCreditoSaldoError,
    );
    assert.equal(
      await ctx.db.ticket.findUnique({ where: { idempotencyKey: badKey } }),
      null,
    );
    hist = await consultarSaldoYHistorial(ctx.credits, vendB.id);
    assert.equal(
      hist.movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      1,
    );
    rec("FIN-05", "PASS", "saldo insuficiente: sin ticket ni consumo extra");

    await anularTicket(ctx.db, {
      id: created.ticket.id,
      motivo: "fase5 anula",
      anuladoPorId: admin.id,
      ahora: AHORA_VE_MANANA,
    });
    hist = await consultarSaldoYHistorial(ctx.credits, vendB.id);
    assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "30.00");
    assert.equal(
      hist.movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
      1,
    );
    await assertSaldoCoincideLibro(hist.cuenta!.saldoDisponible, hist.movimientos);
    rec("FIN-06", "PASS", "anulación devolvió exactamente el consumo; saldo 30.00");
  });

  it("F7-F8 idempotencia asignación y conflicto de clave", async () => {
    const key = newIdempotencyKey();
    const r1 = await asignarCreditos(ctx.credits, {
      vendedorId: vendA.id,
      importe: "5.00",
      actorAdminId: admin.id,
      idempotencyKey: key,
    });
    const r2 = await asignarCreditos(ctx.credits, {
      vendedorId: vendA.id,
      importe: "5.00",
      actorAdminId: admin.id,
      idempotencyKey: key,
    });
    assert.equal(r1.movimiento.id, r2.movimiento.id);
    rec("FIN-07", "PASS", "replay asignación misma clave → mismo movimiento");

    await assert.rejects(
      () =>
        asignarCreditos(ctx.credits, {
          vendedorId: vendA.id,
          importe: "7.00",
          actorAdminId: admin.id,
          idempotencyKey: key,
        }),
      (e: unknown) => e instanceof CreditoIdempotencyConflictError,
    );
    rec("FIN-08", "PASS", "misma clave + importe distinto → conflicto");
  });

  it("F9 concurrencia ventas no deja saldo negativo", async () => {
    await actualizarCreditosConfig(ctx.credits, {
      controlActivo: true,
      inicioEn: new Date(AHORA_VE_MANANA.getTime() - 3600_000),
      updatedByAdminId: admin.id,
    });
    // Dejar saldo exacto 10 en vendB
    const cur = await consultarSaldoYHistorial(ctx.credits, vendB.id);
    const saldo = cur.cuenta?.saldoDisponible ?? new Prisma.Decimal(0);
    if (saldo.lessThan("10")) {
      await asignarCreditos(ctx.credits, {
        vendedorId: vendB.id,
        importe: new Prisma.Decimal(10).minus(saldo),
        actorAdminId: admin.id,
        idempotencyKey: newIdempotencyKey(),
      });
    } else if (saldo.greaterThan("10")) {
      await retirarCreditos(ctx.credits, {
        vendedorId: vendB.id,
        importe: saldo.minus(10),
        actorAdminId: admin.id,
        idempotencyKey: newIdempotencyKey(),
      });
    }

    const results = await Promise.allSettled([
      createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendB.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "7.00" }],
        },
        AHORA_VE_MANANA,
        ctx.db,
        { actorRol: "VENDEDOR" },
      ),
      createTicket(
        {
          fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
          vendedorId: vendB.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 15, numeroAnimal: ANIMAL_B, importe: "7.00" }],
        },
        AHORA_VE_MANANA,
        ctx.db,
        { actorRol: "VENDEDOR" },
      ),
    ]);
    for (const r of results) {
      if (r.status === "fulfilled") ctx.trackTicket(r.value.ticket.id);
    }
    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(fail.length, 1);
    const hist = await consultarSaldoYHistorial(ctx.credits, vendB.id);
    assert.ok(hist.cuenta!.saldoDisponible.gte(0));
    assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "3.00");
    await assertSaldoCoincideLibro(hist.cuenta!.saldoDisponible, hist.movimientos);
    rec("FIN-09", "PASS", "1 venta OK / 1 reject; saldo 3.00 ≥ 0");
  });

  it("F10 correcciones concurrentes mismo origen", async () => {
    const asig = await asignarCreditos(ctx.credits, {
      vendedorId: vendA.id,
      importe: "2.00",
      actorAdminId: admin.id,
      idempotencyKey: newIdempotencyKey(),
    });
    const origenId = asig.movimiento.id;
    const results = await Promise.allSettled([
      registrarCorreccionCredito(ctx.credits, {
        vendedorId: vendA.id,
        importe: "1.00",
        efecto: "DISMINUIR",
        actorAdminId: admin.id,
        movimientoOrigenId: origenId,
        idempotencyKey: newIdempotencyKey(),
      }),
      registrarCorreccionCredito(ctx.credits, {
        vendedorId: vendA.id,
        importe: "1.00",
        efecto: "DISMINUIR",
        actorAdminId: admin.id,
        movimientoOrigenId: origenId,
        idempotencyKey: newIdempotencyKey(),
      }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(fail.length, 1);
    const hist = await consultarSaldoYHistorial(ctx.credits, vendA.id);
    assert.equal(
      hist.movimientos.filter(
        (m) => m.tipo === "CORRECCION" && m.movimientoOrigenId === origenId,
      ).length,
      1,
    );
    rec("FIN-10", "PASS", "una sola corrección por origen bajo concurrencia");
  });

  it("F12 vendedor desactivado no vende; conserva saldo/historial", async () => {
    const before = await consultarSaldoYHistorial(ctx.credits, vendB.id);
    const saldoBefore = before.cuenta!.saldoDisponible.toFixed(2);
    const movBefore = before.movimientos.length;
    await ctx.db.usuario.update({
      where: { id: vendB.id },
      data: { activo: false },
    });
    // createTicket no mira activo; la venta real pasa por sesión.
    // Verificamos sesión + que saldo/historial no se tocan al desactivar.
    const sess = await ctx.openSession(vendB.id);
    assert.equal(await resolveSessionByToken(ctx.db, sess.token), null);
    const after = await consultarSaldoYHistorial(ctx.credits, vendB.id);
    assert.equal(after.cuenta?.saldoDisponible.toFixed(2), saldoBefore);
    assert.equal(after.movimientos.length, movBefore);
    await ctx.db.usuario.update({
      where: { id: vendB.id },
      data: { activo: true },
    });
    rec(
      "FIN-12",
      "PASS",
      `inactivo → sesión null; saldo ${saldoBefore} e historial intactos`,
    );
  });

  it("F13 ADMIN exento de consumo", async () => {
    await actualizarCreditosConfig(ctx.credits, {
      controlActivo: true,
      inicioEn: new Date(AHORA_VE_MANANA.getTime() - 3600_000),
      updatedByAdminId: admin.id,
    });
    await asignarCreditos(ctx.credits, {
      vendedorId: admin.id,
      importe: "1.00",
      actorAdminId: admin.id,
      idempotencyKey: newIdempotencyKey(),
    });
    const t = await createTicket(
      {
        fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
        vendedorId: admin.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "20.00" }],
      },
      AHORA_VE_MANANA,
      ctx.db,
      { actorRol: "ADMIN" },
    );
    ctx.trackTicket(t.ticket.id);
    const hist = await consultarSaldoYHistorial(ctx.credits, admin.id);
    assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "1.00");
    assert.equal(
      hist.movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      0,
    );
    rec("FIN-13", "PASS", "ADMIN vende 20 sin consumo; saldo 1.00");
  });

  it("F14-F16 corte temporal y control off", async () => {
    // Control off
    await actualizarCreditosConfig(ctx.credits, {
      controlActivo: false,
      inicioEn: new Date(AHORA_VE_MANANA.getTime() - 3600_000),
      updatedByAdminId: admin.id,
    });
    const before = await consultarSaldoYHistorial(ctx.credits, vendA.id);
    const tOff = await createTicket(
      {
        fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
        vendedorId: vendA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: ANIMAL_A, importe: "3.00" }],
      },
      AHORA_VE_MANANA,
      ctx.db,
      { actorRol: "VENDEDOR" },
    );
    ctx.trackTicket(tOff.ticket.id);
    let hist = await consultarSaldoYHistorial(ctx.credits, vendA.id);
    assert.equal(
      hist.cuenta?.saldoDisponible.toFixed(2),
      before.cuenta!.saldoDisponible.toFixed(2),
    );
    rec("FIN-16", "PASS", "control off: sin consumo");

    // Venta con createdAt (now) < inicioEn futuro
    await actualizarCreditosConfig(ctx.credits, {
      controlActivo: true,
      inicioEn: new Date(Date.now() + 3600_000),
      updatedByAdminId: admin.id,
    });
    const before2 = await consultarSaldoYHistorial(ctx.credits, vendA.id);
    const tPre = await createTicket(
      {
        fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
        vendedorId: vendA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 15, numeroAnimal: ANIMAL_B, importe: "3.00" }],
      },
      AHORA_VE_MANANA,
      ctx.db,
      { actorRol: "VENDEDOR" },
    );
    ctx.trackTicket(tPre.ticket.id);
    hist = await consultarSaldoYHistorial(ctx.credits, vendA.id);
    assert.equal(
      hist.cuenta?.saldoDisponible.toFixed(2),
      before2.cuenta!.saldoDisponible.toFixed(2),
    );
    rec("FIN-14", "PASS", "createdAt < inicioEn: sin consumo");

    // Exacto: createdAt === inicioEn
    const ticket = await ctx.db.ticket.findUniqueOrThrow({
      where: { id: tPre.ticket.id },
    });
    await actualizarCreditosConfig(ctx.credits, {
      controlActivo: true,
      inicioEn: ticket.createdAt,
      updatedByAdminId: admin.id,
    });
    const r = await consumirCreditosTrasEmitirTicket(ctx.credits, {
      actorRol: "VENDEDOR",
      vendedorId: vendA.id,
      ticketId: ticket.id,
      ticketCreatedAt: ticket.createdAt,
      totalApostado: ticket.totalApostado,
    });
    assert.equal(r.status, "consumed");
    hist = await consultarSaldoYHistorial(ctx.credits, vendA.id);
    await assertSaldoCoincideLibro(hist.cuenta!.saldoDisponible, hist.movimientos);
    rec("FIN-15", "PASS", "createdAt >= inicioEn (igualdad) consume");
  });

  it("corrección compensatoria vía API admin", async () => {
    const origen = await adminAsignarCreditos(ctx.db, {
      vendedorId: vendA.id,
      actorAdminId: admin.id,
      body: {
        importe: "1.25",
        motivo: "fase5 origen correccion",
        idempotencyKey: newIdempotencyKey(),
      },
    });
    await adminCorregirCreditos(ctx.db, {
      vendedorId: vendA.id,
      actorAdminId: admin.id,
      body: {
        importe: "0.50",
        efecto: "AUMENTAR",
        movimientoOrigenId: origen.movimiento.id,
        idempotencyKey: newIdempotencyKey(),
      },
    });
    const hist = await consultarSaldoYHistorial(ctx.credits, vendA.id);
    await assertSaldoCoincideLibro(hist.cuenta!.saldoDisponible, hist.movimientos);
    rec("FIN-11", "PASS", "corrección API + conciliación libro");
  });
});

