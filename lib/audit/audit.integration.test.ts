/**
 * Integration: auditoría de acciones sensibles.
 * Solo vía npm run test:integration (RUN_INTEGRATION=1).
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
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
  createTestUser,
  newIdempotencyKey,
  resetTicketDomain,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";

const ENABLED = process.env.RUN_INTEGRATION === "1";
const db = prisma;

describe("integración PostgreSQL — auditoría", { skip: !ENABLED }, () => {
  let adminId: string;
  let vendorId: string;

  before(async () => {
    await seedMinimalBusiness(db);
  });

  beforeEach(async () => {
    await resetTicketDomain(db);
    await seedMinimalBusiness(db);
    const admin = await createTestUser(db, {
      usuario: "aud_admin",
      nombre: "Admin Aud",
      rol: "ADMIN",
      password: "admin-pass-12",
    });
    adminId = admin.id;
    const vendor = await createTestUser(db, {
      usuario: "aud_vend",
      nombre: "Vend Aud",
      rol: "VENDEDOR",
      password: "vendor-pass-12",
    });
    vendorId = vendor.id;
  });

  after(async () => {
    await db.$disconnect();
  });

  it("crear/activar/desactivar vendedor → Auditoria", async () => {
    const created = await createVendor(
      db,
      {
        nombre: "Nuevo Vend",
        usuario: "nuevo_aud",
        password: "nueva1234",
      },
      { actorUserId: adminId },
    );

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
    );

    const crearEv = await db.auditoria.findFirst({
      where: { accion: "CREAR_TICKET", entidadId: created.ticket.id },
      include: { usuario: { select: { id: true } } },
    });
    assert.ok(crearEv);
    assert.equal(crearEv!.usuarioId, vendorId);
    assert.equal(crearEv!.usuario.id, vendorId);
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

    await db.$transaction(async (tx) => {
      const created = await tx.resultado.create({
        data: { fecha, hora: 12, numero: "03" },
      });
      await recordAuditEvent(tx, {
        usuarioId: adminId,
        accion: "CREAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: created.id,
        detalle: {
          fecha: fechaStr,
          hora: 12,
          numeroAnterior: null,
          numeroNuevo: "03",
        },
      });
    });

    const crear = await db.auditoria.findFirst({
      where: { accion: "CREAR_RESULTADO" },
    });
    assert.ok(crear);

    await db.$transaction(async (tx) => {
      const previo = await tx.resultado.findUniqueOrThrow({
        where: { fecha_hora: { fecha, hora: 12 } },
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
          hora: 12,
          numeroAnterior: "03",
          numeroNuevo: "05",
        },
      });
    });

    const mod = await db.auditoria.findFirst({
      where: { accion: "MODIFICAR_RESULTADO" },
    });
    assert.ok(mod);
    assert.match(mod!.detalle ?? "", /"numeroAnterior":"03"/);
    assert.match(mod!.detalle ?? "", /"numeroNuevo":"05"/);

    const listed = await listAuditoria(db, {
      accion: "MODIFICAR_RESULTADO",
    });
    assert.equal(listed.items.length, 1);
    assert.match(listed.items[0]!.detalleLegible, /03/);
    assert.match(listed.items[0]!.detalleLegible, /05/);
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
