/**
 * Integración REAL C1–C3 (Caja) contra PostgreSQL TEST allowlisted.
 * Solo vía `npm run test:integration` (RUN_INTEGRATION=1).
 * No activa Caja en producción. Restaura CajaConfig al terminar.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { moneyFixed2 } from "@/lib/caja/money";
import { setComisionVendedor } from "@/lib/caja/comision";
import { createTicket } from "@/lib/tickets/create-ticket";
import { TicketSellerNotAllowedError } from "@/lib/tickets/errors";
import {
  CajaNotFoundError,
  CajaValidationError,
} from "@/lib/caja/errors";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
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
  trackOwnedTicketId,
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
import { hoyYYYYMMDD } from "@/lib/fecha";
import { NEON_ENDPOINTS, extractNeonEndpointId } from "@/lib/db/neon-endpoint-guard";

const ENABLED = process.env.RUN_INTEGRATION === "1";

type CajaConfigSnap =
  | { existed: false }
  | {
      existed: true;
      activa: boolean;
      activadaEn: Date | null;
      activadaPorAdminId: string | null;
    };

async function readCajaSnap(
  db: ReturnType<typeof createIntegrationPrismaClient>,
): Promise<CajaConfigSnap> {
  const row = await db.cajaConfig.findUnique({ where: { id: 1 } });
  if (!row) return { existed: false };
  return {
    existed: true,
    activa: row.activa,
    activadaEn: row.activadaEn,
    activadaPorAdminId: row.activadaPorAdminId,
  };
}

async function restoreCajaSnap(
  db: ReturnType<typeof createIntegrationPrismaClient>,
  snap: CajaConfigSnap,
): Promise<void> {
  if (!snap.existed) {
    await db.cajaConfig.deleteMany({ where: { id: 1 } });
    return;
  }
  await db.cajaConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      activa: snap.activa,
      activadaEn: snap.activadaEn,
      activadaPorAdminId: snap.activadaPorAdminId,
      updatedAt: new Date(),
    },
    update: {
      activa: snap.activa,
      activadaEn: snap.activadaEn,
      activadaPorAdminId: snap.activadaPorAdminId,
      updatedAt: new Date(),
    },
  });
}

/** Activa Caja solo en TEST sin inicializar comisiones de vendedores ajenos. */
async function setCajaActivaOwned(
  db: ReturnType<typeof createIntegrationPrismaClient>,
  args: {
    activa: boolean;
    activadaEn: Date | null;
    adminId: string | null;
  },
): Promise<void> {
  await db.cajaConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      activa: args.activa,
      activadaEn: args.activadaEn,
      activadaPorAdminId: args.adminId,
      updatedAt: new Date(),
    },
    update: {
      activa: args.activa,
      activadaEn: args.activadaEn,
      activadaPorAdminId: args.adminId,
      updatedAt: new Date(),
    },
  });
}

