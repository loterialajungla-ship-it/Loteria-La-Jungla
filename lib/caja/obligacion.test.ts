import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { activarCaja } from "@/lib/caja/config";
import { setComisionVendedor } from "@/lib/caja/comision";
import {
  assertVendedorElegibleParaAtribucion,
  debeGenerarObligacion,
  maybeCreateCajaObligacionEnTx,
} from "@/lib/caja/obligacion";
import {
  CajaNotFoundError,
  CajaValidationError,
} from "@/lib/caja/errors";
import { calcularSplitComision, moneyFixed2 } from "@/lib/caja/money";
import { makeCajaFakeDb } from "@/lib/caja/test-fake-db";

describe("caja/obligacion — elegibilidad", () => {
  const activadaEn = new Date("2026-11-06T15:00:00.000Z");

  it("caja desactivada → no genera", () => {
    assert.equal(
      debeGenerarObligacion({
        cajaActiva: false,
        activadaEn,
        ticketCreatedAt: new Date("2026-11-06T16:00:00.000Z"),
        ticketVendedorRol: "VENDEDOR",
      }),
      false,
    );
  });

  it("ticket anterior a activadaEn → no genera", () => {
    assert.equal(
      debeGenerarObligacion({
        cajaActiva: true,
        activadaEn,
        ticketCreatedAt: new Date("2026-11-06T14:59:59.999Z"),
        ticketVendedorRol: "VENDEDOR",
      }),
      false,
    );
  });

  it("ticket posterior a activadaEn → genera", () => {
    assert.equal(
      debeGenerarObligacion({
        cajaActiva: true,
        activadaEn,
        ticketCreatedAt: new Date("2026-11-06T15:00:00.001Z"),
        ticketVendedorRol: "VENDEDOR",
      }),
      true,
    );
  });

  it("ticket con createdAt === activadaEn → incluye (regla ≥)", () => {
    assert.equal(
      debeGenerarObligacion({
        cajaActiva: true,
        activadaEn,
        ticketCreatedAt: new Date(activadaEn.getTime()),
        ticketVendedorRol: "VENDEDOR",
      }),
      true,
    );
  });

  it("venta ADMIN (rol ticket ≠ VENDEDOR) → no genera", () => {
    assert.equal(
      debeGenerarObligacion({
        cajaActiva: true,
        activadaEn,
        ticketCreatedAt: new Date("2026-11-06T16:00:00.000Z"),
        ticketVendedorRol: "ADMIN",
      }),
      false,
    );
  });
});

describe("caja/obligacion — cálculo snapshot", () => {
  it("1000 € al 20 % → comisión 200, admin 800", () => {
    const s = calcularSplitComision("1000.00", "20.00");
    assert.equal(moneyFixed2(s.bruto), "1000.00");
    assert.equal(moneyFixed2(s.comisionImporte), "200.00");
    assert.equal(moneyFixed2(s.importeAdmin), "800.00");
  });

  it("1000 € al 10 % → comisión 100, admin 900", () => {
    const s = calcularSplitComision("1000.00", "10.00");
    assert.equal(moneyFixed2(s.comisionImporte), "100.00");
    assert.equal(moneyFixed2(s.importeAdmin), "900.00");
  });

  it("ROUND_HALF_UP en split (0.005 → 0.01)", () => {
    // 1.00 × 0.5 % = 0.005 → ROUND_HALF_UP → 0.01
    const s = calcularSplitComision("1.00", "0.50");
    assert.equal(moneyFixed2(s.comisionImporte), "0.01");
    assert.equal(moneyFixed2(s.importeAdmin), "0.99");
  });
});

