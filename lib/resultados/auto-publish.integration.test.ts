/**
 * Integración: publicación automática de resultados.
 * Solo vía `npm run test:integration` (`RUN_INTEGRATION=1`).
 * Cliente: `createIntegrationPrismaClient` tras assert de destino TEST.
 * Excluida de `npm test` por sufijo `.integration.test.ts`.
 *
 * Ownership: solo se borran Resultado cuyos IDs registró esta suite.
 * Nunca deleteMany por fecha/hora sola. Si un slot necesario está ocupado
 * por un resultado ajeno → abort diagnóstico (no se modifica).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  createIntegrationPrismaClient,
  createTestUser,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";
import {
  runAutomaticResultsPublish,
  tryCreateAutomaticResult,
  type AutoPublishRunResult,
  type AutoPublishSlotResult,
} from "@/lib/resultados/auto-publish";
import { authorizeCronRequest } from "@/lib/resultados/cron-auth";
import {
  ResultadoCorrectionRequiredError,
  correctPublishedResult,
  createManualResult,
} from "@/lib/resultados/save-manual";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import { ANIMALES_CANONICOS } from "@/lib/resultados/catalogo-animalitos-canonico";

const ENABLED = process.env.RUN_INTEGRATION === "1";

/** Mismos 38 canónicos que seed/auto-publish (no nombres genéricos). */
const ANIMALES_38 = ANIMALES_CANONICOS;

/** 2026-10-02 14:00 UTC = 10:00 America/Caracas → vencidas 09 y 10. */
const AHORA_10_VE = new Date(Date.UTC(2026, 9, 2, 14, 0, 0));
/** 2026-10-02 12:00 UTC = 08:00 America/Caracas → ninguna vencida. */
const AHORA_08_VE = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
/** 2026-10-02 20:00 UTC = 16:00 America/Caracas → vencidas 09–16. */
const AHORA_16_VE = new Date(Date.UTC(2026, 9, 2, 20, 0, 0));

const FECHA = new Date(Date.UTC(2026, 9, 2));

