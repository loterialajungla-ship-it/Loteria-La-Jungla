/**
 * Acceptance / smoke — auth nueva + tickets + liquidación + exposición.
 *
 * Ejecutar solo: `npm run test:acceptance` (runner → `runDbTestSuite`).
 * - Sin `TEST_DATABASE_URL`: el runner hace SKIPPED (exit 0); esta suite
 *   además se salta si `RUN_ACCEPTANCE !== "1"`.
 * - URL inválida / no allowlisted / colisión con prod → exit 1 (no prod).
 * - Cliente: `createIntegrationPrismaClient` tras
 *   `assertIntegrationPointsAtTestDatabase` (nunca `@/lib/prisma` a ciegas).
 * - Ownership FASE 7.74+: limpia solo IDs propios; logins únicos por run.
 * - Excluida de `npm test` por sufijo `.acceptance.test.ts`.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { loginWithCredentials } from "@/lib/auth/login";
import {
  deleteSessionByToken,
  resolveSessionByToken,
} from "@/lib/auth/session";
import { hashSessionToken } from "@/lib/auth/tokens";
import { ljSessionCookieOptions } from "@/lib/auth/cookies";
import { sessionHours } from "@/lib/auth/constants";
import {
  changeOwnPassword,
  resetVendorPassword,
} from "@/lib/auth/password-management";
import {
  ForbiddenError,
  UserNotFoundError,
  UserValidationError,
} from "@/lib/auth/errors";
import {
  activarUsuario,
  createVendor,
  desactivarUsuario,
} from "@/lib/users/admin-users";
import { createTicket } from "@/lib/tickets/create-ticket";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { getDailyReport } from "@/lib/reports/get-daily-report";
import { sumMoneyStrings } from "@/lib/reports/aggregate-sales";
import { listAdminTickets } from "@/lib/tickets/list-admin-tickets";
import {
  getVendorTicketById,
  listVendorTickets,
} from "@/lib/tickets/vendor-tickets";
import { getPublicTicketByCodigo } from "@/lib/tickets/get-public-ticket";
import { getExposureForDraw } from "@/lib/tickets/get-exposure";
import { parseCreateTicketBody } from "@/lib/tickets/parse-create-ticket-body";
import {
  AnimalNotFoundError,
  DrawClosedError,
  IdempotencyConflictError,
  TicketNotFoundError,
} from "@/lib/tickets/errors";
import { hoyYYYYMMDD } from "@/lib/fecha";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";
import {
  AHORA_VE_MANANA,
  assertIntegrationPrismaClient,
  createIntegrationPrismaClient,
  fechaJuegoDate,
  newIdempotencyKey,
  seedMinimalBusiness,
} from "@/lib/tickets/integration/harness";
import {
  cleanupOwnedTicketDomain,
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
import {
  authorizeAdminUi,
  authorizePerfilUi,
  authorizeVentaUi,
  canAccessAdminApi,
  canAccessVentaApi,
  canChangeOwnPassword,
  canResetVendorPassword,
  envSecretAuthenticates,
  isPublicTicketPath,
  legacyCookieGrantsAccess,
} from "@/lib/acceptance/authorize-rules";

const ENABLED = process.env.RUN_ACCEPTANCE === "1";

/** Contraseña de la suite — nunca se imprime. */
function adminPasswordForTest(): string {
  const p = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
  assert.ok(
    p && p.length >= 8,
    "ADMIN_BOOTSTRAP_PASSWORD requerida en entorno de acceptance",
  );
  return p;
}

const VENDOR_PASS = "vendor-test-12";

function moneyAdd(a: string, b: string): string {
  return (Number(a) + Number(b)).toFixed(2);
}

