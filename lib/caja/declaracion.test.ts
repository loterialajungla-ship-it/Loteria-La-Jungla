import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { crearConfirmacionAdmin } from "@/lib/caja/confirmacion";
import {
  crearDeclaracionVendedor,
  listDeclaracionesVendedor,
} from "@/lib/caja/declaracion";
import {
  CajaForbiddenError,
  CajaIdempotencyConflictError,
  CajaValidationError,
} from "@/lib/caja/errors";
import { moneyFixed2, parseImporteCajaPositivo } from "@/lib/caja/money";
import {
  calcularTotalesCaja,
  estadoDeclaracion,
  getTotalesVendedor,
} from "@/lib/caja/resumen";
import { makeCajaFakeDb } from "@/lib/caja/test-fake-db";

function uuid(n: number): string {
  const h = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
}

function seedObligacion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  args: {
    vendedorId: string;
    importeAdmin: string;
    ticketId?: string;
    ticketCreatedAt?: Date;
  },
) {
  const id = `cjo_${Math.random().toString(16).slice(2)}`;
  const importe = new Prisma.Decimal(args.importeAdmin);
  return db.cajaObligacion.create({
    data: {
      id,
      ticketId: args.ticketId ?? `tkt_${id}`,
      vendedorId: args.vendedorId,
      bruto: importe,
      comisionPorcentaje: new Prisma.Decimal("0"),
      comisionImporte: new Prisma.Decimal("0"),
      importeAdmin: importe,
      ticketCreatedAt: args.ticketCreatedAt,
    },
  });
}

describe("caja C4 — totales y estado", () => {
  it("cálculos agregados (ejemplo 1000/300/200)", () => {
    const t = calcularTotalesCaja({
      totalObligado: new Prisma.Decimal("1000.00"),
      totalDeclarado: new Prisma.Decimal("300.00"),
      totalConfirmado: new Prisma.Decimal("200.00"),
      totalAplicado: new Prisma.Decimal("150.00"),
    });
    assert.equal(moneyFixed2(t.pendienteDeclarar), "700.00");
    assert.equal(moneyFixed2(t.pendienteConfirmar), "100.00");
    assert.equal(moneyFixed2(t.deudaPendienteEntregar), "800.00");
    assert.equal(moneyFixed2(t.maxNuevaDeclaracion), "700.00");
    assert.equal(moneyFixed2(t.totalAplicado), "150.00");
    assert.equal(moneyFixed2(t.pendienteAplicar), "50.00");
    assert.equal(moneyFixed2(t.totalPendienteObligaciones), "850.00");
    assert.equal(moneyFixed2(t.totalBruto), "0.00");
    assert.equal(moneyFixed2(t.totalComision), "0.00");
  });

  it("estadoDeclaracion PENDIENTE/PARCIAL/CONFIRMADA", () => {
    assert.equal(
      estadoDeclaracion({
        importeDeclarado: new Prisma.Decimal("100"),
        totalConfirmado: new Prisma.Decimal("0"),
      }),
      "PENDIENTE",
    );
    assert.equal(
      estadoDeclaracion({
        importeDeclarado: new Prisma.Decimal("100"),
        totalConfirmado: new Prisma.Decimal("40"),
      }),
      "PARCIAL",
    );
    assert.equal(
      estadoDeclaracion({
        importeDeclarado: new Prisma.Decimal("100"),
        totalConfirmado: new Prisma.Decimal("100"),
      }),
      "CONFIRMADA",
    );
  });

  it("parseImporteCajaPositivo rechaza 0 y negativo", () => {
    assert.throws(() => parseImporteCajaPositivo("0"), CajaValidationError);
    assert.throws(() => parseImporteCajaPositivo("-1"), CajaValidationError);
  });
});

