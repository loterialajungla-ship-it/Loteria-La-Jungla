/**
 * Integration: cambio / reset de contraseña + invalidación de sesiones.
 * Solo vía `npm run test:integration` (`RUN_INTEGRATION=1`).
 * Aislamiento FASE 7.74: owned-ticket-domain (sin wipe global).
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { loginWithCredentials } from "@/lib/auth/login";
import { resolveSessionByToken } from "@/lib/auth/session";
import {
  changeOwnPassword,
  resetVendorPassword,
} from "@/lib/auth/password-management";
import {
  ForbiddenError,
  UserValidationError,
} from "@/lib/auth/errors";
import {
  createIntegrationPrismaClient,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";
import {
  cleanupOwnedTicketDomain,
  createOwnedTicketDomain,
  trackOwnedUserId,
  type OwnedTicketDomain,
} from "@/lib/tickets/integration/owned-ticket-domain";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";

const ENABLED = process.env.RUN_INTEGRATION === "1";

const ADMIN_PASS = "admin-pass-12";
const VENDOR_PASS = "vendor-pass-12";

describe("integración PostgreSQL — passwords", { skip: !ENABLED }, () => {
  let db: ReturnType<typeof createIntegrationPrismaClient>;
  let domain: OwnedTicketDomain;
  let runTag: string;
  let adminLogin: string;
  let vendorLogin: string;
  let adminId: string;
  let vendorId: string;

  before(async () => {
    assertIntegrationPointsAtTestDatabase();
    db = createIntegrationPrismaClient();
    runTag = `pw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await seedMinimalBusiness(db);
  });

  beforeEach(async () => {
    assertIntegrationPointsAtTestDatabase();
    if (domain) {
      await cleanupOwnedTicketDomain(db, domain);
    }
    domain = createOwnedTicketDomain();
    await seedMinimalBusiness(db);

    adminLogin = `${runTag}_adm`.slice(0, 40);
    vendorLogin = `${runTag}_vend`.slice(0, 40);

    const adminHash = await hashPassword(ADMIN_PASS);
    const admin = await db.usuario.create({
      data: {
        nombre: "Admin PW",
        usuario: adminLogin,
        passwordHash: adminHash,
        rol: "ADMIN",
        activo: true,
      },
    });
    adminId = admin.id;
    trackOwnedUserId(domain, adminId);

    const vendHash = await hashPassword(VENDOR_PASS);
    const vendor = await db.usuario.create({
      data: {
        nombre: "Vendor PW",
        usuario: vendorLogin,
        passwordHash: vendHash,
        rol: "VENDEDOR",
        activo: true,
      },
    });
    vendorId = vendor.id;
    trackOwnedUserId(domain, vendorId);
  });

  after(async () => {
    try {
      if (domain) await cleanupOwnedTicketDomain(db, domain);
    } finally {
      await db.$disconnect();
    }
  });

  it("cambio propio: hash nuevo, antigua falla, sesiones invalidadas", async () => {
    const login = await loginWithCredentials(db, {
      usuario: vendorLogin,
      password: VENDOR_PASS,
    });
    assert.ok(login);
    assert.ok(await resolveSessionByToken(db, login!.token));

    await changeOwnPassword(db, {
      userId: vendorId,
      currentPassword: VENDOR_PASS,
      newPassword: "vendor-new-99",
    });

    assert.equal(await resolveSessionByToken(db, login!.token), null);
    assert.equal(
      await db.usuarioSesion.count({ where: { usuarioId: vendorId } }),
      0,
    );

    const row = await db.usuario.findUniqueOrThrow({ where: { id: vendorId } });
    assert.equal(await verifyPassword(VENDOR_PASS, row.passwordHash), false);
    assert.equal(await verifyPassword("vendor-new-99", row.passwordHash), true);
    assert.doesNotMatch(JSON.stringify(row), /vendor-new-99/);

    assert.equal(
      await loginWithCredentials(db, {
        usuario: vendorLogin,
        password: VENDOR_PASS,
      }),
      null,
    );
    const again = await loginWithCredentials(db, {
      usuario: vendorLogin,
      password: "vendor-new-99",
    });
    assert.ok(again);
  });

  it("contraseña actual incorrecta / igual / corta", async () => {
    await assert.rejects(
      () =>
        changeOwnPassword(db, {
          userId: vendorId,
          currentPassword: "wrong-pass",
          newPassword: "nueva1234",
        }),
      UserValidationError,
    );

    await assert.rejects(
      () =>
        changeOwnPassword(db, {
          userId: vendorId,
          currentPassword: VENDOR_PASS,
          newPassword: VENDOR_PASS,
        }),
      (e: unknown) =>
        e instanceof UserValidationError &&
        e.message.includes("diferente de la actual"),
    );

    await assert.rejects(
      () =>
        changeOwnPassword(db, {
          userId: vendorId,
          currentPassword: VENDOR_PASS,
          newPassword: "corta",
        }),
      UserValidationError,
    );
  });

  it("usuario inactivo no cambia su contraseña", async () => {
    await db.usuario.update({
      where: { id: vendorId },
      data: { activo: false },
    });
    await assert.rejects(
      () =>
        changeOwnPassword(db, {
          userId: vendorId,
          currentPassword: VENDOR_PASS,
          newPassword: "nueva1234",
        }),
      ForbiddenError,
    );
  });

  it("ADMIN reset VENDEDOR: actualiza hash, invalida sesiones, no reactiva", async () => {
    const login = await loginWithCredentials(db, {
      usuario: vendorLogin,
      password: VENDOR_PASS,
    });
    assert.ok(login);

    await db.usuario.update({
      where: { id: vendorId },
      data: { activo: false },
    });

    await resetVendorPassword(db, {
      actorUserId: adminId,
      targetUserId: vendorId,
      newPassword: "reset-pass-9",
    });

    const row = await db.usuario.findUniqueOrThrow({ where: { id: vendorId } });
    assert.equal(row.activo, false);
    assert.equal(await verifyPassword("reset-pass-9", row.passwordHash), true);
    assert.equal(await verifyPassword(VENDOR_PASS, row.passwordHash), false);
    assert.equal(
      await db.usuarioSesion.count({ where: { usuarioId: vendorId } }),
      0,
    );
  });

  it("ADMIN no puede resetear ADMIN; actor no se resetea a sí mismo", async () => {
    await assert.rejects(
      () =>
        resetVendorPassword(db, {
          actorUserId: adminId,
          targetUserId: adminId,
          newPassword: "nueva1234",
        }),
      UserValidationError,
    );

    const otherAdmin = await db.usuario.create({
      data: {
        nombre: "Other Admin",
        usuario: `${runTag}_adm2`.slice(0, 40),
        passwordHash: await hashPassword("other-admin1"),
        rol: "ADMIN",
        activo: true,
      },
    });
    trackOwnedUserId(domain, otherAdmin.id);

    await assert.rejects(
      () =>
        resetVendorPassword(db, {
          actorUserId: adminId,
          targetUserId: otherAdmin.id,
          newPassword: "nueva1234",
        }),
      ForbiddenError,
    );
  });

  it("ADMIN cambia su propia contraseña", async () => {
    await changeOwnPassword(db, {
      userId: adminId,
      currentPassword: ADMIN_PASS,
      newPassword: "admin-new-88",
    });
    const row = await db.usuario.findUniqueOrThrow({ where: { id: adminId } });
    assert.equal(await verifyPassword("admin-new-88", row.passwordHash), true);
  });
});
