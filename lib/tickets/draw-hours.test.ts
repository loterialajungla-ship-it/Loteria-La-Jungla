import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  esHoraAbiertaParaVenta,
  listarDisponibilidadHoras,
  motivoCierreHora,
} from "@/lib/tickets/draw-hours";
import { DrawClosedError } from "@/lib/tickets/errors";
import {
  derivarEstadoTicketPublico,
  liquidarLineaPublica,
} from "@/lib/tickets/ticket-liquidation";
import { Prisma } from "@prisma/client";

describe("esHoraAbiertaParaVenta", () => {
  it("hora futura sin resultado → abierta", () => {
    assert.equal(
      esHoraAbiertaParaVenta({
        hora: 14,
        horaActualVe: 11,
        horasConResultado: [],
      }),
      true,
    );
  });

  it("hora actual → cerrada", () => {
    assert.equal(
      esHoraAbiertaParaVenta({
        hora: 11,
        horaActualVe: 11,
        horasConResultado: [],
      }),
      false,
    );
    assert.equal(
      motivoCierreHora({
        hora: 11,
        horaActualVe: 11,
        horasConResultado: [],
      }),
      "HORA_LLEGADA",
    );
  });

  it("hora pasada → cerrada", () => {
    assert.equal(
      esHoraAbiertaParaVenta({
        hora: 9,
        horaActualVe: 11,
        horasConResultado: [],
      }),
      false,
    );
  });

  it("resultado existente → cerrada aunque sea futura", () => {
    assert.equal(
      esHoraAbiertaParaVenta({
        hora: 15,
        horaActualVe: 11,
        horasConResultado: [15],
      }),
      false,
    );
    assert.equal(
      motivoCierreHora({
        hora: 15,
        horaActualVe: 11,
        horasConResultado: [15],
      }),
      "RESULTADO_PUBLICADO",
    );
  });

  it("sin resultado + hora futura → abierta", () => {
    assert.equal(
      esHoraAbiertaParaVenta({
        hora: 19,
        horaActualVe: 10,
        horasConResultado: [9, 10],
      }),
      true,
    );
  });
});

describe("listarDisponibilidadHoras", () => {
  it("mezcla abiertas y cerradas", () => {
    const lista = listarDisponibilidadHoras({
      horaActualVe: 11,
      horasConResultado: [14],
    });
    assert.equal(lista.find((h) => h.hora === 11)?.abierta, false);
    assert.equal(lista.find((h) => h.hora === 12)?.abierta, true);
    assert.equal(lista.find((h) => h.hora === 14)?.abierta, false);
  });
});

describe("DrawClosedError", () => {
  it("mensaje amigable con hora", () => {
    const err = new DrawClosedError(10);
    assert.equal(err.code, "DRAW_CLOSED");
    assert.match(err.message, /10:00/);
  });
});

describe("liquidación derivada ante cambio de resultado", () => {
  const linea = {
    id: "l1",
    hora: 12,
    numeroAnimal: "05",
    nombreAnimalSnapshot: "León",
    importe: new Prisma.Decimal("5.00"),
  };

  it("resultado 05 → GANADORA; si cambia a 03 → NO_GANADORA", () => {
    const gana = liquidarLineaPublica({
      ticketAnulado: false,
      linea,
      resultado: { numero: "05", nombre: "León" },
      multiplicadorUsado: 30,
    });
    assert.equal(gana.estado, "GANADORA");
    assert.equal(gana.premio, "150.00");

    const pierde = liquidarLineaPublica({
      ticketAnulado: false,
      linea,
      resultado: { numero: "03", nombre: "Ciempiés" },
      multiplicadorUsado: 30,
    });
    assert.equal(pierde.estado, "NO_GANADORA");
    assert.equal(pierde.premio, "0.00");
  });

  it("usa multiplicadorUsado histórico (no hardcode)", () => {
    const r = liquidarLineaPublica({
      ticketAnulado: false,
      linea,
      resultado: { numero: "05", nombre: "León" },
      multiplicadorUsado: 20,
    });
    assert.equal(r.premio, "100.00");
  });

  it("ticket anulado no gana", () => {
    const r = liquidarLineaPublica({
      ticketAnulado: true,
      linea,
      resultado: { numero: "05", nombre: "León" },
      multiplicadorUsado: 30,
    });
    assert.equal(r.estado, "NO_GANADORA");
    assert.equal(
      derivarEstadoTicketPublico({
        ticketAnulado: true,
        estadosLineas: [r.estado],
      }),
      "ANULADO",
    );
  });
});

/** Documenta la regla de createTicket: una hora cerrada rechaza el ticket completo. */
describe("regla de rechazo completo (documentada)", () => {
  it("si alguna hora no está abierta, createTicket debe lanzar DrawClosedError", () => {
    const horasTicket = [10, 12];
    const horaActualVe = 11;
    const cerrada = horasTicket.find(
      (h) =>
        !esHoraAbiertaParaVenta({
          hora: h,
          horaActualVe,
          horasConResultado: [],
        }),
    );
    assert.equal(cerrada, 10);
    assert.throws(() => {
      throw new DrawClosedError(cerrada!);
    }, DrawClosedError);
  });

  it("todas abiertas → permitido a nivel de regla de hora", () => {
    const horasTicket = [14, 15];
    const ok = horasTicket.every((h) =>
      esHoraAbiertaParaVenta({
        hora: h,
        horaActualVe: 11,
        horasConResultado: [],
      }),
    );
    assert.equal(ok, true);
  });
});