describe("caja C4 — declaraciones", () => {
  it("vendedor declara correctamente", async () => {
    const db = makeCajaFakeDb({
      users: [{ id: "v1", rol: "VENDEDOR", activo: true }],
    });
    await seedObligacion(db, { vendedorId: "v1", importeAdmin: "1000.00" });
    const r = await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "500.00",
      idempotencyKey: uuid(1),
    });
    assert.equal(r.idempotentReplay, false);
    assert.equal(moneyFixed2(r.declaracion.importeDeclarado), "500.00");
    assert.equal(r.declaracion.estado, "PENDIENTE");
    assert.equal(db.auditRows.length, 1);
    assert.equal(
      (db.auditRows[0] as { accion: string }).accion,
      "CREAR_CAJA_DECLARACION",
    );
  });

  it("declaración parcial y varias sucesivas", async () => {
    const db = makeCajaFakeDb({
      users: [{ id: "v1", rol: "VENDEDOR", activo: true }],
    });
    await seedObligacion(db, { vendedorId: "v1", importeAdmin: "1000.00" });
    await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "300.00",
      idempotencyKey: uuid(2),
    });
    await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "400.00",
      idempotencyKey: uuid(3),
    });
    const tot = await getTotalesVendedor(db, "v1");
    assert.equal(moneyFixed2(tot.totalDeclarado), "700.00");
    assert.equal(moneyFixed2(tot.pendienteDeclarar), "300.00");
    const list = await listDeclaracionesVendedor(db, "v1");
    assert.equal(list.length, 2);
  });

  it("rechaza importe cero y negativo", async () => {
    const db = makeCajaFakeDb({
      users: [{ id: "v1", rol: "VENDEDOR", activo: true }],
    });
    await seedObligacion(db, { vendedorId: "v1", importeAdmin: "100.00" });
    await assert.rejects(
      () =>
        crearDeclaracionVendedor(db, {
          actorUserId: "v1",
          actorRol: "VENDEDOR",
          importe: "0",
          idempotencyKey: uuid(4),
        }),
      CajaValidationError,
    );
    await assert.rejects(
      () =>
        crearDeclaracionVendedor(db, {
          actorUserId: "v1",
          actorRol: "VENDEDOR",
          importe: "-5",
          idempotencyKey: uuid(5),
        }),
      CajaValidationError,
    );
  });

  it("rechaza importe superior a pendiente declarar", async () => {
    const db = makeCajaFakeDb({
      users: [{ id: "v1", rol: "VENDEDOR", activo: true }],
    });
    await seedObligacion(db, { vendedorId: "v1", importeAdmin: "1000.00" });
    await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "300.00",
      idempotencyKey: uuid(6),
    });
    await assert.rejects(
      () =>
        crearDeclaracionVendedor(db, {
          actorUserId: "v1",
          actorRol: "VENDEDOR",
          importe: "701.00",
          idempotencyKey: uuid(7),
        }),
      (e: unknown) =>
        e instanceof CajaValidationError && e.code === "CAJA_SOBREDECLARACION",
    );
  });

  it("ADMIN no puede usar el endpoint de declaración", async () => {
    const db = makeCajaFakeDb({
      users: [{ id: "a1", rol: "ADMIN", activo: true }],
    });
    await assert.rejects(
      () =>
        crearDeclaracionVendedor(db, {
          actorUserId: "a1",
          actorRol: "ADMIN",
          importe: "10",
          idempotencyKey: uuid(8),
        }),
      CajaForbiddenError,
    );
  });

  it("idempotencia: misma clave mismos datos → replay", async () => {
    const db = makeCajaFakeDb({
      users: [{ id: "v1", rol: "VENDEDOR", activo: true }],
    });
    await seedObligacion(db, { vendedorId: "v1", importeAdmin: "100.00" });
    const key = uuid(9);
    const a = await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "40.00",
      idempotencyKey: key,
    });
    const b = await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "40.00",
      idempotencyKey: key,
    });
    assert.equal(b.idempotentReplay, true);
    assert.equal(a.declaracion.id, b.declaracion.id);
    assert.equal(db.declaraciones.size, 1);
    assert.equal(db.auditRows.length, 1);
  });

  it("idempotencia: misma clave datos distintos → conflicto", async () => {
    const db = makeCajaFakeDb({
      users: [{ id: "v1", rol: "VENDEDOR", activo: true }],
    });
    await seedObligacion(db, { vendedorId: "v1", importeAdmin: "100.00" });
    const key = uuid(10);
    await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "40.00",
      idempotencyKey: key,
    });
    await assert.rejects(
      () =>
        crearDeclaracionVendedor(db, {
          actorUserId: "v1",
          actorRol: "VENDEDOR",
          importe: "41.00",
          idempotencyKey: key,
        }),
      CajaIdempotencyConflictError,
    );
  });
});

