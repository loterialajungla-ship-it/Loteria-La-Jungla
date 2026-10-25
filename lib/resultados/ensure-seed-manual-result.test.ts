import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  ANIMALES_CANONICOS,
  CatalogoAnimalitosInvalidoError,
} from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  ensureSeedManualResult,
  SeedManualResultConflictError,
  SEED_MANUAL_RESULT_NUMERO,
} from "@/lib/resultados/ensure-seed-manual-result";

const FECHA = new Date(Date.UTC(2026, 9, 18));
const HORA = 14;
const ADMIN = "admin-seed";

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
  const stats = {
    findUniqueCalls: 0,
    createCalls: 0,
    upsertCalls: 0,
    updateCalls: 0,
    updateManyCalls: 0,
    auditCreates: 0,
  };
  const nombrePorNumero = new Map(catalog.map((a) => [a.numero, a.nombre]));
  /**
   * Fila escrita por otra TX concurrente: sobrevive al rollback del fake
   * (como en Postgres real tras P2002).
   */
  const concurrentByKey = new Map<string, Row>();
  let raceNumero: string | null = null;

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

  function lookupRow(fecha: Date, hora: number): Row | undefined {
    const key = rowKey(fecha, hora);
    return rows.get(key) ?? concurrentByKey.get(key);
  }

  const api = {
    get audits() {
      return audits;
    },
    get stats() {
      return stats;
    },
    get(fecha: Date, hora: number) {
      return lookupRow(fecha, hora) ?? null;
    },
    /** Simula carrera: findUnique ve vacío; create choca con fila concurrente. */
    armUniquenessRace(numero: string) {
      raceNumero = numero;
    },
    animal: {
      async findMany() {
        return catalog.map((a) => ({ numero: a.numero, nombre: a.nombre }));
      },
    },
    resultadoProgramado: {
      async updateMany() {
        return { count: 0 };
      },
    },
    resultado: {
      async findUnique(args: {
        where: { fecha_hora?: { fecha: Date; hora: number }; id?: string };
        select?: { numero?: true; id?: true; hora?: true; origen?: true };
      }) {
        stats.findUniqueCalls += 1;
        let row: Row | undefined;
        if (args.where.fecha_hora) {
          row = lookupRow(
            args.where.fecha_hora.fecha,
            args.where.fecha_hora.hora,
          );
        }
        if (!row) return null;
        if (args.select) {
          const out: Record<string, unknown> = {};
          if (args.select.id) out.id = row.id;
          if (args.select.numero) out.numero = row.numero;
          if (args.select.hora) out.hora = row.hora;
          if (args.select.origen) out.origen = row.origen;
          return out;
        }
        return { ...row, animal: { ...row.animal } };
      },
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
        if (raceNumero != null) {
          const raced = raceNumero;
          raceNumero = null;
          concurrentByKey.set(key, {
            id: `race-${args.data.hora}`,
            fecha: args.data.fecha,
            hora: args.data.hora,
            numero: raced,
            origen: "AUTOMATICO",
            animal: {
              nombre: nombrePorNumero.get(raced) ?? `Animal-${raced}`,
            },
          });
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        if (rows.has(key) || concurrentByKey.has(key)) {
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
      async upsert() {
        stats.upsertCalls += 1;
        throw new Error("resultado.upsert no debe usarse en seed manual-test");
      },
      async update() {
        stats.updateCalls += 1;
        throw new Error("resultado.update no debe usarse en seed manual-test");
      },
      async updateMany() {
        stats.updateManyCalls += 1;
        throw new Error(
          "resultado.updateMany no debe usarse en seed manual-test",
        );
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

describe("ensureSeedManualResult", () => {
  it("inexistente → createManualResult (create-only), sin upsert/update", async () => {
    const db = makeFakeDb();
    const out = await ensureSeedManualResult(db as never, {
      fecha: FECHA,
      hora: HORA,
      adminUserId: ADMIN,
    });

    assert.equal(out.status, "created");
    if (out.status === "created") {
      assert.equal(out.row.numero, SEED_MANUAL_RESULT_NUMERO);
      assert.equal(out.row.origen, "MANUAL");
    }
    assert.equal(db.stats.createCalls, 1);
    assert.equal(db.stats.upsertCalls, 0);
    assert.equal(db.stats.updateCalls, 0);
    assert.equal(db.stats.updateManyCalls, 0);
    assert.equal(db.stats.auditCreates, 1);
    assert.equal(db.audits[0]!.accion, "CREAR_RESULTADO");
    assert.equal(db.get(FECHA, HORA)?.numero, "03");
  });

  it("existente con 03 → no-op sin dominio de escritura ni auditoría", async () => {
    const db = makeFakeDb([
      {
        id: "r1",
        fecha: FECHA,
        hora: HORA,
        numero: "03",
        origen: "MANUAL",
        animal: { nombre: "Ciempiés" },
      },
    ]);

    const out = await ensureSeedManualResult(db as never, {
      fecha: FECHA,
      hora: HORA,
      adminUserId: ADMIN,
    });

    assert.equal(out.status, "unchanged");
    if (out.status === "unchanged") {
      assert.equal(out.numero, "03");
      assert.equal(out.id, "r1");
    }
    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.upsertCalls, 0);
    assert.equal(db.stats.updateCalls, 0);
    assert.equal(db.stats.updateManyCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
    assert.equal(db.audits.length, 0);
  });

  it("existente con otro número → conflicto, conserva número, cero escrituras", async () => {
    const db = makeFakeDb([
      {
        id: "r1",
        fecha: FECHA,
        hora: HORA,
        numero: "15",
        origen: "AUTOMATICO",
        animal: { nombre: "Zorro" },
      },
    ]);

    await assert.rejects(
      () =>
        ensureSeedManualResult(db as never, {
          fecha: FECHA,
          hora: HORA,
          adminUserId: ADMIN,
        }),
      (e: unknown) =>
        e instanceof SeedManualResultConflictError &&
        e.code === "SEED_RESULT_CONFLICT" &&
        e.currentNumero === "15" &&
        e.race === false,
    );

    assert.equal(db.get(FECHA, HORA)?.numero, "15");
    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.upsertCalls, 0);
    assert.equal(db.stats.updateCalls, 0);
    assert.equal(db.stats.updateManyCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
  });

  it("catálogo inválido al crear → dominio rechaza; cero escrituras/auditorías", async () => {
    const invalid = ANIMALES_CANONICOS.map((a) => ({
      numero: a.numero,
      nombre: a.numero === "03" ? "Animal03" : a.nombre,
    }));
    const db = makeFakeDb([], invalid);

    await assert.rejects(
      () =>
        ensureSeedManualResult(db as never, {
          fecha: FECHA,
          hora: HORA,
          adminUserId: ADMIN,
        }),
      (e: unknown) =>
        e instanceof CatalogoAnimalitosInvalidoError &&
        e.code === "CATALOG_NAME_MISMATCH",
    );

    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.upsertCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
    assert.equal(db.get(FECHA, HORA), null);
  });

  it("carrera de unicidad → conflicto sin sobrescribir ni corregir", async () => {
    const db = makeFakeDb();
    db.armUniquenessRace("22");

    await assert.rejects(
      () =>
        ensureSeedManualResult(db as never, {
          fecha: FECHA,
          hora: HORA,
          adminUserId: ADMIN,
        }),
      (e: unknown) =>
        e instanceof SeedManualResultConflictError &&
        e.race === true &&
        e.currentNumero === "22",
    );

    assert.equal(db.get(FECHA, HORA)?.numero, "22");
    assert.equal(db.stats.upsertCalls, 0);
    assert.equal(db.stats.updateCalls, 0);
    assert.equal(db.stats.updateManyCalls, 0);
    // create se intentó una vez y falló (TX revertida); sin auditoría de éxito
    assert.equal(db.stats.auditCreates, 0);
    assert.equal(db.audits.length, 0);
  });
});
