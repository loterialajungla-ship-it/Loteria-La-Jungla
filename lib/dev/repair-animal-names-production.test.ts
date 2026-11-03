import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANIMALES_CANONICOS } from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  RepairAnimalNamesProductionError,
  assertCanonicalSourceIntegrity,
  assertProductionAnimalNumberSet,
  planAnimalNameRepairs,
  runRepairAnimalNamesProduction,
  type RepairAnimalNamesProductionDb,
} from "@/lib/dev/repair-animal-names-production";

type Row = {
  numero: string;
  nombre: string;
  imagen: string | null;
};

function canonicalRows(): Row[] {
  return ANIMALES_CANONICOS.map((a) => ({
    numero: a.numero,
    nombre: a.nombre,
    imagen: `/animals/${a.numero}.png`,
  }));
}

/** 5 canónicos reales + 33 genéricos AnimalNN (como prod/TEST históricos). */
function pollutedRows(): Row[] {
  const keep = new Set(["0", "00", "03", "05", "15"]);
  return ANIMALES_CANONICOS.map((a) => {
    if (keep.has(a.numero)) {
      return {
        numero: a.numero,
        nombre: a.nombre,
        imagen: `/animals/${a.numero}.png`,
      };
    }
    // Números "01"…"36" → Animal01… (0/00/03/05/15 están en keep).
    return {
      numero: a.numero,
      nombre: `Animal${a.numero}`,
      imagen: `/custom/${a.numero}.webp`,
    };
  });
}

function makeFakeDb(seed: Row[]) {
  let animals = seed.map((r) => ({ ...r }));
  const stats = {
    updateCalls: 0,
    otherTableWrites: 0,
  };
  let failPostRead = false;

  function snapshot() {
    return animals.map((a) => ({ ...a }));
  }

  function restore(s: Row[]) {
    animals = s.map((a) => ({ ...a }));
  }

  const api: RepairAnimalNamesProductionDb & {
    stats: typeof stats;
    animals: Row[];
    setFailPostRead: (v: boolean) => void;
  } = {
    get stats() {
      return stats;
    },
    get animals() {
      return animals;
    },
    setFailPostRead(v: boolean) {
      failPostRead = v;
    },
    animal: {
      async findMany() {
        if (failPostRead && stats.updateCalls > 0) {
          // Tras updates: devolver catálogo inválido para forzar rollback.
          return animals.map((a, i) =>
            i === 0
              ? { ...a, nombre: "NOMBRE_ROTO_POST" }
              : { numero: a.numero, nombre: a.nombre },
          );
        }
        return animals.map((a) => ({
          numero: a.numero,
          nombre: a.nombre,
          imagen: a.imagen,
        }));
      },
      async update(args: {
        where: { numero: string };
        data: { nombre: string };
        select: { numero: true; nombre: true };
      }) {
        stats.updateCalls += 1;
        const idx = animals.findIndex((a) => a.numero === args.where.numero);
        if (idx < 0) throw new Error("missing animal");
        // Solo nombre: preservar imagen e identidad.
        animals[idx] = {
          ...animals[idx]!,
          nombre: args.data.nombre,
        };
        return {
          numero: animals[idx]!.numero,
          nombre: animals[idx]!.nombre,
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

describe("assertCanonicalSourceIntegrity", () => {
  it("acepta la fuente canónica del proyecto", () => {
    assert.doesNotThrow(() => assertCanonicalSourceIntegrity());
  });
});

describe("assertProductionAnimalNumberSet / planAnimalNameRepairs", () => {
  it("aborta con 37 o 39 filas", () => {
    const base = canonicalRows();
    assert.throws(
      () => assertProductionAnimalNumberSet(base.slice(0, 37)),
      /38/,
    );
    assert.throws(
      () =>
        assertProductionAnimalNumberSet([
          ...base,
          { numero: "99", nombre: "X", imagen: null },
        ]),
      RepairAnimalNamesProductionError,
    );
  });

  it("aborta con número faltante, adicional o duplicado", () => {
    const base = canonicalRows();
    const missing = base.filter((r) => r.numero !== "01");
    missing.push({ numero: "99", nombre: "Extra", imagen: null });
    assert.throws(
      () => assertProductionAnimalNumberSet(missing),
      /no canónico|falt/,
    );

    const dup = canonicalRows();
    dup[1] = { ...dup[0]! }; // dos filas con el mismo numero "0"
    assert.throws(() => assertProductionAnimalNumberSet(dup), /duplicado/);
  });

  it("planifica 33 reparaciones ante contaminación tipo prod", () => {
    const rows = pollutedRows();
    const plan = planAnimalNameRepairs(rows);
    assert.equal(plan.length, 33);
    assert.ok(plan.every((p) => p.nombreCanonico.length > 0));
  });

  it("plan vacío si ya es canónico", () => {
    assert.equal(planAnimalNameRepairs(canonicalRows()).length, 0);
  });
});

describe("runRepairAnimalNamesProduction", () => {
  it("repara 33 nombres genéricos y preserva imagen/identidad", async () => {
    const before = pollutedRows();
    const db = makeFakeDb(before);
    const result = await runRepairAnimalNamesProduction(db);

    assert.equal(result.status, "repaired");
    assert.equal(result.updated, 33);
    assert.equal(result.unchanged, 5);
    // La API tipada del dominio solo expone findMany + update (sin create/upsert/delete).
    assert.equal(db.stats.otherTableWrites, 0);
    assert.equal(db.stats.updateCalls, 33);
    assert.equal(db.animals.length, 38);

    for (const expected of ANIMALES_CANONICOS) {
      const row = db.animals.find((a) => a.numero === expected.numero);
      assert.ok(row);
      assert.equal(row!.nombre, expected.nombre);
      const prev = before.find((a) => a.numero === expected.numero)!;
      assert.equal(row!.imagen, prev.imagen);
      assert.equal(row!.numero, expected.numero);
    }
  });

  it("no escribe si el catálogo ya es canónico", async () => {
    const db = makeFakeDb(canonicalRows());
    const result = await runRepairAnimalNamesProduction(db);
    assert.equal(result.status, "already_canonical");
    assert.equal(result.updated, 0);
    assert.equal(db.stats.updateCalls, 0);
  });

  it("aborta sin escrituras si faltan números", async () => {
    const bad = canonicalRows().slice(0, 37);
    const db = makeFakeDb(bad);
    await assert.rejects(
      () => runRepairAnimalNamesProduction(db),
      /38|esperaban/,
    );
    assert.equal(db.stats.updateCalls, 0);
    assert.deepEqual(
      db.animals.map((a) => a.nombre),
      bad.map((a) => a.nombre),
    );
  });

  it("rollback si falla la validación final tras updates", async () => {
    const before = pollutedRows();
    const db = makeFakeDb(before);
    db.setFailPostRead(true);

    await assert.rejects(
      () => runRepairAnimalNamesProduction(db),
      /rollback|POST_REPAIR|inválido|canónico/,
    );

    // Nombres restaurados al snapshot previo.
    for (const prev of before) {
      const row = db.animals.find((a) => a.numero === prev.numero);
      assert.equal(row!.nombre, prev.nombre);
      assert.equal(row!.imagen, prev.imagen);
    }
  });

  it("mensajes de error no incluyen secretos de conexión", () => {
    try {
      assertProductionAnimalNumberSet([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert.doesNotMatch(msg, /postgresql:\/\//i);
      assert.doesNotMatch(msg, /neondb_owner/i);
      assert.doesNotMatch(msg, /PASSWORD/i);
    }
  });
});
