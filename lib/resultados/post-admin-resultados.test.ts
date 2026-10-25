/**
 * Pruebas HTTP aisladas vía postAdminResultadosWithDeps.
 * Dobles en memoria; sin cliente Prisma de producción ni red.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import {
  ForbiddenError,
  UnauthorizedError,
} from "@/lib/auth/errors";
import type { AdminActor } from "@/lib/auth/guards";
import { ANIMALES_CANONICOS } from "@/lib/resultados/catalogo-animalitos-canonico";
import { MOTIVO_CORRECCION_MAX } from "@/lib/resultados/correction-constants";
import { postAdminResultadosWithDeps } from "@/lib/resultados/post-admin-resultados";
import {
  correctPublishedResult,
  createManualResult,
} from "@/lib/resultados/save-manual";
import {
  cancelPendingSchedule,
  upsertPendingSchedule,
  type ScheduleResultRow,
} from "@/lib/resultados/schedule-result";

const FECHA_STR = "2099-11-15";
const FECHA = new Date(Date.UTC(2099, 10, 15));
/** Fecha vencida para publicación inmediata en tests. */
const FECHA_PASADA_STR = "2020-03-10";
const HORA = 11;
const NUMERO_NUEVO = "10";
const NUMERO_ACTUAL = "05";

type Row = {
  id: string;
  fecha: Date;
  hora: number;
  numero: string;
  origen: "MANUAL" | "AUTOMATICO";
  animal: { nombre: string };
};

type AuditRow = {
  usuarioId: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle: string | null;
};

function rowKey(fecha: Date, hora: number): string {
  return `${fecha.toISOString()}|${hora}`;
}

/** Contadores de escritura — deben permanecer en 0 en rechazos. */
type WriteStats = {
  createCalls: number;
  updateManyCalls: number;
  scheduleCreateCalls: number;
  scheduleUpdateManyCalls: number;
  auditCreates: number;
  createManualCalls: number;
  correctCalls: number;
  upsertScheduleCalls: number;
  cancelScheduleCalls: number;
};

