import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { EstadoResultadoProgramado, OrigenResultado } from "@prisma/client";
import {
  ANIMALES_CANONICOS,
  CatalogoAnimalitosInvalidoError,
} from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  classifyP2002Target,
  ProgramacionMaterializacionError,
  runAutomaticResultsPublish,
  tryCreateAutomaticResult,
} from "@/lib/resultados/auto-publish";
import type { DrawSlot } from "@/lib/resultados/pending-slots";

const SLOT: DrawSlot = {
  fecha: new Date(Date.UTC(2026, 9, 2, 4, 0, 0)),
  hora: 9,
};

type ScheduleRow = {
  id: string;
  fecha: Date;
  hora: number;
  numero: string;
  estado: EstadoResultadoProgramado;
  resultadoId: string | null;
};

type ResultadoRow = {
  id: string;
  fecha: Date;
  hora: number;
  numero: string;
  origen: OrigenResultado;
};

function slotKey(fecha: Date, hora: number): string {
  return `${fecha.toISOString()}|${hora}`;
}

function p2002(
  target: string[] | undefined,
  message = "Unique constraint",
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: "P2002",
    clientVersion: "test",
    meta: target ? { target } : {},
  });
}

function makePublishFakeDb(opts?: {
  catalog?: { numero: string; nombre: string }[];
  resultados?: ResultadoRow[];
  schedules?: ScheduleRow[];
  /**
   * Simula P2002 en create: inserta `row` (si se pasa) y lanza con el target dado.
   * Sin `row`, no queda Resultado (P2002 sin evidencia de franja).
   */
  raceOnCreate?: {
    row?: ResultadoRow;
    target?: string[];
  };
}) {
  const catalog =
    opts?.catalog ??
    ANIMALES_CANONICOS.map((a) => ({ numero: a.numero, nombre: a.nombre }));
  const resultados = new Map<string, ResultadoRow>();
  for (const r of opts?.resultados ?? []) {
    resultados.set(slotKey(r.fecha, r.hora), { ...r });
  }
  const schedules = new Map<string, ScheduleRow>();
  for (const s of opts?.schedules ?? []) {
    schedules.set(slotKey(s.fecha, s.hora), { ...s });
  }
  /** Resultados “comprometidos por otra TX”; sobreviven al rollback del fake. */
  const peerCommitted = new Map<string, ResultadoRow>();

  const stats = {
    createCalls: 0,
    auditCalls: 0,
    txCalls: 0,
    scheduleUpdateManyCalls: 0,
  };

  type CreateArgs = {
    data: {
      fecha: Date;
      hora: number;
      numero: string;
      origen: OrigenResultado;
    };
  };
  type FindSlotArgs = {
    where: { fecha_hora: { fecha: Date; hora: number } };
  };
  type UpdateManyArgs = {
    where:
      | {
          id: string;
          estado: EstadoResultadoProgramado;
          numero?: string;
        }
      | {
          fecha: Date;
          hora: number;
          estado: EstadoResultadoProgramado;
          numero?: string;
        };
    data: { estado: EstadoResultadoProgramado; resultadoId?: string };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api: any = {
    stats,
    resultados,
    schedules,
    animal: {
      async findMany() {
        return catalog.map((a) => ({ ...a }));
      },
    },
    resultado: {
      async findUnique(args: FindSlotArgs) {
        const row = resultados.get(
          slotKey(args.where.fecha_hora.fecha, args.where.fecha_hora.hora),
        );
        return row
          ? { id: row.id, numero: row.numero, origen: row.origen }
          : null;
      },
      async create(args: CreateArgs) {
        stats.createCalls += 1;
        if (opts?.raceOnCreate) {
          const race = opts.raceOnCreate;
          if (race.row) {
            const key = slotKey(race.row.fecha, race.row.hora);
            peerCommitted.set(key, { ...race.row });
            resultados.set(key, { ...race.row });
          }
          throw p2002(race.target);
        }
        const key = slotKey(args.data.fecha, args.data.hora);
        if (resultados.has(key)) {
          throw p2002(["fecha", "hora"]);
        }
        const row: ResultadoRow = {
          id: `res-${args.data.hora}-${stats.createCalls}`,
          fecha: args.data.fecha,
          hora: args.data.hora,
          numero: args.data.numero,
          origen: args.data.origen,
        };
        resultados.set(key, row);
        return { id: row.id, numero: row.numero, origen: row.origen };
      },
    },
    resultadoProgramado: {
      async findUnique(args: FindSlotArgs) {
        const row = schedules.get(
          slotKey(args.where.fecha_hora.fecha, args.where.fecha_hora.hora),
        );
        return row
          ? { id: row.id, numero: row.numero, estado: row.estado }
          : null;
      },
      async updateMany(args: UpdateManyArgs) {
        stats.scheduleUpdateManyCalls += 1;
        let count = 0;
        for (const [key, row] of schedules) {
          let match = false;
          if ("id" in args.where) {
            match =
              row.id === args.where.id && row.estado === args.where.estado;
            if (
              match &&
              args.where.numero !== undefined &&
              row.numero !== args.where.numero
            ) {
              match = false;
            }
          } else {
            match =
              row.fecha.getTime() === args.where.fecha.getTime() &&
              row.hora === args.where.hora &&
              row.estado === args.where.estado;
            if (
              match &&
              args.where.numero !== undefined &&
              row.numero !== args.where.numero
            ) {
              match = false;
            }
          }
          if (!match) continue;
          schedules.set(key, {
            ...row,
            estado: args.data.estado,
            resultadoId:
              args.data.resultadoId !== undefined
                ? args.data.resultadoId
                : row.resultadoId,
          });
          count += 1;
        }
        return { count };
      },
    },
    auditoria: {
      async create() {
        stats.auditCalls += 1;
        return {};
      },
    },
    /**
     * Simula rollback de Postgres sobre escrituras de esta TX.
     * Mutaciones externas (cancelación/cambio de número) se conservan.
     * No demuestra aislamiento real de PostgreSQL.
     */
    async $transaction<T>(fn: (tx: typeof api) => Promise<T>): Promise<T> {
      stats.txCalls += 1;
      const snapResultados = new Map(
        [...resultados.entries()].map(([k, v]) => [k, { ...v }]),
      );
      const snapSchedules = new Map(
        [...schedules.entries()].map(([k, v]) => [k, { ...v }]),
      );
      const auditBefore = stats.auditCalls;
      try {
        return await fn(api);
      } catch (err) {
        resultados.clear();
        for (const [k, v] of snapResultados) resultados.set(k, { ...v });
        for (const [k, v] of peerCommitted) resultados.set(k, { ...v });
        // Deshace solo enlaces PUBLICADO cuyo Resultado quedó revertido.
        for (const [key, row] of [...schedules.entries()]) {
          const snap = snapSchedules.get(key);
          if (
            row.estado === "PUBLICADO" &&
            row.resultadoId &&
            ![...resultados.values()].some((r) => r.id === row.resultadoId)
          ) {
            if (snap) schedules.set(key, { ...snap });
            else schedules.delete(key);
          }
        }
        stats.auditCalls = auditBefore;
        throw err;
      }
    },
  };

  return api;
}

describe("classifyP2002Target", () => {
  it("detecta target de franja fecha+hora", () => {
    assert.equal(classifyP2002Target(p2002(["fecha", "hora"])), "slot");
    assert.equal(
      classifyP2002Target(p2002(["Resultado_fecha_hora_key"])),
      "slot",
    );
  });

  it("detecta otra restricción y target ausente", () => {
    assert.equal(classifyP2002Target(p2002(["resultadoId"])), "other");
    assert.equal(classifyP2002Target(p2002(undefined)), "unknown");
  });
});

/**
 * Aísla errores por franja y validación de catálogo sin DB real.
 */
describe("tryCreateAutomaticResult — catálogo canónico", () => {
  it("catálogo inválido → rechaza sin crear ni auditar", async () => {
    const db = makePublishFakeDb({
      catalog: ANIMALES_CANONICOS.map((a) => ({
        numero: a.numero,
        nombre: a.numero === "03" ? "Animal03" : a.nombre,
      })),
    });

    await assert.rejects(
      () => tryCreateAutomaticResult(db as never, SLOT, new Date()),
      (e: unknown) =>
        e instanceof CatalogoAnimalitosInvalidoError &&
        e.code === "CATALOG_NAME_MISMATCH",
    );
    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.auditCalls, 0);
    assert.equal(db.stats.txCalls, 0);
  });

  it("catálogo canónico válido → crea AUTOMATICO y audita", async () => {
    const db = makePublishFakeDb();
    const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
    assert.equal(r.status, "created");
    if (r.status === "created") {
      assert.equal(r.origen, "AUTOMATICO");
      assert.ok(ANIMALES_CANONICOS.some((a) => a.numero === r.numero));
    }
    assert.equal(db.stats.createCalls, 1);
    assert.equal(db.stats.auditCalls, 1);
  });

  it("catalogRows inválidos (invocación directa) → rechaza sin escritura", async () => {
    const invalidRows = ANIMALES_CANONICOS.map((a) => ({
      numero: a.numero,
      nombre: a.numero === "00" ? "X" : a.nombre,
    }));
    const db = makePublishFakeDb();

    await assert.rejects(
      () =>
        tryCreateAutomaticResult(db as never, SLOT, new Date(), {
          catalogRows: invalidRows,
        }),
      CatalogoAnimalitosInvalidoError,
    );
    assert.equal(db.stats.createCalls, 0);
  });
});

