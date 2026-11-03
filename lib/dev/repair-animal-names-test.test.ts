import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANIMALES_CANONICOS } from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  RepairAnimalNamesTestError,
  TEST_ANIMAL_NAME_REPAIRS_ALLOWED,
  assertExplicitRepairsAllowed,
  planExplicitAnimalNameRepairs,
  runRepairAnimalNamesTest,
  type ExplicitAnimalNameRepair,
  type RepairAnimalNamesTestDb,
} from "@/lib/dev/repair-animal-names-test";

type Row = {
  numero: string;
  nombre: string;
  imagen: string | null;
};

function rowsWith20(nombre20: string): Row[] {
  return ANIMALES_CANONICOS.map((a) => ({
    numero: a.numero,
    nombre: a.numero === "20" ? nombre20 : a.nombre,
    imagen: `/animals/${a.numero}.png`,
  }));
}

function makeFakeDb(seed: Row[]) {
  let animals = seed.map((r) => ({ ...r }));
  const stats = { updateCalls: 0, updatedNumeros: [] as string[] };

  function snapshot() {
    return animals.map((a) => ({ ...a }));
  }

  function restore(s: Row[]) {
    animals = s.map((a) => ({ ...a }));
  }

  const api: RepairAnimalNamesTestDb & {
    stats: typeof stats;
    animals: Row[];
  } = {
    get stats() {
      return stats;
    },
    get animals() {
      return animals;
    },
    animal: {
      async findUnique(args: {
        where: { numero: string };
        select: { numero: true; nombre: true; imagen: true };
      }) {
        const row = animals.find((a) => a.numero === args.where.numero);
        return row
          ? { numero: row.numero, nombre: row.nombre, imagen: row.imagen }
          : null;
      },
      async update(args: {
        where: { numero: string };
        data: { nombre: string };
        select: { numero: true; nombre: true; imagen: true };
      }) {
        stats.updateCalls += 1;
        stats.updatedNumeros.push(args.where.numero);
        const idx = animals.findIndex((a) => a.numero === args.where.numero);
        if (idx < 0) throw new Error("missing animal");
        animals[idx] = {
          ...animals[idx]!,
          nombre: args.data.nombre,
        };
        return {
          numero: animals[idx]!.numero,
          nombre: animals[idx]!.nombre,
          imagen: animals[idx]!.imagen,
        };
      },
    },
    async $transaction(fn) {
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

describe("assertExplicitRepairsAllowed", () => {
  it("acepta la allowlist TEST (20 Cochino→Cerdo)", () => {
    assert.doesNotThrow(() =>
      assertExplicitRepairsAllowed(TEST_ANIMAL_NAME_REPAIRS_ALLOWED),
    );
  });

  it("rechaza lista vacía o reparación fuera de allowlist", () => {
    assert.throws(
      () => assertExplicitRepairsAllowed([]),
      RepairAnimalNamesTestError,
    );
    const rogue: ExplicitAnimalNameRepair[] = [
      { numero: "01", nombreAnterior: "X", nombreNuevo: "Delfín" },
    ];
    assert.throws(
      () => assertExplicitRepairsAllowed(rogue),
      /allowlist|REPAIR_NOT_ALLOWED|abortada/,
    );
  });

  it("rechaza nombre nuevo no canónico aunque esté en una allowlist pasada", () => {
    const custom: ExplicitAnimalNameRepair[] = [
      { numero: "20", nombreAnterior: "Cochino", nombreNuevo: "CerdoX" },
    ];
    assert.throws(
      () => assertExplicitRepairsAllowed(custom, custom),
      /canónico/,
    );
  });
});

describe("planExplicitAnimalNameRepairs / runRepairAnimalNamesTest", () => {
  it("éxito Cochino → Cerdo; no toca otros animales ni imagen", async () => {
    const before = rowsWith20("Cochino");
    const db = makeFakeDb(before);
    const result = await runRepairAnimalNamesTest(
      db,
      TEST_ANIMAL_NAME_REPAIRS_ALLOWED,
    );

    assert.equal(result.status, "repaired");
    assert.equal(result.updated, 1);
    assert.equal(db.stats.updateCalls, 1);
    assert.deepEqual(db.stats.updatedNumeros, ["20"]);

    const row20 = db.animals.find((a) => a.numero === "20")!;
    assert.equal(row20.nombre, "Cerdo");
    assert.equal(row20.imagen, "/animals/20.png");

    for (const expected of ANIMALES_CANONICOS) {
      if (expected.numero === "20") continue;
      const row = db.animals.find((a) => a.numero === expected.numero)!;
      const prev = before.find((a) => a.numero === expected.numero)!;
      assert.equal(row.nombre, prev.nombre);
      assert.equal(row.imagen, prev.imagen);
    }
  });

  it("idempotente si ya es Cerdo", async () => {
    const db = makeFakeDb(rowsWith20("Cerdo"));
    const result = await runRepairAnimalNamesTest(
      db,
      TEST_ANIMAL_NAME_REPAIRS_ALLOWED,
    );
    assert.equal(result.status, "already_applied");
    assert.equal(result.updated, 0);
    assert.equal(result.skippedAlreadyCanonical, 1);
    assert.equal(db.stats.updateCalls, 0);
  });

  it("aborta ante nombre inesperado sin escribir", async () => {
    const before = rowsWith20("Animal20");
    const db = makeFakeDb(before);
    await assert.rejects(
      () => runRepairAnimalNamesTest(db, TEST_ANIMAL_NAME_REPAIRS_ALLOWED),
      /inesperado|UNEXPECTED_NAME/,
    );
    assert.equal(db.stats.updateCalls, 0);
    assert.equal(db.animals.find((a) => a.numero === "20")!.nombre, "Animal20");
  });

  it("aborta si falta el animal 20", async () => {
    const without20 = rowsWith20("Cochino").filter((r) => r.numero !== "20");
    const db = makeFakeDb(without20);
    await assert.rejects(
      () => runRepairAnimalNamesTest(db, TEST_ANIMAL_NAME_REPAIRS_ALLOWED),
      /falta|ANIMAL_MISSING/,
    );
    assert.equal(db.stats.updateCalls, 0);
  });

  it("plan solo lectura: Cochino → update; Cerdo → skip", async () => {
    const dbCochino = makeFakeDb(rowsWith20("Cochino"));
    const planA = await planExplicitAnimalNameRepairs(
      dbCochino,
      TEST_ANIMAL_NAME_REPAIRS_ALLOWED,
    );
    assert.equal(planA.toUpdate.length, 1);
    assert.equal(planA.alreadyApplied, 0);

    const dbCerdo = makeFakeDb(rowsWith20("Cerdo"));
    const planB = await planExplicitAnimalNameRepairs(
      dbCerdo,
      TEST_ANIMAL_NAME_REPAIRS_ALLOWED,
    );
    assert.equal(planB.toUpdate.length, 0);
    assert.equal(planB.alreadyApplied, 1);
  });

  it("mensajes de error no incluyen secretos de conexión", () => {
    try {
      assertExplicitRepairsAllowed([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert.doesNotMatch(msg, /postgresql:\/\//i);
      assert.doesNotMatch(msg, /neondb_owner/i);
      assert.doesNotMatch(msg, /PASSWORD/i);
    }
  });
});
