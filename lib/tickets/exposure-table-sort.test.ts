import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnimalExposicion } from "@/lib/tickets/aggregate-exposure";
import { ordenCatalogoAnimal } from "@/lib/tickets/aggregate-exposure";
import { ANIMALES_CANONICOS } from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  ariaSortValue,
  compareExposureRows,
  cycleExposureSort,
  EXPOSURE_SORT_DEFAULT,
  sortExposureAnimals,
  type ExposureSortState,
} from "@/lib/tickets/exposure-table-sort";

function row(
  partial: Partial<AnimalExposicion> &
    Pick<AnimalExposicion, "numeroAnimal" | "nombreAnimal">,
): AnimalExposicion {
  return {
    totalApostado: "0.00",
    exposicion: "0.00",
    ticketsAfectados: 0,
    ...partial,
  };
}

const sample: AnimalExposicion[] = [
  row({
    numeroAnimal: "0",
    nombreAnimal: "Delfín",
    totalApostado: "10.00",
    exposicion: "100.00",
    ticketsAfectados: 2,
  }),
  row({
    numeroAnimal: "00",
    nombreAnimal: "Ballena",
    totalApostado: "9.00",
    exposicion: "90.00",
    ticketsAfectados: 1,
  }),
  row({
    numeroAnimal: "03",
    nombreAnimal: "Ciempiés",
    totalApostado: "100.00",
    exposicion: "10.00",
    ticketsAfectados: 5,
  }),
  row({
    numeroAnimal: "05",
    nombreAnimal: "León",
    totalApostado: "0.00",
    exposicion: "0.00",
    ticketsAfectados: 0,
  }),
];

describe("cycleExposureSort", () => {
  it("ciclo de tres clics en la misma columna", () => {
    let s: ExposureSortState = EXPOSURE_SORT_DEFAULT;
    s = cycleExposureSort(s, "exposicion");
    assert.deepEqual(s, { key: "exposicion", dir: "asc" });
    s = cycleExposureSort(s, "exposicion");
    assert.deepEqual(s, { key: "exposicion", dir: "desc" });
    s = cycleExposureSort(s, "exposicion");
    assert.deepEqual(s, EXPOSURE_SORT_DEFAULT);
  });

  it("cambiar de columna reinicia en ASC", () => {
    let s = cycleExposureSort(EXPOSURE_SORT_DEFAULT, "exposicion");
    s = cycleExposureSort(s, "exposicion"); // desc
    s = cycleExposureSort(s, "ticketsAfectados");
    assert.deepEqual(s, { key: "ticketsAfectados", dir: "asc" });
  });
});

describe("compareExposureRows — money numérico", () => {
  it("9.00 < 10.00 < 100.00 (no lexicográfico)", () => {
    const a = row({
      numeroAnimal: "01",
      nombreAnimal: "A",
      exposicion: "9.00",
      totalApostado: "9.00",
    });
    const b = row({
      numeroAnimal: "02",
      nombreAnimal: "B",
      exposicion: "10.00",
      totalApostado: "10.00",
    });
    const c = row({
      numeroAnimal: "03",
      nombreAnimal: "C",
      exposicion: "100.00",
      totalApostado: "100.00",
    });
    assert.ok(compareExposureRows(a, b, "exposicion", "asc") < 0);
    assert.ok(compareExposureRows(b, c, "exposicion", "asc") < 0);
    assert.ok(compareExposureRows(a, c, "totalApostado", "asc") < 0);
    // Lexicográfico fallaría: "9.00" > "100.00" como string
    assert.ok("9.00" > "100.00");
  });
});