describe("tryCreateAutomaticResult — programación pendiente", () => {
  it("updateMany.count===1: PENDIENTE publica MANUAL y audita", async () => {
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
    });

    const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
    assert.equal(r.status, "created");
    if (r.status === "created") {
      assert.equal(r.numero, "20");
      assert.equal(r.origen, "MANUAL");
    }
    const sch = db.schedules.get(slotKey(SLOT.fecha, SLOT.hora));
    assert.equal(sch?.estado, "PUBLICADO");
    assert.equal(sch?.resultadoId, r.status === "created" ? r.resultadoId : null);
    assert.equal(sch?.numero, "20");
    assert.equal(db.stats.createCalls, 1);
    assert.equal(db.stats.scheduleUpdateManyCalls, 1);
    assert.equal(db.stats.auditCalls, 1);
  });

  it("sin PENDIENTE → AUTOMATICO aleatorio", async () => {
    const db = makePublishFakeDb();
    const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
    assert.equal(r.status, "created");
    if (r.status === "created") {
      assert.equal(r.origen, "AUTOMATICO");
    }
    assert.equal(db.stats.scheduleUpdateManyCalls, 0);
  });

  it("CANCELADO / PUBLICADO / SUPERSEDED no se publican (cae a aleatorio)", async () => {
    for (const estado of [
      "CANCELADO",
      "PUBLICADO",
      "SUPERSEDED",
    ] as EstadoResultadoProgramado[]) {
      const db = makePublishFakeDb({
        schedules: [
          {
            id: `sch-${estado}`,
            fecha: SLOT.fecha,
            hora: SLOT.hora,
            numero: "20",
            estado,
            resultadoId: estado === "PUBLICADO" ? "old" : null,
          },
        ],
      });
      const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
      assert.equal(r.status, "created");
      if (r.status === "created") {
        assert.equal(r.origen, "AUTOMATICO");
      }
      assert.equal(
        db.schedules.get(slotKey(SLOT.fecha, SLOT.hora))?.estado,
        estado,
      );
      assert.equal(db.stats.scheduleUpdateManyCalls, 0);
    }
  });

  it("Resultado existente (manual) → skip sin tocar programación", async () => {
    const db = makePublishFakeDb({
      resultados: [
        {
          id: "res-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "03",
          origen: "MANUAL",
        },
      ],
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
    });
    const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
    assert.equal(r.status, "skipped_exists");
    if (r.status === "skipped_exists") {
      assert.equal(r.numero, "03");
      assert.equal(r.origen, "MANUAL");
    }
    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.txCalls, 0);
    assert.equal(
      db.schedules.get(slotKey(SLOT.fecha, SLOT.hora))?.estado,
      "PENDIENTE",
    );
  });

  it("updateMany.count===0 → falla, rollback sin Resultado ni auditoría", async () => {
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
    });
    const original = db.resultadoProgramado.updateMany.bind(
      db.resultadoProgramado,
    );
    db.resultadoProgramado.updateMany = async (args: {
      where: {
        id: string;
        estado: EstadoResultadoProgramado;
        numero?: string;
      };
      data: { estado: EstadoResultadoProgramado; resultadoId?: string };
    }) => {
      await original(args);
      // Fuerza count 0 tras el intento real (el rollback deshace el PUBLICADO).
      return { count: 0 };
    };

    await assert.rejects(
      () => tryCreateAutomaticResult(db as never, SLOT, new Date()),
      (e: unknown) =>
        e instanceof ProgramacionMaterializacionError &&
        e.code === "SCHEDULE_LINK_FAILED",
    );
    assert.equal(db.resultados.has(slotKey(SLOT.fecha, SLOT.hora)), false);
    assert.equal(db.stats.auditCalls, 0);
    assert.equal(
      db.schedules.get(slotKey(SLOT.fecha, SLOT.hora))?.estado,
      "PENDIENTE",
    );
  });

  it("cancelación concurrente → no queda Resultado; programación CANCELADO", async () => {
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
    });
    const originalUpdateMany = db.resultadoProgramado.updateMany.bind(
      db.resultadoProgramado,
    );
    db.resultadoProgramado.updateMany = async (args: {
      where: {
        id: string;
        estado: EstadoResultadoProgramado;
        numero?: string;
      };
      data: { estado: EstadoResultadoProgramado; resultadoId?: string };
    }) => {
      const key = slotKey(SLOT.fecha, SLOT.hora);
      const cur = db.schedules.get(key)!;
      db.schedules.set(key, { ...cur, estado: "CANCELADO" });
      return originalUpdateMany(args);
    };

    await assert.rejects(
      () => tryCreateAutomaticResult(db as never, SLOT, new Date()),
      ProgramacionMaterializacionError,
    );
    assert.equal(db.resultados.has(slotKey(SLOT.fecha, SLOT.hora)), false);
    assert.equal(db.stats.auditCalls, 0);
    assert.equal(
      db.schedules.get(slotKey(SLOT.fecha, SLOT.hora))?.estado,
      "CANCELADO",
    );
  });

  it("cambio de número concurrente → no publica número desincronizado", async () => {
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
    });
    const originalUpdateMany = db.resultadoProgramado.updateMany.bind(
      db.resultadoProgramado,
    );
    db.resultadoProgramado.updateMany = async (args: {
      where: {
        id: string;
        estado: EstadoResultadoProgramado;
        numero?: string;
      };
      data: { estado: EstadoResultadoProgramado; resultadoId?: string };
    }) => {
      const key = slotKey(SLOT.fecha, SLOT.hora);
      const cur = db.schedules.get(key)!;
      // Admin cambió el animal mientras el cron usaba "20".
      db.schedules.set(key, { ...cur, numero: "05" });
      return originalUpdateMany(args);
    };

    await assert.rejects(
      () => tryCreateAutomaticResult(db as never, SLOT, new Date()),
      ProgramacionMaterializacionError,
    );
    assert.equal(db.resultados.has(slotKey(SLOT.fecha, SLOT.hora)), false);
    assert.equal(db.stats.auditCalls, 0);
    const sch = db.schedules.get(slotKey(SLOT.fecha, SLOT.hora));
    assert.equal(sch?.estado, "PENDIENTE");
    assert.equal(sch?.numero, "05");
    assert.equal(sch?.resultadoId, null);
  });

  it("P2002 franja (target slot) + Resultado → skip idempotente y SUPERSEDED", async () => {
    const race: ResultadoRow = {
      id: "res-race",
      fecha: SLOT.fecha,
      hora: SLOT.hora,
      numero: "05",
      origen: "AUTOMATICO",
    };
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
      raceOnCreate: { row: race, target: ["fecha", "hora"] },
    });

    const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
    assert.equal(r.status, "skipped_exists");
    if (r.status === "skipped_exists") {
      assert.equal(r.numero, "05");
      assert.equal(r.origen, "AUTOMATICO");
    }
    const sch = db.schedules.get(slotKey(SLOT.fecha, SLOT.hora));
    assert.equal(sch?.estado, "SUPERSEDED");
    assert.equal(sch?.resultadoId, null);
  });

  it("P2002 meta ausente (unknown) + Resultado → skipped_exists y reconcilia huérfana", async () => {
    const race: ResultadoRow = {
      id: "res-race",
      fecha: SLOT.fecha,
      hora: SLOT.hora,
      numero: "05",
      origen: "AUTOMATICO",
    };
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
      raceOnCreate: { row: race, target: undefined },
    });

    const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
    assert.equal(r.status, "skipped_exists");
    if (r.status === "skipped_exists") {
      assert.equal(r.numero, "05");
    }
    // Reconciliación por [fecha,hora]: otro número → SUPERSEDED (no huérfana).
    assert.equal(
      db.schedules.get(slotKey(SLOT.fecha, SLOT.hora))?.estado,
      "SUPERSEDED",
    );
  });

  it("P2002 unknown + mismo número pendiente → PUBLICADO enlazado", async () => {
    const race: ResultadoRow = {
      id: "res-race",
      fecha: SLOT.fecha,
      hora: SLOT.hora,
      numero: "20",
      origen: "MANUAL",
    };
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
      raceOnCreate: { row: race, target: undefined },
    });

    const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
    assert.equal(r.status, "skipped_exists");
    const sch = db.schedules.get(slotKey(SLOT.fecha, SLOT.hora));
    assert.equal(sch?.estado, "PUBLICADO");
    assert.equal(sch?.resultadoId, "res-race");
  });

  it("P2002 meta ausente (unknown) sin Resultado → propaga y no muta", async () => {
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
      raceOnCreate: { target: undefined },
    });

    await assert.rejects(
      () => tryCreateAutomaticResult(db as never, SLOT, new Date()),
      (e: unknown) =>
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        classifyP2002Target(e) === "unknown",
    );
    assert.equal(
      db.schedules.get(slotKey(SLOT.fecha, SLOT.hora))?.estado,
      "PENDIENTE",
    );
    assert.equal(db.stats.scheduleUpdateManyCalls, 0);
  });

  it("P2002 sin Resultado existente (target slot) → no marca SUPERSEDED", async () => {
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
      raceOnCreate: { target: ["fecha", "hora"] },
    });

    await assert.rejects(
      () => tryCreateAutomaticResult(db as never, SLOT, new Date()),
      (e: unknown) =>
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002",
    );
    assert.equal(
      db.schedules.get(slotKey(SLOT.fecha, SLOT.hora))?.estado,
      "PENDIENTE",
    );
    assert.equal(db.resultados.has(slotKey(SLOT.fecha, SLOT.hora)), false);
  });

  it("P2002 slot no modifica programación que no está PENDIENTE", async () => {
    for (const estado of [
      "CANCELADO",
      "PUBLICADO",
      "SUPERSEDED",
    ] as EstadoResultadoProgramado[]) {
      const race: ResultadoRow = {
        id: `res-${estado}`,
        fecha: SLOT.fecha,
        hora: SLOT.hora,
        numero: "05",
        origen: "AUTOMATICO",
      };
      const db = makePublishFakeDb({
        schedules: [
          {
            id: `sch-${estado}`,
            fecha: SLOT.fecha,
            hora: SLOT.hora,
            numero: "20",
            estado,
            resultadoId: estado === "PUBLICADO" ? "old" : null,
          },
        ],
        raceOnCreate: { row: race, target: ["fecha", "hora"] },
      });

      const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
      assert.equal(r.status, "skipped_exists");
      assert.equal(
        db.schedules.get(slotKey(SLOT.fecha, SLOT.hora))?.estado,
        estado,
      );
    }
  });

  it("P2002 de otra restricción → no se trata como carrera de franja", async () => {
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
    });
    // Resultado visible solo tras el P2002 (pre-check lo oculta para entrar en TX).
    const hidden: ResultadoRow = {
      id: "res-hidden",
      fecha: SLOT.fecha,
      hora: SLOT.hora,
      numero: "03",
      origen: "MANUAL",
    };
    let reveal = false;
    db.resultado.findUnique = async () => {
      if (!reveal) return null;
      return { id: hidden.id, numero: hidden.numero, origen: hidden.origen };
    };
    db.resultado.create = async () => {
      db.stats.createCalls += 1;
      reveal = true;
      db.resultados.set(slotKey(SLOT.fecha, SLOT.hora), { ...hidden });
      throw p2002(["resultadoId"]);
    };

    await assert.rejects(
      () => tryCreateAutomaticResult(db as never, SLOT, new Date()),
      (e: unknown) =>
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        classifyP2002Target(e) === "other",
    );
    assert.equal(
      db.schedules.get(slotKey(SLOT.fecha, SLOT.hora))?.estado,
      "PENDIENTE",
    );
  });

  it("segunda ejecución es idempotente (ya existe Resultado)", async () => {
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
    });
    const first = await tryCreateAutomaticResult(db as never, SLOT, new Date());
    assert.equal(first.status, "created");
    const second = await tryCreateAutomaticResult(
      db as never,
      SLOT,
      new Date(),
    );
    assert.equal(second.status, "skipped_exists");
    assert.equal(db.stats.createCalls, 1);
  });

  it("rollback de enlace no deja auditoría de publicación revertida", async () => {
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: SLOT.fecha,
          hora: SLOT.hora,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
    });
    db.resultadoProgramado.updateMany = async () => {
      db.stats.scheduleUpdateManyCalls += 1;
      return { count: 0 };
    };

    await assert.rejects(
      () => tryCreateAutomaticResult(db as never, SLOT, new Date()),
      ProgramacionMaterializacionError,
    );
    assert.equal(db.stats.auditCalls, 0);
    assert.equal(db.resultados.size, 0);
  });
});

