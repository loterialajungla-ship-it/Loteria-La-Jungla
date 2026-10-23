import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  ANIMALES_CANONICOS,
  CatalogoAnimalitosInvalidoError,
} from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  MOTIVO_CORRECCION_MAX,
  ResultadoCorrectionConflictError,
  ResultadoCorrectionRequiredError,
  ResultadoCorrectionValidationError,
  correctPublishedResult,
  createManualResult,
  normalizeMotivoCorreccion,
} from "@/lib/resultados/save-manual";

const FECHA = new Date(Date.UTC(2026, 9, 18));

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

function makeFakeDb(
  seed: Row[] = [],
  catalog: { numero: string; nombre: string }[] = ANIMALES_CANONICOS.map(
    (a) => ({ numero: a.numero, nombre: a.nombre }),
  ),
) {
  let rows = new Map<string, Row>();
  for (const r of seed) {
    rows.set(rowKey(r.fecha, r.hora), { ...r, animal: { ...r.animal } });
  }
  let audits: AuditRow[] = [];
  let failAudit = false;
  /** Simula otra TX que cambia `numero` justo antes del CAS updateMany. */
  let casRaceNumero: string | null = null;
  const stats = { createCalls: 0, updateManyCalls: 0, auditCreates: 0 };
  const nombrePorNumero = new Map(catalog.map((a) => [a.numero, a.nombre]));

  function snapshot() {
    return {
      rows: new Map(
        [...rows.entries()].map(([k, v]) => [
          k,
          { ...v, animal: { ...v.animal } },
        ]),
      ),
      audits: audits.map((a) => ({ ...a })),
    };
  }

  function restore(s: ReturnType<typeof snapshot>) {
    rows = s.rows;
    audits = s.audits;
  }

  const api = {
    get audits() {
      return audits;
    },
    get stats() {
      return stats;
    },
    setFailAudit(v: boolean) {
      failAudit = v;
    },
    /** Antes del próximo updateMany, muta el número de la fila (carrera). */
    setCasRace(numero: string) {
      casRaceNumero = numero;
    },
    get(fecha: Date, hora: number) {
      return rows.get(rowKey(fecha, hora)) ?? null;
    },
    animal: {
      async findMany(_args: { select: { numero: true; nombre: true } }) {
        return catalog.map((a) => ({ numero: a.numero, nombre: a.nombre }));
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
            nombre:
              nombrePorNumero.get(args.data.numero) ??
              `Animal-${args.data.numero}`,
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
        if (casRaceNumero != null) {
          const raced = casRaceNumero;
          casRaceNumero = null;
          const raceEntry = [...rows.entries()].find(
            ([, r]) => r.id === args.where.id,
          );
          if (raceEntry) {
            const [key, prev] = raceEntry;
            rows.set(key, {
              ...prev,
              numero: raced,
              origen: "MANUAL",
              animal: {
                nombre: nombrePorNumero.get(raced) ?? `Animal-${raced}`,
              },
            });
          }
        }

        const entry = [...rows.entries()].find(
          ([, r]) =>
            r.id === args.where.id && r.numero === args.where.numero,
        );
        if (!entry) {
          return { count: 0 };
        }
        const [key, prev] = entry;
        rows.set(key, {
          ...prev,
          numero: args.data.numero,
          origen: args.data.origen,
          animal: {
            nombre:
              nombrePorNumero.get(args.data.numero) ??
              `Animal-${args.data.numero}`,
          },
        });
        return { count: 1 };
      },
    },
    auditoria: {
      async create(args: { data: AuditRow }) {
        stats.auditCreates += 1;
        if (failAudit) throw new Error("audit write failed");
        audits.push({ ...args.data });
        return { id: `a-${audits.length}` };
      },
    },
    async $transaction<T>(fn: (tx: typeof api) => Promise<T>): Promise<T> {
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

describe("normalizeMotivoCorreccion", () => {
  it("recorta espacios y rechaza vacío", () => {
    assert.equal(
      normalizeMotivoCorreccion("  Error de digitación  "),
      "Error de digitación",
    );
    assert.throws(
      () => normalizeMotivoCorreccion("   "),
      (e: unknown) =>
        e instanceof ResultadoCorrectionValidationError &&
        e.code === "MOTIVO_REQUIRED",
    );
    assert.throws(
      () => normalizeMotivoCorreccion(null),
      ResultadoCorrectionValidationError,
    );
  });

  it("rechaza motivo demasiado largo", () => {
    assert.throws(
      () => normalizeMotivoCorreccion("x".repeat(MOTIVO_CORRECCION_MAX + 1)),
      (e: unknown) =>
        e instanceof ResultadoCorrectionValidationError &&
        e.code === "MOTIVO_TOO_LONG",
    );
  });
});

describe("createManualResult", () => {
  it("crea MANUAL y audita CREAR_RESULTADO", async () => {
    const db = makeFakeDb();
    const row = await createManualResult(db as never, {
      fecha: FECHA,
      hora: 14,
      numero: "03",
      adminUserId: "admin-1",
    });
    assert.equal(row.numero, "03");
    assert.equal(row.origen, "MANUAL");
    assert.equal(db.audits.length, 1);
    assert.equal(db.audits[0]!.accion, "CREAR_RESULTADO");
  });

  it("catálogo inválido → rechaza sin crear ni auditar", async () => {
    const invalidCatalog = ANIMALES_CANONICOS.map((a) => ({
      numero: a.numero,
      nombre: a.numero === "03" ? "Animal03" : a.nombre,
    }));
    const db = makeFakeDb([], invalidCatalog);

    await assert.rejects(
      () =>
        createManualResult(db as never, {
          fecha: FECHA,
          hora: 14,
          numero: "03",
          adminUserId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof CatalogoAnimalitosInvalidoError &&
        e.code === "CATALOG_NAME_MISMATCH",
    );

    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
    assert.equal(db.audits.length, 0);
    assert.equal(db.get(FECHA, 14), null);
  });

  it("si ya existe no actualiza: CORRECTION_REQUIRED", async () => {
    const db = makeFakeDb([
      {
        id: "r1",
        fecha: FECHA,
        hora: 14,
        numero: "05",
        origen: "AUTOMATICO",
        animal: { nombre: "León" },
      },
    ]);
    await assert.rejects(
      () =>
        createManualResult(db as never, {
          fecha: FECHA,
          hora: 14,
          numero: "03",
          adminUserId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof ResultadoCorrectionRequiredError &&
        e.currentNumero === "05",
    );
    assert.equal(db.get(FECHA, 14)?.numero, "05");
    assert.equal(db.audits.length, 0);
  });
});

describe("correctPublishedResult", () => {
  it("catálogo inválido → rechaza sin actualizar ni auditar", async () => {
    const invalidCatalog = ANIMALES_CANONICOS.map((a) => ({
      numero: a.numero,
      nombre: a.numero === "00" ? "NombreMal" : a.nombre,
    }));
    const db = makeFakeDb(
      [
        {
          id: "r1",
          fecha: FECHA,
          hora: 10,
          numero: "03",
          origen: "MANUAL",
          animal: { nombre: "Ciempiés" },
        },
      ],
      invalidCatalog,
    );

    await assert.rejects(
      () =>
        correctPublishedResult(db as never, {
          fecha: FECHA,
          hora: 10,
          numero: "05",
          adminUserId: "a1",
          confirmCorrection: true,
          motivo: "Corrección con catálogo roto",
          expectedNumero: "03",
        }),
      (e: unknown) =>
        e instanceof CatalogoAnimalitosInvalidoError &&
        e.code === "CATALOG_NAME_MISMATCH",
    );

    assert.equal(db.stats.updateManyCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
    assert.equal(db.audits.length, 0);
    assert.equal(db.get(FECHA, 10)?.numero, "03");
  });

  it("exige confirmación y motivo", async () => {
    const db = makeFakeDb([
      {
        id: "r1",
        fecha: FECHA,
        hora: 10,
        numero: "03",
        origen: "MANUAL",
        animal: { nombre: "Ciempiés" },
      },
    ]);

    await assert.rejects(
      () =>
        correctPublishedResult(db as never, {
          fecha: FECHA,
          hora: 10,
          numero: "05",
          adminUserId: "a1",
          confirmCorrection: false,
          motivo: "x",
          expectedNumero: "03",
        }),
      (e: unknown) =>
        e instanceof ResultadoCorrectionValidationError &&
        e.code === "CONFIRM_REQUIRED",
    );

    await assert.rejects(
      () =>
        correctPublishedResult(db as never, {
          fecha: FECHA,
          hora: 10,
          numero: "05",
          adminUserId: "a1",
          confirmCorrection: true,
          motivo: "   ",
          expectedNumero: "03",
        }),
      ResultadoCorrectionValidationError,
    );
  });

  it("conflicto si expectedNumero no coincide", async () => {
    const db = makeFakeDb([
      {
        id: "r1",
        fecha: FECHA,
        hora: 11,
        numero: "15",
        origen: "AUTOMATICO",
        animal: { nombre: "X" },
      },
    ]);

    await assert.rejects(
      () =>
        correctPublishedResult(db as never, {
          fecha: FECHA,
          hora: 11,
          numero: "03",
          adminUserId: "a1",
          confirmCorrection: true,
          motivo: "Otro admin corrigió antes",
          expectedNumero: "00",
        }),
      (e: unknown) =>
        e instanceof ResultadoCorrectionConflictError &&
        e.currentNumero === "15",
    );
    assert.equal(db.get(FECHA, 11)?.numero, "15");
    assert.equal(db.audits.length, 0);
  });

  it("CAS count 1 → audita expectedNumero, nuevo y motivo", async () => {
    const db = makeFakeDb([
      {
        id: "r1",
        fecha: FECHA,
        hora: 12,
        numero: "00",
        origen: "AUTOMATICO",
        animal: { nombre: "Ballena" },
      },
    ]);

    const row = await correctPublishedResult(db as never, {
      fecha: FECHA,
      hora: 12,
      numero: "03",
      adminUserId: "admin-9",
      confirmCorrection: true,
      motivo: "  Publicación errónea  ",
      expectedNumero: "00",
    });

    assert.equal(row.numero, "03");
    assert.equal(row.origen, "MANUAL");
    assert.equal(db.get(FECHA, 12)?.origen, "MANUAL");
    assert.equal(db.audits.length, 1);
    assert.equal(db.audits[0]!.accion, "MODIFICAR_RESULTADO");
    assert.equal(db.audits[0]!.usuarioId, "admin-9");
    const detalle = JSON.parse(db.audits[0]!.detalle ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(detalle.numeroAnterior, "00");
    assert.equal(detalle.numeroNuevo, "03");
    assert.equal(detalle.motivo, "Publicación errónea");
    assert.equal(detalle.correccionControlada, true);
    assert.equal(detalle.origenAnterior, "AUTOMATICO");
  });

  it("CAS count 0 → RESULT_CONFLICT y sin auditoría", async () => {
    const db = makeFakeDb([
      {
        id: "r1",
        fecha: FECHA,
        hora: 14,
        numero: "03",
        origen: "MANUAL",
        animal: { nombre: "Ciempiés" },
      },
    ]);
    // Tras el findUnique exitoso, otra TX cambia el número → updateMany count 0.
    db.setCasRace("15");

    await assert.rejects(
      () =>
        correctPublishedResult(db as never, {
          fecha: FECHA,
          hora: 14,
          numero: "05",
          adminUserId: "a1",
          confirmCorrection: true,
          motivo: "Intento concurrente",
          expectedNumero: "03",
        }),
      (e: unknown) =>
        e instanceof ResultadoCorrectionConflictError &&
        e.code === "RESULT_CONFLICT" &&
        e.currentNumero === "15",
    );

    // Fake TX revierte también la mutación de carrera; lo importante es count 0 →
    // conflicto sin auditoría (en Postgres real la otra TX sí dejaría "15").
    assert.equal(db.get(FECHA, 14)?.numero, "03");
    assert.equal(db.audits.length, 0);
  });

  it("si falla la auditoría tras CAS exitoso revierte la TX", async () => {
    const db = makeFakeDb([
      {
        id: "r1",
        fecha: FECHA,
        hora: 13,
        numero: "05",
        origen: "MANUAL",
        animal: { nombre: "León" },
      },
    ]);
    db.setFailAudit(true);

    await assert.rejects(() =>
      correctPublishedResult(db as never, {
        fecha: FECHA,
        hora: 13,
        numero: "03",
        adminUserId: "a1",
        confirmCorrection: true,
        motivo: "Debe fallar la auditoría",
        expectedNumero: "05",
      }),
    );

    assert.equal(db.get(FECHA, 13)?.numero, "05");
    assert.equal(db.audits.length, 0);
  });
});

describe("contrato HTTP 409 RESULT_CONFLICT", () => {
  it("ResultadoCorrectionConflictError.code es RESULT_CONFLICT", () => {
    const e = new ResultadoCorrectionConflictError("15");
    assert.equal(e.code, "RESULT_CONFLICT");
    assert.equal(e.currentNumero, "15");
  });
});
