/**
 * Integración REAL C4 (declaraciones/confirmaciones) contra PostgreSQL TEST.
 * Solo vía `npm run test:integration` (RUN_INTEGRATION=1).
 * No activa Caja de forma permanente. No toca producción.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { crearConfirmacionAdmin } from "@/lib/caja/confirmacion";
import { crearDeclaracionVendedor } from "@/lib/caja/declaracion";
import {
  CajaForbiddenError,
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

describe("integración PostgreSQL — Caja C4", { skip: !ENABLED }, () => {
  let db: ReturnType<typeof createIntegrationPrismaClient>;
  let db2: ReturnType<typeof createIntegrationPrismaClient>;
  let domain: OwnedTicketDomain;
  let runTag: string;
  let vendedorA: { id: string };
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
    runTag = `c4_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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
      nombre: "C4 Vend A",
      rol: "VENDEDOR",
    });
    admin = await createOwnedTestUser(db, domain, {
      usuario: `${tag}_ad`.slice(0, 40),
      nombre: "C4 Admin",
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

  /** Obliga sin activar Caja: ticket + obligación con comisión 0 % (bruto = admin). */
  async function seedObligacionAdmin(
    vendedorId: string,
    importeAdmin: string,
  ): Promise<string> {
    const tag = `${runTag}_${caseSeq}_${randomHex(6)}`;
    const ticket = await db.ticket.create({
      data: {
        numeroVisible: `LJ-C4-${tag}`.slice(0, 24),
        codigoPublico: `C4${tag}`.slice(0, 16),
        fechaJuego: AHORA_VE_MANANA,
        vendedorId,
        totalApostado: new Prisma.Decimal(importeAdmin),
        estado: "EMITIDO",
        multiplicadorUsado: 30,
      },
    });
    trackOwnedTicketId(domain, ticket.id);
    const oid = `cob_c4_${tag}`.slice(0, 40);
    await db.cajaObligacion.create({
      data: {
        id: oid,
        ticketId: ticket.id,
        vendedorId,
        bruto: new Prisma.Decimal(importeAdmin),
        comisionPorcentaje: new Prisma.Decimal("0.00"),
        comisionImporte: new Prisma.Decimal("0.00"),
        importeAdmin: new Prisma.Decimal(importeAdmin),
      },
    });
    return oid;
  }

  function randomHex(n: number): string {
    return Math.random().toString(16).slice(2, 2 + n);
  }

  it("declaración + confirmación parcial + totales Decimal", async () => {
    await seedObligacionAdmin(vendedorA.id, "1000.00");
    const d1 = await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "300.00",
      idempotencyKey: newIdempotencyKey(),
    });
    assert.equal(d1.declaracion.estado, "PENDIENTE");

    await crearConfirmacionAdmin(db, {
      actorAdminId: admin.id,
      actorRol: "ADMIN",
      declaracionId: d1.declaracion.id,
      importe: "200.00",
      idempotencyKey: newIdempotencyKey(),
    });

    const tot = await getTotalesVendedor(db, vendedorA.id);
    assert.equal(moneyFixed2(tot.totalObligado), "1000.00");
    assert.equal(moneyFixed2(tot.totalDeclarado), "300.00");
    assert.equal(moneyFixed2(tot.totalConfirmado), "200.00");
    assert.equal(moneyFixed2(tot.pendienteDeclarar), "700.00");
    assert.equal(moneyFixed2(tot.pendienteConfirmar), "100.00");
    assert.equal(moneyFixed2(tot.deudaPendienteEntregar), "800.00");

    const d2 = await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "500.00",
      idempotencyKey: newIdempotencyKey(),
    });
    assert.equal(moneyFixed2(d2.declaracion.importeDeclarado), "500.00");

    await assert.rejects(
      () =>
        crearDeclaracionVendedor(db, {
          actorUserId: vendedorA.id,
          actorRol: "VENDEDOR",
          importe: "201.00",
          idempotencyKey: newIdempotencyKey(),
        }),
      (e: unknown) =>
        e instanceof CajaValidationError && e.code === "CAJA_SOBREDECLARACION",
    );

    const obligCount = await db.cajaObligacion.count({
      where: { vendedorId: vendedorA.id },
    });
    assert.equal(obligCount, 1);
  });

  it("ADMIN no declara; VENDEDOR no confirma; confirmación identifica admin", async () => {
    await seedObligacionAdmin(vendedorA.id, "100.00");
    await assert.rejects(
      () =>
        crearDeclaracionVendedor(db, {
          actorUserId: admin.id,
          actorRol: "ADMIN",
          importe: "10.00",
          idempotencyKey: newIdempotencyKey(),
        }),
      CajaForbiddenError,
    );
    const d = await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "50.00",
      idempotencyKey: newIdempotencyKey(),
    });
    await assert.rejects(
      () =>
        crearConfirmacionAdmin(db, {
          actorAdminId: vendedorA.id,
          actorRol: "VENDEDOR",
          declaracionId: d.declaracion.id,
          importe: "10.00",
          idempotencyKey: newIdempotencyKey(),
        }),
      CajaForbiddenError,
    );
    const c = await crearConfirmacionAdmin(db, {
      actorAdminId: admin.id,
      actorRol: "ADMIN",
      declaracionId: d.declaracion.id,
      importe: "50.00",
      idempotencyKey: newIdempotencyKey(),
    });
    assert.equal(c.confirmacion.confirmadoPorAdminId, admin.id);
  });

  it("idempotencia declaración y confirmación (replay + conflicto + carrera)", async () => {
    await seedObligacionAdmin(vendedorA.id, "200.00");
    const keyD = newIdempotencyKey();
    const a = await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "80.00",
      idempotencyKey: keyD,
    });
    const b = await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "80.00",
      idempotencyKey: keyD,
    });
    assert.equal(b.idempotentReplay, true);
    assert.equal(a.declaracion.id, b.declaracion.id);
    await assert.rejects(
      () =>
        crearDeclaracionVendedor(db, {
          actorUserId: vendedorA.id,
          actorRol: "VENDEDOR",
          importe: "81.00",
          idempotencyKey: keyD,
        }),
      CajaIdempotencyConflictError,
    );

    const keyRace = newIdempotencyKey();
    const raceResults = await Promise.allSettled([
      crearDeclaracionVendedor(db, {
        actorUserId: vendedorA.id,
        actorRol: "VENDEDOR",
        importe: "20.00",
        idempotencyKey: keyRace,
      }),
      crearDeclaracionVendedor(db2, {
        actorUserId: vendedorA.id,
        actorRol: "VENDEDOR",
        importe: "20.00",
        idempotencyKey: keyRace,
      }),
    ]);
    const ok = raceResults.filter((r) => r.status === "fulfilled");
    assert.equal(ok.length, 2);
    const ids = new Set(
      ok.map(
        (r) =>
          (r as PromiseFulfilledResult<{ declaracion: { id: string } }>)
            .value.declaracion.id,
      ),
    );
    assert.equal(ids.size, 1);

    const keyC = newIdempotencyKey();
    const c1 = await crearConfirmacionAdmin(db, {
      actorAdminId: admin.id,
      actorRol: "ADMIN",
      declaracionId: a.declaracion.id,
      importe: "30.00",
      idempotencyKey: keyC,
    });
    const c2 = await crearConfirmacionAdmin(db, {
      actorAdminId: admin.id,
      actorRol: "ADMIN",
      declaracionId: a.declaracion.id,
      importe: "30.00",
      idempotencyKey: keyC,
    });
    assert.equal(c2.idempotentReplay, true);
    assert.equal(c1.confirmacion.id, c2.confirmacion.id);

    const keyCRace = newIdempotencyKey();
    const confRace = await Promise.allSettled([
      crearConfirmacionAdmin(db, {
        actorAdminId: admin.id,
        actorRol: "ADMIN",
        declaracionId: a.declaracion.id,
        importe: "10.00",
        idempotencyKey: keyCRace,
      }),
      crearConfirmacionAdmin(db2, {
        actorAdminId: admin.id,
        actorRol: "ADMIN",
        declaracionId: a.declaracion.id,
        importe: "10.00",
        idempotencyKey: keyCRace,
      }),
    ]);
    const confOk = confRace.filter((r) => r.status === "fulfilled");
    assert.equal(confOk.length, 2);
    const confIds = new Set(
      confOk.map(
        (r) =>
          (
            r as PromiseFulfilledResult<{ confirmacion: { id: string } }>
          ).value.confirmacion.id,
      ),
    );
    assert.equal(confIds.size, 1);
  });

  it("concurrencia: dos declaraciones no sobredeclaran", async () => {
    await seedObligacionAdmin(vendedorA.id, "100.00");
    const results = await Promise.allSettled([
      crearDeclaracionVendedor(db, {
        actorUserId: vendedorA.id,
        actorRol: "VENDEDOR",
        importe: "80.00",
        idempotencyKey: newIdempotencyKey(),
      }),
      crearDeclaracionVendedor(db2, {
        actorUserId: vendedorA.id,
        actorRol: "VENDEDOR",
        importe: "80.00",
        idempotencyKey: newIdempotencyKey(),
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]!.status === "rejected" &&
        rejected[0].reason instanceof CajaValidationError &&
        rejected[0].reason.code === "CAJA_SOBREDECLARACION",
    );
    const tot = await getTotalesVendedor(db, vendedorA.id);
    assert.ok(tot.totalDeclarado.lte(tot.totalObligado));
    assert.equal(moneyFixed2(tot.totalDeclarado), "80.00");
  });

  it("concurrencia: dos confirmaciones no sobreconfirman", async () => {
    await seedObligacionAdmin(vendedorA.id, "100.00");
    const d = await crearDeclaracionVendedor(db, {
      actorUserId: vendedorA.id,
      actorRol: "VENDEDOR",
      importe: "50.00",
      idempotencyKey: newIdempotencyKey(),
    });
    const results = await Promise.allSettled([
      crearConfirmacionAdmin(db, {
        actorAdminId: admin.id,
        actorRol: "ADMIN",
        declaracionId: d.declaracion.id,
        importe: "40.00",
        idempotencyKey: newIdempotencyKey(),
      }),
      crearConfirmacionAdmin(db2, {
        actorAdminId: admin.id,
        actorRol: "ADMIN",
        declaracionId: d.declaracion.id,
        importe: "40.00",
        idempotencyKey: newIdempotencyKey(),
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]!.status === "rejected" &&
        rejected[0].reason instanceof CajaValidationError &&
        rejected[0].reason.code === "CAJA_SOBRECONFIRMACION",
    );
    const tot = await getTotalesVendedor(db, vendedorA.id);
    assert.equal(moneyFixed2(tot.totalConfirmado), "40.00");
    assert.ok(tot.totalConfirmado.lte(tot.totalDeclarado));
  });

  it("caja vuelve inactiva tras suite (fixture local)", async () => {
    await setCajaActivaOwned(db, {
      activa: false,
      activadaEn: null,
      adminId: null,
    });
    const cfg = await db.cajaConfig.findUnique({ where: { id: 1 } });
    assert.equal(cfg?.activa ?? false, false);
  });
});