describe("runAutomaticResultsPublish — aislamiento de errores", () => {
  it("un fallo en una hora no impide procesar las demás vencidas", async () => {
    // 2026-10-02 14:00 UTC = 10:00 America/Caracas → vencidas 9 y 10
    const ahora = new Date(Date.UTC(2026, 9, 2, 14, 0, 0));
    const created: number[] = [];

    const base = makePublishFakeDb();
    base.resultado.findUnique = async (args: {
      where: { fecha_hora: { fecha: Date; hora: number } };
    }) => {
      const hora = args.where.fecha_hora.hora;
      if (hora === 10) {
        throw new Error("fallo simulado en franja 10");
      }
      return null;
    };
    const originalCreate = base.resultado.create.bind(base.resultado);
    base.resultado.create = async (args: {
      data: {
        fecha: Date;
        hora: number;
        numero: string;
        origen: OrigenResultado;
      };
    }) => {
      created.push(args.data.hora);
      return originalCreate(args);
    };

    const run = await runAutomaticResultsPublish(base as never, ahora);

    assert.equal(run.processed, 2);
    assert.equal(run.failed, 1);
    assert.equal(run.created, 1);
    assert.equal(run.ok, false);
    assert.deepEqual(created, [9]);

    const err = run.results.find((r) => r.status === "error");
    assert.ok(err && err.status === "error");
    assert.equal(err.hora, 10);
    assert.equal(err.error, "No se pudo publicar el sorteo.");
    assert.doesNotMatch(err.error, /fallo simulado|prisma|secret/i);

    const ok = run.results.find((r) => r.status === "created");
    assert.ok(ok && ok.status === "created");
    assert.equal(ok.hora, 9);
  });

  it("catálogo no canónico aborta antes de crear resultados", async () => {
    const ahora = new Date(Date.UTC(2026, 9, 2, 14, 0, 0));
    const db = makePublishFakeDb({
      catalog: ANIMALES_CANONICOS.map((a) => ({
        numero: a.numero,
        nombre: a.numero === "03" ? "Animal03" : a.nombre,
      })),
    });

    await assert.rejects(
      () => runAutomaticResultsPublish(db as never, ahora),
      (e: unknown) =>
        e instanceof CatalogoAnimalitosInvalidoError &&
        e.code === "CATALOG_NAME_MISMATCH",
    );
    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.txCalls, 0);
  });

  it("programado en franja 9 y aleatorio en 10 en la misma corrida", async () => {
    const ahora = new Date(Date.UTC(2026, 9, 2, 14, 0, 0));
    const fecha = new Date(Date.UTC(2026, 9, 2));
    const db = makePublishFakeDb({
      schedules: [
        {
          id: "sch-9",
          fecha,
          hora: 9,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
        },
      ],
    });

    const run = await runAutomaticResultsPublish(db as never, ahora);
    assert.equal(run.created, 2);
    assert.equal(run.failed, 0);
    const r9 = run.results.find((r) => r.hora === 9);
    const r10 = run.results.find((r) => r.hora === 10);
    assert.ok(r9 && r9.status === "created");
    assert.equal(r9.numero, "20");
    assert.equal(r9.origen, "MANUAL");
    assert.ok(r10 && r10.status === "created");
    assert.equal(r10.origen, "AUTOMATICO");
  });
});