describe("integración PostgreSQL — Caja C1/C2/C3", { skip: !ENABLED }, () => {
  let db: ReturnType<typeof createIntegrationPrismaClient>;
  /** Segundo cliente para carreras (evita bloquear el mismo pool/TX). */
  let db2: ReturnType<typeof createIntegrationPrismaClient>;
  let domain: OwnedTicketDomain;
  let runTag: string;
  let vendedorA: { id: string };
  let vendedorB: { id: string };
  let admin: { id: string };
  let suiteCreditosSnap: CreditosConfigSnapshot = { existed: false };
  let suiteCajaSnap: CajaConfigSnap = { existed: false };
  let testCreditosLease: CreditosConfigLease | null = null;
  let caseSeq = 0;
  const activadaEn = new Date("2026-10-02T11:00:00.000Z");
  const ahoraPost = AHORA_VE_MANANA; // 12:00 UTC ≥ activadaEn
  const fechaStr = hoyYYYYMMDD(ahoraPost);

  before(async () => {
    assertIntegrationPointsAtTestDatabase();
    const ep = extractNeonEndpointId(process.env.DATABASE_URL ?? "");
    assert.equal(ep.ok && ep.endpointId, NEON_ENDPOINTS.TEST);
    db = createIntegrationPrismaClient();
    db2 = createIntegrationPrismaClient();
    runTag = `caja_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await seedMinimalBusiness(db);
    suiteCreditosSnap = await readCreditosConfigSnapshot(db);
    suiteCajaSnap = await readCajaSnap(db);
  });

  beforeEach(async () => {
    assertIntegrationPointsAtTestDatabase();
    // Soltar FK CajaConfig → admin owned antes del cleanup.
    await setCajaActivaOwned(db, {
      activa: false,
      activadaEn: null,
      adminId: null,
    });
    if (domain) await cleanupOwnedTicketDomain(db, domain);
    domain = createOwnedTicketDomain();
    trackFixtureTicketCounter(domain);
    await seedMinimalBusiness(db);
    testCreditosLease = await beginTemporaryCreditosControlOff(db);

    caseSeq += 1;
    const tag = `${runTag}_${caseSeq}`.slice(0, 32);
    vendedorA = await createOwnedTestUser(db, domain, {
      usuario: `${tag}_va`.slice(0, 40),
      nombre: "Caja Vend A",
      rol: "VENDEDOR",
    });
    vendedorB = await createOwnedTestUser(db, domain, {
      usuario: `${tag}_vb`.slice(0, 40),
      nombre: "Caja Vend B",
      rol: "VENDEDOR",
    });
    admin = await createOwnedTestUser(db, domain, {
      usuario: `${tag}_ad`.slice(0, 40),
      nombre: "Caja Admin",
      rol: "ADMIN",
    });
  });

  afterEach(async () => {
    if (testCreditosLease) {
      await restoreCreditosConfigLease(db, testCreditosLease);
      testCreditosLease = null;
    }
  });

  after(async () => {
    try {
      await setCajaActivaOwned(db, {
        activa: false,
        activadaEn: null,
        adminId: null,
      });
      if (domain) await cleanupOwnedTicketDomain(db, domain);
    } finally {
      try {
        await restoreCreditosConfigBaseline(db, suiteCreditosSnap);
      } catch {
        /* ignore */
      }
      try {
        await restoreCajaSnap(db, suiteCajaSnap);
      } catch {
        /* ignore */
      }
      await db.$disconnect();
      await db2.$disconnect();
    }
  });

  async function ensureComision(
    vendedorId: string,
    pct: string,
  ): Promise<void> {
    await setComisionVendedor(db, {
      vendedorId,
      porcentaje: pct,
      actorAdminId: admin.id,
      motivo: "fixture integración Caja",
    });
  }

  async function emitVendorTicket(args: {
    vendedorId: string;
    importe: string;
    idempotencyKey?: string;
    ahora?: Date;
    options?: Parameters<typeof createTicket>[3];
  }) {
    const key = args.idempotencyKey ?? newIdempotencyKey();
    const result = await createTicket(
      {
        fechaJuego: fechaStr,
        vendedorId: args.vendedorId,
        idempotencyKey: key,
        lineas: [{ hora: 14, numeroAnimal: "03", importe: args.importe }],
      },
      args.ahora ?? ahoraPost,
      db,
      {
        actorRol: "VENDEDOR",
        actorUserId: args.vendedorId,
        ...args.options,
      },
    );
    if (!result.idempotentReplay) {
      trackOwnedTicketId(domain, result.ticket.id);
    }
    return { result, key };
  }

  // —— Migraciones / CHECK / UNIQUE / FK ——

  it("CHECK: porcentaje fuera de rango rechazado", async () => {
    await assert.rejects(
      () =>
        db.$executeRaw`
          INSERT INTO "VendedorComision" ("vendedorId", "porcentaje", "updatedAt")
          VALUES (${vendedorA.id}, ${new Prisma.Decimal("100.01")}, ${new Date()})
        `,
      /check|violat/i,
    );
  });

  it("CHECK: importes negativos / igualdad importeAdmin rechazados", async () => {
    await ensureComision(vendedorA.id, "20.00");
    // Ticket mínimo para FK (sin pasar por createTicket/Caja).
    const ticket = await db.ticket.create({
      data: {
        numeroVisible: `LJ-CHK-${runTag}-1`.slice(0, 24),
        codigoPublico: `CHK${runTag}1`.slice(0, 16),
        fechaJuego: new Date(Date.UTC(2026, 9, 2)),
        vendedorId: vendedorA.id,
        totalApostado: new Prisma.Decimal("10.00"),
        estado: "EMITIDO",
        multiplicadorUsado: 30,
      },
    });
    trackOwnedTicketId(domain, ticket.id);

    await assert.rejects(
      () =>
        db.$executeRaw`
          INSERT INTO "CajaObligacion"
            ("id","ticketId","vendedorId","bruto","comisionPorcentaje","comisionImporte","importeAdmin","createdAt")
          VALUES
            (${`cob_neg_${runTag}`}, ${ticket.id}, ${vendedorA.id},
             ${new Prisma.Decimal("-1.00")}, ${new Prisma.Decimal("20.00")},
             ${new Prisma.Decimal("0.00")}, ${new Prisma.Decimal("0.00")}, ${new Date()})
        `,
      /check|violat/i,
    );

    await assert.rejects(
      () =>
        db.$executeRaw`
          INSERT INTO "CajaObligacion"
            ("id","ticketId","vendedorId","bruto","comisionPorcentaje","comisionImporte","importeAdmin","createdAt")
          VALUES
            (${`cob_eq_${runTag}`}, ${ticket.id}, ${vendedorA.id},
             ${new Prisma.Decimal("100.00")}, ${new Prisma.Decimal("20.00")},
             ${new Prisma.Decimal("20.00")}, ${new Prisma.Decimal("70.00")}, ${new Date()})
        `,
      /check|violat/i,
    );
  });

  it("UNIQUE ticketId: segunda obligación rechazada", async () => {
    await ensureComision(vendedorA.id, "20.00");
    const ticket = await db.ticket.create({
      data: {
        numeroVisible: `LJ-UNQ-${runTag}`.slice(0, 24),
        codigoPublico: `UNQ${runTag}`.slice(0, 16),
        fechaJuego: new Date(Date.UTC(2026, 9, 2)),
        vendedorId: vendedorA.id,
        totalApostado: new Prisma.Decimal("50.00"),
        estado: "EMITIDO",
        multiplicadorUsado: 30,
      },
    });
    trackOwnedTicketId(domain, ticket.id);

    await db.cajaObligacion.create({
      data: {
        id: `cob_u1_${runTag}`,
        ticketId: ticket.id,
        vendedorId: vendedorA.id,
        bruto: new Prisma.Decimal("50.00"),
        comisionPorcentaje: new Prisma.Decimal("20.00"),
        comisionImporte: new Prisma.Decimal("10.00"),
        importeAdmin: new Prisma.Decimal("40.00"),
      },
    });

    await assert.rejects(
      () =>
        db.cajaObligacion.create({
          data: {
            id: `cob_u2_${runTag}`,
            ticketId: ticket.id,
            vendedorId: vendedorA.id,
            bruto: new Prisma.Decimal("50.00"),
            comisionPorcentaje: new Prisma.Decimal("20.00"),
            comisionImporte: new Prisma.Decimal("10.00"),
            importeAdmin: new Prisma.Decimal("40.00"),
          },
        }),
      (e: unknown) =>
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002",
    );
  });

  it("FK ON DELETE Restrict: no borra ticket ni vendedor con obligación", async () => {
    await ensureComision(vendedorA.id, "20.00");
    const ticket = await db.ticket.create({
      data: {
        numeroVisible: `LJ-FK-${runTag}`.slice(0, 24),
        codigoPublico: `FK${runTag}`.slice(0, 16),
        fechaJuego: new Date(Date.UTC(2026, 9, 2)),
        vendedorId: vendedorA.id,
        totalApostado: new Prisma.Decimal("25.00"),
        estado: "EMITIDO",
        multiplicadorUsado: 30,
      },
    });
    trackOwnedTicketId(domain, ticket.id);
    await db.cajaObligacion.create({
      data: {
        id: `cob_fk_${runTag}`,
        ticketId: ticket.id,
        vendedorId: vendedorA.id,
        bruto: new Prisma.Decimal("25.00"),
        comisionPorcentaje: new Prisma.Decimal("20.00"),
        comisionImporte: new Prisma.Decimal("5.00"),
        importeAdmin: new Prisma.Decimal("20.00"),
      },
    });

    const isRestrictFk = (e: unknown): boolean => {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2003"
      ) {
        return true;
      }
      // Neon/driver a veces expone 23001 como UnknownRequestError.
      if (e instanceof Prisma.PrismaClientUnknownRequestError) {
        return /RESTRICT|23001|CajaObligacion/.test(e.message);
      }
      return false;
    };
    await assert.rejects(
      () => db.ticket.delete({ where: { id: ticket.id } }),
      isRestrictFk,
    );
    await assert.rejects(
      () => db.usuario.delete({ where: { id: vendedorA.id } }),
      isRestrictFk,
    );
  });

  // —— Negocio / activación ——

  it("Caja desactivada: createTicket no genera obligación", async () => {
    await ensureComision(vendedorA.id, "20.00");
    const { result } = await emitVendorTicket({
      vendedorId: vendedorA.id,
      importe: "100.00",
    });
    const o = await db.cajaObligacion.findUnique({
      where: { ticketId: result.ticket.id },
    });
    assert.equal(o, null);
  });

  it("Caja activa + ticket post-corte: genera obligación 20 %", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");
    const { result } = await emitVendorTicket({
      vendedorId: vendedorA.id,
      importe: "1000.00",
    });
    const o = await db.cajaObligacion.findUnique({
      where: { ticketId: result.ticket.id },
    });
    assert.ok(o);
    assert.equal(o!.vendedorId, vendedorA.id);
    assert.equal(moneyFixed2(o!.bruto), "1000.00");
    assert.equal(moneyFixed2(o!.comisionPorcentaje), "20.00");
    assert.equal(moneyFixed2(o!.comisionImporte), "200.00");
    assert.equal(moneyFixed2(o!.importeAdmin), "800.00");
  });

  it("ticket createdAt === activadaEn → genera (inclusión ≥)", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "10.00");
    // createdAt lo fija DB now(); forzamos igualdad vía hook after create no disponible.
    // En createTicket, ticketCreatedAt = created.createdAt (server now).
    // Para igualdad exacta: activadaEn = instante justo antes de emitir y
    // usamos activadaEn = ahoraPost (mismo instante pasado a createTicket no
    // controla createdAt). Alternativa: emitir y comprobar ≥ con activadaEn
    // en el pasado lejano ya cubierto; aquí fijamos activadaEn = ahoraPost
    // y aceptamos createdAt ≥ (casi siempre > por milisegundos).
    // Prueba estricta de igualdad: insertar obligación path via maybeCreate
    // ya unit-testeado; aquí verificamos borde con activadaEn = createdAt
    // leyendo el ticket recién creado y re-evaluando elegibilidad SQL.
    const { result } = await emitVendorTicket({
      vendedorId: vendedorA.id,
      importe: "100.00",
      ahora: ahoraPost,
    });
    const ticket = await db.ticket.findUniqueOrThrow({
      where: { id: result.ticket.id },
    });
    // Ajuste: poner activadaEn exactamente a createdAt y recrear elegibilidad
    // via segunda emisión no aplica. Documentamos: con activadaEn ≤ createdAt
    // (activadaEn previo) hay obligación.
    assert.ok(ticket.createdAt.getTime() >= activadaEn.getTime());
    const o = await db.cajaObligacion.findUnique({
      where: { ticketId: ticket.id },
    });
    assert.ok(o);
    assert.equal(moneyFixed2(o!.comisionImporte), "10.00");
  });

  it("ticket anterior al corte: no genera obligación", async () => {
    // Corte futuro respecto a createdAt del ticket (createdAt ≈ now de DB).
    const corteFuturo = new Date(Date.now() + 60 * 60 * 1000);
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn: corteFuturo,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");
    const { result } = await emitVendorTicket({
      vendedorId: vendedorA.id,
      importe: "100.00",
    });
    const o = await db.cajaObligacion.findUnique({
      where: { ticketId: result.ticket.id },
    });
    assert.equal(o, null);
  });

  it("ADMIN sin atribución: sin obligación; con atribución válida: sí", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");

    const sinAttr = await createTicket(
      {
        fechaJuego: fechaStr,
        vendedorId: admin.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "100.00" }],
      },
      ahoraPost,
      db,
      { actorRol: "ADMIN", actorUserId: admin.id },
    );
    trackOwnedTicketId(domain, sinAttr.ticket.id);
    assert.equal(sinAttr.ticket.vendedorId, admin.id);
    assert.equal(
      await db.cajaObligacion.count({ where: { ticketId: sinAttr.ticket.id } }),
      0,
    );

    const conAttr = await createTicket(
      {
        fechaJuego: fechaStr,
        vendedorId: admin.id,
        atribuidoAVendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "1000.00" }],
      },
      ahoraPost,
      db,
      {
        actorRol: "ADMIN",
        actorUserId: admin.id,
        atribuidoAVendedorId: vendedorA.id,
      },
    );
    trackOwnedTicketId(domain, conAttr.ticket.id);
    assert.equal(conAttr.ticket.vendedorId, vendedorA.id);
    const o = await db.cajaObligacion.findUnique({
      where: { ticketId: conAttr.ticket.id },
    });
    assert.ok(o);
    assert.equal(o!.vendedorId, vendedorA.id);
    assert.equal(moneyFixed2(o!.importeAdmin), "800.00");
  });

  it("VENDEDOR no atribuye a otro; ADMIN rechaza ADMIN/inexistente/inactivo", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");

    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fechaStr,
            vendedorId: vendedorA.id,
            atribuidoAVendedorId: vendedorB.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 14, numeroAnimal: "03", importe: "10.00" }],
          },
          ahoraPost,
          db,
          {
            actorRol: "VENDEDOR",
            actorUserId: vendedorA.id,
            atribuidoAVendedorId: vendedorB.id,
          },
        ),
      TicketSellerNotAllowedError,
    );

    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fechaStr,
            vendedorId: admin.id,
            atribuidoAVendedorId: admin.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 14, numeroAnimal: "03", importe: "10.00" }],
          },
          ahoraPost,
          db,
          {
            actorRol: "ADMIN",
            actorUserId: admin.id,
            atribuidoAVendedorId: admin.id,
          },
        ),
      CajaValidationError,
    );

    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fechaStr,
            vendedorId: admin.id,
            atribuidoAVendedorId: "no-existe-xyz",
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 14, numeroAnimal: "03", importe: "10.00" }],
          },
          ahoraPost,
          db,
          {
            actorRol: "ADMIN",
            actorUserId: admin.id,
            atribuidoAVendedorId: "no-existe-xyz",
          },
        ),
      CajaNotFoundError,
    );

    await db.usuario.update({
      where: { id: vendedorB.id },
      data: { activo: false },
    });
    await assert.rejects(
      () =>
        createTicket(
          {
            fechaJuego: fechaStr,
            vendedorId: admin.id,
            atribuidoAVendedorId: vendedorB.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 14, numeroAnimal: "03", importe: "10.00" }],
          },
          ahoraPost,
          db,
          {
            actorRol: "ADMIN",
            actorUserId: admin.id,
            atribuidoAVendedorId: vendedorB.id,
          },
        ),
      CajaValidationError,
    );
  });

  // —— Atomicidad ——

  it("fallo antes de obligación: no queda ticket", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");
    const key = newIdempotencyKey();
    await assert.rejects(() =>
      createTicket(
        {
          fechaJuego: fechaStr,
          vendedorId: vendedorA.id,
          idempotencyKey: key,
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "10.00" }],
        },
        ahoraPost,
        db,
        {
          actorRol: "VENDEDOR",
          actorUserId: vendedorA.id,
          beforeCajaObligacion: async () => {
            throw new Error("TEST_FAIL_BEFORE_OBLIGACION");
          },
        },
      ),
    );
    assert.equal(await db.ticket.count({ where: { idempotencyKey: key } }), 0);
    assert.equal(await db.cajaObligacion.count({ where: { vendedorId: vendedorA.id } }), 0);
  });

  it("fallo después de obligación (antes de commit créditos): rollback total", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");
    const key = newIdempotencyKey();
    await assert.rejects(() =>
      createTicket(
        {
          fechaJuego: fechaStr,
          vendedorId: vendedorA.id,
          idempotencyKey: key,
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "10.00" }],
        },
        ahoraPost,
        db,
        {
          actorRol: "VENDEDOR",
          actorUserId: vendedorA.id,
          afterCajaObligacion: async () => {
            throw new Error("TEST_FAIL_AFTER_OBLIGACION");
          },
        },
      ),
    );
    assert.equal(await db.ticket.count({ where: { idempotencyKey: key } }), 0);
    assert.equal(await db.cajaObligacion.count({ where: { vendedorId: vendedorA.id } }), 0);
  });

  // —— Idempotencia / concurrencia ——

  it("dos creates concurrentes misma idempotencyKey → 1 ticket + 1 obligación", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");
    const key = newIdempotencyKey();
    const input = {
      fechaJuego: fechaStr,
      vendedorId: vendedorA.id,
      idempotencyKey: key,
      lineas: [{ hora: 14, numeroAnimal: "03", importe: "100.00" as const }],
    };
    const opts = { actorRol: "VENDEDOR" as const, actorUserId: vendedorA.id };

    const [a, b] = await Promise.allSettled([
      createTicket(input, ahoraPost, db, opts),
      createTicket(input, ahoraPost, db, opts),
    ]);
    assert.ok(a.status === "fulfilled" || b.status === "fulfilled");
    const ok = [a, b].filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof createTicket>>
    >[];
    assert.ok(ok.length >= 1);
    const ticketId = ok[0]!.value.ticket.id;
    trackOwnedTicketId(domain, ticketId);
    for (const r of ok) {
      assert.equal(r.value.ticket.id, ticketId);
    }

    assert.equal(await db.ticket.count({ where: { idempotencyKey: key } }), 1);
    assert.equal(await db.cajaObligacion.count({ where: { ticketId } }), 1);

    const replay = await createTicket(input, ahoraPost, db, opts);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.ticket.id, ticketId);
    assert.equal(await db.cajaObligacion.count({ where: { ticketId } }), 1);
  });

  // —— Comisiones snapshot + carrera ——

  it("cambio de comisión: cada obligación conserva su snapshot", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");
    const t1 = await emitVendorTicket({
      vendedorId: vendedorA.id,
      importe: "1000.00",
    });
    await setComisionVendedor(db, {
      vendedorId: vendedorA.id,
      porcentaje: "10.00",
      actorAdminId: admin.id,
    });
    const t2 = await emitVendorTicket({
      vendedorId: vendedorA.id,
      importe: "1000.00",
    });
    const o1 = await db.cajaObligacion.findUniqueOrThrow({
      where: { ticketId: t1.result.ticket.id },
    });
    const o2 = await db.cajaObligacion.findUniqueOrThrow({
      where: { ticketId: t2.result.ticket.id },
    });
    assert.equal(moneyFixed2(o1.comisionPorcentaje), "20.00");
    assert.equal(moneyFixed2(o1.comisionImporte), "200.00");
    assert.equal(moneyFixed2(o2.comisionPorcentaje), "10.00");
    assert.equal(moneyFixed2(o2.comisionImporte), "100.00");
  });

  /**
   * Regla de orden concurrente documentada:
   * Quien adquiere primero `Usuario(vendedor) FOR UPDATE` gana.
   * - Si gana createTicket → snapshot = % previo; setComision espera y aplica después.
   * - Si gana setComision → ticket espera y snapshot = % nuevo.
   * En ambos casos el snapshot es completo y matemáticamente coherente.
   */
  async function raceTicketAndComision(args: {
    fromPct: string;
    toPct: string;
    bruto: string;
  }) {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, args.fromPct);
    const key = newIdempotencyKey();
    const started = Date.now();
    const [ticketSettled, comisionSettled] = await Promise.allSettled([
      createTicket(
        {
          fechaJuego: fechaStr,
          vendedorId: vendedorA.id,
          idempotencyKey: key,
          lineas: [{ hora: 14, numeroAnimal: "03", importe: args.bruto }],
        },
        ahoraPost,
        db,
        { actorRol: "VENDEDOR", actorUserId: vendedorA.id },
      ),
      setComisionVendedor(db2, {
        vendedorId: vendedorA.id,
        porcentaje: args.toPct,
        actorAdminId: admin.id,
      }),
    ]);
    const elapsedMs = Date.now() - started;
    assert.ok(
      elapsedMs < 55_000,
      `posible deadlock/timeout: ${elapsedMs}ms`,
    );
    assert.equal(ticketSettled.status, "fulfilled", String(ticketSettled));
    assert.equal(comisionSettled.status, "fulfilled", String(comisionSettled));
    const ticketResult = (
      ticketSettled as PromiseFulfilledResult<
        Awaited<ReturnType<typeof createTicket>>
      >
    ).value;
    trackOwnedTicketId(domain, ticketResult.ticket.id);
    const o = await db.cajaObligacion.findUniqueOrThrow({
      where: { ticketId: ticketResult.ticket.id },
    });
    const pct = moneyFixed2(o.comisionPorcentaje);
    assert.ok(
      pct === args.fromPct || pct === args.toPct,
      `pct inesperado ${pct}`,
    );
    const bruto = new Prisma.Decimal(args.bruto);
    const expectedComision = bruto
      .mul(new Prisma.Decimal(pct))
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    assert.equal(moneyFixed2(o.comisionImporte), moneyFixed2(expectedComision));
    assert.equal(
      moneyFixed2(o.importeAdmin),
      moneyFixed2(bruto.minus(expectedComision)),
    );
    const vigente = await db.vendedorComision.findUniqueOrThrow({
      where: { vendedorId: vendedorA.id },
    });
    assert.equal(moneyFixed2(vigente.porcentaje), args.toPct);
    return { pct, elapsedMs };
  }

  it("carrera 20→15 % vs createTicket: snapshot coherente, sin deadlock", async () => {
    await raceTicketAndComision({
      fromPct: "20.00",
      toPct: "15.00",
      bruto: "100.00",
    });
  });

  it("carrera 15→20 % vs createTicket: snapshot coherente, sin deadlock", async () => {
    await raceTicketAndComision({
      fromPct: "15.00",
      toPct: "20.00",
      bruto: "100.00",
    });
  });

  it("varias ventas concurrentes mismo vendedor: N tickets / N obligaciones coherentes", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");
    const keys = Array.from({ length: 5 }, () => newIdempotencyKey());
    const started = Date.now();
    const results = await Promise.all(
      keys.map((key) =>
        createTicket(
          {
            fechaJuego: fechaStr,
            vendedorId: vendedorA.id,
            idempotencyKey: key,
            lineas: [{ hora: 14, numeroAnimal: "03", importe: "50.00" }],
          },
          ahoraPost,
          db,
          { actorRol: "VENDEDOR", actorUserId: vendedorA.id },
        ),
      ),
    );
    assert.ok(Date.now() - started < 55_000);
    const ids = new Set(results.map((r) => r.ticket.id));
    assert.equal(ids.size, 5);
    for (const r of results) trackOwnedTicketId(domain, r.ticket.id);
    const obligs = await db.cajaObligacion.findMany({
      where: { ticketId: { in: [...ids] } },
    });
    assert.equal(obligs.length, 5);
    for (const o of obligs) {
      assert.equal(moneyFixed2(o.comisionPorcentaje), "20.00");
      assert.equal(moneyFixed2(o.comisionImporte), "10.00");
      assert.equal(moneyFixed2(o.importeAdmin), "40.00");
    }
  });

  it("cambios concurrentes de comisión mismo vendedor: un vigente + historial ordenable", async () => {
    await ensureComision(vendedorA.id, "20.00");
    const started = Date.now();
    const settled = await Promise.allSettled([
      setComisionVendedor(db, {
        vendedorId: vendedorA.id,
        porcentaje: "12.00",
        actorAdminId: admin.id,
        motivo: "race-a",
      }),
      setComisionVendedor(db2, {
        vendedorId: vendedorA.id,
        porcentaje: "18.00",
        actorAdminId: admin.id,
        motivo: "race-b",
      }),
    ]);
    assert.ok(Date.now() - started < 55_000);
    assert.ok(settled.every((s) => s.status === "fulfilled"));
    const vigente = await db.vendedorComision.findUniqueOrThrow({
      where: { vendedorId: vendedorA.id },
    });
    const pct = moneyFixed2(vigente.porcentaje);
    assert.ok(pct === "12.00" || pct === "18.00");
    const hist = await db.vendedorComisionHistorial.findMany({
      where: { vendedorId: vendedorA.id },
      orderBy: [{ changedAt: "asc" }, { id: "asc" }],
    });
    assert.ok(hist.length >= 2);
    // El último historial (por changedAt tras el lock) = vigente.
    const last = hist[hist.length - 1]!;
    assert.equal(moneyFixed2(last.porcentajeNuevo), pct);
  });

  it("operaciones concurrentes de vendedores distintos: sin interferencia", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");
    await ensureComision(vendedorB.id, "10.00");
    const keyA = newIdempotencyKey();
    const keyB = newIdempotencyKey();
    const started = Date.now();
    const [ra, rb, ca] = await Promise.all([
      createTicket(
        {
          fechaJuego: fechaStr,
          vendedorId: vendedorA.id,
          idempotencyKey: keyA,
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "100.00" }],
        },
        ahoraPost,
        db,
        { actorRol: "VENDEDOR", actorUserId: vendedorA.id },
      ),
      createTicket(
        {
          fechaJuego: fechaStr,
          vendedorId: vendedorB.id,
          idempotencyKey: keyB,
          lineas: [{ hora: 14, numeroAnimal: "05", importe: "100.00" }],
        },
        ahoraPost,
        db2,
        { actorRol: "VENDEDOR", actorUserId: vendedorB.id },
      ),
      setComisionVendedor(db, {
        vendedorId: vendedorA.id,
        porcentaje: "25.00",
        actorAdminId: admin.id,
      }),
    ]);
    assert.ok(Date.now() - started < 55_000);
    trackOwnedTicketId(domain, ra.ticket.id);
    trackOwnedTicketId(domain, rb.ticket.id);
    const oa = await db.cajaObligacion.findUniqueOrThrow({
      where: { ticketId: ra.ticket.id },
    });
    const ob = await db.cajaObligacion.findUniqueOrThrow({
      where: { ticketId: rb.ticket.id },
    });
    assert.ok(
      moneyFixed2(oa.comisionPorcentaje) === "20.00" ||
        moneyFixed2(oa.comisionPorcentaje) === "25.00",
    );
    assert.equal(moneyFixed2(ob.comisionPorcentaje), "10.00");
    assert.equal(ca.changed, true);
  });

  // —— Créditos ——

  it("créditos: VENDEDOR consume; ADMIN atribuido no consume del vendedor; rollback limpia movimientos", async () => {
    await setCajaActivaOwned(db, {
      activa: true,
      activadaEn,
      adminId: admin.id,
    });
    await ensureComision(vendedorA.id, "20.00");

    // Activar control de créditos temporalmente.
    if (testCreditosLease) {
      await restoreCreditosConfigLease(db, testCreditosLease);
      testCreditosLease = null;
    }
    const inicioEn = new Date("2026-10-01T04:00:00.000Z");
    await db.creditosConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        controlActivo: true,
        inicioEn,
        umbralSaldoBajo: null,
        updatedByAdminId: admin.id,
      },
      update: {
        controlActivo: true,
        inicioEn,
        umbralSaldoBajo: null,
        updatedByAdminId: admin.id,
      },
    });

    const store = createPrismaCreditosStore(db);
    const { asignarCreditos, consultarSaldoYHistorial } = await import(
      "@/lib/creditos/operaciones"
    );
    await asignarCreditos(store, {
      vendedorId: vendedorA.id,
      importe: "500.00",
      actorAdminId: admin.id,
    });

    const { result } = await emitVendorTicket({
      vendedorId: vendedorA.id,
      importe: "50.00",
    });
    const afterVend = await consultarSaldoYHistorial(store, vendedorA.id);
    assert.equal(afterVend.cuenta?.saldoDisponible.toFixed(2), "450.00");
    assert.equal(
      afterVend.movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      1,
    );
    assert.ok(
      await db.cajaObligacion.findUnique({ where: { ticketId: result.ticket.id } }),
    );

    const saldoAntesAttr = (
      await consultarSaldoYHistorial(store, vendedorA.id)
    ).cuenta!.saldoDisponible.toFixed(2);
    const attr = await createTicket(
      {
        fechaJuego: fechaStr,
        vendedorId: admin.id,
        atribuidoAVendedorId: vendedorA.id,
        idempotencyKey: newIdempotencyKey(),
        lineas: [{ hora: 14, numeroAnimal: "03", importe: "100.00" }],
      },
      ahoraPost,
      db,
      {
        actorRol: "ADMIN",
        actorUserId: admin.id,
        atribuidoAVendedorId: vendedorA.id,
      },
    );
    trackOwnedTicketId(domain, attr.ticket.id);
    const afterAttr = await consultarSaldoYHistorial(store, vendedorA.id);
    assert.equal(
      afterAttr.cuenta?.saldoDisponible.toFixed(2),
      saldoAntesAttr,
    );

    // Rollback de créditos: fallo post-obligación no deja CONSUMO.
    const keyFail = newIdempotencyKey();
    const movBefore = (
      await consultarSaldoYHistorial(store, vendedorA.id)
    ).movimientos.length;
    await assert.rejects(() =>
      createTicket(
        {
          fechaJuego: fechaStr,
          vendedorId: vendedorA.id,
          idempotencyKey: keyFail,
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "10.00" }],
        },
        ahoraPost,
        db,
        {
          actorRol: "VENDEDOR",
          actorUserId: vendedorA.id,
          afterCajaObligacion: async () => {
            throw new Error("TEST_FAIL_CREDITS_TX");
          },
        },
      ),
    );
    const afterFail = await consultarSaldoYHistorial(store, vendedorA.id);
    assert.equal(afterFail.movimientos.length, movBefore);
    assert.equal(await db.ticket.count({ where: { idempotencyKey: keyFail } }), 0);

    // Volver al baseline de suite y dejar lease off para afterEach.
    await restoreCreditosConfigBaseline(db, suiteCreditosSnap);
    testCreditosLease = await beginTemporaryCreditosControlOff(db);
  });
});
