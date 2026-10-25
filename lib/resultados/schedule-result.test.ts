import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { EstadoResultadoProgramado } from "@prisma/client";
import {
  ScheduleResultDomainError,
  assertHoraSorteoValida,
  assertScheduleEstadoModifiable,
  cancelPendingSchedule,
  upsertPendingSchedule,
  type ScheduleResultRow,
} from "@/lib/resultados/schedule-result";

const FECHA = new Date(Date.UTC(2026, 9, 25));

type AnimalRow = { numero: string };
type ResultadoRow = { id: string; fecha: Date; hora: number };
type AuditRow = {
  usuarioId: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle: string | null;
};

function makeFakeDb(opts?: {
  animals?: AnimalRow[];
  resultados?: ResultadoRow[];
  schedules?: ScheduleResultRow[];
  /** P2002 en create de programación. */
  createP2002?: { target?: string[]; thenSchedule?: ScheduleResultRow };
}) {
  const animals = new Map(
    (opts?.animals ?? [{ numero: "03" }, { numero: "05" }, { numero: "20" }]).map(
      (a) => [a.numero, a],
    ),
  );
  const resultados = [...(opts?.resultados ?? [])];
  const schedules = [...(opts?.schedules ?? [])];
  /** Filas insertadas por un peer concurrente; sobreviven al rollback del fake. */
  const peerCommitted: ScheduleResultRow[] = [];
  const audits: AuditRow[] = [];
  let idSeq = 1;

  const stats = { createCalls: 0, updateManyCalls: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api: any = {
    get createCalls() {
      return stats.createCalls;
    },
    set createCalls(n: number) {
      stats.createCalls = n;
    },
    get updateManyCalls() {
      return stats.updateManyCalls;
    },
    set updateManyCalls(n: number) {
      stats.updateManyCalls = n;
    },
    get schedules() {
      return schedules;
    },
    get audits() {
      return audits;
    },
    animal: {
      async findUnique(args: { where: { numero: string } }) {
        const row = animals.get(args.where.numero);
        return row ? { numero: row.numero } : null;
      },
    },
    resultado: {
      async findUnique(args: {
        where: { fecha_hora: { fecha: Date; hora: number } };
      }) {
        const row = resultados.find(
          (r) =>
            r.fecha.getTime() === args.where.fecha_hora.fecha.getTime() &&
            r.hora === args.where.fecha_hora.hora,
        );
        return row ? { id: row.id } : null;
      },
    },
    resultadoProgramado: {
      async findUnique(args: {
        where: { fecha_hora: { fecha: Date; hora: number } };
      }) {
        const row = schedules.find(
          (s) =>
            s.fecha.getTime() === args.where.fecha_hora.fecha.getTime() &&
            s.hora === args.where.fecha_hora.hora,
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
        stats.createCalls += 1;
        if (opts?.createP2002) {
          if (opts.createP2002.thenSchedule) {
            peerCommitted.push({ ...opts.createP2002.thenSchedule });
            schedules.push({ ...opts.createP2002.thenSchedule });
          }
          throw new Prisma.PrismaClientKnownRequestError("Unique", {
            code: "P2002",
            clientVersion: "test",
            meta: opts.createP2002.target
              ? { target: opts.createP2002.target }
              : {},
          });
        }
        const row: ScheduleResultRow = {
          id: `sch-${idSeq++}`,
          fecha: args.data.fecha,
          hora: args.data.hora,
          numero: args.data.numero,
          estado: args.data.estado,
          resultadoId: null,
          createdById: args.data.createdById,
        };
        schedules.push(row);
        return { ...row };
      },
      async updateMany(args: {
        where:
          | { id: string; estado: EstadoResultadoProgramado }
          | { fecha: Date; hora: number; estado: EstadoResultadoProgramado };
        data: {
          numero?: string;
          estado?: EstadoResultadoProgramado;
          resultadoId?: string | null;
        };
      }) {
        stats.updateManyCalls += 1;
        let count = 0;
        for (let i = 0; i < schedules.length; i += 1) {
          const row = schedules[i]!;
          let match = false;
          if ("id" in args.where) {
            match =
              row.id === args.where.id && row.estado === args.where.estado;
          } else {
            match =
              row.fecha.getTime() === args.where.fecha.getTime() &&
              row.hora === args.where.hora &&
              row.estado === args.where.estado;
          }
          if (!match) continue;
          schedules[i] = {
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
          };
          count += 1;
        }
        return { count };
      },
    },
    auditoria: {
      async create(args: { data: AuditRow }) {
        audits.push({ ...args.data });
        return { id: `a-${audits.length}` };
      },
    },
    async $transaction<T>(fn: (tx: typeof api) => Promise<T>) {
      const snapSchedules = schedules.map((s) => ({ ...s }));
      const snapAudits = audits.map((a) => ({ ...a }));
      try {
        return await fn(api);
      } catch (e) {
        schedules.splice(0, schedules.length, ...snapSchedules);
        for (const p of peerCommitted) {
          if (!schedules.some((s) => s.id === p.id)) schedules.push({ ...p });
        }
        audits.splice(0, audits.length, ...snapAudits);
        throw e;
      }
    },
  };

  return api;
}

describe("assertHoraSorteoValida / assertScheduleEstadoModifiable", () => {
  it("acepta horas 9–19 y rechaza fuera de rango", () => {
    assert.doesNotThrow(() => assertHoraSorteoValida(9));
    assert.doesNotThrow(() => assertHoraSorteoValida(19));
    assert.throws(
      () => assertHoraSorteoValida(8),
      (e: unknown) =>
        e instanceof ScheduleResultDomainError && e.code === "INVALID_HORA",
    );
  });

  it("bloquea estados terminales", () => {
    assert.doesNotThrow(() => assertScheduleEstadoModifiable("PENDIENTE"));
    for (const estado of [
      "PUBLICADO",
      "CANCELADO",
      "SUPERSEDED",
    ] as EstadoResultadoProgramado[]) {
      assert.throws(
        () => assertScheduleEstadoModifiable(estado),
        (e: unknown) =>
          e instanceof ScheduleResultDomainError &&
          e.code === "SCHEDULE_NOT_MODIFIABLE",
      );
    }
  });
});

describe("upsertPendingSchedule", () => {
  it("crea programación PENDIENTE y audita PROGRAMAR_RESULTADO", async () => {
    const db = makeFakeDb();
    const result = await upsertPendingSchedule(db, {
      fecha: FECHA,
      hora: 11,
      numero: "20",
      adminUserId: "admin-1",
    });
    assert.equal(result.action, "created");
    assert.equal(result.row.estado, "PENDIENTE");
    assert.equal(result.row.numero, "20");
    assert.equal(db.createCalls, 1);
    assert.equal(db.audits[0]?.accion, "PROGRAMAR_RESULTADO");
    assert.equal(db.audits[0]?.entidad, "RESULTADO_PROGRAMADO");
  });

  it("modifica el animal de una PENDIENTE existente y audita", async () => {
    const db = makeFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: FECHA,
          hora: 11,
          numero: "03",
          estado: "PENDIENTE",
          resultadoId: null,
          createdById: "admin-1",
        },
      ],
    });
    const result = await upsertPendingSchedule(db, {
      fecha: FECHA,
      hora: 11,
      numero: "20",
      adminUserId: "admin-1",
    });
    assert.equal(result.action, "updated");
    assert.equal(result.row.numero, "20");
    assert.equal(db.updateManyCalls, 1);
    assert.equal(db.audits[0]?.accion, "MODIFICAR_PROGRAMACION");
  });

  it("idempotente si el número pendiente ya coincide (sin auditoría)", async () => {
    const db = makeFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: FECHA,
          hora: 11,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
          createdById: "admin-1",
        },
      ],
    });
    const result = await upsertPendingSchedule(db, {
      fecha: FECHA,
      hora: 11,
      numero: "20",
      adminUserId: "admin-1",
    });
    assert.equal(result.action, "updated");
    assert.equal(db.updateManyCalls, 0);
    assert.equal(db.audits.length, 0);
  });

  it("rechaza si ya hay Resultado publicado", async () => {
    const db = makeFakeDb({
      resultados: [{ id: "r1", fecha: FECHA, hora: 11 }],
    });
    await assert.rejects(
      () =>
        upsertPendingSchedule(db, {
          fecha: FECHA,
          hora: 11,
          numero: "20",
          adminUserId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof ScheduleResultDomainError &&
        e.code === "RESULTADO_ALREADY_PUBLISHED",
    );
    assert.equal(db.createCalls, 0);
    assert.equal(db.audits.length, 0);
  });

  it("rechaza modificar PUBLICADO / CANCELADO / SUPERSEDED", async () => {
    for (const estado of [
      "PUBLICADO",
      "CANCELADO",
      "SUPERSEDED",
    ] as EstadoResultadoProgramado[]) {
      const db = makeFakeDb({
        schedules: [
          {
            id: `sch-${estado}`,
            fecha: FECHA,
            hora: 11,
            numero: "03",
            estado,
            resultadoId: estado === "PUBLICADO" ? "r1" : null,
            createdById: "admin-1",
          },
        ],
      });
      await assert.rejects(
        () =>
          upsertPendingSchedule(db, {
            fecha: FECHA,
            hora: 11,
            numero: "20",
            adminUserId: "admin-1",
          }),
        (e: unknown) =>
          e instanceof ScheduleResultDomainError &&
          e.code === "SCHEDULE_NOT_MODIFIABLE",
      );
    }
  });

  it("updateMany count 0 (carrera) → no audita y falla", async () => {
    const db = makeFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: FECHA,
          hora: 11,
          numero: "03",
          estado: "PENDIENTE",
          resultadoId: null,
          createdById: "admin-1",
        },
      ],
    });
    const original = db.resultadoProgramado.updateMany.bind(
      db.resultadoProgramado,
    );
    db.resultadoProgramado.updateMany = async (args: {
      where:
        | { id: string; estado: EstadoResultadoProgramado }
        | { fecha: Date; hora: number; estado: EstadoResultadoProgramado };
      data: {
        numero?: string;
        estado?: EstadoResultadoProgramado;
        resultadoId?: string | null;
      };
    }) => {
      // Simula publicación concurrente antes del update.
      db.schedules[0] = { ...db.schedules[0]!, estado: "PUBLICADO" };
      return original(args);
    };
    await assert.rejects(
      () =>
        upsertPendingSchedule(db, {
          fecha: FECHA,
          hora: 11,
          numero: "20",
          adminUserId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof ScheduleResultDomainError &&
        e.code === "SCHEDULE_NOT_MODIFIABLE",
    );
    assert.equal(db.audits.length, 0);
    assert.equal(db.schedules[0]?.numero, "03");
  });

  it("rechaza animal inexistente y hora inválida", async () => {
    const db = makeFakeDb();
    await assert.rejects(
      () =>
        upsertPendingSchedule(db, {
          fecha: FECHA,
          hora: 11,
          numero: "99",
          adminUserId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof ScheduleResultDomainError &&
        e.code === "ANIMAL_NOT_FOUND",
    );
    await assert.rejects(
      () =>
        upsertPendingSchedule(db, {
          fecha: FECHA,
          hora: 3,
          numero: "20",
          adminUserId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof ScheduleResultDomainError && e.code === "INVALID_HORA",
    );
  });

  it("mensajes sin secretos de conexión", async () => {
    const db = makeFakeDb();
    try {
      await upsertPendingSchedule(db, {
        fecha: FECHA,
        hora: 11,
        numero: "99",
        adminUserId: "admin-1",
      });
    } catch (e) {
      assert.ok(e instanceof ScheduleResultDomainError);
      assert.doesNotMatch(e.message, /postgres|neon|password|DATABASE/i);
    }
  });

  it("P2002 fecha+hora con peer PENDIENTE → SCHEDULE_CONFLICT sin auditoría", async () => {
    const db = makeFakeDb({
      createP2002: {
        target: ["fecha", "hora"],
        thenSchedule: {
          id: "sch-peer",
          fecha: FECHA,
          hora: 11,
          numero: "03",
          estado: "PENDIENTE",
          resultadoId: null,
          createdById: "other",
        },
      },
    });
    await assert.rejects(
      () =>
        upsertPendingSchedule(db, {
          fecha: FECHA,
          hora: 11,
          numero: "20",
          adminUserId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof ScheduleResultDomainError &&
        e.code === "SCHEDULE_CONFLICT",
    );
    assert.equal(db.audits.length, 0);
  });

  it("P2002 other (resultadoId) → propaga error Prisma", async () => {
    const db = makeFakeDb({
      createP2002: { target: ["resultadoId"] },
    });
    await assert.rejects(
      () =>
        upsertPendingSchedule(db, {
          fecha: FECHA,
          hora: 11,
          numero: "20",
          adminUserId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002",
    );
    assert.equal(db.audits.length, 0);
  });

  it("P2002 unknown sin peer → propaga error", async () => {
    const db = makeFakeDb({
      createP2002: { target: undefined },
    });
    await assert.rejects(
      () =>
        upsertPendingSchedule(db, {
          fecha: FECHA,
          hora: 11,
          numero: "20",
          adminUserId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002",
    );
  });
});

describe("cancelPendingSchedule", () => {
  it("cancela PENDIENTE y audita CANCELAR_PROGRAMACION", async () => {
    const db = makeFakeDb({
      schedules: [
        {
          id: "sch-1",
          fecha: FECHA,
          hora: 14,
          numero: "20",
          estado: "PENDIENTE",
          resultadoId: null,
          createdById: "admin-1",
        },
      ],
    });
    const row = await cancelPendingSchedule(db, {
      fecha: FECHA,
      hora: 14,
      adminUserId: "admin-1",
    });
    assert.equal(row.estado, "CANCELADO");
    assert.equal(db.schedules[0]?.estado, "CANCELADO");
    assert.equal(db.audits[0]?.accion, "CANCELAR_PROGRAMACION");
  });

  it("rechaza cancelar si ya no está PENDIENTE", async () => {
    for (const estado of [
      "PUBLICADO",
      "CANCELADO",
      "SUPERSEDED",
    ] as EstadoResultadoProgramado[]) {
      const db = makeFakeDb({
        schedules: [
          {
            id: `sch-${estado}`,
            fecha: FECHA,
            hora: 14,
            numero: "20",
            estado,
            resultadoId: null,
            createdById: "admin-1",
          },
        ],
      });
      await assert.rejects(
        () =>
          cancelPendingSchedule(db, {
            fecha: FECHA,
            hora: 14,
            adminUserId: "admin-1",
          }),
        (e: unknown) =>
          e instanceof ScheduleResultDomainError &&
          e.code === "SCHEDULE_NOT_MODIFIABLE",
      );
      assert.equal(db.audits.length, 0);
      assert.equal(db.schedules[0]?.estado, estado);
    }
  });
});