describe("auto-publish resultados (TEST DB)", { skip: !ENABLED }, () => {
  let db: ReturnType<typeof createIntegrationPrismaClient>;
  /** Admins creados por esta suite (cleanup acotado en after). */
  const ownedAdminIds = new Set<string>();
  /** Resultados creados por esta suite — única base de cleanup. */
  const ownedResultadoIds = new Set<string>();

  async function seedCatalogo38(): Promise<void> {
    for (const a of ANIMALES_38) {
      await db.animal.upsert({
        where: { numero: a.numero },
        update: { nombre: a.nombre },
        create: {
          numero: a.numero,
          nombre: a.nombre,
          imagen: `/animals/${a.numero}.png`,
        },
      });
    }
  }

  function trackResultadoId(id: string): void {
    ownedResultadoIds.add(id);
  }

  function trackFromSlotResult(r: AutoPublishSlotResult): void {
    if (r.status === "created") {
      trackResultadoId(r.resultadoId);
    }
  }

  function trackFromRun(run: AutoPublishRunResult): void {
    for (const r of run.results) trackFromSlotResult(r);
  }

  /**
   * Tras prepareFixtureSlots, cualquier fila en esos slots es nuestra.
   * Útil cuando skipped_exists / carrera no devuelve resultadoId.
   */
  async function claimSlotIds(horas: number[]): Promise<void> {
    const rows = await db.resultado.findMany({
      where: { fecha: FECHA, hora: { in: horas } },
      select: { id: true },
    });
    for (const r of rows) trackResultadoId(r.id);
  }

  /** Limpia únicamente IDs propios + auditorías RESULTADO ligadas. */
  async function cleanupOwnedResultados(): Promise<void> {
    const ids = [...ownedResultadoIds];
    if (ids.length === 0) return;
    await db.auditoria.deleteMany({
      where: { entidad: "RESULTADO", entidadId: { in: ids } },
    });
    await db.resultado.deleteMany({ where: { id: { in: ids } } });
    ownedResultadoIds.clear();
  }

  /**
   * Si hay Resultado preexistente (no owned) en los slots pedidos → abort.
   * No modifica ni elimina filas ajenas.
   */
  async function assertFixtureSlotsFree(horas: number[]): Promise<void> {
    const rows = await db.resultado.findMany({
      where: { fecha: FECHA, hora: { in: horas } },
      select: { id: true, hora: true, origen: true },
    });
    const foreign = rows.filter((r) => !ownedResultadoIds.has(r.id));
    if (foreign.length === 0) return;
    const detail = foreign
      .map((r) => `hora=${r.hora} id=${r.id} origen=${r.origen}`)
      .join("; ");
    throw new Error(
      `[auto-publish] ABORT: slot(s) ocupados por Resultado preexistente ` +
        `(fecha=2026-10-02). No se borran resultados ajenos. ${detail}`,
    );
  }

  async function prepareFixtureSlots(horas: number[]): Promise<void> {
    await cleanupOwnedResultados();
    await assertFixtureSlotsFree(horas);
  }

  async function trackAdmin(
    user: Awaited<ReturnType<typeof createTestUser>>,
  ): Promise<Awaited<ReturnType<typeof createTestUser>>> {
    ownedAdminIds.add(user.id);
    return user;
  }

  before(async () => {
    assertIntegrationPointsAtTestDatabase();
    db = createIntegrationPrismaClient();
    await seedMinimalBusiness(db);
    await seedCatalogo38();
  });

  beforeEach(async () => {
    assertIntegrationPointsAtTestDatabase();
    await cleanupOwnedResultados();
  });

  after(async () => {
    try {
      await cleanupOwnedResultados();
      for (const adminId of ownedAdminIds) {
        await db.auditoria.deleteMany({
          where: {
            OR: [
              { usuarioId: adminId },
              { entidad: "USUARIO", entidadId: adminId },
            ],
          },
        });
        try {
          await db.usuario.delete({ where: { id: adminId } });
        } catch {
          // FK Restrict residual: no forzar wipe global.
        }
      }
      ownedAdminIds.clear();
    } finally {
      await db.$disconnect();
    }
  });

  it("1) sorteo futuro: no genera nada antes de la hora", async () => {
    // Ninguna franja vence a las 08:00 VE; no exige slots libres.
    const run = await runAutomaticResultsPublish(db, AHORA_08_VE);
    trackFromRun(run);
    assert.equal(run.created, 0);
    assert.equal(run.processed, 0);
    assert.equal(ownedResultadoIds.size, 0);
  });

  it("2) hora llegada sin resultado: genera automático", async () => {
    await prepareFixtureSlots([9, 10]);

    const run = await runAutomaticResultsPublish(db, AHORA_10_VE);
    trackFromRun(run);
    assert.equal(run.created, 2);
    assert.equal(run.processed, 2);

    const rows = await db.resultado.findMany({
      where: { id: { in: [...ownedResultadoIds] } },
      orderBy: { hora: "asc" },
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.hora),
      [9, 10],
    );
    for (const r of rows) {
      assert.equal(r.origen, "AUTOMATICO");
      assert.ok(ANIMALES_38.some((a) => a.numero === r.numero));
    }
  });

  it("3) resultado manual se conserva", async () => {
    await prepareFixtureSlots([9, 10]);
    const admin = await createTestUser(db, {
      usuario: `adm_manual_${Date.now()}`,
      nombre: "Admin Manual",
      rol: "ADMIN",
    });

    const manual = await db.resultado.create({
      data: {
        fecha: FECHA,
        hora: 9,
        numero: "05",
        origen: "MANUAL",
      },
    });
    trackResultadoId(manual.id);

    const run = await runAutomaticResultsPublish(db, AHORA_10_VE);
    trackFromRun(run);
    assert.equal(run.created, 1);
    assert.equal(run.skippedExists, 1);

    const r9 = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: FECHA, hora: 9 } },
    });
    assert.equal(r9?.id, manual.id);
    assert.equal(r9?.numero, "05");
    assert.equal(r9?.origen, "MANUAL");
    void admin;
  });

  it("4) automático previo: no genera segundo", async () => {
    await prepareFixtureSlots([9, 10]);

    const prior = await db.resultado.create({
      data: {
        fecha: FECHA,
        hora: 9,
        numero: "15",
        origen: "AUTOMATICO",
      },
    });
    trackResultadoId(prior.id);

    const first = await runAutomaticResultsPublish(db, AHORA_10_VE);
    trackFromRun(first);
    assert.equal(first.created, 1);
    assert.equal(first.skippedExists, 1);

    const second = await runAutomaticResultsPublish(db, AHORA_10_VE);
    trackFromRun(second);
    assert.equal(second.created, 0);
    assert.equal(second.skippedExists, 2);

    const r9 = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: FECHA, hora: 9 } },
    });
    assert.equal(r9?.id, prior.id);
    assert.equal(r9?.numero, "15");
    assert.equal(r9?.origen, "AUTOMATICO");
  });

  it("5) dos ejecuciones simultáneas → un solo resultado", async () => {
    await prepareFixtureSlots([11]);

    const slot = { fecha: FECHA, hora: 11 as const };
    const [a, b] = await Promise.all([
      tryCreateAutomaticResult(db, slot, AHORA_16_VE),
      tryCreateAutomaticResult(db, slot, AHORA_16_VE),
    ]);
    trackFromSlotResult(a);
    trackFromSlotResult(b);
    await claimSlotIds([11]);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["created", "skipped_exists"]);

    const count = await db.resultado.count({
      where: { id: { in: [...ownedResultadoIds] }, hora: 11 },
    });
    assert.equal(count, 1);
  });

  it("6) manual concurrente con auto: un solo resultado, auto no pisa", async () => {
    await prepareFixtureSlots([12]);

    const slot = { fecha: FECHA, hora: 12 };

    const [manualSettled, auto] = await Promise.all([
      db.resultado
        .create({
          data: {
            fecha: FECHA,
            hora: 12,
            numero: "03",
            origen: "MANUAL",
          },
        })
        .then(
          (row) => ({ ok: true as const, row }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      tryCreateAutomaticResult(db, slot, AHORA_16_VE),
    ]);
    if (manualSettled.ok) trackResultadoId(manualSettled.row.id);
    trackFromSlotResult(auto);
    await claimSlotIds([12]);

    const row = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: FECHA, hora: 12 } },
    });
    assert.ok(row);
    assert.ok(ownedResultadoIds.has(row.id));
    assert.equal(
      await db.resultado.count({ where: { fecha: FECHA, hora: 12 } }),
      1,
    );

    // Auto nunca hace update: o crea, o salta. No puede cambiar un MANUAL a otro número.
    if (manualSettled.ok) {
      assert.equal(row.numero, "03");
      assert.equal(row.origen, "MANUAL");
      assert.equal(auto.status, "skipped_exists");
      assert.equal(auto.numero, "03");
    } else {
      // Auto insertó primero; el create MANUAL chocó con @@unique (no hay overwrite silencioso).
      assert.equal(row.origen, "AUTOMATICO");
      assert.equal(auto.status, "created");
      assert.equal(auto.numero, row.numero);
    }
  });

  it("7) recuperación tras varias horas: procesa vencidos pendientes", async () => {
    const horas = [9, 10, 11, 12, 13, 14, 15, 16];
    await prepareFixtureSlots(horas);

    const manual = await db.resultado.create({
      data: {
        fecha: FECHA,
        hora: 9,
        numero: "00",
        origen: "MANUAL",
      },
    });
    trackResultadoId(manual.id);

    const run = await runAutomaticResultsPublish(db, AHORA_16_VE);
    trackFromRun(run);
    // Vencidas 9–16 (8 franjas); 9 ya existe → 7 creadas
    assert.equal(run.processed, 8);
    assert.equal(run.created, 7);
    assert.equal(run.skippedExists, 1);

    const ownedHoras = (
      await db.resultado.findMany({
        where: { id: { in: [...ownedResultadoIds] } },
        select: { hora: true },
        orderBy: { hora: "asc" },
      })
    ).map((r) => r.hora);
    assert.deepEqual(ownedHoras, horas);
  });

  it("8) fecha America/Caracas correcta en filas creadas", async () => {
    await prepareFixtureSlots([9, 10]);
    const run = await runAutomaticResultsPublish(db, AHORA_10_VE);
    trackFromRun(run);
    assert.ok(run.created >= 1);
    for (const r of run.results) {
      if (r.status === "created") {
        assert.equal(r.fecha, "2026-10-02");
      }
    }
    const row = await db.resultado.findFirst({
      where: { id: { in: [...ownedResultadoIds] } },
    });
    assert.ok(row);
    assert.equal(fechaAYYYYMMDD(row.fecha), "2026-10-02");
  });

  it("9) resultado visible por fecha/hora (consulta pública equivalente)", async () => {
    await prepareFixtureSlots([9, 10]);
    const run = await runAutomaticResultsPublish(db, AHORA_10_VE);
    trackFromRun(run);

    const publicQuery = await db.resultado.findMany({
      where: { id: { in: [...ownedResultadoIds] } },
      include: { animal: true },
      orderBy: { hora: "asc" },
    });
    assert.equal(publicQuery.length, 2);
    assert.equal(publicQuery[0]!.hora, 9);
    assert.ok(publicQuery[0]!.animal.nombre);
    // La página pública no expone origen — el campo existe en DB pero no es requisito de UI pública.
    assert.ok(publicQuery[0]!.numero);
  });

  it("10) auditoría con origen AUTOMATICO y usuario sistema", async () => {
    await prepareFixtureSlots([9, 10]);

    const run = await runAutomaticResultsPublish(db, AHORA_10_VE);
    trackFromRun(run);

    const events = await db.auditoria.findMany({
      where: {
        accion: "CREAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: { in: [...ownedResultadoIds] },
      },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(events.length >= 2);
    for (const ev of events) {
      assert.equal(ev.usuarioId, null);
      assert.equal(ev.entidad, "RESULTADO");
      const detalle = JSON.parse(ev.detalle ?? "{}") as Record<string, unknown>;
      assert.equal(detalle.origen, "AUTOMATICO");
      assert.equal(detalle.fecha, "2026-10-02");
      assert.ok(typeof detalle.hora === "number");
      assert.ok(typeof detalle.numeroNuevo === "string");
      assert.ok(typeof detalle.generadoEn === "string");
      assert.equal(detalle.secret, undefined);
    }
  });

  it("11) animalito siempre del catálogo válido", async () => {
    await prepareFixtureSlots([9, 10, 11, 12, 13, 14, 15, 16]);
    const run = await runAutomaticResultsPublish(db, AHORA_16_VE);
    trackFromRun(run);
    const valid = new Set(ANIMALES_38.map((a) => a.numero));
    for (const r of run.results) {
      if (r.status === "created" || r.status === "skipped_exists") {
        assert.ok(valid.has(r.numero), `numero inválido: ${r.numero}`);
      }
    }
    assert.equal(run.catalogSize, 38);
  });

  it("12) endpoint interno sin autorización: denegado", () => {
    assert.equal(
      authorizeCronRequest(new Request("http://local/api/cron/resultados-automaticos"), {
        CRON_SECRET: "expected-secret",
      }),
      false,
    );
    assert.equal(
      authorizeCronRequest(
        new Request("http://local/api/cron/resultados-automaticos", {
          headers: { authorization: "Bearer wrong" },
        }),
        { CRON_SECRET: "expected-secret" },
      ),
      false,
    );
    assert.equal(
      authorizeCronRequest(
        new Request("http://local/api/cron/resultados-automaticos", {
          headers: { authorization: "Bearer expected-secret" },
        }),
        { CRON_SECRET: "expected-secret" },
      ),
      true,
    );
  });

  it("13) cron no reemplaza MANUAL ni AUTOMATICO existente", async () => {
    await prepareFixtureSlots([9, 10]);
    const m9 = await db.resultado.create({
      data: { fecha: FECHA, hora: 9, numero: "05", origen: "MANUAL" },
    });
    const m10 = await db.resultado.create({
      data: { fecha: FECHA, hora: 10, numero: "15", origen: "AUTOMATICO" },
    });
    trackResultadoId(m9.id);
    trackResultadoId(m10.id);

    const run = await runAutomaticResultsPublish(db, AHORA_10_VE);
    trackFromRun(run);
    assert.equal(run.ok, true);
    assert.equal(run.created, 0);
    assert.equal(run.failed, 0);
    assert.equal(run.skippedExists, 2);

    const r9 = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: FECHA, hora: 9 } },
    });
    const r10 = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: FECHA, hora: 10 } },
    });
    assert.equal(r9?.id, m9.id);
    assert.equal(r9?.numero, "05");
    assert.equal(r9?.origen, "MANUAL");
    assert.equal(r10?.id, m10.id);
    assert.equal(r10?.numero, "15");
    assert.equal(r10?.origen, "AUTOMATICO");
  });

  it("14) admin corrige AUTOMATICO → MANUAL con confirmación y motivo", async () => {
    await prepareFixtureSlots([13]);
    const admin = await trackAdmin(
      await createTestUser(db, {
        usuario: `adm_override_${Date.now()}`,
        nombre: "Admin Override",
        rol: "ADMIN",
      }),
    );

    const prior = await db.resultado.create({
      data: { fecha: FECHA, hora: 13, numero: "00", origen: "AUTOMATICO" },
    });
    trackResultadoId(prior.id);

    const saved = await correctPublishedResult(db, {
      fecha: FECHA,
      hora: 13,
      numero: "03",
      adminUserId: admin.id,
      confirmCorrection: true,
      motivo: "Corrección controlada en prueba de integración",
      expectedNumero: "00",
    });
    trackResultadoId(saved.id);
    assert.equal(saved.numero, "03");
    assert.equal(saved.origen, "MANUAL");

    const row = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: FECHA, hora: 13 } },
    });
    assert.equal(row?.numero, "03");
    assert.equal(row?.origen, "MANUAL");

    const audit = await db.auditoria.findFirst({
      where: { entidadId: saved.id, accion: "MODIFICAR_RESULTADO" },
    });
    assert.ok(audit);
    assert.equal(audit.usuarioId, admin.id);
    const detalle = JSON.parse(audit.detalle ?? "{}") as Record<string, unknown>;
    assert.equal(detalle.origenAnterior, "AUTOMATICO");
    assert.equal(detalle.origen, "MANUAL");
    assert.equal(detalle.motivo, "Corrección controlada en prueba de integración");
    assert.equal(detalle.correccionControlada, true);
  });

  it("15) carrera createManual + auto: un solo resultado válido", async () => {
    await prepareFixtureSlots([14]);
    const admin = await trackAdmin(
      await createTestUser(db, {
        usuario: `adm_race_${Date.now()}`,
        nombre: "Admin Race",
        rol: "ADMIN",
      }),
    );

    const slot = { fecha: FECHA, hora: 14 };
    const [manualOutcome, auto] = await Promise.all([
      createManualResult(db, {
        fecha: FECHA,
        hora: 14,
        numero: "05",
        adminUserId: admin.id,
      }).then(
        (row) => ({ ok: true as const, row }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
      tryCreateAutomaticResult(db, slot, AHORA_16_VE),
    ]);
    if (manualOutcome.ok) trackResultadoId(manualOutcome.row.id);
    trackFromSlotResult(auto);
    await claimSlotIds([14]);

    const count = await db.resultado.count({
      where: { id: { in: [...ownedResultadoIds] }, hora: 14 },
    });
    assert.equal(count, 1);

    const row = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: FECHA, hora: 14 } },
    });
    assert.ok(row);
    assert.ok(ownedResultadoIds.has(row.id));

    // create-only: si admin gana → MANUAL/05; si auto gana primero → admin recibe
    // CORRECTION_REQUIRED y la fila queda AUTOMATICO (sin update silencioso).
    if (manualOutcome.ok) {
      assert.equal(manualOutcome.row.numero, "05");
      assert.equal(manualOutcome.row.origen, "MANUAL");
      assert.equal(row.numero, "05");
      assert.equal(row.origen, "MANUAL");
    } else {
      assert.equal(row.origen, "AUTOMATICO");
      assert.ok(manualOutcome.err instanceof ResultadoCorrectionRequiredError);
    }
    assert.ok(
      auto.status === "created" || auto.status === "skipped_exists",
    );
  });
});
