/**
 * Integración PostgreSQL aislada — programación de resultados (Fase 3A).
 *
 * Solo vía `scripts/run-schedule-integration.ts` (`RUN_INTEGRATION=1`).
 * Excluida de `npm test` por sufijo `.integration.test.ts`.
 * No usa resetTicketDomain ni limpiezas globales.
 * No usa runAutomaticResultsPublish con reloj/día real.
 * No captura ni borra Auditoria (propiedad no demostrable sin id de creación).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  ProgramacionMaterializacionError,
  tryCreateAutomaticResult,
} from "@/lib/resultados/auto-publish";
import { reconcilePendingScheduleForPublishedSlot } from "@/lib/resultados/reconcile-pending-schedule";
import {
  cancelPendingSchedule,
  ScheduleResultDomainError,
  upsertPendingSchedule,
} from "@/lib/resultados/schedule-result";
import { createManualResult } from "@/lib/resultados/save-manual";
import {
  FECHA_SUITE,
  FECHA_SUITE_ROLLBACK,
  bootstrapScheduleIntegration,
  countProgramadoSlot,
  countResultadoSlot,
  createSecondaryScheduleAdmin,
  disconnectScheduleIntegration,
  wrapDbForceScheduleLinkCountZero,
  type ScheduleIntegrationContext,
} from "@/lib/resultados/schedule-integration-harness";

const ENABLED = process.env.RUN_INTEGRATION === "1";

/** Reloj inyectado solo para metadatos de auditoría de auto-publish (no define el día Caracas). */
const AHORA_INYECTADO = new Date(Date.UTC(2099, 10, 17, 20, 0, 0));

/** Asignación de horas 9–19: un slot por caso (colisión solo cuando es intencional). */
const HORA = {
  A_CREATE: 9,
  B_MODIFY_CANCEL: 10,
  C_MATERIALIZE: 11,
  D_MANUAL_SAME: 12,
  D_MANUAL_DIFF: 13,
  E_RECONCILE_LINK: 14,
  E_RECONCILE_SUPERSEDE: 15,
  G_CONCURRENT_SCHEDULE: 16,
  G_CONCURRENT_PUBLISH: 17,
  G_CANCEL_VS_MATERIALIZE: 18,
  G_MANUAL_VS_PENDING: 19,
  /** Caso F usa FECHA_SUITE_ROLLBACK (2099-11-18), no solapa con A–G en FECHA_SUITE. */
  F_ROLLBACK: 9,
} as const;