describe("acceptance — auth + tickets + liquidación", { skip: !ENABLED }, () => {
  let db: ReturnType<typeof createIntegrationPrismaClient>;
  let domain: OwnedTicketDomain;
  let runTag: string;
  let adminId: string;
  let adminPassword: string;
  let adminUsuario: string;
  /** Multiplicador real al entrar a la suite (restaurar al salir). */
  let suiteMultiplicador: number | null;
  let suiteCreditosSnap: CreditosConfigSnapshot = { existed: false };
  let testCreditosLease: CreditosConfigLease | null = null;

  before(async () => {
    const ep = assertIntegrationPointsAtTestDatabase();
    assert.equal(
      ep,
      NEON_ENDPOINTS.TEST,
      `acceptance exige endpoint TEST; recibido ${ep || "(vacío)"}`,
    );
    db = createIntegrationPrismaClient();
    runTag = `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const mult = await db.configNegocio.findUnique({
      where: { clave: "MULTIPLICADOR_PREMIO" },
      select: { valorInt: true },
    });
    suiteMultiplicador = mult?.valorInt ?? null;
    suiteCreditosSnap = await readCreditosConfigSnapshot(db);
    await seedMinimalBusiness(db);
  });

  beforeEach(async () => {
    assertIntegrationPointsAtTestDatabase();
    if (domain) {
      await cleanupOwnedTicketDomain(db, domain);
    }
    domain = createOwnedTicketDomain();
    trackFixtureTicketCounter(domain);
    await seedMinimalBusiness(db);
    // Valor de prueba esperado por los casos (no es el estado permanente de TEST).
    await db.configNegocio.upsert({
      where: { clave: "MULTIPLICADOR_PREMIO" },
      update: { valorInt: 30 },
      create: { clave: "MULTIPLICADOR_PREMIO", valorInt: 30 },
    });

    // Override temporal CreditosConfig OFF; restore seguro vía lease.
    testCreditosLease = await beginTemporaryCreditosControlOff(db);

    // ADMIN propio de la ejecución — nunca reutilizar / mutar admins preexistentes.
    adminPassword = adminPasswordForTest();
    adminUsuario = `${runTag}_adm`.slice(0, 40);
    const passwordHash = await hashPassword(adminPassword);
    const admin = await db.usuario.create({
      data: {
        nombre: "Admin Acceptance",
        usuario: adminUsuario,
        passwordHash,
        rol: "ADMIN",
        activo: true,
      },
      select: {
        id: true,
        usuario: true,
        rol: true,
        activo: true,
        passwordHash: true,
      },
    });
    adminId = admin.id;
    trackOwnedUserId(domain, adminId);
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
    } catch {
      /* ignore */
    }
    try {
      await restoreCreditosConfigBaseline(db, suiteCreditosSnap);
    } catch {
      /* ignore */
    }
    try {
      // Restaurar valor previo; si no había fila, dejar 30 (idempotente con seed).
      const restoreVal = suiteMultiplicador ?? 30;
      await db.configNegocio.upsert({
        where: { clave: "MULTIPLICADOR_PREMIO" },
        update: { valorInt: restoreVal },
        create: { clave: "MULTIPLICADOR_PREMIO", valorInt: restoreVal },
      });
    } catch {
      /* ignore */
    }
    await db.$disconnect();
  });

  async function createVendorUser(suffix: string) {
    assertIntegrationPrismaClient(db);
    const usuario = `${runTag}_${suffix}`.slice(0, 40);
    const vendor = await createVendor(
      db,
      {
        nombre: `Vend ${suffix}`,
        usuario,
        password: VENDOR_PASS,
      },
      { actorUserId: adminId },
    );
    trackOwnedUserId(domain, vendor.id);
    return vendor;
  }

  async function countOwnTickets(): Promise<number> {
    const userIds = [...domain.userIds];
    if (userIds.length === 0) return 0;
    return db.ticket.count({
      where: {
        OR: [
          { vendedorId: { in: userIds } },
          { id: { in: [...domain.ticketIds] } },
        ],
      },
    });
  }

  // ——— 2. Admin propio de la suite ———
  it("bootstrap ADMIN: un admin, hash ≠ password, activo", async () => {
    const a = await db.usuario.findUniqueOrThrow({ where: { id: adminId } });
    assert.equal(a.rol, "ADMIN");
    assert.equal(a.activo, true);
    assert.equal(a.usuario, adminUsuario);
    assert.ok(a.passwordHash.length > 20);
    assert.notEqual(a.passwordHash, adminPassword);
    assert.doesNotMatch(
      a.passwordHash,
      new RegExp(adminPassword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  // ——— 3–4. Login ———
  it("login ADMIN: sesión, cookie conceptual, tokenHash ≠ token", async () => {
    const result = await loginWithCredentials(db, {
      usuario: adminUsuario,
      password: adminPassword,
    });
    assert.ok(result);
    assert.equal(result!.user.rol, "ADMIN");
    assert.ok(result!.token.length > 20);

    const sessions = await db.usuarioSesion.findMany({
      where: { usuarioId: adminId },
    });
    assert.equal(sessions.length, 1);
    const s = sessions[0]!;
    assert.ok(s.tokenHash);
    assert.notEqual(s.tokenHash, result!.token);
    assert.equal(s.tokenHash, hashSessionToken(result!.token));

    const expectedMs = sessionHours() * 60 * 60 * 1000;
    const delta = Math.abs(s.expiresAt.getTime() - result!.expiresAt.getTime());
    assert.ok(delta < 2000);
    assert.ok(
      Math.abs(s.expiresAt.getTime() - (Date.now() + expectedMs)) < 60_000,
    );

    // passwordHash / token no en objeto user
    assert.equal("passwordHash" in result!.user, false);
    assert.equal("token" in result!.user, false);
  });

  it("login ADMIN contraseña incorrecta → null genérico", async () => {
    const result = await loginWithCredentials(db, {
      usuario: adminUsuario,
      password: "wrong-password-xx",
    });
    assert.equal(result, null);
  });

  it("login VENDEDOR asocia sesión al Usuario correcto", async () => {
    const vendor = await createVendorUser("vend_acc_a");
    const result = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });
    assert.ok(result);
    assert.equal(result!.user.id, vendor.id);
    assert.equal(result!.user.rol, "VENDEDOR");
    const ses = await db.usuarioSesion.findFirst({
      where: { usuarioId: vendor.id },
    });
    assert.ok(ses);
  });

  // ——— 5. Autorización ———
  it("permisos UI/API ADMIN vs VENDEDOR; /ticket público", async () => {
    const vendor = await createVendorUser("vend_perm");
    const adminLogin = await loginWithCredentials(db, {
      usuario: adminUsuario,
      password: adminPassword,
    });
    const vendLogin = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });
    assert.ok(adminLogin && vendLogin);

    const adminResolved = await resolveSessionByToken(db, adminLogin!.token);
    const vendResolved = await resolveSessionByToken(db, vendLogin!.token);
    assert.ok(adminResolved && vendResolved);

    assert.equal(authorizeAdminUi(adminResolved!.user).ok, true);
    assert.equal(authorizeVentaUi(adminResolved!.user).ok, true);
    assert.equal(authorizePerfilUi(adminResolved!.user).ok, true);
    assert.equal(canAccessAdminApi(adminResolved!.user), true);
    assert.equal(canAccessVentaApi(adminResolved!.user), true);
    assert.equal(canChangeOwnPassword(adminResolved!.user), true);
    assert.equal(canResetVendorPassword(adminResolved!.user), true);

    const vendAdminUi = authorizeAdminUi(vendResolved!.user);
    assert.equal(vendAdminUi.ok, false);
    if (!vendAdminUi.ok) assert.equal(vendAdminUi.redirect, "/venta");

    assert.equal(authorizeVentaUi(vendResolved!.user).ok, true);
    assert.equal(authorizePerfilUi(vendResolved!.user).ok, true);
    assert.equal(canAccessAdminApi(vendResolved!.user), false);
    assert.equal(canAccessVentaApi(vendResolved!.user), true);
    assert.equal(canChangeOwnPassword(vendResolved!.user), true);
    assert.equal(canResetVendorPassword(vendResolved!.user), false);

    // Sin sesión
    assert.equal(canAccessVentaApi(null), false);
    assert.equal(canAccessAdminApi(null), false);
    assert.equal(authorizePerfilUi(null).ok, false);
    assert.equal(canChangeOwnPassword(null), false);
    assert.equal(canResetVendorPassword(null), false);

    assert.equal(isPublicTicketPath("/ticket/abc"), true);
    assert.equal(isPublicTicketPath("/admin/tickets"), false);
  });

  it("admin_session / secretos legacy NO conceden acceso", () => {
    assert.equal(legacyCookieGrantsAccess("fake-admin-session"), false);
    assert.equal(legacyCookieGrantsAccess(process.env.ADMIN_SESSION_SECRET), false);
    assert.equal(envSecretAuthenticates("ADMIN_PASSWORD"), false);
    assert.equal(envSecretAuthenticates("ADMIN_SESSION_SECRET"), false);
  });

  // ——— 6–8. Tickets propiedad ———
  it("creación ticket: vendedorId de sesión; ignore body ajeno", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const va = await createVendorUser("vend_own_a");
    const vb = await createVendorUser("vend_own_b");

    const parsed = parseCreateTicketBody({
      fechaJuego: fecha,
      vendedorId: vb.id,
      idempotencyKey: newIdempotencyKey(),
      lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
    });
    assert.equal(parsed.vendedorId, null);

    const created = await createTicket(
      {
        ...parsed,
        vendedorId: va.id,
        idempotencyKey: parsed.idempotencyKey,
      },
      AHORA_VE_MANANA,
      db,
    );
    assert.equal(created.ticket.vendedorId, va.id);
    const row = await db.ticket.findUniqueOrThrow({
      where: { id: created.ticket.id },
    });
    assert.equal(row.vendedorId, va.id);
    assert.notEqual(row.vendedorId, vb.id);
  });

  it("historial: A ve solo suyos; B ajeno → 404; ADMIN ve ambos + null", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const va = await createVendorUser("vend_hist_a");
    const vb = await createVendorUser("vend_hist_b");

    const ticketA = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: va.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    const ticketB = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vb.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 15, numeroAnimal: "05", importe: "1.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );

    // Histórico null
    await db.ticketCounter.upsert({
      where: { fechaJuego: fechaJuegoDate() },
      update: { ultimoNumero: 99 },
      create: { fechaJuego: fechaJuegoDate(), ultimoNumero: 99 },
    });
    const hist = await db.ticket.create({
      data: {
        numeroVisible: `LJ-${fecha.replace(/-/g, "")}-h${runTag.slice(-5)}`,
        codigoPublico: `hist_acc_${runTag}`,
        fechaJuego: fechaJuegoDate(),
        vendedorId: null,
        totalApostado: new Prisma.Decimal("1.00"),
        multiplicadorUsado: 30,
        estado: "EMITIDO",
        lineas: {
          create: {
            fechaJuego: fechaJuegoDate(),
            hora: 16,
            numeroAnimal: "03",
            nombreAnimalSnapshot: "Ciempiés",
            importe: new Prisma.Decimal("1.00"),
          },
        },
      },
    });
    trackOwnedTicketId(domain, hist.id);
    trackOwnedTicketId(domain, ticketA.ticket.id);
    trackOwnedTicketId(domain, ticketB.ticket.id);

    const listA = await listVendorTickets(
      db,
      { userId: va.id, rol: "VENDEDOR" },
      {},
    );
    const idsA = listA.tickets.map((t) => t.id);
    assert.ok(idsA.includes(ticketA.ticket.id));
    assert.equal(idsA.includes(ticketB.ticket.id), false);
    assert.equal(idsA.includes(hist.id), false);

    await assert.rejects(
      () =>
        getVendorTicketById(
          db,
          { userId: va.id, rol: "VENDEDOR" },
          ticketB.ticket.id,
        ),
      TicketNotFoundError,
    );

    const adminList = await listAdminTickets(db, {});
    const adminIds = adminList.items.map((t) => t.id);
    assert.ok(adminIds.includes(ticketA.ticket.id));
    assert.ok(adminIds.includes(ticketB.ticket.id));
    assert.ok(adminIds.includes(hist.id));
  });

  // ——— 9. Anulación ———
  it("anulación ADMIN: anuladoPorId + vendedor sigue consultando", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const vendor = await createVendorUser("vend_anul");
    const created = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendor.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );

    const anulado = await anularTicket(db, {
      id: created.ticket.id,
      motivo: "Corrección acceptance: error de digitación",
      anuladoPorId: adminId,
    });
    assert.equal(anulado.estado, "ANULADO");
    assert.equal(anulado.anuladoPorId, adminId);

    const row = await db.ticket.findUniqueOrThrow({
      where: { id: created.ticket.id },
    });
    assert.equal(row.estado, "ANULADO");
    assert.ok(row.anuladoAt);
    assert.equal(row.anuladoPorId, adminId);
    assert.match(row.motivoAnulacion ?? "", /digitación/);

    const detalle = await getVendorTicketById(
      db,
      { userId: vendor.id, rol: "VENDEDOR" },
      created.ticket.id,
    );
    assert.equal(detalle.estado, "ANULADO");
    assert.equal(detalle.estadoDerivado, "ANULADO");
    assert.equal(await db.ticketLinea.count({ where: { ticketId: row.id } }), 1);
  });

  // ——— 10–11. Desactivación / reactivación ———
  it("desactivar invalida sesión; reactivar exige login nuevo", async () => {
    const vendor = await createVendorUser("vend_deact");
    const login = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });
    assert.ok(login);
    assert.ok(await resolveSessionByToken(db, login!.token));

    await desactivarUsuario(db, { id: vendor.id, actorUserId: adminId });
    const inactive = await db.usuario.findUniqueOrThrow({
      where: { id: vendor.id },
    });
    assert.equal(inactive.activo, false);

    assert.equal(await resolveSessionByToken(db, login!.token), null);

    // No puede operar como vendedor activo
    const reLogin = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });
    assert.equal(reLogin, null);

    await activarUsuario(db, { id: vendor.id });
    const fresh = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });
    assert.ok(fresh);
    assert.notEqual(fresh!.token, login!.token);
    assert.ok(await resolveSessionByToken(db, fresh!.token));
    // sesión antigua sigue inválida (si aún existiera hash)
    assert.equal(await resolveSessionByToken(db, login!.token), null);
  });

  // ——— 12–13. Resultados / liquidación ———
  it("resultado y cambio de resultado: liquidación derivada", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const vendor = await createVendorUser("vend_liq");
    const created = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendor.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "5.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );

    let pub = await getPublicTicketByCodigo(created.ticket.codigoPublico, db);
    assert.ok(pub);
    assert.equal(pub!.estado, "PENDIENTE");

    trackOwnedTicketId(domain, created.ticket.id);
    const slot = await db.resultado.findUnique({
      where: {
        fecha_hora: { fecha: fechaJuegoDate(), hora: 14 },
      },
    });
    if (slot && !domain.resultadoIds.has(slot.id)) {
      // Slot ajeno: no mutar. Validar solo estado pendiente del ticket propio.
      assert.equal(pub!.estado, "PENDIENTE");
      return;
    }
    let resultadoId = slot?.id;
    if (!resultadoId) {
      const createdRes = await db.resultado.create({
        data: {
          fecha: fechaJuegoDate(),
          hora: 14,
          numero: "03",
        },
      });
      resultadoId = createdRes.id;
      trackOwnedResultadoId(domain, resultadoId);
    } else {
      await db.resultado.update({
        where: { id: resultadoId },
        data: { numero: "03" },
      });
    }

    pub = await getPublicTicketByCodigo(created.ticket.codigoPublico, db);
    assert.equal(pub!.estado, "GANADOR");
    assert.equal(pub!.premioTotal, "150.00");
    assert.equal(pub!.lineas[0]!.estado, "GANADORA");

    await db.resultado.update({
      where: { id: resultadoId },
      data: { numero: "05" },
    });

    pub = await getPublicTicketByCodigo(created.ticket.codigoPublico, db);
    assert.equal(pub!.estado, "NO_GANADOR");
    assert.equal(pub!.premioTotal, "0.00");
    assert.equal(pub!.lineas[0]!.estado, "NO_GANADORA");

    const linea = await db.ticketLinea.findFirstOrThrow({
      where: { ticketId: created.ticket.id },
    });
    assert.equal(linea.numeroAnimal, "03");
  });

  // ——— 14. Exposición ———
  it("exposición ignora anulados", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const vendor = await createVendorUser("vend_exp");
    const before = await getExposureForDraw({ fechaJuego: fecha, hora: 14, db });

    await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendor.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "5.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    const anular = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendor.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "10.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    await anularTicket(db, {
      id: anular.ticket.id,
      motivo: "Anulación para prueba de exposición",
      anuladoPorId: adminId,
    });

    const exp = await getExposureForDraw({ fechaJuego: fecha, hora: 14, db });
    assert.equal(
      exp.totalApostado,
      moneyAdd(before.totalApostado, "5.00"),
    );
    assert.equal(
      exp.totalExposicion,
      moneyAdd(before.totalExposicion, "150.00"),
    );
  });

  // ——— 15. Multiplicador histórico ———
  it("multiplicadorUsado histórico vs config nueva", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const vendor = await createVendorUser("vend_mult");

    const oldT = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendor.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "5.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    assert.equal(oldT.ticket.multiplicadorUsado, 30);

    await db.configNegocio.update({
      where: { clave: "MULTIPLICADOR_PREMIO" },
      data: { valorInt: 25 },
    });

    const slot14 = await db.resultado.findUnique({
      where: {
        fecha_hora: { fecha: fechaJuegoDate(), hora: 14 },
      },
    });
    if (slot14 && !domain.resultadoIds.has(slot14.id)) {
      // No mutar resultado ajeno; el premio histórico ya quedó fijado en el ticket.
      assert.equal(oldT.ticket.multiplicadorUsado, 30);
      const newT = await createTicket(
        {
          fechaJuego: fecha,
          vendedorId: vendor.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 15, numeroAnimal: "05", importe: "5.00" }],
        },
        AHORA_VE_MANANA,
        db,
      );
      assert.equal(newT.ticket.multiplicadorUsado, 25);
      return;
    }
    if (!slot14) {
      const res = await db.resultado.create({
        data: { fecha: fechaJuegoDate(), hora: 14, numero: "03" },
      });
      trackOwnedResultadoId(domain, res.id);
    } else {
      await db.resultado.update({
        where: { id: slot14.id },
        data: { numero: "03" },
      });
    }

    const pubOld = await getPublicTicketByCodigo(oldT.ticket.codigoPublico, db);
    assert.equal(pubOld!.premioTotal, "150.00"); // 5 × 30

    const newT = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendor.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 15, numeroAnimal: "05", importe: "5.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    assert.equal(newT.ticket.multiplicadorUsado, 25);
  });

  // ——— 16–17. Idempotencia + concurrencia ———
  it("idempotencia: replay, body distinto, otro vendedor", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const va = await createVendorUser("vend_idem_a");
    const vb = await createVendorUser("vend_idem_b");
    const key = newIdempotencyKey();
    const input = {
      fechaJuego: fecha,
      vendedorId: va.id,
      idempotencyKey: key,
      lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
    };

    const first = await createTicket(input, AHORA_VE_MANANA, db);
    const second = await createTicket(input, AHORA_VE_MANANA, db);
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.ticket.id, first.ticket.id);
    assert.equal(await countOwnTickets(), 1);

    await assert.rejects(
      () =>
        createTicket(
          {
            ...input,
            lineas: [{ hora: 14, numeroAnimal: "03", importe: "20.00" }],
          },
          AHORA_VE_MANANA,
      db,
    ),
      IdempotencyConflictError,
    );

    await assert.rejects(
      () =>
        createTicket({ ...input, vendedorId: vb.id }, AHORA_VE_MANANA, db),
      IdempotencyConflictError,
    );
  });

  it("concurrencia: 20 numeros únicos + 10 same-key → 1 ticket", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const vendor = await createVendorUser("vend_conc");

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        createTicket(
          {
            fechaJuego: fecha,
            vendedorId: vendor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [
              {
                hora: 14 + (i % 5),
                numeroAnimal: i % 2 === 0 ? "03" : "05",
                importe: "1.00",
              },
            ],
          },
          AHORA_VE_MANANA,
          db,
        ),
      ),
    );
    assert.equal(new Set(results.map((r) => r.ticket.numeroVisible)).size, 20);

    // Sin wipe: nuevo vendedor propio para el subcaso de idempotencia concurrente.
    const vendor2 = await createVendorUser("vend_conc2");
    const key = newIdempotencyKey();
    const input = {
      fechaJuego: fecha,
      vendedorId: vendor2.id,
      idempotencyKey: key,
      lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
    };
    const parallel = await Promise.all(
      Array.from({ length: 10 }, () => createTicket(input, AHORA_VE_MANANA, db)),
    );
    assert.equal(new Set(parallel.map((r) => r.ticket.id)).size, 1);
    assert.equal(
      await db.ticket.count({ where: { vendedorId: vendor2.id } }),
      1,
    );
  });

  // ——— 18. Horas cerradas ———
  it("horas cerradas / mixtas rechazan", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const vendor = await createVendorUser("vend_hora");

    // Hora con resultado (crear solo si el slot está libre; si hay ajeno, también cierra).
    const slot14 = await db.resultado.findUnique({
      where: {
        fecha_hora: { fecha: fechaJuegoDate(), hora: 14 },
      },
    });
    if (!slot14) {
      const createdRes = await db.resultado.create({
        data: { fecha: fechaJuegoDate(), hora: 14, numero: "03" },
      });
      trackOwnedResultadoId(domain, createdRes.id);
    }
    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fecha,
            vendedorId: vendor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
          },
          AHORA_VE_MANANA,
      db,
    ),
      DrawClosedError,
    );

    // Hora actual (08:00 VE → usar ahora con hora 15 Caracas = 19:00 UTC)
    const ahoraHora15 = new Date(Date.UTC(2026, 9, 2, 19, 0, 0)); // 15:00 VE
    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: hoyYYYYMMDD(ahoraHora15),
            vendedorId: vendor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 15, numeroAnimal: "05", importe: "1.00" }],
          },
          ahoraHora15,
          db,
        ),
      DrawClosedError,
    );

    // Hora pasada
    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: hoyYYYYMMDD(ahoraHora15),
            vendedorId: vendor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 10, numeroAnimal: "05", importe: "1.00" }],
          },
          ahoraHora15,
          db,
        ),
      DrawClosedError,
    );

    // Mixta: abierta + cerrada (resultado)
    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fecha,
            vendedorId: vendor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [
              { hora: 16, numeroAnimal: "05", importe: "1.00" },
              { hora: 14, numeroAnimal: "03", importe: "1.00" },
            ],
          },
          AHORA_VE_MANANA,
      db,
    ),
      DrawClosedError,
    );
    assert.equal(await countOwnTickets(), 0);
  });

  // ——— 19. QR / público ———
  it("consulta pública por codigoPublico (no numeroVisible)", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const vendor = await createVendorUser("vend_qr");
    const created = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendor.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "1.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    assert.ok(created.ticket.codigoPublico.length > 8);

    const byCodigo = await getPublicTicketByCodigo(
      created.ticket.codigoPublico,
      db,
    );
    assert.ok(byCodigo);
    assert.equal(byCodigo!.id, created.ticket.id);

    const byVisible = await getPublicTicketByCodigo(
      created.ticket.numeroVisible,
      db,
    );
    assert.equal(byVisible, null);
  });

  // ——— 20–21. Expiración + logout ———
  it("sesión expirada y logout invalidan", async () => {
    const vendor = await createVendorUser("vend_sess");
    const login = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });
    assert.ok(login);

    await db.usuarioSesion.updateMany({
      where: { usuarioId: vendor.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    assert.equal(await resolveSessionByToken(db, login!.token), null);

    const login2 = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });
    assert.ok(login2);
    await deleteSessionByToken(db, login2!.token);
    assert.equal(await resolveSessionByToken(db, login2!.token), null);
    assert.equal(
      await db.usuarioSesion.count({ where: { usuarioId: vendor.id } }),
      0,
    );
  });

  // ——— 22–23. Secretos ———
  it("passwordHash y token real no salen en APIs públicas de usuario", async () => {
    const vendor = await createVendor(db, {
      nombre: "Sec Vend",
      usuario: `${runTag}_sec`.slice(0, 40),
      password: VENDOR_PASS,
    });
    trackOwnedUserId(domain, vendor.id);
    const json = JSON.stringify(vendor);
    assert.doesNotMatch(json, /passwordHash/);
    assert.doesNotMatch(json, /password/);

    const login = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });
    assert.ok(login);
    const userJson = JSON.stringify(login!.user);
    assert.doesNotMatch(userJson, /passwordHash/);
    assert.equal(userJson.includes(login!.token), false);

    const sessions = await db.usuarioSesion.findMany({ where: { usuarioId: vendor.id } });
    for (const s of sessions) {
      assert.notEqual(s.tokenHash, login!.token);
    }
  });

  // ——— 26. Cookies ———
  it("cookie lj_session: httpOnly, sameSite=lax, secure solo prod", () => {
    const opts = ljSessionCookieOptions();
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, "lax");
    assert.equal(opts.path, "/");
    assert.equal(opts.secure, process.env.NODE_ENV === "production");
  });

  // Animal inexistente (rollback smoke)
  it("animal inexistente no deja ticket", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const vendor = await createVendorUser("vend_roll");
    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fecha,
            vendedorId: vendor.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 14, numeroAnimal: "99", importe: "1.00" }],
          },
          AHORA_VE_MANANA,
      db,
    ),
      AnimalNotFoundError,
    );
    assert.equal(await countOwnTickets(), 0);
  });

  // ——— Passwords: change + admin reset ———
  it("change-password: invalida sesión; antigua falla; nueva login OK", async () => {
    const vendor = await createVendorUser("vend_pw_chg");
    const login = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });
    assert.ok(login);

    await changeOwnPassword(db, {
      userId: vendor.id,
      currentPassword: VENDOR_PASS,
      newPassword: "vendor-acc-99",
    });

    assert.equal(await resolveSessionByToken(db, login!.token), null);
    assert.equal(
      await loginWithCredentials(db, {
        usuario: vendor.usuario,
        password: VENDOR_PASS,
      }),
      null,
    );
    const again = await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: "vendor-acc-99",
    });
    assert.ok(again);
    assert.equal("passwordHash" in again!.user, false);
  });

  it("change-password rechaza actual incorrecta / igual / corta / inactivo", async () => {
    const vendor = await createVendorUser("vend_pw_bad");
    await assert.rejects(
      () =>
        changeOwnPassword(db, {
          userId: vendor.id,
          currentPassword: "wrong-xxxx",
          newPassword: "nueva1234",
        }),
      UserValidationError,
    );
    await assert.rejects(
      () =>
        changeOwnPassword(db, {
          userId: vendor.id,
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
          userId: vendor.id,
          currentPassword: VENDOR_PASS,
          newPassword: "corta",
        }),
      UserValidationError,
    );

    await desactivarUsuario(db, {
      actorUserId: adminId,
      id: vendor.id,
    });
    await assert.rejects(
      () =>
        changeOwnPassword(db, {
          userId: vendor.id,
          currentPassword: VENDOR_PASS,
          newPassword: "nueva1234",
        }),
      ForbiddenError,
    );
  });

  it("ADMIN reset VENDEDOR: hash nuevo, sesiones 0, inactivo no reactivado; no reset ADMIN", async () => {
    const vendor = await createVendorUser("vend_pw_rst");
    await loginWithCredentials(db, {
      usuario: vendor.usuario,
      password: VENDOR_PASS,
    });

    await desactivarUsuario(db, {
      actorUserId: adminId,
      id: vendor.id,
    });

    await resetVendorPassword(db, {
      actorUserId: adminId,
      targetUserId: vendor.id,
      newPassword: "reset-acc-77",
    });

    const row = await db.usuario.findUniqueOrThrow({ where: { id: vendor.id } });
    assert.equal(row.activo, false);
    assert.equal(await verifyPassword("reset-acc-77", row.passwordHash), true);
    assert.equal(await verifyPassword(VENDOR_PASS, row.passwordHash), false);
    assert.equal(
      await db.usuarioSesion.count({ where: { usuarioId: vendor.id } }),
      0,
    );
    assert.doesNotMatch(JSON.stringify({ ok: true }), /passwordHash|reset-acc/);

    await assert.rejects(
      () =>
        resetVendorPassword(db, {
          actorUserId: adminId,
          targetUserId: adminId,
          newPassword: "nueva1234",
        }),
      UserValidationError,
    );

    await assert.rejects(
      () =>
        resetVendorPassword(db, {
          actorUserId: adminId,
          targetUserId: "00000000-0000-4000-8000-000000000099",
          newPassword: "nueva1234",
        }),
      UserNotFoundError,
    );
  });

  // ——— Reportes ADMIN ———
  it("reporte diario: anulados fuera; consistencia vendedor/hora; sin passwordHash", async () => {
    const fecha = hoyYYYYMMDD(AHORA_VE_MANANA);
    const vendor = await createVendorUser("vend_rep_a");
    const baseline = await getDailyReport(db, fecha);

    await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendor.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [
          { hora: 14, numeroAnimal: "03", importe: "4.00" },
          { hora: 15, numeroAnimal: "05", importe: "6.00" },
        ],
      },
      AHORA_VE_MANANA,
      db,
    );

    const anulado = await createTicket(
      {
        fechaJuego: fecha,
        vendedorId: vendor.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "50.00" }],
      },
      AHORA_VE_MANANA,
      db,
    );
    await anularTicket(db, {
      id: anulado.ticket.id,
      motivo: "Acceptance reporte",
      anuladoPorId: adminId,
    });

    const reporte = await getDailyReport(db, fecha);

    assert.equal(
      reporte.tickets.emitidos,
      baseline.tickets.emitidos + 1,
    );
    assert.equal(
      reporte.tickets.anulados,
      baseline.tickets.anulados + 1,
    );
    assert.equal(
      reporte.ventas.totalJugado,
      moneyAdd(baseline.ventas.totalJugado, "10.00"),
    );
    assert.equal(
      sumMoneyStrings(reporte.porVendedor.map((v) => v.totalJugado)),
      reporte.ventas.totalJugado,
    );
    const vendRow = reporte.porVendedor.find((v) => v.vendedorId === vendor.id);
    assert.ok(vendRow);
    assert.equal(vendRow!.totalJugado, "10.00");
    assert.equal(reporte.porHora.length, 11);
    assert.equal(
      canAccessAdminApi({
        id: adminId,
        nombre: "A",
        usuario: adminUsuario,
        rol: "ADMIN",
        activo: true,
      }),
      true,
    );
    assert.doesNotMatch(JSON.stringify(reporte), /passwordHash/);
  });

  // ——— Auditoría ———
  it("auditoría: resultado 03→05 y anulación sin secretos", async () => {
    const fecha = new Date(Date.UTC(2026, 9, 2));
    const fechaStr = hoyYYYYMMDD(AHORA_VE_MANANA);
    // Hora 12: menos conflicto con ventas fixture (14).
    const hora = 12;
    const existing = await db.resultado.findUnique({
      where: { fecha_hora: { fecha, hora } },
    });
    if (existing && !domain.resultadoIds.has(existing.id)) {
      // No mutar resultado ajeno; la regla de auth ya se cubre abajo.
      assert.equal(canAccessAdminApi(null), false);
      return;
    }

    let resultadoId: string;
    await db.$transaction(async (tx) => {
      const { recordAuditEvent } = await import("@/lib/audit/audit");
      const created = existing
        ? await tx.resultado.update({
            where: { id: existing.id },
            data: { numero: "03" },
          })
        : await tx.resultado.create({
            data: { fecha, hora, numero: "03" },
          });
      resultadoId = created.id;
      await recordAuditEvent(tx, {
        usuarioId: adminId,
        accion: "CREAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: created.id,
        detalle: {
          fecha: fechaStr,
          hora,
          numeroAnterior: null,
          numeroNuevo: "03",
        },
      });
    });
    trackOwnedResultadoId(domain, resultadoId!);

    await db.$transaction(async (tx) => {
      const { recordAuditEvent } = await import("@/lib/audit/audit");
      const updated = await tx.resultado.update({
        where: { id: resultadoId! },
        data: { numero: "05" },
      });
      await recordAuditEvent(tx, {
        usuarioId: adminId,
        accion: "MODIFICAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: updated.id,
        detalle: {
          fecha: fechaStr,
          hora,
          numeroAnterior: "03",
          numeroNuevo: "05",
        },
      });
    });

    const { listAuditoria } = await import("@/lib/audit/list-auditoria");
    const listed = await listAuditoria(db, {
      accion: "MODIFICAR_RESULTADO",
    });
    const mod = listed.items.find((i) => i.entidadId === resultadoId!);
    assert.ok(mod);
    assert.equal(mod!.detalle?.numeroAnterior, "03");
    assert.equal(mod!.detalle?.numeroNuevo, "05");
    assert.doesNotMatch(
      JSON.stringify(listed),
      /passwordHash|tokenHash|idempotencyKey/,
    );
    assert.equal(canAccessAdminApi(null), false);
  });
});
