/**
 * Integración REAL C5 (FIFO aplicaciones) contra PostgreSQL TEST.
 * Solo vía `npm run test:integration` (RUN_INTEGRATION=1).
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { crearConfirmacionAdmin } from "@/lib/caja/confirmacion";
import { crearDeclaracionVendedor } from "@/lib/caja/declaracion";
import {
  CajaIdempotencyConflictError,
  CajaValidationError,
} from "@/lib/caja/errors";
import { moneyFixed2 } from "@/lib/caja/money";
import { getTotalesVendedor } from "@/lib/caja/resumen";
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

describe("integración PostgreSQL — Caja C5 FIFO", { skip: !ENABLED }, () => {
  let db: ReturnType<typeof createIntegrationPrismaClient>;
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

  before(async () => {
    assertIntegrationPointsAtTestDatabase();
    const ep = extractNeonEndpointId(process.env.DATABASE_URL ?? "");
    assert.equal(ep.ok && ep.endpointId, NEON_ENDPOINTS.TEST);
    db = createIntegrationPrismaClient();
    db2 = createIntegrationPrismaClient();
    runTag = `c5_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await seedMinimalBusiness(db);
    suiteCreditosSnap = await readCreditosConfigSnapshot(db);
    suiteCajaSnap = await readCajaSnap(db);
  });

  beforeEach(async () => {
    assertIntegrationPointsAtTestDatabase();
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
      nombre: "C5 Vend A",
      rol: "VENDEDOR",
    });
    vendedorB = await createOwnedTestUser(db, domain, {
      usuario: `${tag}_vb`.slice(0, 40),
      nombre: "C5 Vend B",
      rol: "VENDEDOR",
    });
    admin = await createOwnedTestUser(db, domain, {
      usuario: `${tag}_ad`.slice(0, 40),
      nombre: "C5 Admin",
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

  function randomHex(n: number): string {
    return Math.random().toString(16).slice(2, 2 + n);
  }

  let obligSeq = 0;

  async function seedObligacion(args: {
    vendedorId: string;
    importeAdmin: string;
    ticketCreatedAt: Date;
    ticketIdSuffix?: string;
  }): Promise<{ obligacionId: string; ticketId: string }> {
    obligSeq += 1;
    const uniq = `${caseSeq}_${obligSeq}_${randomHex(8)}_${args.ticketIdSuffix ?? "x"}`;
    // Unicidad en el prefijo (numeroVisible máx ~24): no depender del final del tag.
    const numeroVisible = `C5${uniq}`.slice(0, 24);
    const codigoPublico = `P${uniq}`.slice(0, 16);
    const ticket = await db.ticket.create({
      data: {
        numeroVisible,
        codigoPublico,
        fechaJuego: AHORA_VE_MANANA,
        vendedorId: args.vendedorId,
        totalApostado: new Prisma.Decimal(args.importeAdmin),
        estado: "EMITIDO",
        multiplicadorUsado: 30,
        createdAt: args.ticketCreatedAt,
      },
    });
    trackOwnedTicketId(domain, ticket.id);
    const oid = `cob_c5_${uniq}`.slice(0, 40);
    await db.cajaObligacion.create({
      data: {
        id: oid,
        ticketId: ticket.id,
        vendedorId: args.vendedorId,
        bruto: new Prisma.Decimal(args.importeAdmin),
        comisionPorcentaje: new Prisma.Decimal("0.00"),
        comisionImporte: new Prisma.Decimal("0.00"),
        importeAdmin: new Prisma.Decimal(args.importeAdmin),
      },
    });
    return { obligacionId: oid, ticketId: ticket.id };
  }

  it("FIFO: createdAt ASC y ticketId ASC; parcial entre obligaciones", async () => {
    const tEarly = new Date("2026-01-01T10:00:00.000Z");
    const tLate = new Date("2026-01-02T10:00:00.000Z");
    const o1 = await seedObligacion({
      vendedorId: vendedorA.id,
      importeAdmin: "100.00",
      ticketCreatedAt: tEarly,
      ticketIdSuffix: "1",
    });
    const o2 = await seedObligacion({
      vendedorId: vendedorA.id,
      importeAdmin: "80.00",
      ticketCreatedAt: tLate,
      ticketIdSuffix: "2",
    });

    await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "150.00",
      idempotencyKey: newIdempotencyKey(),
    });
    const decl = await db.cajaDeclaracion.findFirstOrThrow({
      where: { vendedorId: vendedorA.id },
    });

    const r = await crearConfirmacionAdmin(db, {
      actorAdminId: admin.id,
      actorRol: "ADMIN",
      declaracionId: decl.id,
      importe: "150.00",
      idempotencyKey: newIdempotencyKey(),
    });

    assert.equal(r.aplicaciones.length, 2);
    assert.equal(r.aplicaciones[0]!.obligacionId, o1.obligacionId);
    assert.equal(moneyFixed2(r.aplicaciones[0]!.importeAplicado), "100.00");
    assert.equal(r.aplicaciones[1]!.obligacionId, o2.obligacionId);
    assert.equal(moneyFixed2(r.aplicaciones[1]!.importeAplicado), "50.00");

    const tot = await getTotalesVendedor(db, vendedorA.id);
    assert.equal(moneyFixed2(tot.totalAplicado), "150.00");
    assert.equal(moneyFixed2(tot.pendienteAplicar), "0.00");
  });

  it("desempate ticketId ASC a igual createdAt; varias confirmaciones", async () => {
    const ts = new Date("2026-04-01T12:00:00.000Z");
    // Crear en orden inverso al id para forzar desempate por ticket.id
    const first = await seedObligacion({
      vendedorId: vendedorA.id,
      importeAdmin: "30.00",
      ticketCreatedAt: ts,
      ticketIdSuffix: "z",
    });
    const second = await seedObligacion({
      vendedorId: vendedorA.id,
      importeAdmin: "30.00",
      ticketCreatedAt: ts,
      ticketIdSuffix: "a",
    });
    // Orden esperado: menor ticket.id primero
    const ordered =
      first.ticketId < second.ticketId
        ? [first, second]
        : [second, first];

    await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "60.00",
      idempotencyKey: newIdempotencyKey(),
    });
    const decl = await db.cajaDeclaracion.findFirstOrThrow({
      where: { vendedorId: vendedorA.id },
    });

    const c1 = await crearConfirmacionAdmin(db, {
      actorAdminId: admin.id,
      actorRol: "ADMIN",
      declaracionId: decl.id,
      importe: "40.00",
      idempotencyKey: newIdempotencyKey(),
    });
    assert.equal(c1.aplicaciones[0]!.obligacionId, ordered[0]!.obligacionId);
    assert.equal(moneyFixed2(c1.aplicaciones[0]!.importeAplicado), "30.00");
    assert.equal(c1.aplicaciones[1]!.obligacionId, ordered[1]!.obligacionId);
    assert.equal(moneyFixed2(c1.aplicaciones[1]!.importeAplicado), "10.00");

    const c2 = await crearConfirmacionAdmin(db, {
      actorAdminId: admin.id,
      actorRol: "ADMIN",
      declaracionId: decl.id,
      importe: "20.00",
      idempotencyKey: newIdempotencyKey(),
    });
    assert.equal(c2.aplicaciones.length, 1);
    assert.equal(c2.aplicaciones[0]!.obligacionId, ordered[1]!.obligacionId);
    assert.equal(moneyFixed2(c2.aplicaciones[0]!.importeAplicado), "20.00");
  });

  it("idempotencia: replay no duplica apps; clave distinta conflicto", async () => {
    await seedObligacion({
      vendedorId: vendedorA.id,
      importeAdmin: "50.00",
      ticketCreatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "50.00",
      idempotencyKey: newIdempotencyKey(),
    });
    const decl = await db.cajaDeclaracion.findFirstOrThrow({
      where: { vendedorId: vendedorA.id },
    });
    const key = newIdempotencyKey();
    const a = await crearConfirmacionAdmin(db, {
      actorAdminId: admin.id,
      actorRol: "ADMIN",
      declaracionId: decl.id,
      importe: "50.00",
      idempotencyKey: key,
    });
    const b = await crearConfirmacionAdmin(db, {
      actorAdminId: admin.id,
      actorRol: "ADMIN",
      declaracionId: decl.id,
      importe: "50.00",
      idempotencyKey: key,
    });
    assert.equal(b.idempotentReplay, true);
    assert.equal(b.aplicaciones.length, a.aplicaciones.length);
    assert.equal(
      await db.cajaAplicacion.count({
        where: { confirmacionId: a.confirmacion.id },
      }),
      1,
    );
    await assert.rejects(
      () =>
        crearConfirmacionAdmin(db, {
          actorAdminId: admin.id,
          actorRol: "ADMIN",
          declaracionId: decl.id,
          importe: "49.00",
          idempotencyKey: key,
        }),
      CajaIdempotencyConflictError,
    );
  });

  it("concurrencia: dos confirmaciones no sobreaplican obligaciones", async () => {
    await seedObligacion({
      vendedorId: vendedorA.id,
      importeAdmin: "100.00",
      ticketCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "100.00",
      idempotencyKey: newIdempotencyKey(),
    });
    const decl = await db.cajaDeclaracion.findFirstOrThrow({
      where: { vendedorId: vendedorA.id },
    });

    const results = await Promise.allSettled([
      crearConfirmacionAdmin(db, {
        actorAdminId: admin.id,
        actorRol: "ADMIN",
        declaracionId: decl.id,
        importe: "70.00",
        idempotencyKey: newIdempotencyKey(),
      }),
      crearConfirmacionAdmin(db2, {
        actorAdminId: admin.id,
        actorRol: "ADMIN",
        declaracionId: decl.id,
        importe: "70.00",
        idempotencyKey: newIdempotencyKey(),
      }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(bad.length, 1);
    assert.ok(
      bad[0]!.status === "rejected" &&
        bad[0].reason instanceof CajaValidationError &&
        (bad[0].reason.code === "CAJA_SOBRECONFIRMACION" ||
          bad[0].reason.code === "CAJA_FIFO_INSUFICIENTE"),
    );

    const tot = await getTotalesVendedor(db, vendedorA.id);
    assert.ok(tot.totalAplicado.lte(tot.totalObligado));
    assert.ok(tot.totalAplicado.eq(tot.totalConfirmado));
    assert.equal(moneyFixed2(tot.totalAplicado), "70.00");
  });

  it("vendedores distintos no se bloquean; PG rechaza cruce y importe <= 0", async () => {
    await seedObligacion({
      vendedorId: vendedorA.id,
      importeAdmin: "40.00",
      ticketCreatedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    await seedObligacion({
      vendedorId: vendedorB.id,
      importeAdmin: "40.00",
      ticketCreatedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "40.00",
      idempotencyKey: newIdempotencyKey(),
    });
    await crearDeclaracionVendedor(db, {
      actorUserId: vendedorB.id,
      actorRol: "VENDEDOR",
      importe: "40.00",
      idempotencyKey: newIdempotencyKey(),
    });
    const declA = await db.cajaDeclaracion.findFirstOrThrow({
      where: { vendedorId: vendedorA.id },
    });
    const declB = await db.cajaDeclaracion.findFirstOrThrow({
      where: { vendedorId: vendedorB.id },
    });

    const [ra, rb] = await Promise.all([
      crearConfirmacionAdmin(db, {
        actorAdminId: admin.id,
        actorRol: "ADMIN",
        declaracionId: declA.id,
        importe: "40.00",
        idempotencyKey: newIdempotencyKey(),
      }),
      crearConfirmacionAdmin(db2, {
        actorAdminId: admin.id,
        actorRol: "ADMIN",
        declaracionId: declB.id,
        importe: "40.00",
        idempotencyKey: newIdempotencyKey(),
      }),
    ]);
    assert.equal(ra.aplicaciones.length, 1);
    assert.equal(rb.aplicaciones.length, 1);
    assert.equal(ra.aplicaciones[0]!.vendedorId, vendedorA.id);
    assert.equal(rb.aplicaciones[0]!.vendedorId, vendedorB.id);

    const oblB = await db.cajaObligacion.findFirstOrThrow({
      where: { vendedorId: vendedorB.id },
    });
    await assert.rejects(
      () =>
        db.cajaAplicacion.create({
          data: {
            id: `cja_cross_${runTag}`,
            confirmacionId: ra.confirmacion.id,
            obligacionId: oblB.id,
            vendedorId: vendedorA.id,
            importeAplicado: new Prisma.Decimal("1.00"),
          },
        }),
      /vendedor|check|23514|CajaAplicacion/i,
    );

    // Confirmación cruda sin apps (histórico C4) para probar CHECK importe > 0.
    const rawConfId = `cjc_raw_${runTag}`.slice(0, 40);
    await db.cajaConfirmacion.create({
      data: {
        id: rawConfId,
        declaracionId: declA.id,
        importeConfirmado: new Prisma.Decimal("1.00"),
        confirmadoPorAdminId: admin.id,
        idempotencyKey: newIdempotencyKey(),
        idempotencyRequestHash: "raw-c5-check",
      },
    });
    const oblA = await db.cajaObligacion.findFirstOrThrow({
      where: { vendedorId: vendedorA.id },
    });
    await assert.rejects(
      () =>
        db.$executeRaw`
          INSERT INTO "CajaAplicacion"
            ("id","confirmacionId","obligacionId","vendedorId","importeAplicado","createdAt")
          VALUES
            (${`cja_neg_${runTag}`}, ${rawConfId}, ${oblA.id},
             ${vendedorA.id}, ${new Prisma.Decimal("0")}, ${new Date()})
        `,
      /check|violat/i,
    );
  });

  it("caja inactiva al final; sin backfill histórico implícito", async () => {
    await setCajaActivaOwned(db, {
      activa: false,
      activadaEn: null,
      adminId: null,
    });
    const cfg = await db.cajaConfig.findUnique({ where: { id: 1 } });
    assert.equal(cfg?.activa ?? false, false);
  });
});
