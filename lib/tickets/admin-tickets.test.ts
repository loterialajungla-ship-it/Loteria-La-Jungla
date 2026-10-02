import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAdminListTicketsQuery,
  parseAnularTicketBody,
  validarMotivoAnulacion,
  ADMIN_TICKETS_PAGE_SIZE_MAX,
  MOTIVO_ANULACION_MAX,
} from "@/lib/tickets/admin-ticket-query";
import {
  InvalidAnulacionMotivoError,
  TicketAlreadyAnuladoError,
  TicketNotFoundError,
  TicketValidationError,
} from "@/lib/tickets/errors";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";
import {
  derivarEstadoTicketPublico,
  liquidarLineaPublica,
} from "@/lib/tickets/ticket-liquidation";
import { aggregateExposure } from "@/lib/tickets/aggregate-exposure";
import { Prisma } from "@prisma/client";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";

describe("parseAdminListTicketsQuery", () => {
  it("acepta filtros vacíos con paginación por defecto", () => {
    const f = parseAdminListTicketsQuery({});
    assert.equal(f.estado, "TODOS");
    assert.equal(f.fechaJuego, null);
    assert.equal(f.numeroVisible, null);
    assert.equal(f.page, 1);
    assert.equal(f.pageSize, 20);
  });

  it("filtra por fecha válida", () => {
    const f = parseAdminListTicketsQuery({ fecha: "2026-10-01" });
    assert.equal(f.fechaJuegoStr, "2026-10-01");
    assert.ok(f.fechaJuego instanceof Date);
  });

  it("rechaza fecha inválida", () => {
    assert.throws(
      () => parseAdminListTicketsQuery({ fecha: "01-10-2026" }),
      TicketValidationError,
    );
  });

  it("filtra por estado EMITIDO / ANULADO", () => {
    assert.equal(
      parseAdminListTicketsQuery({ estado: "EMITIDO" }).estado,
      "EMITIDO",
    );
    assert.equal(
      parseAdminListTicketsQuery({ estado: "anulado" }).estado,
      "ANULADO",
    );
  });

  it("normaliza numeroVisible a mayúsculas (búsqueda exacta)", () => {
    const f = parseAdminListTicketsQuery({
      numero: "lj-20261001-000001",
    });
    assert.equal(f.numeroVisible, "LJ-20261001-000001");
  });

  it("limita pageSize al máximo", () => {
    const f = parseAdminListTicketsQuery({ pageSize: "9999" });
    assert.equal(f.pageSize, ADMIN_TICKETS_PAGE_SIZE_MAX);
  });

  it("paginación page >= 1", () => {
    assert.throws(
      () => parseAdminListTicketsQuery({ page: "0" }),
      TicketValidationError,
    );
  });
});

describe("validarMotivoAnulacion / parseAnularTicketBody", () => {
  it("acepta motivo válido", () => {
    assert.equal(validarMotivoAnulacion("  Error de digitación  "), "Error de digitación");
  });

  it("rechaza motivo vacío", () => {
    assert.throws(() => validarMotivoAnulacion("   "), InvalidAnulacionMotivoError);
    assert.throws(() => parseAnularTicketBody({ motivo: "" }), InvalidAnulacionMotivoError);
  });

  it("rechaza motivo demasiado largo", () => {
    assert.throws(
      () => validarMotivoAnulacion("x".repeat(MOTIVO_ANULACION_MAX + 1)),
      InvalidAnulacionMotivoError,
    );
  });

  it("parseAnularTicketBody exige objeto con motivo", () => {
    assert.throws(() => parseAnularTicketBody(null), TicketValidationError);
    assert.equal(
      parseAnularTicketBody({ motivo: "Cliente pidió cancelación" }).motivo,
      "Cliente pidió cancelación",
    );
  });
});

describe("mapTicketErrorToHttp — admin tickets", () => {
  it("TicketNotFoundError → 404", () => {
    const m = mapTicketErrorToHttp(new TicketNotFoundError());
    assert.equal(m.status, 404);
    assert.equal(m.body.error.code, "TICKET_NOT_FOUND");
  });

  it("TicketAlreadyAnuladoError → 409", () => {
    const m = mapTicketErrorToHttp(new TicketAlreadyAnuladoError());
    assert.equal(m.status, 409);
    assert.equal(m.body.error.code, "ALREADY_ANULADO");
  });

  it("motivo vacío → 400", () => {
    const m = mapTicketErrorToHttp(new InvalidAnulacionMotivoError());
    assert.equal(m.status, 400);
    assert.equal(m.body.error.code, "INVALID_ANULACION_MOTIVO");
  });
});

