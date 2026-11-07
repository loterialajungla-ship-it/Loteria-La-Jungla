import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { planFifoAplicaciones } from "@/lib/caja/aplicacion";
import { crearConfirmacionAdmin } from "@/lib/caja/confirmacion";
import { crearDeclaracionVendedor } from "@/lib/caja/declaracion";
import { CajaValidationError } from "@/lib/caja/errors";
import { moneyFixed2 } from "@/lib/caja/money";
import { getTotalesVendedor } from "@/lib/caja/resumen";
import { makeCajaFakeDb } from "@/lib/caja/test-fake-db";

function uuid(n: number): string {
  const h = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
}

function seedObligacion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  args: {
    id?: string;
    vendedorId: string;
    importeAdmin: string;
    ticketId: string;
    ticketCreatedAt: Date;
  },
) {
  const id = args.id ?? `cjo_${Math.random().toString(16).slice(2)}`;
  const importe = new Prisma.Decimal(args.importeAdmin);
  return db.cajaObligacion.create({
    data: {
      id,
      ticketId: args.ticketId,
      vendedorId: args.vendedorId,
      bruto: importe,
      comisionPorcentaje: new Prisma.Decimal("0"),
      comisionImporte: new Prisma.Decimal("0"),
      importeAdmin: importe,
      ticketCreatedAt: args.ticketCreatedAt,
    },
  });
}

describe("caja C5 — planFifoAplicaciones", () => {
  it("cubre una obligación completa", () => {
    const plan = planFifoAplicaciones({
      importeDisponible: new Prisma.Decimal("100"),
      pendientes: [
        { obligacionId: "o1", pendiente: new Prisma.Decimal("100") },
      ],
    });
    assert.equal(plan.length, 1);
    assert.equal(moneyFixed2(plan[0]!.importeAplicar), "100.00");
  });

  it("parcial y continúa a la siguiente", () => {
    const plan = planFifoAplicaciones({
      importeDisponible: new Prisma.Decimal("150"),
      pendientes: [
        { obligacionId: "o1", pendiente: new Prisma.Decimal("100") },
        { obligacionId: "o2", pendiente: new Prisma.Decimal("80") },
      ],
    });
    assert.equal(plan.length, 2);
    assert.equal(moneyFixed2(plan[0]!.importeAplicar), "100.00");
    assert.equal(moneyFixed2(plan[1]!.importeAplicar), "50.00");
  });

  it("no crea ceros; falla si sobra", () => {
    assert.throws(
      () =>
        planFifoAplicaciones({
          importeDisponible: new Prisma.Decimal("50"),
          pendientes: [
            { obligacionId: "o1", pendiente: new Prisma.Decimal("0") },
          ],
        }),
      (e: unknown) =>
        e instanceof CajaValidationError && e.code === "CAJA_FIFO_INSUFICIENTE",
    );
  });

  it("suma aplicada = confirmación", () => {
    const plan = planFifoAplicaciones({
      importeDisponible: new Prisma.Decimal("70.25"),
      pendientes: [
        { obligacionId: "o1", pendiente: new Prisma.Decimal("40.10") },
        { obligacionId: "o2", pendiente: new Prisma.Decimal("100") },
      ],
    });
    const sum = plan.reduce(
      (a, p) => a.plus(p.importeAplicar),
      new Prisma.Decimal(0),
    );
    assert.equal(moneyFixed2(sum), "70.25");
  });
});

