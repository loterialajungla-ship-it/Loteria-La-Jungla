import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { aggregateExposure } from "@/lib/tickets/aggregate-exposure";

const catalogo = [
  { numero: "0", nombre: "Delfín" },
  { numero: "00", nombre: "Ballena" },
  { numero: "03", nombre: "Ciempiés" },
  { numero: "04", nombre: "Alacrán" },
  { numero: "05", nombre: "León" },
];

describe("aggregateExposure", () => {
  it("sin tickets → totales en 0 y catálogo completo", () => {
    const r = aggregateExposure({
      fechaJuego: "2026-10-01",
      hora: 12,
      catalogo,
      lineas: [],
    });
    assert.equal(r.totalApostado, "0.00");
    assert.equal(r.totalExposicion, "0.00");
    assert.equal(r.mayorExposicion, "0.00");
    assert.equal(r.ticketsAfectados, 0);
    assert.equal(r.animales.length, catalogo.length);
    assert.equal(r.animales[0].numeroAnimal, "0");
  });

  it("un ticket con una línea → jugado y exposición correctos", () => {
    const r = aggregateExposure({
      fechaJuego: "2026-10-01",
      hora: 12,
      catalogo,
      lineas: [
        {
          ticketId: "t1",
          numeroAnimal: "03",
          importe: "5.00",
          multiplicadorUsado: 30,
        },
      ],
    });
    const a03 = r.animales.find((a) => a.numeroAnimal === "03")!;
    assert.equal(a03.totalApostado, "5.00");
    assert.equal(a03.exposicion, "150.00");
    assert.equal(a03.ticketsAfectados, 1);
    assert.equal(r.totalApostado, "5.00");
    assert.equal(r.totalExposicion, "150.00");
    assert.equal(r.mayorExposicion, "150.00");
  });

  it("varias líneas del mismo animal suman", () => {
    const r = aggregateExposure({
      fechaJuego: "2026-10-01",
      hora: 12,
      catalogo,
      lineas: [
        {
          ticketId: "t1",
          numeroAnimal: "03",
          importe: "2.00",
          multiplicadorUsado: 30,
        },
        {
          ticketId: "t2",
          numeroAnimal: "03",
          importe: "5.00",
          multiplicadorUsado: 30,
        },
      ],
    });
    const a03 = r.animales.find((a) => a.numeroAnimal === "03")!;
    assert.equal(a03.totalApostado, "7.00");
    assert.equal(a03.exposicion, "210.00");
    assert.equal(a03.ticketsAfectados, 2);
  });

  it("respeta multiplicadores distintos por ticket", () => {
    const r = aggregateExposure({
      fechaJuego: "2026-10-01",
      hora: 12,
      catalogo,
      lineas: [
        {
          ticketId: "t1",
          numeroAnimal: "03",
          importe: "10.00",
          multiplicadorUsado: 30,
        },
        {
          ticketId: "t2",
          numeroAnimal: "03",
          importe: "10.00",
          multiplicadorUsado: 20,
        },
      ],
    });
    const a03 = r.animales.find((a) => a.numeroAnimal === "03")!;
    // 10*30 + 10*20 = 500
    assert.equal(a03.exposicion, "500.00");
    assert.equal(r.totalExposicion, "500.00");
  });

  it("agrupa animales distintos y calcula mayor exposición", () => {
    const r = aggregateExposure({
      fechaJuego: "2026-10-01",
      hora: 12,
      catalogo,
      lineas: [
        {
          ticketId: "t1",
          numeroAnimal: "03",
          importe: "10.00",
          multiplicadorUsado: 30,
        },
        {
          ticketId: "t2",
          numeroAnimal: "05",
          importe: "100.00",
          multiplicadorUsado: 30,
        },
      ],
    });
    assert.equal(r.mayorExposicion, "3000.00");
    assert.equal(r.ticketsAfectados, 2);
  });

  it("mismo ticket con una sola línea en el sorteo cuenta una vez", () => {
    const r = aggregateExposure({
      fechaJuego: "2026-10-01",
      hora: 12,
      catalogo,
      lineas: [
        {
          ticketId: "t1",
          numeroAnimal: "03",
          importe: "1.00",
          multiplicadorUsado: 30,
        },
        {
          ticketId: "t1",
          numeroAnimal: "04",
          importe: "2.00",
          multiplicadorUsado: 30,
        },
      ],
    });
    assert.equal(r.ticketsAfectados, 1);
  });

  it("conserva precisión Decimal (centavos)", () => {
    const r = aggregateExposure({
      fechaJuego: "2026-10-01",
      hora: 12,
      catalogo,
      lineas: [
        {
          ticketId: "t1",
          numeroAnimal: "03",
          importe: new Prisma.Decimal("0.10"),
          multiplicadorUsado: 30,
        },
        {
          ticketId: "t2",
          numeroAnimal: "03",
          importe: new Prisma.Decimal("0.20"),
          multiplicadorUsado: 30,
        },
      ],
    });
    const a03 = r.animales.find((a) => a.numeroAnimal === "03")!;
    assert.equal(a03.totalApostado, "0.30");
    assert.equal(a03.exposicion, "9.00");
  });
});
