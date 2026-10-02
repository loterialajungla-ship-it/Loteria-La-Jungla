import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { TicketNotFoundError } from "@/lib/tickets/errors";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";
import { parseAdminListTicketsQuery } from "@/lib/tickets/admin-ticket-query";
import { puedeVerTicketVenta } from "@/lib/tickets/vendor-tickets";
import {
  derivarEstadoTicketPublico,
  liquidarLineaPublica,
} from "@/lib/tickets/ticket-liquidation";
import { Prisma } from "@prisma/client";

describe("puedeVerTicketVenta", () => {
  it("vendedor obtiene solo los suyos", () => {
    assert.equal(
      puedeVerTicketVenta({
        rol: "VENDEDOR",
        actorUserId: "v1",
        ticketVendedorId: "v1",
      }),
      true,
    );
  });

  it("vendedor no obtiene tickets ajenos", () => {
    assert.equal(
      puedeVerTicketVenta({
        rol: "VENDEDOR",
        actorUserId: "v1",
        ticketVendedorId: "v2",
      }),
      false,
    );
  });

  it("vendedor no ve históricos con vendedorId null", () => {
    assert.equal(
      puedeVerTicketVenta({
        rol: "VENDEDOR",
        actorUserId: "v1",
        ticketVendedorId: null,
      }),
      false,
    );
  });

  it("ADMIN puede consultar cualquiera", () => {
    assert.equal(
      puedeVerTicketVenta({
        rol: "ADMIN",
        actorUserId: "a1",
        ticketVendedorId: "v2",
      }),
      true,
    );
    assert.equal(
      puedeVerTicketVenta({
        rol: "ADMIN",
        actorUserId: "a1",
        ticketVendedorId: null,
      }),
      true,
    );
  });
});

describe("API venta tickets — auth / 404", () => {
  it("sin sesión → 401", async () => {
    const res = jsonAuthError(new UnauthorizedError());
    assert.equal(res.status, 401);
  });

  it("rol no autorizado → 403", async () => {
    const res = jsonAuthError(new ForbiddenError());
    assert.equal(res.status, 403);
  });

  it("ticket inexistente o ajeno → 404 indistinguible", () => {
    const mapped = mapTicketErrorToHttp(new TicketNotFoundError());
    assert.equal(mapped.status, 404);
    assert.equal(mapped.body.error.code, "TICKET_NOT_FOUND");
  });
});

describe("filtros y paginación (parse compartido)", () => {
  it("filtro fecha", () => {
    const f = parseAdminListTicketsQuery({ fecha: "2026-10-02" });
    assert.equal(f.fechaJuegoStr, "2026-10-02");
  });

  it("filtro estado", () => {
    assert.equal(
      parseAdminListTicketsQuery({ estado: "EMITIDO" }).estado,
      "EMITIDO",
    );
    assert.equal(
      parseAdminListTicketsQuery({ estado: "ANULADO" }).estado,
      "ANULADO",
    );
  });

  it("paginación pageSize máx 100", () => {
    const f = parseAdminListTicketsQuery({ page: "2", pageSize: "500" });
    assert.equal(f.page, 2);
    assert.equal(f.pageSize, 100);
  });

  it("búsqueda numeroVisible exacta (normalizada)", () => {
    const f = parseAdminListTicketsQuery({
      numero: "lj-20261002-000125",
    });
    assert.equal(f.numeroVisible, "LJ-20261002-000125");
  });
});

describe("estado / premio derivado en historial", () => {
  const linea = {
    id: "l1",
    hora: 12,
    numeroAnimal: "05",
    nombreAnimalSnapshot: "Ballena",
    importe: new Prisma.Decimal("3.00"),
  };

  it("estado derivado correcto y premio", () => {
    const liq = liquidarLineaPublica({
      ticketAnulado: false,
      linea,
      resultado: { numero: "05", nombre: "Ballena" },
      multiplicadorUsado: 30,
    });
    assert.equal(liq.estado, "GANADORA");
    assert.equal(liq.premio, "90.00");
    assert.equal(
      derivarEstadoTicketPublico({
        ticketAnulado: false,
        estadosLineas: [liq.estado],
      }),
      "GANADOR",
    );
  });

  it("ticket anulado aparece como ANULADO", () => {
    const liq = liquidarLineaPublica({
      ticketAnulado: true,
      linea,
      resultado: { numero: "05", nombre: "Ballena" },
      multiplicadorUsado: 30,
    });
    assert.equal(
      derivarEstadoTicketPublico({
        ticketAnulado: true,
        estadosLineas: [liq.estado],
      }),
      "ANULADO",
    );
  });
});

/**
 * Integración DB / e2e pendiente:
 * - listVendorTickets filtra por vendedorId en PostgreSQL
 * - getVendorTicketById 404 para ticket ajeno por id y por numeroVisible
 * - TicketPreview + imagen en /venta/tickets/[id]
 * - navegación filtros/paginación UI
 */
