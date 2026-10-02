import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  calcularPremioTotalPublico,
  derivarEstadoTicketPublico,
  liquidarLineaPublica,
} from "@/lib/tickets/ticket-liquidation";

const lineaBase = {
  id: "l1",
  hora: 10,
  numeroAnimal: "03",
  nombreAnimalSnapshot: "Ciempiés",
  importe: new Prisma.Decimal("5.00"),
};

describe("liquidarLineaPublica", () => {
  it("PENDIENTE sin resultado", () => {
    const r = liquidarLineaPublica({
      ticketAnulado: false,
      linea: lineaBase,
      resultado: null,
      multiplicadorUsado: 30,
    });
    assert.equal(r.estado, "PENDIENTE");
    assert.equal(r.premio, null);
  });

  it("GANADORA = importe × multiplicadorUsado", () => {
    const r = liquidarLineaPublica({
      ticketAnulado: false,
      linea: lineaBase,
      resultado: { numero: "03", nombre: "Ciempiés" },
      multiplicadorUsado: 30,
    });
    assert.equal(r.estado, "GANADORA");
    assert.equal(r.premio, "150.00");
  });

  it("NO_GANADORA con resultado distinto", () => {
    const r = liquidarLineaPublica({
      ticketAnulado: false,
      linea: lineaBase,
      resultado: { numero: "05", nombre: "León" },
      multiplicadorUsado: 30,
    });
    assert.equal(r.estado, "NO_GANADORA");
    assert.equal(r.premio, "0.00");
  });

  it("ticket anulado nunca es GANADORA aunque coincida", () => {
    const r = liquidarLineaPublica({
      ticketAnulado: true,
      linea: lineaBase,
      resultado: { numero: "03", nombre: "Ciempiés" },
      multiplicadorUsado: 30,
    });
    assert.equal(r.estado, "NO_GANADORA");
    assert.equal(r.premio, "0.00");
  });
});

describe("derivarEstadoTicketPublico", () => {
  it("PENDIENTE si hay línea pendiente aunque otra gane", () => {
    assert.equal(
      derivarEstadoTicketPublico({
        ticketAnulado: false,
        estadosLineas: ["GANADORA", "PENDIENTE"],
      }),
      "PENDIENTE",
    );
  });

  it("GANADOR si todas resueltas y hay ganadora", () => {
    assert.equal(
      derivarEstadoTicketPublico({
        ticketAnulado: false,
        estadosLineas: ["GANADORA", "NO_GANADORA"],
      }),
      "GANADOR",
    );
  });

  it("NO_GANADOR si todas resueltas sin ganadora", () => {
    assert.equal(
      derivarEstadoTicketPublico({
        ticketAnulado: false,
        estadosLineas: ["NO_GANADORA", "NO_GANADORA"],
      }),
      "NO_GANADOR",
    );
  });

  it("ANULADO tiene prioridad", () => {
    assert.equal(
      derivarEstadoTicketPublico({
        ticketAnulado: true,
        estadosLineas: ["GANADORA"],
      }),
      "ANULADO",
    );
  });
});

describe("calcularPremioTotalPublico", () => {
  it("suma solo ganadoras y marca liquidación incompleta", () => {
    const r = calcularPremioTotalPublico({
      ticketAnulado: false,
      lineas: [
        { estado: "GANADORA", premio: "150.00" },
        { estado: "PENDIENTE", premio: null },
      ],
    });
    assert.equal(r.premioTotal, "150.00");
    assert.equal(r.liquidacionCompleta, false);
  });

  it("anulado → 0.00 completo", () => {
    const r = calcularPremioTotalPublico({
      ticketAnulado: true,
      lineas: [{ estado: "NO_GANADORA", premio: "0.00" }],
    });
    assert.equal(r.premioTotal, "0.00");
    assert.equal(r.liquidacionCompleta, true);
  });
});
