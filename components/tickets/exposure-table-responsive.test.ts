import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExposureTable } from "@/components/tickets/ExposureTable";
import type { ExposicionSorteo } from "@/lib/tickets/aggregate-exposure";

const sample: ExposicionSorteo = {
  fechaJuego: "2026-11-01",
  hora: 10,
  totalApostado: "10.00",
  totalExposicion: "300.00",
  mayorExposicion: "150.00",
  ticketsAfectados: 2,
  animales: [
    {
      numeroAnimal: "03",
      nombreAnimal: "Delfín",
      totalApostado: "5.00",
      exposicion: "150.00",
      ticketsAfectados: 1,
    },
    {
      numeroAnimal: "05",
      nombreAnimal: "León",
      totalApostado: "5.00",
      exposicion: "150.00",
      ticketsAfectados: 1,
    },
  ],
};

describe("ExposureTable — táctil y layout (D.3.F)", () => {
  it("botones de ordenación ≥ min-h-11; conserva datos y columnas", () => {
    const html = renderToStaticMarkup(
      createElement(ExposureTable, { exposicion: sample }),
    );
    assert.match(html, /min-h-11/);
    assert.match(html, /Animal/);
    assert.match(html, /Jugado/);
    assert.match(html, /Exposición/);
    assert.match(html, /Tickets/);
    assert.match(html, /Delfín/);
    assert.match(html, /León/);
    assert.match(html, /Total jugado/);
    assert.match(html, /Mayor exposición/);
    assert.match(html, /aria-sort/);
    assert.match(html, /type="button"/);
  });

  it("scroll local max-w-full; no altera ciclo de sort en fuente", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "ExposureTable.tsx"),
      "utf8",
    );
    assert.match(src, /max-w-full overflow-x-auto/);
    assert.match(src, /min-h-11/);
    assert.match(src, /cycleExposureSort/);
    assert.match(src, /sortExposureAnimals/);
    assert.doesNotMatch(src, /min-h-10/);
  });
});

void React;