function makeFakePrisma(
  seed: Row[] = [],
  catalog: { numero: string; nombre: string }[] = ANIMALES_CANONICOS.map(
    (a) => ({ numero: a.numero, nombre: a.nombre }),
  ),
  scheduleSeed: ScheduleResultRow[] = [],
) {
  let rows = new Map<string, Row>();
  for (const r of seed) {
    rows.set(rowKey(r.fecha, r.hora), { ...r, animal: { ...r.animal } });
  }
  let schedules = new Map<string, ScheduleResultRow>();
  for (const s of scheduleSeed) {
    schedules.set(rowKey(s.fecha, s.hora), { ...s });
  }
  let audits: AuditRow[] = [];
  let scheduleIdSeq = 1;
  const stats: WriteStats = {
    createCalls: 0,
    updateManyCalls: 0,
    scheduleCreateCalls: 0,
    scheduleUpdateManyCalls: 0,
    auditCreates: 0,
    createManualCalls: 0,
    correctCalls: 0,
    upsertScheduleCalls: 0,
    cancelScheduleCalls: 0,
  };

  const animales = new Map<string, { numero: string; nombre: string }>(
    catalog.map((a) => [a.numero, { numero: a.numero, nombre: a.nombre }]),
  );

  function snapshot() {
    return {
      rows: new Map(
        [...rows.entries()].map(([k, v]) => [
          k,
          { ...v, animal: { ...v.animal } },
        ]),
      ),
      schedules: new Map(
        [...schedules.entries()].map(([k, v]) => [k, { ...v }]),
      ),
      audits: audits.map((a) => ({ ...a })),
    };
  }

  function restore(s: ReturnType<typeof snapshot>) {
    rows = s.rows;
    schedules = s.schedules;
    audits = s.audits;
  }

  const api = {
    get audits() {
      return audits;
    },
    get stats() {
      return stats;
    },
    get(fecha: Date, hora: number) {
      return rows.get(rowKey(fecha, hora)) ?? null;
    },
    getSchedule(fecha: Date, hora: number) {
      return schedules.get(rowKey(fecha, hora)) ?? null;
    },
    animal: {
      async findUnique(args: {
        where: { numero: string };
        select?: { numero: true };
      }) {
        const row = animales.get(args.where.numero);
        if (!row) return null;
        if (args.select) return { numero: row.numero };
        return { ...row };
      },
      async findMany(args: { select: { numero: true; nombre: true } }) {
        void args;
        return [...animales.values()].map((a) => ({
          numero: a.numero,
          nombre: a.nombre,
        }));
      },
    },
    resultadoProgramado: {
      async findUnique(args: {
        where: { fecha_hora: { fecha: Date; hora: number } };
      }) {
        const row = schedules.get(
          rowKey(args.where.fecha_hora.fecha, args.where.fecha_hora.hora),
        );
        return row ? { ...row } : null;
      },
      async create(args: {
        data: {
          fecha: Date;
          hora: number;
          numero: string;
          estado: "PENDIENTE";
          createdById: string;
        };
      }) {
        stats.scheduleCreateCalls += 1;
        const row: ScheduleResultRow = {
          id: `sch-${scheduleIdSeq++}`,
          fecha: args.data.fecha,
          hora: args.data.hora,
          numero: args.data.numero,
          estado: args.data.estado,
          resultadoId: null,
          createdById: args.data.createdById,
        };
        schedules.set(rowKey(row.fecha, row.hora), row);
        return { ...row };
      },
      async updateMany(args: {
        where:
          | { id: string; estado: ScheduleResultRow["estado"] }
          | {
              fecha: Date;
              hora: number;
              estado: ScheduleResultRow["estado"];
              numero?: string;
            };
        data: {
          numero?: string;
          estado?: ScheduleResultRow["estado"];
          resultadoId?: string | null;
        };
      }) {
        stats.scheduleUpdateManyCalls += 1;
        let count = 0;
        for (const [key, row] of schedules) {
          let match = false;
          if ("id" in args.where) {
            match =
              row.id === args.where.id && row.estado === args.where.estado;
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
            ...(args.data.numero !== undefined
              ? { numero: args.data.numero }
              : {}),
            ...(args.data.estado !== undefined
              ? { estado: args.data.estado }
              : {}),
            ...(args.data.resultadoId !== undefined
              ? { resultadoId: args.data.resultadoId }
              : {}),
          });
          count += 1;
        }
        return { count };
      },
    },
    resultado: {
      async create(args: {
        data: {
          fecha: Date;
          hora: number;
          numero: string;
          origen: "MANUAL" | "AUTOMATICO";
        };
        include: { animal: true };
      }) {
        stats.createCalls += 1;
        const key = rowKey(args.data.fecha, args.data.hora);
        if (rows.has(key)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        const row: Row = {
          id: `id-${args.data.hora}-${args.data.numero}`,
          fecha: args.data.fecha,
          hora: args.data.hora,
          numero: args.data.numero,
          origen: args.data.origen,
          animal: {
            nombre: animales.get(args.data.numero)?.nombre ?? `N-${args.data.numero}`,
          },
        };
        rows.set(key, row);
        return { ...row, animal: { ...row.animal } };
      },
      async findUnique(args: {
        where: { fecha_hora?: { fecha: Date; hora: number }; id?: string };
        select?: { numero?: true; id?: true; origen?: true };
        include?: { animal: true };
      }) {
        let row: Row | undefined;
        if (args.where.fecha_hora) {
          row =
            rows.get(
              rowKey(args.where.fecha_hora.fecha, args.where.fecha_hora.hora),
            ) ?? undefined;
        } else if (args.where.id) {
          row = [...rows.values()].find((r) => r.id === args.where.id);
        }
        if (!row) return null;
        if (args.select) {
          const out: Record<string, unknown> = {};
          if (args.select.id) out.id = row.id;
          if (args.select.numero) out.numero = row.numero;
          if (args.select.origen) out.origen = row.origen;
          return out;
        }
        return { ...row, animal: { ...row.animal } };
      },
      async findUniqueOrThrow(args: {
        where: { id: string };
        include: { animal: true };
      }) {
        const row = [...rows.values()].find((r) => r.id === args.where.id);
        if (!row) throw new Error("not found");
        return { ...row, animal: { ...row.animal } };
      },
      async updateMany(args: {
        where: { id: string; numero: string };
        data: { numero: string; origen: "MANUAL" };
      }) {
        stats.updateManyCalls += 1;
        const entry = [...rows.entries()].find(
          ([, r]) =>
            r.id === args.where.id && r.numero === args.where.numero,
        );
        if (!entry) return { count: 0 };
        const [key, prev] = entry;
        rows.set(key, {
          ...prev,
          numero: args.data.numero,
          origen: args.data.origen,
          animal: {
            nombre:
              animales.get(args.data.numero)?.nombre ??
              `N-${args.data.numero}`,
          },
        });
        return { count: 1 };
      },
    },
    auditoria: {
      async create(args: { data: AuditRow }) {
        stats.auditCreates += 1;
        audits.push({ ...args.data });
        return { id: `a-${audits.length}` };
      },
    },
    async $transaction<T>(fn: (tx: object) => Promise<T>): Promise<T> {
      const snap = snapshot();
      try {
        return await fn(api);
      } catch (e) {
        restore(snap);
        throw e;
      }
    },
  };

  return api;
}

