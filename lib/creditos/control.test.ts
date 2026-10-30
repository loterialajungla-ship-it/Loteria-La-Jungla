import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  cuentaCoherenteConLibro,
  esSaldoBajo,
  esTipoOrigenCorregible,
  saldoEsperadoDesdeMovimientos,
  ventaSujetaAControlCreditos,
} from "@/lib/creditos/control";

describe("esTipoOrigenCorregible", () => {
  it("permite ASIGNACION, RETIRO y CORRECCION; rechaza consumo y devolución", () => {
    assert.equal(esTipoOrigenCorregible("ASIGNACION"), true);
    assert.equal(esTipoOrigenCorregible("RETIRO"), true);
    assert.equal(esTipoOrigenCorregible("CORRECCION"), true);
    assert.equal(esTipoOrigenCorregible("CONSUMO_VENTA"), false);
    assert.equal(esTipoOrigenCorregible("DEVOLUCION_ANULACION"), false);
  });
});

describe("ventaSujetaAControlCreditos", () => {
  const inicio = new Date("2026-11-01T04:00:00.000Z"); // ej. medianoche Caracas UTC-4

  const configOn = {
    controlActivo: true,
    inicioEn: inicio,
    umbralSaldoBajo: null,
  };

  it("control desactivado → false aunque haya inicioEn", () => {
    assert.equal(
      ventaSujetaAControlCreditos({
        config: { ...configOn, controlActivo: false },
        actorRol: "VENDEDOR",
        vendedorId: "v1",
        ticketCreatedAt: new Date("2026-11-02T12:00:00.000Z"),
      }),
      false,
    );
  });

  it("inicioEn null → false aunque controlActivo", () => {
    assert.equal(
      ventaSujetaAControlCreditos({
        config: { controlActivo: true, inicioEn: null, umbralSaldoBajo: null },
        actorRol: "VENDEDOR",
        vendedorId: "v1",
        ticketCreatedAt: new Date("2026-11-02T12:00:00.000Z"),
      }),
      false,
    );
  });

  it("ADMIN exento aunque createdAt posterior al inicio", () => {
    assert.equal(
      ventaSujetaAControlCreditos({
        config: configOn,
        actorRol: "ADMIN",
        vendedorId: "v1",
        ticketCreatedAt: new Date("2026-11-02T12:00:00.000Z"),
      }),
      false,
    );
  });

  it("vendedorId null (histórico) → false", () => {
    assert.equal(
      ventaSujetaAControlCreditos({
        config: configOn,
        actorRol: "VENDEDOR",
        vendedorId: null,
        ticketCreatedAt: new Date("2026-11-02T12:00:00.000Z"),
      }),
      false,
    );
  });

  it("createdAt antes del inicio → false", () => {
    assert.equal(
      ventaSujetaAControlCreditos({
        config: configOn,
        actorRol: "VENDEDOR",
        vendedorId: "v1",
        ticketCreatedAt: new Date("2026-10-31T23:59:59.000Z"),
      }),
      false,
    );
  });

  it("createdAt exactamente en inicioEn → true", () => {
    assert.equal(
      ventaSujetaAControlCreditos({
        config: configOn,
        actorRol: "VENDEDOR",
        vendedorId: "v1",
        ticketCreatedAt: new Date(inicio),
      }),
      true,
    );
  });

  it("createdAt después del inicio → true", () => {
    assert.equal(
      ventaSujetaAControlCreditos({
        config: configOn,
        actorRol: "VENDEDOR",
        vendedorId: "v1",
        ticketCreatedAt: new Date("2026-11-01T04:00:00.001Z"),
      }),
      true,
    );
  });

  it("fechaJuego no influye (pasada solo para documentar ignoro)", () => {
    const fechaJuegoFutura = new Date(Date.UTC(2099, 0, 1));
    const createdAtAntes = new Date("2026-10-31T12:00:00.000Z");
    assert.equal(
      ventaSujetaAControlCreditos({
        config: configOn,
        actorRol: "VENDEDOR",
        vendedorId: "v1",
        ticketCreatedAt: createdAtAntes,
        fechaJuegoIgnorada: fechaJuegoFutura,
      }),
      false,
    );
  });
});

describe("esSaldoBajo", () => {
  it("sin umbral → false", () => {
    assert.equal(esSaldoBajo("10.00", null), false);
  });

  it("saldo igual al umbral → true", () => {
    assert.equal(esSaldoBajo("5.00", "5.00"), true);
  });

  it("saldo por debajo → true; por encima → false", () => {
    assert.equal(esSaldoBajo("4.99", "5"), true);
    assert.equal(esSaldoBajo("5.01", "5"), false);
  });
});

describe("coherencia libro ↔ saldo", () => {
  it("suma neta de movimientos coincide con saldo", () => {
    const movimientos = [
      {
        tipo: "ASIGNACION" as const,
        importe: new Prisma.Decimal("100.00"),
        saldoAnterior: new Prisma.Decimal("0"),
        saldoPosterior: new Prisma.Decimal("100.00"),
      },
      {
        tipo: "CONSUMO_VENTA" as const,
        importe: new Prisma.Decimal("30.50"),
        saldoAnterior: new Prisma.Decimal("100.00"),
        saldoPosterior: new Prisma.Decimal("69.50"),
      },
      {
        tipo: "CORRECCION" as const,
        importe: new Prisma.Decimal("0.50"),
        saldoAnterior: new Prisma.Decimal("69.50"),
        saldoPosterior: new Prisma.Decimal("70.00"),
      },
    ];
    assert.equal(
      saldoEsperadoDesdeMovimientos(movimientos).toFixed(2),
      "70.00",
    );
    assert.equal(
      cuentaCoherenteConLibro(new Prisma.Decimal("70.00"), movimientos),
      true,
    );
    assert.equal(
      cuentaCoherenteConLibro(new Prisma.Decimal("69.00"), movimientos),
      false,
    );
  });
});
