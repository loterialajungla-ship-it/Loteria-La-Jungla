/**
 * Integration: auditoría de acciones sensibles.
 * Solo vía `npm run test:integration` (`RUN_INTEGRATION=1`).
 * Aislamiento FASE 7.74: owned-ticket-domain (sin wipe global).
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createTicket } from "@/lib/tickets/create-ticket";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import {
  activarUsuario,
  createVendor,
  desactivarUsuario,
} from "@/lib/users/admin-users";
import {
  changeOwnPassword,
  resetVendorPassword,
} from "@/lib/auth/password-management";
import { recordAuditEvent } from "@/lib/audit/audit";
import { listAuditoria } from "@/lib/audit/list-auditoria";
import { fechaAYYYYMMDD, hoyYYYYMMDD } from "@/lib/fecha";
import {
  AHORA_VE_MANANA,
  createIntegrationPrismaClient,
  newIdempotencyKey,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";
import {
  cleanupOwnedTicketDomain,
  createOwnedTestUser,
  createOwnedTicketDomain,
  trackFixtureTicketCounter,
  trackOwnedResultadoId,
  trackOwnedTicketId,
  trackOwnedUserId,
  type OwnedTicketDomain,
} from "@/lib/tickets/integration/owned-ticket-domain";
import {
  beginTemporaryCreditosControlOff,
  readCreditosConfigSnapshot,
  restoreCreditosConfigBaseline,
  restoreCreditosConfigLease,
  type CreditosConfigLease,
  type CreditosConfigSnapshot,
} from "@/lib/tickets/integration/creditos-config-test-fixture";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";

const ENABLED = process.env.RUN_INTEGRATION === "1";

describe("integración PostgreSQL — auditoría", { skip: !ENABLED }, () => {
  let db: ReturnType<typeof createIntegrationPrismaClient>;
  let domain: OwnedTicketDomain;
  let runTag: string;
  let adminId: string;
  let vendorId: string;
  let suiteCreditosSnap: CreditosConfigSnapshot = { existed: false };
  let testCreditosLease: CreditosConfigLease | null = null;

  before(async () => {
    assertIntegrationPointsAtTestDatabase();
    db = createIntegrationPrismaClient();
    runTag = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await seedMinimalBusiness(db);
    suiteCreditosSnap = await readCreditosConfigSnapshot(db);
  });

  beforeEach(async () => {
    assertIntegrationPointsAtTestDatabase();
    if (domain) {
      await cleanupOwnedTicketDomain(db, domain);
    }
    domain = createOwnedTicketDomain();
    trackFixtureTicketCounter(domain);
    await seedMinimalBusiness(db);
    testCreditosLease = await beginTemporaryCreditosControlOff(db);
    const admin = await createOwnedTestUser(db, domain, {
      usuario: `${runTag}_adm`.slice(0, 40),
      nombre: "Admin Aud",
      rol: "ADMIN",
      password: "admin-pass-12",
    });
    adminId = admin.id;
    const vendor = await createOwnedTestUser(db, domain, {
      usuario: `${runTag}_vend`.slice(0, 40),
      nombre: "Vend Aud",
      rol: "VENDEDOR",
      password: "vendor-pass-12",
    });
    vendorId = vendor.id;
  });

  afterEach(async () => {
    if (testCreditosLease) {
      await restoreCreditosConfigLease(db, testCreditosLease);
      testCreditosLease = null;
    }
  });

  after(async () => {
    try {
      if (domain) await cleanupOwnedTicketDomain(db, domain);
    } finally {
      try {
        await restoreCreditosConfigBaseline(db, suiteCreditosSnap);
      } catch {
        /* ignore */
      }
      await db.$disconnect();
    }
  });

  it("crear/activar/desactivar vendedor → Auditoria", async () => {
    const created = await createVendor(
      db,
      {
        nombre: "Nuevo Vend",
        usuario: `${runTag}_nv`.slice(0, 40),
        password: "nueva1234",
      },
      { actorUserId: adminId },
    );
    trackOwnedUserId(domain, created.id);

    let ev = await db.auditoria.findFirst({
      where: { accion: "CREAR_VENDEDOR", entidadId: created.id },
    });
    assert.ok(ev);
    assert.equal(ev!.usuarioId, adminId);
    assert.doesNotMatch(ev!.detalle ?? "", /password|hash/i);

    await desactivarUsuario(db, {
      id: created.id,
      actorUserId: adminId,
    });
    ev = await db.auditoria.findFirst({
      where: { accion: "DESACTIVAR_VENDEDOR", entidadId: created.id },
    });
    assert.ok(ev);

    await activarUsuario(db, {
      id: created.id,
      actorUserId: adminId,
    });
    ev = await db.auditoria.findFirst({
      where: { accion: "ACTIVAR_VENDEDOR", entidadId: created.id },
    });
    assert.ok(ev);
  });

  it("crear y anular ticket → Auditoria; relaciones Usuario", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const created = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendorId,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    trackOwnedTicketId(domain, created.ticket.id);

    const crearEv = await db.auditoria.findFirst({
      where: { accion: "CREAR_TICKET", entidadId: created.ticket.id },
      include: { usuario: { select: { id: true } } },
    });
    assert.ok(crearEv);
    assert.equal(crearEv!.usuarioId, vendorId);
    assert.ok(crearEv!.usuario);
    assert.equal(crearEv!.usuario!.id, vendorId);
    assert.doesNotMatch(crearEv!.detalle ?? "", /idempotency/i);

    await anularTicket(db, {
      id: created.ticket.id,
      motivo: "Error de digitación",
      anuladoPorId: adminId,
    });
    const anularEv = await db.auditoria.findFirst({
      where: { accion: "ANULAR_TICKET", entidadId: created.ticket.id },
    });
    assert.ok(anularEv);
    assert.equal(anularEv!.usuarioId, adminId);
    assert.match(anularEv!.detalle ?? "", /Error de digitación/);
  });

  it("crear y modificar resultado → CREAR / MODIFICAR con 03→05", async () => {
    const fecha = new Date(Date.UTC(2026, 9, 2));
    const fechaStr = fechaAYYYYMMDD(fecha);

    // Hora 12: menos probable de conflicto con ventas fixture (hora 14).
    const slotHora = 12;
    const existing = await db.resultado.findUnique({
      where: { fecha_hora: { fecha, hora: slotHora } },
    });
    if (existing) {
      // No borrar ajeno; usar id propio solo si no hay fila.
      // Skip asserts de creación si slot ocupado por terceros.
      assert.ok(existing.id);
      return;
    }

    let resultadoId: string;
    await db.$transaction(async (tx) => {
      const created = await tx.resultado.create({
        data: { fecha, hora: slotHora, numero: "03" },
      });
      resultadoId = created.id;
      await recordAuditEvent(tx, {
        usuarioId: adminId,
        accion: "CREAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: created.id,
        detalle: {
          fecha: fechaStr,
          hora: slotHora,
          numeroAnterior: null,
          numeroNuevo: "03",
        },
      });
    });
    trackOwnedResultadoId(domain, resultadoId!);

    const crear = await db.auditoria.findFirst({
      where: { accion: "CREAR_RESULTADO", entidadId: resultadoId! },
    });
    assert.ok(crear);

    await db.$transaction(async (tx) => {
      const previo = await tx.resultado.findUniqueOrThrow({
        where: { id: resultadoId! },
      });
      const updated = await tx.resultado.update({
        where: { id: previo.id },
        data: { numero: "05" },
      });
      await recordAuditEvent(tx, {
        usuarioId: adminId,
        accion: "MODIFICAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: updated.id,
        detalle: {
          fecha: fechaStr,
          hora: slotHora,
          numeroAnterior: "03",
          numeroNuevo: "05",
        },
      });
    });

    const mod = await db.auditoria.findFirst({
      where: { accion: "MODIFICAR_RESULTADO", entidadId: resultadoId! },
    });
    assert.ok(mod);
    assert.match(mod!.detalle ?? "", /"numeroAnterior":"03"/);
    assert.match(mod!.detalle ?? "", /"numeroNuevo":"05"/);

    const listed = await listAuditoria(db, {
      accion: "MODIFICAR_RESULTADO",
    });
    const ours = listed.items.filter((i) => i.entidadId === resultadoId!);
    assert.equal(ours.length, 1);
    assert.match(ours[0]!.detalleLegible, /03/);
    assert.match(ours[0]!.detalleLegible, /05/);
  });

  it("cambiar y reset password → Auditoria sin secretos", async () => {
    await changeOwnPassword(db, {
      userId: vendorId,
      currentPassword: "vendor-pass-12",
      newPassword: "vendor-new-99",
    });
    let ev = await db.auditoria.findFirst({
      where: { accion: "CAMBIAR_PASSWORD", entidadId: vendorId },
    });
    assert.ok(ev);
    assert.doesNotMatch(ev!.detalle ?? "", /vendor-pass|vendor-new|hash/i);

    await resetVendorPassword(db, {
      actorUserId: adminId,
      targetUserId: vendorId,
      newPassword: "reset-pass-88",
    });
    ev = await db.auditoria.findFirst({
      where: { accion: "RESET_PASSWORD", entidadId: vendorId },
    });
    assert.ok(ev);
    assert.equal(ev!.usuarioId, adminId);
    assert.doesNotMatch(ev!.detalle ?? "", /reset-pass|passwordHash/);
  });

  it("rollback no deja auditoría huérfana", async () => {
    const before = await db.auditoria.count();
    await assert.rejects(async () => {
      await db.$transaction(async (tx) => {
        await recordAuditEvent(tx, {
          usuarioId: adminId,
          accion: "CREAR_VENDEDOR",
          entidad: "USUARIO",
          entidadId: "fake-will-rollback",
          detalle: { test: true },
        });
        throw new Error("force rollback");
      });
    });
    assert.equal(await db.auditoria.count(), before);
  });
});