describe("caja C4 — confirmaciones", () => {
  async function prep() {
    const db = makeCajaFakeDb({
      users: [
        { id: "v1", rol: "VENDEDOR", activo: true },
        { id: "a1", rol: "ADMIN", activo: true },
      ],
    });
    await seedObligacion(db, { vendedorId: "v1", importeAdmin: "1000.00" });
    const d = await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "500.00",
      idempotencyKey: uuid(20),
    });
    return { db, declId: d.declaracion.id };
  }

  it("ADMIN confirma completa", async () => {
    const { db, declId } = await prep();
    const r = await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: declId,
      importe: "500.00",
      idempotencyKey: uuid(21),
    });
    assert.equal(r.declaracion.estado, "CONFIRMADA");
    assert.equal(r.confirmacion.confirmadoPorAdminId, "a1");
    assert.equal(r.aplicaciones.length, 1);
    assert.equal(moneyFixed2(r.aplicaciones[0]!.importeAplicado), "500.00");
  });

  it("confirmaciones parciales sucesivas", async () => {
    const { db, declId } = await prep();
    await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: declId,
      importe: "200.00",
      idempotencyKey: uuid(22),
    });
    const r = await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: declId,
      importe: "300.00",
      idempotencyKey: uuid(23),
    });
    assert.equal(r.declaracion.estado, "CONFIRMADA");
    assert.equal(moneyFixed2(r.declaracion.totalConfirmado), "500.00");
  });

  it("rechaza confirmación 0, negativa y sobreconfirmación", async () => {
    const { db, declId } = await prep();
    await assert.rejects(
      () =>
        crearConfirmacionAdmin(db, {
          actorAdminId: "a1",
          actorRol: "ADMIN",
          declaracionId: declId,
          importe: "0",
          idempotencyKey: uuid(24),
        }),
      CajaValidationError,
    );
    await assert.rejects(
      () =>
        crearConfirmacionAdmin(db, {
          actorAdminId: "a1",
          actorRol: "ADMIN",
          declaracionId: declId,
          importe: "-1",
          idempotencyKey: uuid(25),
        }),
      CajaValidationError,
    );
    await assert.rejects(
      () =>
        crearConfirmacionAdmin(db, {
          actorAdminId: "a1",
          actorRol: "ADMIN",
          declaracionId: declId,
          importe: "500.01",
          idempotencyKey: uuid(26),
        }),
      (e: unknown) =>
        e instanceof CajaValidationError && e.code === "CAJA_SOBRECONFIRMACION",
    );
  });

  it("VENDEDOR no puede confirmar", async () => {
    const { db, declId } = await prep();
    await assert.rejects(
      () =>
        crearConfirmacionAdmin(db, {
          actorAdminId: "v1",
          actorRol: "VENDEDOR",
          declaracionId: declId,
          importe: "10",
          idempotencyKey: uuid(27),
        }),
      CajaForbiddenError,
    );
  });

  it("idempotencia confirmación replay y conflicto", async () => {
    const { db, declId } = await prep();
    const key = uuid(28);
    const a = await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: declId,
      importe: "100.00",
      idempotencyKey: key,
    });
    const b = await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: declId,
      importe: "100.00",
      idempotencyKey: key,
    });
    assert.equal(b.idempotentReplay, true);
    assert.equal(a.confirmacion.id, b.confirmacion.id);
    await assert.rejects(
      () =>
        crearConfirmacionAdmin(db, {
          actorAdminId: "a1",
          actorRol: "ADMIN",
          declaracionId: declId,
          importe: "101.00",
          idempotencyKey: key,
        }),
      CajaIdempotencyConflictError,
    );
  });

  it("declaraciones/confirmaciones no modifican obligaciones", async () => {
    const { db } = await prep();
    const before = [...db.obligaciones.values()].map((o) =>
      moneyFixed2(o.importeAdmin),
    );
    await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: [...db.declaraciones.values()][0]!.id,
      importe: "50.00",
      idempotencyKey: uuid(29),
    });
    const after = [...db.obligaciones.values()].map((o) =>
      moneyFixed2(o.importeAdmin),
    );
    assert.deepEqual(after, before);
  });
});
