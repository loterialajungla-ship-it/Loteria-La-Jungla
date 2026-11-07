/**
 * C5.1 — Concurrencia de triggers CajaAplicacion (FOR UPDATE en padres).
 * Dos PrismaClient / transacciones independientes. Solo TEST allowlisted.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { crearConfirmacionAdmin } from "@/lib/caja/confirmacion";
import { crearDeclaracionVendedor } from "@/lib/caja/declaracion";
import { CajaValidationError } from "@/lib/caja/errors";
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

describe(
  "integración PostgreSQL — C5.1 triggers cupos FOR UPDATE",
  { skip: !ENABLED },
  () => {
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
    let obligSeq = 0;

    before(async () => {
      assertIntegrationPointsAtTestDatabase();
      const ep = extractNeonEndpointId(process.env.DATABASE_URL ?? "");
      assert.equal(ep.ok && ep.endpointId, NEON_ENDPOINTS.TEST);
      db = createIntegrationPrismaClient();
      db2 = createIntegrationPrismaClient();
      runTag = `c51_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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
        nombre: "C51 Vend A",
        rol: "VENDEDOR",
      });
      vendedorB = await createOwnedTestUser(db, domain, {
        usuario: `${tag}_vb`.slice(0, 40),
        nombre: "C51 Vend B",
        rol: "VENDEDOR",
      });
      admin = await createOwnedTestUser(db, domain, {
        usuario: `${tag}_ad`.slice(0, 40),
        nombre: "C51 Admin",
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

    async function seedObligacion(args: {
      vendedorId: string;
      importeAdmin: string;
      ticketCreatedAt?: Date;
    }): Promise<{ obligacionId: string; ticketId: string }> {
      obligSeq += 1;
      const uniq = `${caseSeq}_${obligSeq}_${randomHex(8)}`;
      const ticket = await db.ticket.create({
        data: {
          numeroVisible: `C51${uniq}`.slice(0, 24),
          codigoPublico: `Q${uniq}`.slice(0, 16),
          fechaJuego: AHORA_VE_MANANA,
          vendedorId: args.vendedorId,
          totalApostado: new Prisma.Decimal(args.importeAdmin),
          estado: "EMITIDO",
          multiplicadorUsado: 30,
          createdAt: args.ticketCreatedAt ?? new Date(),
        },
      });
      trackOwnedTicketId(domain, ticket.id);
      const oid = `cob_c51_${uniq}`.slice(0, 40);
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

    async function seedDeclaracionRaw(args: {
      vendedorId: string;
      importe: string;
    }): Promise<string> {
      const id = `cjd_c51_${caseSeq}_${randomHex(8)}`.slice(0, 40);
      await db.cajaDeclaracion.create({
        data: {
          id,
          vendedorId: args.vendedorId,
          importeDeclarado: new Prisma.Decimal(args.importe),
          idempotencyKey: newIdempotencyKey(),
          idempotencyRequestHash: "c51-raw",
        },
      });
      return id;
    }

    async function seedConfirmacionRaw(args: {
      declaracionId: string;
      importe: string;
    }): Promise<string> {
      const id = `cjc_c51_${caseSeq}_${randomHex(8)}`.slice(0, 40);
      await db.cajaConfirmacion.create({
        data: {
          id,
          declaracionId: args.declaracionId,
          importeConfirmado: new Prisma.Decimal(args.importe),
          confirmadoPorAdminId: admin.id,
          idempotencyKey: newIdempotencyKey(),
          idempotencyRequestHash: "c51-raw-conf",
        },
      });
      return id;
    }

    async function insertAplicacionRaw(
      client: ReturnType<typeof createIntegrationPrismaClient>,
      args: {
        id: string;
        confirmacionId: string;
        obligacionId: string;
        vendedorId: string;
        importe: string;
      },
    ): Promise<void> {
      await client.$transaction(
        async (tx) => {
          await tx.$executeRaw`
            INSERT INTO "CajaAplicacion"
              ("id","confirmacionId","obligacionId","vendedorId","importeAplicado","createdAt")
            VALUES
              (${args.id}, ${args.confirmacionId}, ${args.obligacionId},
               ${args.vendedorId}, ${new Prisma.Decimal(args.importe)}, ${new Date()})
          `;
        },
        { maxWait: 30_000, timeout: 60_000 },
      );
    }

    it("Caso A: INSERT SQL concurrentes no superan importeConfirmado", async () => {
      const o1 = await seedObligacion({
        vendedorId: vendedorA.id,
        importeAdmin: "200.00",
      });
      const o2 = await seedObligacion({
        vendedorId: vendedorA.id,
        importeAdmin: "200.00",
      });
      const declId = await seedDeclaracionRaw({
        vendedorId: vendedorA.id,
        importe: "100.00",
      });
      const confId = await seedConfirmacionRaw({
        declaracionId: declId,
        importe: "100.00",
      });

      const results = await Promise.allSettled([
        insertAplicacionRaw(db, {
          id: `cja_a1_${runTag}_${caseSeq}`,
          confirmacionId: confId,
          obligacionId: o1.obligacionId,
          vendedorId: vendedorA.id,
          importe: "60.00",
        }),
        insertAplicacionRaw(db2, {
          id: `cja_a2_${runTag}_${caseSeq}`,
          confirmacionId: confId,
          obligacionId: o2.obligacionId,
          vendedorId: vendedorA.id,
          importe: "60.00",
        }),
      ]);

      const ok = results.filter((r) => r.status === "fulfilled");
      const bad = results.filter((r) => r.status === "rejected");
      assert.equal(ok.length, 1, `esperaba 1 OK, got ${ok.length}`);
      assert.equal(bad.length, 1, `esperaba 1 rechazo, got ${bad.length}`);

      const sum = await db.cajaAplicacion.aggregate({
        where: { confirmacionId: confId },
        _sum: { importeAplicado: true },
      });
      const total = new Prisma.Decimal(sum._sum.importeAplicado ?? 0);
      assert.ok(total.lte(new Prisma.Decimal("100.00")));
      assert.equal(moneyFixed2(total), "60.00");
    });

    it("Caso B: INSERT SQL concurrentes no superan importeAdmin", async () => {
      const o = await seedObligacion({
        vendedorId: vendedorA.id,
        importeAdmin: "100.00",
      });
      const declId = await seedDeclaracionRaw({
        vendedorId: vendedorA.id,
        importe: "200.00",
      });
      const conf1 = await seedConfirmacionRaw({
        declaracionId: declId,
        importe: "100.00",
      });
      const conf2 = await seedConfirmacionRaw({
        declaracionId: declId,
        importe: "100.00",
      });

      const results = await Promise.allSettled([
        insertAplicacionRaw(db, {
          id: `cja_b1_${runTag}_${caseSeq}`,
          confirmacionId: conf1,
          obligacionId: o.obligacionId,
          vendedorId: vendedorA.id,
          importe: "70.00",
        }),
        insertAplicacionRaw(db2, {
          id: `cja_b2_${runTag}_${caseSeq}`,
          confirmacionId: conf2,
          obligacionId: o.obligacionId,
          vendedorId: vendedorA.id,
          importe: "70.00",
        }),
      ]);

      const ok = results.filter((r) => r.status === "fulfilled");
      const bad = results.filter((r) => r.status === "rejected");
      assert.equal(ok.length, 1);
      assert.equal(bad.length, 1);

      const sum = await db.cajaAplicacion.aggregate({
        where: { obligacionId: o.obligacionId },
        _sum: { importeAplicado: true },
      });
      const total = new Prisma.Decimal(sum._sum.importeAplicado ?? 0);
      assert.ok(total.lte(new Prisma.Decimal("100.00")));
      assert.equal(moneyFixed2(total), "70.00");
    });

    it("Caso C: UPDATE sobre aplicación es rechazado", async () => {
      const o = await seedObligacion({
        vendedorId: vendedorA.id,
        importeAdmin: "50.00",
      });
      const declId = await seedDeclaracionRaw({
        vendedorId: vendedorA.id,
        importe: "50.00",
      });
      const confId = await seedConfirmacionRaw({
        declaracionId: declId,
        importe: "50.00",
      });
      const appId = `cja_c_${runTag}_${caseSeq}`;
      await insertAplicacionRaw(db, {
        id: appId,
        confirmacionId: confId,
        obligacionId: o.obligacionId,
        vendedorId: vendedorA.id,
        importe: "50.00",
      });

      await assert.rejects(
        () =>
          db.$executeRaw`
            UPDATE "CajaAplicacion"
            SET "importeAplicado" = ${new Prisma.Decimal("1.00")}
            WHERE id = ${appId}
          `,
        /inmutable|23514|CajaAplicacion/i,
      );
    });

    it("Caso D: confirmaciones concurrentes vía servicio (FIFO, sin deadlock)", async () => {
      await seedObligacion({
        vendedorId: vendedorA.id,
        importeAdmin: "100.00",
        ticketCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
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
          bad[0].reason instanceof CajaValidationError,
      );

      const tot = await getTotalesVendedor(db, vendedorA.id);
      assert.equal(moneyFixed2(tot.totalAplicado), "70.00");
      assert.ok(tot.totalAplicado.eq(tot.totalConfirmado));
      assert.equal(moneyFixed2(tot.pendienteAplicar), "0.00");
    });

    it("Caso E: vendedores distintos sin contención cruzada", async () => {
      await seedObligacion({
        vendedorId: vendedorA.id,
        importeAdmin: "40.00",
      });
      await seedObligacion({
        vendedorId: vendedorB.id,
        importeAdmin: "40.00",
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
    });

    it("Servicio ∥ INSERT raw sobre misma obligación: sin deadlock", async () => {
      const o = await seedObligacion({
        vendedorId: vendedorA.id,
        importeAdmin: "100.00",
        ticketCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
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
      // Confirmación cruda rival (sin apps). Pendiente confirmar queda en 50.
      const rawConf = await seedConfirmacionRaw({
        declaracionId: decl.id,
        importe: "50.00",
      });

      const results = await Promise.allSettled([
        crearConfirmacionAdmin(db, {
          actorAdminId: admin.id,
          actorRol: "ADMIN",
          declaracionId: decl.id,
          importe: "50.00",
          idempotencyKey: newIdempotencyKey(),
        }),
        insertAplicacionRaw(db2, {
          id: `cja_dl_${runTag}_${caseSeq}`,
          confirmacionId: rawConf,
          obligacionId: o.obligacionId,
          vendedorId: vendedorA.id,
          importe: "50.00",
        }),
      ]);

      // Misma obligación, confirmaciones distintas, orden C→O en ambos caminos.
      for (const r of results) {
        if (r.status === "rejected") {
          const msg = String(
            (r.reason as Error)?.message ?? r.reason ?? "",
          );
          assert.doesNotMatch(msg, /deadlock detected|P2034/i);
        }
      }
      assert.equal(
        results.filter((r) => r.status === "fulfilled").length,
        2,
        "ambos deben completar sin deadlock (50+50=100)",
      );
      const sum = await db.cajaAplicacion.aggregate({
        where: { obligacionId: o.obligacionId },
        _sum: { importeAplicado: true },
      });
      assert.equal(
        moneyFixed2(new Prisma.Decimal(sum._sum.importeAplicado ?? 0)),
        "100.00",
      );
    });
  },
);