describe("caja C5 — confirmación con FIFO (fake)", () => {
  it("una confirmación cubre varias obligaciones en orden createdAt/id", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "v1", rol: "VENDEDOR", activo: true },
        { id: "a1", rol: "ADMIN", activo: true },
      ],
    });
    const t1 = new Date("2026-01-01T10:00:00.000Z");
    const t2 = new Date("2026-01-01T10:00:00.000Z"); // misma fecha → desempate ticketId
    const oOlder = await seedObligacion(db, {
      id: "obl_b",
      vendedorId: "v1",
      importeAdmin: "40.00",
      ticketId: "tkt_b",
      ticketCreatedAt: t1,
    });
    const oNewerSameTs = await seedObligacion(db, {
      id: "obl_a",
      vendedorId: "v1",
      importeAdmin: "60.00",
      ticketId: "tkt_a", // id menor que tkt_b → primero si mismo timestamp
      ticketCreatedAt: t2,
    });
    void oOlder;
    void oNewerSameTs;

    await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "100.00",
      idempotencyKey: uuid(100),
    });
    const declId = [...db.declaraciones.values()][0]!.id;

    const r = await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: declId,
      importe: "100.00",
      idempotencyKey: uuid(101),
    });

    assert.equal(r.aplicaciones.length, 2);
    // Orden FIFO: misma createdAt → ticketId ASC → tkt_a luego tkt_b
    assert.equal(r.aplicaciones[0]!.obligacionId, "obl_a");
    assert.equal(moneyFixed2(r.aplicaciones[0]!.importeAplicado), "60.00");
    assert.equal(r.aplicaciones[1]!.obligacionId, "obl_b");
    assert.equal(moneyFixed2(r.aplicaciones[1]!.importeAplicado), "40.00");

    const tot = await getTotalesVendedor(db, "v1");
    assert.equal(moneyFixed2(tot.totalAplicado), "100.00");
    assert.equal(moneyFixed2(tot.pendienteAplicar), "0.00");
  });

  it("varias confirmaciones sobre una obligación; replay no duplica", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "v1", rol: "VENDEDOR", activo: true },
        { id: "a1", rol: "ADMIN", activo: true },
      ],
    });
    await seedObligacion(db, {
      vendedorId: "v1",
      importeAdmin: "100.00",
      ticketId: "tkt_1",
      ticketCreatedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await crearDeclaracionVendedor(db, {
      actorUserId: "v1",
      actorRol: "VENDEDOR",
      importe: "100.00",
      idempotencyKey: uuid(110),
    });
    const declId = [...db.declaraciones.values()][0]!.id;

    await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: declId,
      importe: "30.00",
      idempotencyKey: uuid(111),
    });
    const key = uuid(112);
    const a = await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: declId,
      importe: "40.00",
      idempotencyKey: key,
    });
    const replay = await crearConfirmacionAdmin(db, {
      actorAdminId: "a1",
      actorRol: "ADMIN",
      declaracionId: declId,
      importe: "40.00",
      idempotencyKey: key,
    });
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.aplicaciones.length, a.aplicaciones.length);
    assert.equal(db.aplicaciones.size, 2);

    const tot = await getTotalesVendedor(db, "v1");
    assert.equal(moneyFixed2(tot.totalConfirmado), "70.00");
    assert.equal(moneyFixed2(tot.totalAplicado), "70.00");
  });

  it("falla FIFO insuficiente revierte (sin confirmación ni apps)", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "v1", rol: "VENDEDOR", activo: true },
        { id: "a1", rol: "ADMIN", activo: true },
      ],
    });
    // Obligación 50, declaración 100 — inconsistencia forzada para FIFO
    await seedObligacion(db, {
      vendedorId: "v1",
      importeAdmin: "50.00",
      ticketId: "tkt_x",
      ticketCreatedAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    // Bypass pendiente declarar: insert declaración directa
    await db.cajaDeclaracion.create({
      data: {
        id: "decl_force",
        vendedorId: "v1",
        importeDeclarado: new Prisma.Decimal("100.00"),
        idempotencyKey: uuid(120),
        idempotencyRequestHash: "x",
        nota: null,
      },
    });

    await assert.rejects(
      () =>
        crearConfirmacionAdmin(db, {
          actorAdminId: "a1",
          actorRol: "ADMIN",
          declaracionId: "decl_force",
          importe: "100.00",
          idempotencyKey: uuid(121),
        }),
      (e: unknown) =>
        e instanceof CajaValidationError && e.code === "CAJA_FIFO_INSUFICIENTE",
    );
    assert.equal(db.confirmaciones.size, 0);
    assert.equal(db.aplicaciones.size, 0);
  });
});