describe("schedule-result integración aislada (TEST DB)", { skip: !ENABLED }, () => {
  let ctx: ScheduleIntegrationContext | null = null;
  let bootstrapError: string | null = null;

  before(async () => {
    try {
      ctx = await bootstrapScheduleIntegration();
    } catch (e) {
      bootstrapError = e instanceof Error ? e.message : String(e);
      ctx = null;
    }
  });

  after(async () => {
    if (ctx?.registry.cleanupAllowed) {
      try {
        const result = await ctx.cleanupOwn();
        if (result.retainedUsers.length > 0) {
          console.log(
            "[schedule-integration] usuarios de prueba conservados (Auditoria FK Restrict); " +
              `n=${result.retainedUsers.length}. Auditorías no borradas.`,
          );
        }
      } catch (e) {
        console.error(
          "[schedule-integration] cleanupOwn falló; datos de negocio propios pueden residuales",
          e instanceof Error ? e.message : e,
        );
      }
    }
    await disconnectScheduleIntegration(ctx);
  });

  function requireCtx(): ScheduleIntegrationContext {
    if (!ctx) {
      assert.fail(
        bootstrapError ??
          "Bootstrap de schedule-integration no disponible (¿preflight?).",
      );
    }
    return ctx;
  }

  function n0(c: ScheduleIntegrationContext): string {
    return c.catalog[0]!.numero;
  }
  function n1(c: ScheduleIntegrationContext): string {
    return c.catalog[1]!.numero;
  }

  // ---------------------------------------------------------------------------
  // A — Crear programación futura
  // ---------------------------------------------------------------------------
  it("A) crea PENDIENTE sin Resultado y audita PROGRAMAR_RESULTADO", async () => {
    const c = requireCtx();
    const hora = HORA.A_CREATE;

    const created = await upsertPendingSchedule(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n0(c),
      adminUserId: c.registry.adminUserId,
    });
    assert.equal(created.action, "created");
    assert.equal(created.row.estado, "PENDIENTE");
    c.trackProgramacion(created.row.id);

    assert.equal(await countResultadoSlot(c.db, FECHA_SUITE, hora), 0);
    assert.equal(await countProgramadoSlot(c.db, FECHA_SUITE, hora), 1);

    await c.assertAuditExists({
      entidadId: created.row.id,
      accion: "PROGRAMAR_RESULTADO",
      entidad: "RESULTADO_PROGRAMADO",
    });
  });

  // ---------------------------------------------------------------------------
  // B — Modificar y cancelar
  // ---------------------------------------------------------------------------
  it("B) modifica PENDIENTE, cancela a CANCELADO y no materializa el número cancelado", async () => {
    const c = requireCtx();
    const hora = HORA.B_MODIFY_CANCEL;

    const created = await upsertPendingSchedule(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n0(c),
      adminUserId: c.registry.adminUserId,
    });
    c.trackProgramacion(created.row.id);
    await c.assertAuditExists({
      entidadId: created.row.id,
      accion: "PROGRAMAR_RESULTADO",
    });

    const updated = await upsertPendingSchedule(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n1(c),
      adminUserId: c.registry.adminUserId,
    });
    assert.equal(updated.action, "updated");
    assert.equal(updated.row.numero, n1(c));
    await c.assertAuditExists({
      entidadId: created.row.id,
      accion: "MODIFICAR_PROGRAMACION",
    });

    const cancelled = await cancelPendingSchedule(c.db, {
      fecha: FECHA_SUITE,
      hora,
      adminUserId: c.registry.adminUserId,
    });
    assert.equal(cancelled.estado, "CANCELADO");
    await c.assertAuditExists({
      entidadId: created.row.id,
      accion: "CANCELAR_PROGRAMACION",
    });

    const auto = await tryCreateAutomaticResult(
      c.db,
      { fecha: FECHA_SUITE, hora },
      AHORA_INYECTADO,
      { catalogRows: c.catalog },
    );
    assert.equal(auto.status, "created");
    assert.equal(auto.origen, "AUTOMATICO");
    c.trackResultado(auto.resultadoId);
    await c.assertAuditExists({
      entidadId: auto.resultadoId,
      accion: "CREAR_RESULTADO",
      entidad: "RESULTADO",
    });

    const sch = await c.db.resultadoProgramado.findUnique({
      where: { id: created.row.id },
    });
    assert.equal(sch?.estado, "CANCELADO");
    assert.equal(sch?.resultadoId, null);
    assert.equal(await countResultadoSlot(c.db, FECHA_SUITE, hora), 1);
  });

  // ---------------------------------------------------------------------------
  // C — Materialización automática
  // ---------------------------------------------------------------------------
  it("C) tryCreateAutomaticResult materializa PENDIENTE → PUBLICADO + resultadoId", async () => {
    const c = requireCtx();
    const hora = HORA.C_MATERIALIZE;

    const created = await upsertPendingSchedule(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n0(c),
      adminUserId: c.registry.adminUserId,
    });
    c.trackProgramacion(created.row.id);

    const auto = await tryCreateAutomaticResult(
      c.db,
      { fecha: FECHA_SUITE, hora },
      AHORA_INYECTADO,
      { catalogRows: c.catalog },
    );
    assert.equal(auto.status, "created");
    assert.equal(auto.origen, "MANUAL");
    assert.equal(auto.numero, n0(c));
    c.trackResultado(auto.resultadoId);

    const sch = await c.db.resultadoProgramado.findUnique({
      where: { id: created.row.id },
    });
    assert.equal(sch?.estado, "PUBLICADO");
    assert.equal(sch?.resultadoId, auto.resultadoId);

    const res = await c.db.resultado.findUnique({
      where: { id: auto.resultadoId },
    });
    assert.ok(res);
    assert.equal(res!.numero, n0(c));
    assert.equal(await countResultadoSlot(c.db, FECHA_SUITE, hora), 1);

    await c.assertAuditExists({
      entidadId: auto.resultadoId,
      accion: "CREAR_RESULTADO",
    });
  });

  // ---------------------------------------------------------------------------
  // D — Publicación manual
  // ---------------------------------------------------------------------------
  it("D1) createManualResult con pendiente mismo número → PUBLICADO enlazado", async () => {
    const c = requireCtx();
    const hora = HORA.D_MANUAL_SAME;

    const created = await upsertPendingSchedule(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n0(c),
      adminUserId: c.registry.adminUserId,
    });
    c.trackProgramacion(created.row.id);

    const manual = await createManualResult(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n0(c),
      adminUserId: c.registry.adminUserId,
    });
    c.trackResultado(manual.id);

    const sch = await c.db.resultadoProgramado.findUnique({
      where: { id: created.row.id },
    });
    assert.equal(sch?.estado, "PUBLICADO");
    assert.equal(sch?.resultadoId, manual.id);
    assert.equal(await countResultadoSlot(c.db, FECHA_SUITE, hora), 1);

    await c.assertAuditExists({
      entidadId: manual.id,
      accion: "CREAR_RESULTADO",
    });
  });

  it("D2) createManualResult con pendiente otro número → SUPERSEDED", async () => {
    const c = requireCtx();
    const hora = HORA.D_MANUAL_DIFF;

    const created = await upsertPendingSchedule(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n0(c),
      adminUserId: c.registry.adminUserId,
    });
    c.trackProgramacion(created.row.id);

    const manual = await createManualResult(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n1(c),
      adminUserId: c.registry.adminUserId,
    });
    c.trackResultado(manual.id);

    const sch = await c.db.resultadoProgramado.findUnique({
      where: { id: created.row.id },
    });
    assert.equal(sch?.estado, "SUPERSEDED");
    assert.equal(sch?.resultadoId, null);
    assert.equal(manual.numero, n1(c));
    assert.equal(await countResultadoSlot(c.db, FECHA_SUITE, hora), 1);
  });

  // ---------------------------------------------------------------------------
  // E — Reconciliación
  // ---------------------------------------------------------------------------
  it("E1) reconcile enlaza PENDIENTE mismo número → PUBLICADO", async () => {
    const c = requireCtx();
    const hora = HORA.E_RECONCILE_LINK;

    const res = await c.db.resultado.create({
      data: {
        fecha: FECHA_SUITE,
        hora,
        numero: n0(c),
        origen: "MANUAL",
      },
    });
    c.trackResultado(res.id);

    const sch = await c.db.resultadoProgramado.create({
      data: {
        fecha: FECHA_SUITE,
        hora,
        numero: n0(c),
        estado: "PENDIENTE",
        createdById: c.registry.adminUserId,
      },
    });
    c.trackProgramacion(sch.id);

    const r = await reconcilePendingScheduleForPublishedSlot(c.db, {
      fecha: FECHA_SUITE,
      hora,
      resultadoId: res.id,
      numero: n0(c),
    });
    assert.equal(r.linked, true);
    assert.equal(r.superseded, false);

    const after = await c.db.resultadoProgramado.findUnique({
      where: { id: sch.id },
    });
    assert.equal(after?.estado, "PUBLICADO");
    assert.equal(after?.resultadoId, res.id);
  });

  it("E2) reconcile marca PENDIENTE otro número → SUPERSEDED", async () => {
    const c = requireCtx();
    const hora = HORA.E_RECONCILE_SUPERSEDE;

    const res = await c.db.resultado.create({
      data: {
        fecha: FECHA_SUITE,
        hora,
        numero: n0(c),
        origen: "MANUAL",
      },
    });
    c.trackResultado(res.id);

    const sch = await c.db.resultadoProgramado.create({
      data: {
        fecha: FECHA_SUITE,
        hora,
        numero: n1(c),
        estado: "PENDIENTE",
        createdById: c.registry.adminUserId,
      },
    });
    c.trackProgramacion(sch.id);

    const r = await reconcilePendingScheduleForPublishedSlot(c.db, {
      fecha: FECHA_SUITE,
      hora,
      resultadoId: res.id,
      numero: n0(c),
    });
    assert.equal(r.linked, false);
    assert.equal(r.superseded, true);

    const after = await c.db.resultadoProgramado.findUnique({
      where: { id: sch.id },
    });
    assert.equal(after?.estado, "SUPERSEDED");
    assert.equal(after?.resultadoId, null);
  });

  // ---------------------------------------------------------------------------
  // F — Rollback TX determinista (PostgreSQL real vía wrapper mínimo)
  // ---------------------------------------------------------------------------
  it("F) updateMany count 0 tras create → rollback PG; luego materializa con cliente real", async () => {
    const c = requireCtx();
    const fecha = FECHA_SUITE_ROLLBACK;
    const hora = HORA.F_ROLLBACK;
    const slot = { fecha, hora };

    assert.equal(await countResultadoSlot(c.db, fecha, hora), 0);
    assert.equal(await countProgramadoSlot(c.db, fecha, hora), 0);

    const created = await upsertPendingSchedule(c.db, {
      fecha,
      hora,
      numero: n0(c),
      adminUserId: c.registry.adminUserId,
    });
    assert.equal(created.action, "created");
    assert.equal(created.row.estado, "PENDIENTE");
    assert.equal(created.row.resultadoId, null);
    c.trackProgramacion(created.row.id);

    const dbForceMiss = wrapDbForceScheduleLinkCountZero(c.db);

    await assert.rejects(
      () =>
        tryCreateAutomaticResult(dbForceMiss, slot, AHORA_INYECTADO, {
          catalogRows: c.catalog,
        }),
      (e: unknown) =>
        e instanceof ProgramacionMaterializacionError &&
        e.code === "SCHEDULE_LINK_FAILED",
    );

    // Cliente real: el INSERT de Resultado debió revertirse con la TX.
    assert.equal(await countResultadoSlot(c.db, fecha, hora), 0);
    const afterFail = await c.db.resultadoProgramado.findUnique({
      where: { id: created.row.id },
    });
    assert.ok(afterFail);
    assert.equal(afterFail!.estado, "PENDIENTE");
    assert.equal(afterFail!.resultadoId, null);

    /**
     * Auditoría: en auto-publish, `recordAuditEvent` corre en la misma TX
     * *después* del chequeo `linked.count !== 1`. Si se lanza
     * ProgramacionMaterializacionError, no se llega a auditar; el rollback
     * tampoco dejaría CREAR_RESULTADO. No hay entidadId de Resultado
     * persistido que consultar de forma segura → no se aserta auditoría
     * del intento fallido (evitar atribución falsa).
     */

    // Recuperación con cliente real (sin wrapper).
    const recovered = await tryCreateAutomaticResult(
      c.db,
      slot,
      AHORA_INYECTADO,
      { catalogRows: c.catalog },
    );
    assert.equal(recovered.status, "created");
    assert.equal(recovered.origen, "MANUAL");
    assert.equal(recovered.numero, n0(c));
    c.trackResultado(recovered.resultadoId);

    assert.equal(await countResultadoSlot(c.db, fecha, hora), 1);
    const afterOk = await c.db.resultadoProgramado.findUnique({
      where: { id: created.row.id },
    });
    assert.equal(afterOk?.estado, "PUBLICADO");
    assert.equal(afterOk?.resultadoId, recovered.resultadoId);
  });

  // ---------------------------------------------------------------------------
  // G — Concurrencia real
  // ---------------------------------------------------------------------------
  it("G1) dos programaciones concurrentes mismo slot → una fila; invariantes", async () => {
    const c = requireCtx();
    const hora = HORA.G_CONCURRENT_SCHEDULE;
    const secondary = await createSecondaryScheduleAdmin(c);

    const [a, b] = await Promise.allSettled([
      upsertPendingSchedule(c.db, {
        fecha: FECHA_SUITE,
        hora,
        numero: n0(c),
        adminUserId: c.registry.adminUserId,
      }),
      upsertPendingSchedule(c.db, {
        fecha: FECHA_SUITE,
        hora,
        numero: n1(c),
        adminUserId: secondary.id,
      }),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof upsertPendingSchedule>>
    >[];
    const rejected = [a, b].filter((r) => r.status === "rejected");

    assert.equal(await countProgramadoSlot(c.db, FECHA_SUITE, hora), 1);
    assert.equal(await countResultadoSlot(c.db, FECHA_SUITE, hora), 0);

    assert.ok(fulfilled.length >= 1);
    for (const f of fulfilled) {
      c.trackProgramacion(f.value.row.id);
    }
    for (const r of rejected) {
      const err = r.reason;
      if (err instanceof ScheduleResultDomainError) {
        assert.ok(
          err.code === "SCHEDULE_CONFLICT" ||
            err.code === "SCHEDULE_NOT_MODIFIABLE" ||
            err.code === "RESULTADO_ALREADY_PUBLISHED",
          `código inesperado: ${err.code}`,
        );
      }
    }
  });

  it("G2) dos publicaciones concurrentes mismo slot → un Resultado", async () => {
    const c = requireCtx();
    const hora = HORA.G_CONCURRENT_PUBLISH;

    const [a, b] = await Promise.all([
      tryCreateAutomaticResult(
        c.db,
        { fecha: FECHA_SUITE, hora },
        AHORA_INYECTADO,
        { catalogRows: c.catalog },
      ),
      tryCreateAutomaticResult(
        c.db,
        { fecha: FECHA_SUITE, hora },
        AHORA_INYECTADO,
        { catalogRows: c.catalog },
      ),
    ]);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["created", "skipped_exists"]);
    assert.equal(await countResultadoSlot(c.db, FECHA_SUITE, hora), 1);

    const created = a.status === "created" ? a : b.status === "created" ? b : null;
    assert.ok(created && created.status === "created");
    c.trackResultado(created.resultadoId);
  });

  it("G3) cancel ∥ materialize → CANCELADO sin resultado o PUBLICADO enlazado", async () => {
    const c = requireCtx();
    const hora = HORA.G_CANCEL_VS_MATERIALIZE;

    const created = await upsertPendingSchedule(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n0(c),
      adminUserId: c.registry.adminUserId,
    });
    c.trackProgramacion(created.row.id);

    const [cancelSettled, autoSettled] = await Promise.allSettled([
      cancelPendingSchedule(c.db, {
        fecha: FECHA_SUITE,
        hora,
        adminUserId: c.registry.adminUserId,
      }),
      tryCreateAutomaticResult(
        c.db,
        { fecha: FECHA_SUITE, hora },
        AHORA_INYECTADO,
        { catalogRows: c.catalog },
      ),
    ]);

    const sch = await c.db.resultadoProgramado.findUnique({
      where: { id: created.row.id },
    });
    assert.ok(sch);
    const resCount = await countResultadoSlot(c.db, FECHA_SUITE, hora);
    assert.ok(resCount <= 1);

    if (sch!.estado === "CANCELADO") {
      assert.equal(sch!.resultadoId, null);
      if (resCount === 1) {
        const res = await c.db.resultado.findFirst({
          where: { fecha: FECHA_SUITE, hora },
        });
        assert.ok(res);
        c.trackResultado(res!.id);
        assert.notEqual(sch!.resultadoId, res!.id);
      }
    } else if (sch!.estado === "PUBLICADO") {
      assert.ok(sch!.resultadoId);
      assert.equal(resCount, 1);
      c.trackResultado(sch!.resultadoId!);
    } else {
      assert.fail(`estado inesperado tras carrera: ${sch!.estado}`);
    }

    void cancelSettled;
    void autoSettled;
  });

  it("G4) createManualResult ∥ pendiente → un Resultado; prog. PUBLICADO o SUPERSEDED", async () => {
    const c = requireCtx();
    const hora = HORA.G_MANUAL_VS_PENDING;

    const created = await upsertPendingSchedule(c.db, {
      fecha: FECHA_SUITE,
      hora,
      numero: n0(c),
      adminUserId: c.registry.adminUserId,
    });
    c.trackProgramacion(created.row.id);

    const [manualSettled, autoSettled] = await Promise.allSettled([
      createManualResult(c.db, {
        fecha: FECHA_SUITE,
        hora,
        numero: n0(c),
        adminUserId: c.registry.adminUserId,
      }),
      tryCreateAutomaticResult(
        c.db,
        { fecha: FECHA_SUITE, hora },
        AHORA_INYECTADO,
        { catalogRows: c.catalog },
      ),
    ]);

    assert.equal(await countResultadoSlot(c.db, FECHA_SUITE, hora), 1);
    assert.equal(await countProgramadoSlot(c.db, FECHA_SUITE, hora), 1);

    const sch = await c.db.resultadoProgramado.findUnique({
      where: { id: created.row.id },
    });
    assert.ok(sch);
    assert.ok(
      sch!.estado === "PUBLICADO" || sch!.estado === "SUPERSEDED",
      `estado=${sch!.estado}`,
    );
    if (sch!.estado === "PUBLICADO") {
      assert.ok(sch!.resultadoId);
      c.trackResultado(sch!.resultadoId!);
    } else {
      const res = await c.db.resultado.findFirst({
        where: { fecha: FECHA_SUITE, hora },
      });
      assert.ok(res);
      c.trackResultado(res!.id);
    }

    if (manualSettled.status === "fulfilled") {
      c.trackResultado(manualSettled.value.id);
    }
    if (autoSettled.status === "fulfilled" && autoSettled.value.status === "created") {
      c.trackResultado(autoSettled.value.resultadoId);
    } else if (
      autoSettled.status === "fulfilled" &&
      autoSettled.value.status === "skipped_exists"
    ) {
      const res = await c.db.resultado.findFirst({
        where: { fecha: FECHA_SUITE, hora },
      });
      if (res) c.trackResultado(res.id);
    }
  });
});
