import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrigenResultado } from "@prisma/client";
import {
  ANIMALES_CANONICOS,
  CatalogoAnimalitosInvalidoError,
} from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  runAutomaticResultsPublish,
  tryCreateAutomaticResult,
} from "@/lib/resultados/auto-publish";
import type { DrawSlot } from "@/lib/resultados/pending-slots";

const SLOT: DrawSlot = {
  fecha: new Date(Date.UTC(2026, 9, 2, 4, 0, 0)),
  hora: 9,
};

/**
 * Aísla errores por franja y validación de catálogo sin DB real.
 */
describe("tryCreateAutomaticResult — catálogo canónico", () => {
  it("catálogo inválido → rechaza sin crear ni auditar", async () => {
    let createCalls = 0;
    let auditCalls = 0;
    let txCalls = 0;

    const db = {
      animal: {
        findMany: async () =>
          ANIMALES_CANONICOS.map((a) => ({
            numero: a.numero,
            nombre: a.numero === "03" ? "Animal03" : a.nombre,
          })),
      },
      resultado: {
        findUnique: async () => null,
        create: async () => {
          createCalls += 1;
          throw new Error("no debería crear");
        },
      },
      auditoria: {
        create: async () => {
          auditCalls += 1;
          throw new Error("no debería auditar");
        },
      },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        txCalls += 1;
        return fn(db);
      },
    };

    await assert.rejects(
      () => tryCreateAutomaticResult(db as never, SLOT, new Date()),
      (e: unknown) =>
        e instanceof CatalogoAnimalitosInvalidoError &&
        e.code === "CATALOG_NAME_MISMATCH",
    );
    assert.equal(createCalls, 0);
    assert.equal(auditCalls, 0);
    assert.equal(txCalls, 0);
  });

  it("catálogo canónico válido → crea AUTOMATICO y audita", async () => {
    let createCalls = 0;
    let auditCalls = 0;

    const db = {
      animal: {
        findMany: async () =>
          ANIMALES_CANONICOS.map((a) => ({
            numero: a.numero,
            nombre: a.nombre,
          })),
      },
      resultado: {
        findUnique: async () => null,
        create: async (args: {
          data: { hora: number; numero: string; origen: OrigenResultado };
        }) => {
          createCalls += 1;
          return {
            id: "auto-1",
            numero: args.data.numero,
            origen: args.data.origen,
          };
        },
      },
      auditoria: {
        create: async () => {
          auditCalls += 1;
          return {};
        },
      },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        return fn(db);
      },
    };

    const r = await tryCreateAutomaticResult(db as never, SLOT, new Date());
    assert.equal(r.status, "created");
    if (r.status === "created") {
      assert.equal(r.origen, "AUTOMATICO");
      assert.ok(ANIMALES_CANONICOS.some((a) => a.numero === r.numero));
    }
    assert.equal(createCalls, 1);
    assert.equal(auditCalls, 1);
  });

  it("catalogRows inválidos (invocación directa) → rechaza sin escritura", async () => {
    let createCalls = 0;
    let findManyCalls = 0;

    const invalidRows = ANIMALES_CANONICOS.map((a) => ({
      numero: a.numero,
      nombre: a.numero === "00" ? "X" : a.nombre,
    }));

    const db = {
      animal: {
        findMany: async () => {
          findManyCalls += 1;
          return ANIMALES_CANONICOS.map((a) => ({
            numero: a.numero,
            nombre: a.nombre,
          }));
        },
      },
      resultado: {
        findUnique: async () => null,
        create: async () => {
          createCalls += 1;
          throw new Error("no debería crear");
        },
      },
      auditoria: {
        create: async () => {
          throw new Error("no debería auditar");
        },
      },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        return fn(db);
      },
    };

    await assert.rejects(
      () =>
        tryCreateAutomaticResult(db as never, SLOT, new Date(), {
          catalogRows: invalidRows,
        }),
      CatalogoAnimalitosInvalidoError,
    );
    assert.equal(createCalls, 0);
    // Reutiliza catalogRows del caller: no consulta de nuevo.
    assert.equal(findManyCalls, 0);
  });
});

describe("runAutomaticResultsPublish — aislamiento de errores", () => {
  it("un fallo en una hora no impide procesar las demás vencidas", async () => {
    // 2026-10-02 14:00 UTC = 10:00 America/Caracas → vencidas 9 y 10
    const ahora = new Date(Date.UTC(2026, 9, 2, 14, 0, 0));

    const created: number[] = [];

    const db = {
      animal: {
        findMany: async () =>
          ANIMALES_CANONICOS.map((a) => ({
            numero: a.numero,
            nombre: a.nombre,
          })),
      },
      resultado: {
        findUnique: async (args: {
          where: { fecha_hora: { hora: number } };
        }) => {
          const hora = args.where.fecha_hora.hora;
          if (hora === 10) {
            throw new Error("fallo simulado en franja 10");
          }
          return null;
        },
        create: async (args: {
          data: { hora: number; numero: string; origen: OrigenResultado };
        }) => {
          created.push(args.data.hora);
          return {
            id: `id-${args.data.hora}`,
            numero: args.data.numero,
            origen: args.data.origen,
          };
        },
      },
      auditoria: {
        create: async () => ({}),
      },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        return fn(db);
      },
    };

    const run = await runAutomaticResultsPublish(db as never, ahora);

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
    let createCalls = 0;
    let txCalls = 0;

    const db = {
      animal: {
        findMany: async () =>
          ANIMALES_CANONICOS.map((a) => ({
            numero: a.numero,
            nombre: a.numero === "03" ? "Animal03" : a.nombre,
          })),
      },
      resultado: {
        findUnique: async () => null,
        create: async () => {
          createCalls += 1;
          throw new Error("no debería crear");
        },
      },
      auditoria: {
        create: async () => {
          throw new Error("no debería auditar");
        },
      },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        txCalls += 1;
        return fn(db);
      },
    };

    await assert.rejects(
      () => runAutomaticResultsPublish(db as never, ahora),
      (e: unknown) =>
        e instanceof CatalogoAnimalitosInvalidoError &&
        e.code === "CATALOG_NAME_MISMATCH",
    );
    assert.equal(createCalls, 0);
    assert.equal(txCalls, 0);
  });
});
