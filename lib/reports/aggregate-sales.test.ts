import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { HORAS_SORTEO } from "@/lib/fecha";
import {
  aggregateSalesByAnimal,
  aggregateSalesByHour,
  aggregateSalesByVendor,
  sumMoneyStrings,
} from "@/lib/reports/aggregate-sales";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { InvalidGameDateError } from "@/lib/tickets/errors";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";
import { canAccessAdminApi } from "@/lib/acceptance/authorize-rules";

describe("aggregateSalesByVendor", () => {
  it("agrupa por vendedor y Sin vendedor", () => {
    const rows = aggregateSalesByVendor([
      {
        vendedorId: "a",
        nombre: "Carlos",
        usuario: "carlos",
        totalApostado: "10.00",
      },
      {
        vendedorId: "a",
        nombre: "Carlos",
        usuario: "carlos",
        totalApostado: "5.50",
      },
      {
        vendedorId: null,
        nombre: null,
        usuario: null,
        totalApostado: "3.00",
      },
    ]);

    assert.equal(rows.length, 2);
    const carlos = rows.find((r) => r.vendedorId === "a")!;
    assert.equal(carlos.tickets, 2);
    assert.equal(carlos.totalJugado, "15.50");
    assert.equal(carlos.nombre, "Carlos");

    const sin = rows.find((r) => r.vendedorId === null)!;
    assert.equal(sin.nombre, "Sin vendedor");
    assert.equal(sin.tickets, 1);
    assert.equal(sin.totalJugado, "3.00");
    assert.equal(sin.usuario, null);
  });

  it("suma de vendedores coincide con total (consistencia)", () => {
    const rows = aggregateSalesByVendor([
      {
        vendedorId: "a",
        nombre: "A",
        usuario: "a",
        totalApostado: new Prisma.Decimal("100.25"),
      },
      {
        vendedorId: null,
        nombre: null,
        usuario: null,
        totalApostado: "50.75",
      },
    ]);
    assert.equal(sumMoneyStrings(rows.map((r) => r.totalJugado)), "151.00");
  });
});

describe("aggregateSalesByHour", () => {
  it("incluye las 11 HORAS_SORTEO en orden, ceros incluidos", () => {
    const rows = aggregateSalesByHour([
      { hora: 14, numeroAnimal: "03", importe: "10.00" },
      { hora: 14, numeroAnimal: "05", importe: "2.50" },
      { hora: 9, numeroAnimal: "00", importe: "1.00" },
    ]);
    assert.equal(rows.length, HORAS_SORTEO.length);
    assert.equal(rows.length, 11);
    assert.deepEqual(
      rows.map((r) => r.hora),
      [...HORAS_SORTEO],
    );
    assert.equal(rows.find((r) => r.hora === 9)!.totalJugado, "1.00");
    assert.equal(rows.find((r) => r.hora === 14)!.totalJugado, "12.50");
    assert.equal(rows.find((r) => r.hora === 10)!.totalJugado, "0.00");
  });

  it("suma por hora = SUM líneas (consistencia)", () => {
    const lineas = [
      { hora: 11, numeroAnimal: "03", importe: "4.00" },
      { hora: 12, numeroAnimal: "05", importe: "6.10" },
    ];
    const rows = aggregateSalesByHour(lineas);
    assert.equal(sumMoneyStrings(rows.map((r) => r.totalJugado)), "10.10");
  });
});

describe("aggregateSalesByAnimal", () => {
  it("muestra catálogo completo ordenado con ceros (38 en seed prod)", () => {
    // Catálogo oficial seed.ts: 0, 00, 01…36 = 38
    const catalogo = Array.from({ length: 38 }, (_, i) => {
      if (i === 0) return { numero: "0", nombre: "Delfín" };
      if (i === 1) return { numero: "00", nombre: "Ballena" };
      const n = String(i - 1).padStart(2, "0");
      return { numero: n, nombre: `Animal ${n}` };
    });
    assert.equal(catalogo.length, 38);
    const rows = aggregateSalesByAnimal(
      [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
      catalogo,
    );
    assert.equal(rows.length, 38);
    assert.equal(rows[0]!.numeroAnimal, "0");
    assert.equal(rows.find((r) => r.numeroAnimal === "03")!.totalJugado, "1.00");
  });
});

describe("autorización / errores reportes", () => {
  it("ADMIN autorizado; VENDEDOR no; sin sesión no", () => {
    const admin = {
      id: "1",
      nombre: "A",
      usuario: "a",
      rol: "ADMIN" as const,
      activo: true,
    };
    const vend = {
      id: "2",
      nombre: "V",
      usuario: "v",
      rol: "VENDEDOR" as const,
      activo: true,
    };
    assert.equal(canAccessAdminApi(admin), true);
    assert.equal(canAccessAdminApi(vend), false);
    assert.equal(canAccessAdminApi(null), false);
  });

  it("fecha inválida → 400; auth → 401/403", async () => {
    const mapped = mapTicketErrorToHttp(
      new InvalidGameDateError("Fecha de juego inválida."),
    );
    assert.equal(mapped.status, 400);
    assert.equal(mapped.body.error.code, "INVALID_GAME_DATE");

    assert.equal(jsonAuthError(new UnauthorizedError()).status, 401);
    assert.equal(jsonAuthError(new ForbiddenError()).status, 403);
  });

  it("respuesta ok no incluye passwordHash", () => {
    const body = {
      ok: true,
      reporte: {
        ventas: { totalJugado: "10.00" },
        porVendedor: [
          {
            vendedorId: null,
            nombre: "Sin vendedor",
            tickets: 1,
            totalJugado: "10.00",
          },
        ],
      },
    };
    const json = JSON.stringify(body);
    assert.equal(json.includes("passwordHash"), false);
    assert.equal(json.includes("password"), false);
    assert.equal(json.includes("token"), false);
  });
});
