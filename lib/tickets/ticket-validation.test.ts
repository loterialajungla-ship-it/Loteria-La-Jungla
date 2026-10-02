import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  DuplicateTicketLineError,
  EmptyTicketLinesError,
  InvalidBetAmountError,
  InvalidDrawHourError,
  InvalidGameDateError,
} from "@/lib/tickets/errors";
import { formatearNumeroVisible } from "@/lib/tickets/ticket-number";
import {
  parsearImporte,
  sumarImportes,
  validarFechaJuegoHoy,
  validarHoraSorteo,
  validarLineasBasicas,
} from "@/lib/tickets/ticket-validation";
import { hoyYYYYMMDD } from "@/lib/fecha";

describe("validarFechaJuegoHoy", () => {
  const fijo = new Date("2026-10-01T15:00:00.000Z"); // ~11:00 Caracas (UTC-4)

  it("acepta la fecha de hoy en America/Caracas", () => {
    const hoy = hoyYYYYMMDD(fijo);
    const fecha = validarFechaJuegoHoy(hoy, fijo);
    assert.equal(fecha.toISOString().slice(0, 10), hoy);
  });

  it("rechaza fecha futura", () => {
    assert.throws(
      () => validarFechaJuegoHoy("2099-01-01", fijo),
      InvalidGameDateError,
    );
  });

  it("rechaza fecha pasada", () => {
    assert.throws(
      () => validarFechaJuegoHoy("2020-01-01", fijo),
      InvalidGameDateError,
    );
  });

  it("rechaza fecha inválida", () => {
    assert.throws(
      () => validarFechaJuegoHoy("no-es-fecha", fijo),
      InvalidGameDateError,
    );
  });
});

describe("validarHoraSorteo", () => {
  it("acepta hora válida de HORAS_SORTEO", () => {
    assert.doesNotThrow(() => validarHoraSorteo(10));
    assert.doesNotThrow(() => validarHoraSorteo(19));
  });

  it("rechaza hora inválida", () => {
    assert.throws(() => validarHoraSorteo(8), InvalidDrawHourError);
    assert.throws(() => validarHoraSorteo(20), InvalidDrawHourError);
    assert.throws(() => validarHoraSorteo(10.5), InvalidDrawHourError);
  });
});

describe("parsearImporte", () => {
  it("acepta importe positivo con 2 decimales", () => {
    const d = parsearImporte("2.00");
    assert.equal(d.toFixed(2), "2.00");
  });

  it("rechaza cero", () => {
    assert.throws(() => parsearImporte("0"), InvalidBetAmountError);
    assert.throws(() => parsearImporte("0.00"), InvalidBetAmountError);
  });

  it("rechaza negativo", () => {
    assert.throws(() => parsearImporte("-1.00"), InvalidBetAmountError);
  });

  it("rechaza más de 2 decimales", () => {
    assert.throws(() => parsearImporte("1.234"), InvalidBetAmountError);
  });

  it("rechaza string inválido", () => {
    assert.throws(() => parsearImporte("abc"), InvalidBetAmountError);
    assert.throws(() => parsearImporte(""), InvalidBetAmountError);
  });
});

describe("validarLineasBasicas", () => {
  it("rechaza ticket sin líneas", () => {
    assert.throws(() => validarLineasBasicas([]), EmptyTicketLinesError);
  });

  it("rechaza líneas duplicadas misma hora + animal", () => {
    assert.throws(
      () =>
        validarLineasBasicas([
          { hora: 10, numeroAnimal: "03", importe: "2.00" },
          { hora: 10, numeroAnimal: "03", importe: "5.00" },
        ]),
      DuplicateTicketLineError,
    );
  });

  it("acepta el mismo animal en horas distintas", () => {
    const lineas = validarLineasBasicas([
      { hora: 10, numeroAnimal: "03", importe: "2.00" },
      { hora: 12, numeroAnimal: "03", importe: "3.00" },
    ]);
    assert.equal(lineas.length, 2);
  });

  it("acepta estructura válida y suma importes", () => {
    const lineas = validarLineasBasicas([
      { hora: 10, numeroAnimal: "03", importe: "2.00" },
      { hora: 10, numeroAnimal: "15", importe: "5.00" },
      { hora: 12, numeroAnimal: "03", importe: "3.00" },
    ]);
    const total = sumarImportes(lineas.map((l) => l.importe));
    assert.equal(total.toFixed(2), "10.00");
    assert.ok(total instanceof Prisma.Decimal);
  });
});

describe("formatearNumeroVisible", () => {
  it("formatea LJ-YYYYMMDD-NNNNNN", () => {
    const fecha = new Date(Date.UTC(2026, 9, 1));
    assert.equal(formatearNumeroVisible(fecha, 1), "LJ-20261001-000001");
    assert.equal(formatearNumeroVisible(fecha, 125), "LJ-20261001-000125");
  });
});