function adminActor(): AdminActor {
  return {
    userId: "admin-http-test",
    source: "session",
    user: {
      id: "admin-http-test",
      usuario: "admin_test",
      nombre: "Admin Test",
      rol: "ADMIN",
      activo: true,
    },
  };
}

function seedPublicado(): Row {
  return {
    id: "r-http-1",
    fecha: FECHA,
    hora: HORA,
    numero: NUMERO_ACTUAL,
    origen: "MANUAL",
    animal: { nombre: "León" },
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://local/api/admin/resultados", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

type ErrorBody = {
  ok?: boolean;
  error?: { code?: string; message?: string; currentNumero?: string };
  resultado?: {
    hora?: number;
    numero?: string;
    nombre?: string;
    origen?: string;
  };
};

async function parseJson(res: Response): Promise<{
  status: number;
  body: ErrorBody;
}> {
  return { status: res.status, body: (await res.json()) as ErrorBody };
}

function assertNoWrites(db: ReturnType<typeof makeFakePrisma>) {
  assert.equal(db.stats.createCalls, 0, "resultado.create no debe invocarse");
  assert.equal(db.stats.updateManyCalls, 0, "updateMany no debe invocarse");
  assert.equal(db.stats.auditCreates, 0, "auditoría no debe escribirse");
  assert.equal(db.audits.length, 0);
  assert.equal(db.get(FECHA, HORA)?.numero, NUMERO_ACTUAL);
}

function assertRejected(
  status: number,
  body: ErrorBody,
  expectedStatus: number,
  code: string,
) {
  assert.equal(status, expectedStatus);
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, code);
}

function depsFor(
  db: ReturnType<typeof makeFakePrisma>,
  requireAdmin: () => Promise<AdminActor>,
) {
  const bag: {
    lastCorrectArgs: Parameters<typeof correctPublishedResult>[1] | null;
  } = { lastCorrectArgs: null };

  const deps = {
    requireAdmin,
    prisma: db as never,
    createManualResult: (async (...args: Parameters<typeof createManualResult>) => {
      db.stats.createManualCalls += 1;
      return createManualResult(...args);
    }) as typeof createManualResult,
    correctPublishedResult: (async (
      ...args: Parameters<typeof correctPublishedResult>
    ) => {
      db.stats.correctCalls += 1;
      bag.lastCorrectArgs = args[1];
      return correctPublishedResult(...args);
    }) as typeof correctPublishedResult,
    upsertPendingSchedule: (async (
      ...args: Parameters<typeof upsertPendingSchedule>
    ) => {
      db.stats.upsertScheduleCalls += 1;
      return upsertPendingSchedule(...args);
    }) as typeof upsertPendingSchedule,
    cancelPendingSchedule: (async (
      ...args: Parameters<typeof cancelPendingSchedule>
    ) => {
      db.stats.cancelScheduleCalls += 1;
      return cancelPendingSchedule(...args);
    }) as typeof cancelPendingSchedule,
  };

  return { deps, bag };
}

describe("postAdminResultadosWithDeps (HTTP aislado)", () => {
  it("el archivo de test no importa Prisma de producción", () => {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    assert.doesNotMatch(src, /from ["']@\/lib\/prisma["']/);
    assert.doesNotMatch(src, /new PrismaClient\s*\(/);
    assert.match(src, /postAdminResultadosWithDeps/);
  });

  it("confirmCorrection ausente → 409 CORRECTION_REQUIRED sin escrituras", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 409, "CORRECTION_REQUIRED");
    assert.equal(body.error?.currentNumero, NUMERO_ACTUAL);
    assert.equal(db.stats.correctCalls, 0);
    assert.equal(db.stats.createManualCalls, 0);
    assertNoWrites(db);
  });

  it("confirmCorrection false → 409 CORRECTION_REQUIRED sin escrituras", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: false,
        motivo: "no debería llegar",
        expectedNumero: NUMERO_ACTUAL,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 409, "CORRECTION_REQUIRED");
    assert.equal(db.stats.correctCalls, 0);
    assertNoWrites(db);
  });

  it('confirmCorrection string "true" → 409, no equivale a boolean true', async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: "true",
        motivo: "intento con string",
        expectedNumero: NUMERO_ACTUAL,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 409, "CORRECTION_REQUIRED");
    assert.equal(db.stats.correctCalls, 0);
    assertNoWrites(db);
  });

  it("confirmación true sin motivo → 400 MOTIVO_REQUIRED sin escrituras", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: true,
        expectedNumero: NUMERO_ACTUAL,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 400, "MOTIVO_REQUIRED");
    assert.equal(db.stats.correctCalls, 1);
    assertNoWrites(db);
  });

  it("confirmación y motivo sin expectedNumero → 400 EXPECTED_NUMERO_REQUIRED", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: true,
        motivo: "QA-HTTP-sin-expected",
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 400, "EXPECTED_NUMERO_REQUIRED");
    assert.equal(db.stats.correctCalls, 1);
    assertNoWrites(db);
  });

  it("sin sesión → 401, sin lecturas de escritura ni dominio", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => {
      throw new UnauthorizedError();
    });
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: true,
        motivo: "x",
        expectedNumero: NUMERO_ACTUAL,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 401, "UNAUTHORIZED");
    assert.equal(db.stats.correctCalls, 0);
    assert.equal(db.stats.createManualCalls, 0);
    assertNoWrites(db);
  });

  it("rol VENDEDOR → 403 sin escrituras", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => {
      throw new ForbiddenError("Se requiere rol ADMIN.");
    });
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: true,
        motivo: "x",
        expectedNumero: NUMERO_ACTUAL,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 403, "FORBIDDEN");
    assert.equal(db.stats.correctCalls, 0);
    assertNoWrites(db);
  });

  it("corrección exitosa → 200, args correctos, update + auditoría", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const motivo = "QA-HTTP-correccion-ok";
    const { deps, bag } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: true,
        motivo,
        expectedNumero: NUMERO_ACTUAL,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.resultado?.hora, HORA);
    assert.equal(body.resultado?.numero, NUMERO_NUEVO);
    assert.equal(body.resultado?.nombre, "Tigre");
    assert.equal(body.resultado?.origen, "MANUAL");

    assert.equal(db.stats.correctCalls, 1);
    assert.equal(db.stats.createManualCalls, 0);
    assert.ok(bag.lastCorrectArgs);
    assert.equal(bag.lastCorrectArgs.confirmCorrection, true);
    assert.equal(bag.lastCorrectArgs.motivo, motivo);
    assert.equal(bag.lastCorrectArgs.expectedNumero, NUMERO_ACTUAL);
    assert.equal(bag.lastCorrectArgs.numero, NUMERO_NUEVO);
    assert.equal(bag.lastCorrectArgs.hora, HORA);
    assert.equal(bag.lastCorrectArgs.adminUserId, "admin-http-test");

    assert.equal(db.get(FECHA, HORA)?.numero, NUMERO_NUEVO);
    assert.equal(db.stats.updateManyCalls, 1);
    assert.equal(db.stats.auditCreates, 1);
    assert.equal(db.audits.length, 1);
    assert.equal(db.audits[0]!.accion, "MODIFICAR_RESULTADO");
    const detalle = JSON.parse(db.audits[0]!.detalle ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(detalle.numeroAnterior, NUMERO_ACTUAL);
    assert.equal(detalle.numeroNuevo, NUMERO_NUEVO);
    assert.equal(detalle.motivo, motivo);
  });

  it("motivo de 501 caracteres → 400 MOTIVO_TOO_LONG sin escrituras", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: true,
        motivo: "x".repeat(MOTIVO_CORRECCION_MAX + 1),
        expectedNumero: NUMERO_ACTUAL,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 400, "MOTIVO_TOO_LONG");
    assert.equal(db.stats.correctCalls, 1);
    assertNoWrites(db);
  });

  it("expectedNumero desfasado → 409 RESULT_CONFLICT sin auditoría", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: true,
        motivo: "QA-HTTP-conflicto",
        expectedNumero: "00",
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 409, "RESULT_CONFLICT");
    assert.equal(body.error?.currentNumero, NUMERO_ACTUAL);
    assert.equal(db.stats.correctCalls, 1);
    assert.equal(db.stats.updateManyCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
    assert.equal(db.audits.length, 0);
    assert.equal(db.get(FECHA, HORA)?.numero, NUMERO_ACTUAL);
  });

  it("catálogo canónico → franja futura programa sin crear Resultado", async () => {
    const db = makeFakePrisma([]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
      }),
      { ...deps, ahora: new Date("2026-01-01T12:00:00.000Z") },
    );
    const { status, body } = await parseJson(res);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.resultado, undefined);
    assert.equal(
      (body as { programacion?: { numero?: string; estado?: string } })
        .programacion?.numero,
      NUMERO_NUEVO,
    );
    assert.equal(
      (body as { programacion?: { estado?: string } }).programacion?.estado,
      "PENDIENTE",
    );
    assert.equal(db.stats.createManualCalls, 0);
    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.get(FECHA, HORA), null);
    assert.equal(db.getSchedule(FECHA, HORA)?.estado, "PENDIENTE");
    assert.equal(db.audits[0]!.accion, "PROGRAMAR_RESULTADO");
  });

  it("franja vencida sin Resultado → publicación MANUAL inmediata", async () => {
    const db = makeFakePrisma([]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_PASADA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
      }),
      { ...deps, ahora: new Date("2026-10-25T18:00:00.000Z") },
    );
    const { status, body } = await parseJson(res);
    assert.equal(status, 200);
    assert.equal(body.resultado?.numero, NUMERO_NUEVO);
    assert.equal(body.resultado?.origen, "MANUAL");
    assert.equal(db.stats.createManualCalls, 1);
    assert.equal(db.audits[0]!.accion, "CREAR_RESULTADO");
  });

  it("modificar programación pendiente vía Guardar futuro", async () => {
    const db = makeFakePrisma(
      [],
      undefined,
      [
        {
          id: "sch-1",
          fecha: FECHA,
          hora: HORA,
          numero: NUMERO_ACTUAL,
          estado: "PENDIENTE",
          resultadoId: null,
          createdById: "admin-http-test",
        },
      ],
    );
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
      }),
      { ...deps, ahora: new Date("2026-01-01T12:00:00.000Z") },
    );
    const { status, body } = await parseJson(res);
    assert.equal(status, 200);
    assert.equal(db.getSchedule(FECHA, HORA)?.numero, NUMERO_NUEVO);
    assert.equal(db.audits[0]!.accion, "MODIFICAR_PROGRAMACION");
    assert.equal(
      (body as { programacion?: { action?: string } }).programacion?.action,
      "updated",
    );
  });

  it("cancelar programación pendiente", async () => {
    const db = makeFakePrisma(
      [],
      undefined,
      [
        {
          id: "sch-1",
          fecha: FECHA,
          hora: HORA,
          numero: NUMERO_ACTUAL,
          estado: "PENDIENTE",
          resultadoId: null,
          createdById: "admin-http-test",
        },
      ],
    );
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        action: "cancelProgramacion",
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assert.equal(status, 200);
    assert.equal(db.getSchedule(FECHA, HORA)?.estado, "CANCELADO");
    assert.equal(db.audits[0]!.accion, "CANCELAR_PROGRAMACION");
    assert.equal(
      (body as { programacion?: { estado?: string } }).programacion?.estado,
      "CANCELADO",
    );
  });

  it("rechaza cancelar programación ya PUBLICADO", async () => {
    const db = makeFakePrisma(
      [],
      undefined,
      [
        {
          id: "sch-1",
          fecha: FECHA,
          hora: HORA,
          numero: NUMERO_ACTUAL,
          estado: "PUBLICADO",
          resultadoId: "r1",
          createdById: "admin-http-test",
        },
      ],
    );
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        action: "cancelProgramacion",
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 409, "SCHEDULE_NOT_MODIFIABLE");
    assert.equal(db.getSchedule(FECHA, HORA)?.estado, "PUBLICADO");
    assert.equal(db.audits.length, 0);
  });

  it("rechaza programar si ya hay Resultado publicado", async () => {
    const db = makeFakePrisma([seedPublicado()]);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
      }),
      { ...deps, ahora: new Date("2026-01-01T12:00:00.000Z") },
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 409, "CORRECTION_REQUIRED");
    assert.equal(db.stats.scheduleCreateCalls, 0);
    assert.equal(db.stats.upsertScheduleCalls, 0);
  });

  it("catálogo incompleto → rechaza create sin escrituras", async () => {
    const incompleto = ANIMALES_CANONICOS.slice(0, 10).map((a) => ({
      numero: a.numero,
      nombre: a.nombre,
    }));
    const db = makeFakePrisma([], incompleto);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: "05",
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 400, "CATALOG_SIZE");
    assert.equal(db.stats.createManualCalls, 0);
    assert.equal(db.stats.correctCalls, 0);
    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
    assert.equal(db.get(FECHA, HORA), null);
  });

  it("catálogo con nombre incorrecto → rechaza create sin escrituras", async () => {
    const malo = ANIMALES_CANONICOS.map((a) =>
      a.numero === "10"
        ? { numero: a.numero, nombre: "Animal10" }
        : { numero: a.numero, nombre: a.nombre },
    );
    const db = makeFakePrisma([], malo);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 400, "CATALOG_NAME_MISMATCH");
    assert.equal(db.stats.createManualCalls, 0);
    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
  });

  it("catálogo inválido → rechaza corrección sin modificar ni auditar", async () => {
    const malo = ANIMALES_CANONICOS.map((a) =>
      a.numero === "05"
        ? { numero: a.numero, nombre: "Animal05" }
        : { numero: a.numero, nombre: a.nombre },
    );
    const db = makeFakePrisma([seedPublicado()], malo);
    const { deps } = depsFor(db, async () => adminActor());
    const res = await postAdminResultadosWithDeps(
      jsonRequest({
        fecha: FECHA_STR,
        hora: HORA,
        numero: NUMERO_NUEVO,
        confirmCorrection: true,
        motivo: "QA-catalogo-malo",
        expectedNumero: NUMERO_ACTUAL,
      }),
      deps,
    );
    const { status, body } = await parseJson(res);
    assertRejected(status, body, 400, "CATALOG_NAME_MISMATCH");
    assert.equal(db.stats.correctCalls, 0);
    assert.equal(db.stats.updateManyCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
    assert.equal(db.get(FECHA, HORA)?.numero, NUMERO_ACTUAL);
  });
});