describe("sortExposureAnimals", () => {
  it("default conserva orden recibido (catálogo)", () => {
    const sorted = sortExposureAnimals(sample, EXPOSURE_SORT_DEFAULT);
    assert.deepEqual(
      sorted.map((r) => r.numeroAnimal),
      ["0", "00", "03", "05"],
    );
  });

  it("ASC/DESC exposicion", () => {
    const asc = sortExposureAnimals(sample, {
      key: "exposicion",
      dir: "asc",
    });
    assert.deepEqual(
      asc.map((r) => r.exposicion),
      ["0.00", "10.00", "90.00", "100.00"],
    );
    const desc = sortExposureAnimals(sample, {
      key: "exposicion",
      dir: "desc",
    });
    assert.deepEqual(
      desc.map((r) => r.exposicion),
      ["100.00", "90.00", "10.00", "0.00"],
    );
  });

  it("ASC/DESC totalApostado", () => {
    const asc = sortExposureAnimals(sample, {
      key: "totalApostado",
      dir: "asc",
    });
    assert.deepEqual(
      asc.map((r) => r.totalApostado),
      ["0.00", "9.00", "10.00", "100.00"],
    );
    const desc = sortExposureAnimals(sample, {
      key: "totalApostado",
      dir: "desc",
    });
    assert.deepEqual(
      desc.map((r) => r.totalApostado),
      ["100.00", "10.00", "9.00", "0.00"],
    );
  });

  it("ASC/DESC ticketsAfectados", () => {
    const asc = sortExposureAnimals(sample, {
      key: "ticketsAfectados",
      dir: "asc",
    });
    assert.deepEqual(
      asc.map((r) => r.ticketsAfectados),
      [0, 1, 2, 5],
    );
    const desc = sortExposureAnimals(sample, {
      key: "ticketsAfectados",
      dir: "desc",
    });
    assert.deepEqual(
      desc.map((r) => r.ticketsAfectados),
      [5, 2, 1, 0],
    );
  });

  it("orden animal por catálogo ASC/DESC", () => {
    const scrambled = [sample[2]!, sample[0]!, sample[3]!, sample[1]!];
    const asc = sortExposureAnimals(scrambled, {
      key: "animal",
      dir: "asc",
    });
    assert.deepEqual(
      asc.map((r) => r.numeroAnimal),
      ["0", "00", "03", "05"],
    );
    const desc = sortExposureAnimals(scrambled, {
      key: "animal",
      dir: "desc",
    });
    assert.deepEqual(
      desc.map((r) => r.numeroAnimal),
      ["05", "03", "00", "0"],
    );
  });

  it("empates: desempate estable por catálogo", () => {
    const tied: AnimalExposicion[] = [
      row({
        numeroAnimal: "05",
        nombreAnimal: "León",
        exposicion: "50.00",
      }),
      row({
        numeroAnimal: "03",
        nombreAnimal: "Ciempiés",
        exposicion: "50.00",
      }),
      row({
        numeroAnimal: "00",
        nombreAnimal: "Ballena",
        exposicion: "50.00",
      }),
    ];
    const asc = sortExposureAnimals(tied, {
      key: "exposicion",
      dir: "asc",
    });
    assert.deepEqual(
      asc.map((r) => r.numeroAnimal),
      ["00", "03", "05"],
    );
  });

  it("ceros visibles y ordenados", () => {
    const asc = sortExposureAnimals(sample, {
      key: "exposicion",
      dir: "asc",
    });
    assert.equal(asc[0]!.exposicion, "0.00");
    assert.equal(asc[0]!.numeroAnimal, "05");
  });

  it("array vacío y una fila", () => {
    assert.deepEqual(sortExposureAnimals([], EXPOSURE_SORT_DEFAULT), []);
    const one = [sample[0]!];
    const out = sortExposureAnimals(one, {
      key: "exposicion",
      dir: "desc",
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.numeroAnimal, "0");
  });

  it("lista canónica de 38 animales conserva orden default", () => {
    const full: AnimalExposicion[] = ANIMALES_CANONICOS.map((a) =>
      row({
        numeroAnimal: a.numero,
        nombreAnimal: a.nombre,
        exposicion: "0.00",
      }),
    );
    assert.equal(full.length, 38);
    const sorted = sortExposureAnimals(full, EXPOSURE_SORT_DEFAULT);
    assert.deepEqual(
      sorted.map((r) => r.numeroAnimal),
      ANIMALES_CANONICOS.map((a) => a.numero),
    );
    const byExp = sortExposureAnimals(full, {
      key: "exposicion",
      dir: "asc",
    });
    // Todos empatados en 0 → desempate catálogo
    assert.deepEqual(
      byExp.map((r) => r.numeroAnimal),
      ANIMALES_CANONICOS.map((a) => a.numero),
    );
  });

  it("restauración tras ciclo: orden original", () => {
    let s = EXPOSURE_SORT_DEFAULT;
    s = cycleExposureSort(s, "exposicion");
    s = cycleExposureSort(s, "exposicion");
    s = cycleExposureSort(s, "exposicion");
    const restored = sortExposureAnimals(sample, s);
    assert.deepEqual(
      restored.map((r) => r.numeroAnimal),
      sample.map((r) => r.numeroAnimal),
    );
  });

  it("inmutabilidad: no muta array ni campos de objetos", () => {
    const originalOrder = sample.map((r) => r.numeroAnimal);
    const snapshot = sample.map((r) => ({ ...r }));
    const sorted = sortExposureAnimals(sample, {
      key: "exposicion",
      dir: "desc",
    });
    assert.notEqual(sorted, sample);
    assert.deepEqual(
      sample.map((r) => r.numeroAnimal),
      originalOrder,
    );
    for (let i = 0; i < sample.length; i++) {
      assert.equal(sample[i]!.exposicion, snapshot[i]!.exposicion);
      assert.equal(sample[i]!.totalApostado, snapshot[i]!.totalApostado);
      assert.equal(sample[i]!.ticketsAfectados, snapshot[i]!.ticketsAfectados);
      assert.equal(sample[i]!.nombreAnimal, snapshot[i]!.nombreAnimal);
    }
  });

  it("ariaSortValue refleja estado", () => {
    assert.equal(
      ariaSortValue("exposicion", EXPOSURE_SORT_DEFAULT),
      "none",
    );
    assert.equal(
      ariaSortValue("exposicion", { key: "exposicion", dir: "asc" }),
      "ascending",
    );
    assert.equal(
      ariaSortValue("exposicion", { key: "exposicion", dir: "desc" }),
      "descending",
    );
    assert.equal(
      ariaSortValue("animal", { key: "exposicion", dir: "asc" }),
      "none",
    );
  });

  it("ordenCatalogoAnimal sigue siendo la base del default", () => {
    const nums = sample.map((r) => r.numeroAnimal);
    const catalogSorted = nums
      .slice()
      .sort((a, b) => ordenCatalogoAnimal(a) - ordenCatalogoAnimal(b));
    assert.deepEqual(catalogSorted, ["0", "00", "03", "05"]);
  });
});