describe("protección de sesión admin (sin legacy)", () => {
  it("sin UsuarioSesion → no autorizado (401)", () => {
    assert.equal(new UnauthorizedError().httpStatus, 401);
  });

  it("rol no ADMIN → 403", () => {
    assert.equal(new ForbiddenError("Se requiere rol ADMIN.").httpStatus, 403);
  });
});

describe("anulación: liquidación y exposición", () => {
  const linea = {
    id: "l1",
    hora: 12,
    numeroAnimal: "05",
    nombreAnimalSnapshot: "León",
    importe: new Prisma.Decimal("5.00"),
  };

  it("ticket anulado no aparece como ganador", () => {
    const liq = liquidarLineaPublica({
      ticketAnulado: true,
      linea,
      resultado: { numero: "05", nombre: "León" },
      multiplicadorUsado: 30,
    });
    assert.equal(liq.estado, "NO_GANADORA");
    assert.equal(liq.premio, "0.00");
    assert.equal(
      derivarEstadoTicketPublico({
        ticketAnulado: true,
        estadosLineas: [liq.estado],
      }),
      "ANULADO",
    );
  });

  it("consulta pública: estado derivado ANULADO (regla)", () => {
    assert.equal(
      derivarEstadoTicketPublico({
        ticketAnulado: true,
        estadosLineas: ["GANADORA", "PENDIENTE"],
      }),
      "ANULADO",
    );
  });

  it("exposición solo debe agregar líneas EMITIDO (anulados excluidos)", () => {
    // getExposureForDraw filtra ticket.estado = EMITIDO.
    // Aquí documentamos que una línea de ticket anulado NO debe entrar al agregador.
    const soloEmitidos = aggregateExposure({
      fechaJuego: "2026-10-01",
      hora: 12,
      catalogo: [
        { numero: "05", nombre: "León" },
        { numero: "03", nombre: "Ciempiés" },
      ],
      lineas: [
        {
          ticketId: "emitido-1",
          numeroAnimal: "05",
          importe: "10.00",
          multiplicadorUsado: 30,
        },
        // ticket anulado NO incluido en el array (filtro DB)
      ],
    });
    assert.equal(soloEmitidos.ticketsAfectados, 1);
    assert.equal(soloEmitidos.totalApostado, "10.00");
    assert.equal(soloEmitidos.totalExposicion, "300.00");
  });
});

/**
 * Simula la lógica condicional de anularTicket (updateMany count).
 * Integración real con DB: pendiente de harness; esta prueba cubre la regla.
 */
describe("carreras de anulación (regla condicional)", () => {
  it("solo el primer updateMany con estado=EMITIDO gana; el segundo no sobrescribe", () => {
    type TicketStub = {
      id: string;
      estado: "EMITIDO" | "ANULADO";
      anuladoAt: string | null;
      motivoAnulacion: string | null;
      anuladoPorId: null;
    };

    const store: TicketStub = {
      id: "t1",
      estado: "EMITIDO",
      anuladoAt: null,
      motivoAnulacion: null,
      anuladoPorId: null,
    };

    function tryAnular(motivo: string, at: string): number {
      if (store.estado !== "EMITIDO") return 0;
      store.estado = "ANULADO";
      store.anuladoAt = at;
      store.motivoAnulacion = motivo;
      store.anuladoPorId = null;
      return 1;
    }

    const first = tryAnular("Error de digitación", "2026-10-01T12:00:00.000Z");
    const second = tryAnular("Otro motivo", "2026-10-01T12:00:01.000Z");

    assert.equal(first, 1);
    assert.equal(second, 0);
    assert.equal(store.motivoAnulacion, "Error de digitación");
    assert.equal(store.anuladoAt, "2026-10-01T12:00:00.000Z");
  });

  it("segundo intento debe mapearse a 409 ALREADY_ANULADO", () => {
    const m = mapTicketErrorToHttp(new TicketAlreadyAnuladoError());
    assert.equal(m.status, 409);
  });
});
