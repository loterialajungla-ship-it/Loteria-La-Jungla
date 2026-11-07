import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureComisionInicialSiAusente,
  getComisionVigente,
  listComisionHistorial,
  setComisionVendedor,
} from "@/lib/caja/comision";
import { activarCaja, getCajaConfig } from "@/lib/caja/config";
import { CajaValidationError } from "@/lib/caja/errors";
import { COMISION_PORCENTAJE_DEFAULT, moneyFixed2 } from "@/lib/caja/money";
import { makeCajaFakeDb } from "@/lib/caja/test-fake-db";

describe("caja/comision", () => {
  it("alta inicial 20 % con historial (anterior null)", async () => {
    const db = makeCajaFakeDb({
      users: [{ id: "admin-1", rol: "ADMIN", activo: true }],
    });
    db.users.set("vend-1", {
      id: "vend-1",
      rol: "VENDEDOR",
      activo: true,
      nombre: "V1",
      usuario: "v1",
    });

    const r = await ensureComisionInicialSiAusente(db as never, {
      vendedorId: "vend-1",
      actorAdminId: "admin-1",
    });
    assert.equal(r.created, true);
    assert.equal(moneyFixed2(r.comision.porcentaje), "20.00");

    const again = await ensureComisionInicialSiAusente(db as never, {
      vendedorId: "vend-1",
      actorAdminId: "admin-1",
    });
    assert.equal(again.created, false);
    assert.equal(db.historial.length, 1);
    assert.equal(db.historial[0]!.porcentajeAnterior, null);
  });

  it("conserva porcentaje personalizado al ensure", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
    });
    await setComisionVendedor(db as never, {
      vendedorId: "vend-1",
      porcentaje: "15",
      actorAdminId: "admin-1",
    });
    const r = await ensureComisionInicialSiAusente(db as never, {
      vendedorId: "vend-1",
      actorAdminId: "admin-1",
    });
    assert.equal(r.created, false);
    assert.equal(moneyFixed2(r.comision.porcentaje), "15.00");
  });

  it("cambio de comisión registra historial; sin cambio si igual", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
      ],
    });
    await ensureComisionInicialSiAusente(db as never, {
      vendedorId: "vend-1",
      actorAdminId: "admin-1",
    });
    const c1 = await setComisionVendedor(db as never, {
      vendedorId: "vend-1",
      porcentaje: "25.50",
      actorAdminId: "admin-1",
      motivo: "Ajuste",
    });
    assert.equal(c1.changed, true);
    assert.ok(c1.historial);
    assert.equal(moneyFixed2(c1.historial!.porcentajeAnterior!), "20.00");
    assert.equal(moneyFixed2(c1.historial!.porcentajeNuevo), "25.50");

    const c2 = await setComisionVendedor(db as never, {
      vendedorId: "vend-1",
      porcentaje: "25.50",
      actorAdminId: "admin-1",
    });
    assert.equal(c2.changed, false);
    assert.equal(c2.historial, null);
    assert.equal(db.historial.length, 2);

    const hist = await listComisionHistorial(db as never, "vend-1");
    assert.equal(hist.length, 2);
    assert.ok(hist[0]!.changedAt.getTime() <= hist[1]!.changedAt.getTime());
  });

  it("rechaza porcentaje inválido y no-vendedor", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-1", rol: "VENDEDOR", activo: true },
        { id: "admin-2", rol: "ADMIN", activo: true },
      ],
    });
    await assert.rejects(
      () =>
        setComisionVendedor(db as never, {
          vendedorId: "vend-1",
          porcentaje: "101",
          actorAdminId: "admin-1",
        }),
      CajaValidationError,
    );
    await assert.rejects(
      () =>
        setComisionVendedor(db as never, {
          vendedorId: "admin-2",
          porcentaje: "20",
          actorAdminId: "admin-1",
        }),
      CajaValidationError,
    );
  });
});

describe("caja/activarCaja", () => {
  it("activa, inicializa 20 % solo sin comisión, idempotente", async () => {
    const db = makeCajaFakeDb({
      users: [
        { id: "admin-1", rol: "ADMIN", activo: true },
        { id: "vend-a", rol: "VENDEDOR", activo: true },
        { id: "vend-b", rol: "VENDEDOR", activo: true },
      ],
    });
    // vend-b ya tiene 12 %
    await setComisionVendedor(db as never, {
      vendedorId: "vend-b",
      porcentaje: "12",
      actorAdminId: "admin-1",
    });

    const t0 = new Date("2026-11-06T12:00:00.000Z");
    const first = await activarCaja(db as never, {
      actorAdminId: "admin-1",
      ahora: t0,
    });
    assert.equal(first.alreadyActive, false);
    assert.equal(first.config.activa, true);
    assert.equal(first.config.activadaEn?.toISOString(), t0.toISOString());
    assert.equal(first.comisionesInicializadas, 1);

    const ca = await getComisionVigente(db as never, "vend-a");
    const cb = await getComisionVigente(db as never, "vend-b");
    assert.equal(moneyFixed2(ca!.porcentaje), moneyFixed2(COMISION_PORCENTAJE_DEFAULT));
    assert.equal(moneyFixed2(cb!.porcentaje), "12.00");

    const t1 = new Date("2026-11-07T12:00:00.000Z");
    const second = await activarCaja(db as never, {
      actorAdminId: "admin-1",
      ahora: t1,
    });
    assert.equal(second.alreadyActive, true);
    assert.equal(second.comisionesInicializadas, 0);
    assert.equal(second.config.activadaEn?.toISOString(), t0.toISOString());

    const cfg = await getCajaConfig(db as never);
    assert.equal(cfg.activa, true);
    assert.equal(cfg.activadaEn?.toISOString(), t0.toISOString());
  });

  it("default virtual sin fila persistida", async () => {
    const db = makeCajaFakeDb();
    const cfg = await getCajaConfig(db as never);
    assert.equal(cfg.activa, false);
    assert.equal(cfg.configPersisted, false);
  });
});