describe("caja/obligacion — persistencia y atribución", () => {
  it("maybeCreate: caja inactiva → null", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
    });
    const r = await maybeCreateCajaObligacionEnTx(db as never, {
      ticketId: "tk-1",
      ticketVendedorId: "vend-1",
      bruto: new Prisma.Decimal("100.00"),
      ticketCreatedAt: new Date("2026-11-06T16:00:00.000Z"),
      actorUserId: "vend-1",
      actorAdminId: null,
    });
    assert.equal(r, null);
    assert.equal(db.obligaciones.size, 0);
  });

  it("maybeCreate: ticket anterior al corte → null", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
    });
    const activadaEn = new Date("2026-11-06T15:00:00.000Z");
    await activarCaja(db as never, {
      actorAdminId: "admin-1",
      ahora: activadaEn,
    });
    const r = await maybeCreateCajaObligacionEnTx(db as never, {
      ticketId: "tk-old",
      ticketVendedorId: "vend-1",
      bruto: new Prisma.Decimal("100.00"),
      ticketCreatedAt: new Date("2026-11-06T14:00:00.000Z"),
      actorUserId: "vend-1",
      actorAdminId: null,
    });
    assert.equal(r, null);
    assert.equal(db.obligaciones.size, 0);
  });

  it("maybeCreate: elegible → snapshot; cambio comisión posterior no altera", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
    });
    const activadaEn = new Date("2026-11-06T15:00:00.000Z");
    await activarCaja(db as never, {
      actorAdminId: "admin-1",
      ahora: activadaEn,
    });

    const o1 = await maybeCreateCajaObligacionEnTx(db as never, {
      ticketId: "tk-1000",
      ticketVendedorId: "vend-1",
      bruto: new Prisma.Decimal("1000.00"),
      ticketCreatedAt: new Date("2026-11-06T16:00:00.000Z"),
      actorUserId: "vend-1",
      actorAdminId: null,
    });
    assert.ok(o1);
    assert.equal(moneyFixed2(o1!.bruto), "1000.00");
    assert.equal(moneyFixed2(o1!.comisionPorcentaje), "20.00");
    assert.equal(moneyFixed2(o1!.comisionImporte), "200.00");
    assert.equal(moneyFixed2(o1!.importeAdmin), "800.00");

    await setComisionVendedor(db as never, {
      vendedorId: "vend-1",
      porcentaje: "10.00",
      actorAdminId: "admin-1",
    });

    const stored = await db.cajaObligacion.findUnique({
      where: { ticketId: "tk-1000" },
    });
    assert.equal(moneyFixed2(stored.comisionPorcentaje), "20.00");
    assert.equal(moneyFixed2(stored.comisionImporte), "200.00");

    const o2 = await maybeCreateCajaObligacionEnTx(db as never, {
      ticketId: "tk-1000-b",
      ticketVendedorId: "vend-1",
      bruto: new Prisma.Decimal("1000.00"),
      ticketCreatedAt: new Date("2026-11-06T17:00:00.000Z"),
      actorUserId: "vend-1",
      actorAdminId: null,
    });
    assert.equal(moneyFixed2(o2!.comisionPorcentaje), "10.00");
    assert.equal(moneyFixed2(o2!.comisionImporte), "100.00");
    assert.equal(moneyFixed2(o2!.importeAdmin), "900.00");
  });

  it("unicidad ticketId: segunda obligación mismo ticket → P2002", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
    });
    await activarCaja(db as never, {
      actorAdminId: "admin-1",
      ahora: new Date("2026-11-06T15:00:00.000Z"),
    });
    await maybeCreateCajaObligacionEnTx(db as never, {
      ticketId: "tk-dup",
      ticketVendedorId: "vend-1",
      bruto: new Prisma.Decimal("50.00"),
      ticketCreatedAt: new Date("2026-11-06T16:00:00.000Z"),
      actorUserId: "vend-1",
      actorAdminId: null,
    });
    await assert.rejects(
      () =>
        maybeCreateCajaObligacionEnTx(db as never, {
          ticketId: "tk-dup",
          ticketVendedorId: "vend-1",
          bruto: new Prisma.Decimal("50.00"),
          ticketCreatedAt: new Date("2026-11-06T16:00:00.000Z"),
          actorUserId: "vend-1",
          actorAdminId: null,
        }),
      (e: unknown) =>
        e instanceof Error && (e as { code?: string }).code === "P2002",
    );
    assert.equal(db.obligaciones.size, 1);
  });

  it("auditoría CREAR_CAJA_OBLIGACION con snapshot", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
    });
    await activarCaja(db as never, {
      actorAdminId: "admin-1",
      ahora: new Date("2026-11-06T15:00:00.000Z"),
    });
    await maybeCreateCajaObligacionEnTx(db as never, {
      ticketId: "tk-aud",
      ticketVendedorId: "vend-1",
      bruto: new Prisma.Decimal("1000.00"),
      ticketCreatedAt: new Date("2026-11-06T16:00:00.000Z"),
      actorUserId: "vend-1",
      actorAdminId: null,
    });
    const aud = db.auditRows.filter(
      (r: { accion?: string }) => r.accion === "CREAR_CAJA_OBLIGACION",
    );
    assert.equal(aud.length, 1);
    const rawDetalle = (aud[0] as { detalle: string }).detalle;
    const det = JSON.parse(rawDetalle) as Record<string, string>;
    assert.equal(det.ticketId, "tk-aud");
    assert.equal(det.vendedorId, "vend-1");
    assert.equal(det.bruto, "1000.00");
    assert.equal(det.comisionPorcentaje, "20.00");
    assert.equal(det.comisionImporte, "200.00");
    assert.equal(det.importeAdmin, "800.00");
  });

  it("atribución: rechaza ADMIN / inexistente / inactivo", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-off", rol: "VENDEDOR", activo: false },
      ],
    });
    await assert.rejects(
      () => assertVendedorElegibleParaAtribucion(db as never, "admin-1"),
      CajaValidationError,
    );
    await assert.rejects(
      () => assertVendedorElegibleParaAtribucion(db as never, "no-existe"),
      CajaNotFoundError,
    );
    await assert.rejects(
      () => assertVendedorElegibleParaAtribucion(db as never, "vend-off"),
      CajaValidationError,
    );
  });
});
