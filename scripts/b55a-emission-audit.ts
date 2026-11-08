/**
 * B5.5-A — Auditoría/pruebas de emisión de tickets (solo TEST).
 *
 * - No migra.
 * - No modifica .env.
 * - No usa DATABASE_URL/DIRECT_URL locales si son producción.
 * - Fixtures etiquetados `b55a_*`; cleanup owned al final.
 * - No imprime URLs ni secretos.
 *
 * Uso: npx tsx scripts/b55a-emission-audit.ts
 */
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Prisma } from "@prisma/client";
import { createTicket } from "../lib/tickets/create-ticket";
import { InsufficientCreditoSaldoError } from "../lib/creditos/errors";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
} from "../lib/creditos/operaciones";
import { createPrismaCreditosStore } from "../lib/creditos/prisma-store";
import {
  extractNeonEndpointId,
  NEON_ENDPOINTS,
  assertIntegrationWriteTarget,
} from "../lib/db/neon-endpoint-guard";
import { assertSafeTestDatabase } from "../lib/tickets/integration/safe-test-db";
import {
  AHORA_VE_MANANA,
  createIntegrationPrismaClient,
  newIdempotencyKey,
  seedMinimalBusiness,
  type IntegrationPrismaClient,
} from "../lib/tickets/integration/harness";
import {
  cleanupOwnedTicketDomain,
  createOwnedTestUser,
  createOwnedTicketDomain,
  trackFixtureTicketCounter,
  trackOwnedTicketId,
  type OwnedTicketDomain,
} from "../lib/tickets/integration/owned-ticket-domain";
import {
  readCreditosConfigSnapshot,
  restoreCreditosConfigLease,
  type CreditosConfigLease,
  type CreditosConfigSnapshot,
} from "../lib/tickets/integration/creditos-config-test-fixture";
import { hoyYYYYMMDD } from "../lib/fecha";
import type { CreditosStore } from "../lib/creditos/store";

const ROOT = path.resolve(__dirname, "..");
const TAG = `b55a_${Date.now().toString(36)}`;
const AHORA = AHORA_VE_MANANA;
const FECHA = hoyYYYYMMDD(AHORA);
const ACTIVADA_EN = new Date("2026-10-01T04:00:00.000Z");
const CREDITOS_INICIO = new Date("2026-10-01T04:00:00.000Z");

type CaseResult = {
  id: string;
  ok: boolean;
  detail: Record<string, unknown>;
  error?: string;
};

type CajaSnap =
  | { existed: false }
  | {
      existed: true;
      activa: boolean;
      activadaEn: Date | null;
      activadaPorAdminId: string | null;
    };

const cases: CaseResult[] = [];

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function withPoolParams(raw: string, limit: number, timeout: number): string {
  const u = new URL(raw);
  u.searchParams.set("connection_limit", String(limit));
  u.searchParams.set("pool_timeout", String(timeout));
  if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "require");
  return u.toString();
}

function hostOnly(raw: string): string | null {
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function rec(
  id: string,
  ok: boolean,
  detail: Record<string, unknown> = {},
  error?: unknown,
): void {
  cases.push({
    id,
    ok,
    detail,
    error:
      error == null
        ? undefined
        : error instanceof Error
          ? error.message.slice(0, 240)
          : String(error).slice(0, 240),
  });
}

async function readCajaSnap(db: IntegrationPrismaClient): Promise<CajaSnap> {
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
  db: IntegrationPrismaClient,
  snap: CajaSnap,
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

async function setCaja(
  db: IntegrationPrismaClient,
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

async function enableCreditos(
  db: IntegrationPrismaClient,
  adminId: string,
  snapBefore: CreditosConfigSnapshot,
): Promise<CreditosConfigLease> {
  await db.creditosConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      controlActivo: true,
      inicioEn: CREDITOS_INICIO,
      umbralSaldoBajo: null,
      updatedByAdminId: adminId,
    },
    update: {
      controlActivo: true,
      inicioEn: CREDITOS_INICIO,
      updatedByAdminId: adminId,
    },
  });
  return {
    leaseId: `b55a_${Math.random().toString(36).slice(2, 8)}`,
    snap: snapBefore,
    held: {
      controlActivo: true,
      inicioEn: CREDITOS_INICIO,
      umbralSaldoBajo: snapBefore.existed ? snapBefore.umbralSaldoBajo : null,
      updatedByAdminId: adminId,
    },
  };
}

async function integrityCheck(
  db: IntegrationPrismaClient,
  userIds: string[],
  ticketIds: string[],
): Promise<Record<string, unknown>> {
  const tickets = await db.ticket.findMany({
    where: { id: { in: ticketIds } },
    include: { lineas: true, cajaObligacion: true },
  });
  const movimientos = await db.creditoMovimiento.findMany({
    where: {
      OR: [
        { vendedorId: { in: userIds } },
        { ticketId: { in: ticketIds } },
      ],
    },
  });
  const consumos = movimientos.filter((m) => m.tipo === "CONSUMO_VENTA");
  const cuentas = await db.vendedorCreditoCuenta.findMany({
    where: { vendedorId: { in: userIds } },
  });

  let brutoEmitido = new Prisma.Decimal(0);
  let lineasSumOk = 0;
  let lineasSumBad = 0;
  for (const t of tickets) {
    const sum = t.lineas.reduce(
      (a, l) => a.add(l.importe),
      new Prisma.Decimal(0),
    );
    if (sum.eq(t.totalApostado)) lineasSumOk += 1;
    else lineasSumBad += 1;
    brutoEmitido = brutoEmitido.add(t.totalApostado);
  }

  const consumoTotal = consumos.reduce(
    (a, m) => a.add(m.importe),
    new Prisma.Decimal(0),
  );

  const obligaciones = await db.cajaObligacion.findMany({
    where: {
      OR: [
        { ticketId: { in: ticketIds } },
        { vendedorId: { in: userIds } },
      ],
    },
  });
  const obligByTicket = new Map(obligaciones.map((o) => [o.ticketId, o]));
  const dupOblig = obligaciones.length !== new Set(obligaciones.map((o) => o.ticketId)).size;
  const orphanOblig = obligaciones.filter(
    (o) => !ticketIds.includes(o.ticketId),
  ).length;

  const saldosNegativos = cuentas.filter((c) => c.saldoDisponible.lt(0)).length;
  const codes = tickets.map((t) => t.codigoPublico);
  const uniqueCodes = new Set(codes).size === codes.length;

  // Consumos solo de tickets emitidos en esta corrida (vendors).
  const consumosDeTickets = consumos.filter(
    (m) => m.ticketId != null && ticketIds.includes(m.ticketId),
  );
  const brutoConConsumo = tickets
    .filter((t) =>
      consumosDeTickets.some((m) => m.ticketId === t.id),
    )
    .reduce((a, t) => a.add(t.totalApostado), new Prisma.Decimal(0));

  return {
    tickets: tickets.length,
    lineasSumOk,
    lineasSumBad,
    brutoEmitido: brutoEmitido.toFixed(2),
    consumoTicketImporte: consumosDeTickets
      .reduce((a, m) => a.add(m.importe), new Prisma.Decimal(0))
      .toFixed(2),
    brutoConConsumo: brutoConConsumo.toFixed(2),
    consumoMatchesBrutoVendors: consumosDeTickets
      .reduce((a, m) => a.add(m.importe), new Prisma.Decimal(0))
      .eq(brutoConConsumo),
    consumosDuplicadosPorTicket:
      consumosDeTickets.length !==
      new Set(consumosDeTickets.map((m) => m.ticketId)).size,
    obligaciones: obligaciones.length,
    obligacionesDupTicket: dupOblig,
    obligacionesHuerfanasVsOwnedTickets: orphanOblig,
    saldosNegativos,
    codigosUnicos: uniqueCodes,
    ticketsSinLineas: tickets.filter((t) => t.lineas.length === 0).length,
    ticketsConObligacion: tickets.filter((t) => obligByTicket.has(t.id)).length,
    totalConsumoMovs: consumoTotal.toFixed(2),
  };
}

async function main(): Promise<void> {
  loadEnvFile(path.join(ROOT, ".env"));

  const identityBefore = {
    TEST_DATABASE_URL: extractNeonEndpointId(
      process.env.TEST_DATABASE_URL ?? "",
    ),
    DATABASE_URL: extractNeonEndpointId(process.env.DATABASE_URL ?? ""),
    DIRECT_URL: extractNeonEndpointId(process.env.DIRECT_URL ?? ""),
  };

  // Abortar si TEST no se puede demostrar.
  let testUrl: string;
  try {
    testUrl = assertSafeTestDatabase(process.env);
  } catch (e) {
    console.log(
      JSON.stringify({
        abort: true,
        phase: "identity",
        reason: e instanceof Error ? e.message : String(e),
        identityBefore: {
          TEST: identityBefore.TEST_DATABASE_URL.ok
            ? {
                endpointId: identityBefore.TEST_DATABASE_URL.endpointId,
                host: hostOnly(process.env.TEST_DATABASE_URL ?? ""),
              }
            : { ok: false },
          DATABASE: identityBefore.DATABASE_URL.ok
            ? {
                endpointId: identityBefore.DATABASE_URL.endpointId,
                isProd:
                  identityBefore.DATABASE_URL.endpointId ===
                  NEON_ENDPOINTS.PRODUCTION,
              }
            : { ok: false },
        },
      }),
    );
    process.exit(1);
  }

  const testEp = extractNeonEndpointId(testUrl);
  if (
    !testEp.ok ||
    testEp.endpointId !== NEON_ENDPOINTS.TEST ||
    identityBefore.DATABASE_URL.ok &&
      identityBefore.DATABASE_URL.endpointId === NEON_ENDPOINTS.PRODUCTION
  ) {
    // OK: local DATABASE is prod — we ignore it.
  }
  if (!testEp.ok || testEp.endpointId !== NEON_ENDPOINTS.TEST) {
    console.log(
      JSON.stringify({
        abort: true,
        reason: "TEST endpoint mismatch",
        endpointId: testEp.ok ? testEp.endpointId : null,
      }),
    );
    process.exit(1);
  }

  // Inyectar solo en proceso: pooled TEST + params candidatas B5.4-A.
  const runtimeUrl = withPoolParams(testUrl, 2, 15);
  const directFromTest = testUrl.replace(/-pooler\./i, ".");
  process.env.TEST_DATABASE_URL = testUrl;
  process.env.DATABASE_URL = runtimeUrl;
  process.env.DIRECT_URL = directFromTest;
  process.env.RUN_INTEGRATION = "1";
  process.env.PRISMA_DISABLE_WARNINGS = "1";

  assertIntegrationWriteTarget(process.env);

  const identity = {
    endpointId: NEON_ENDPOINTS.TEST,
    runtimeHost: hostOnly(runtimeUrl),
    runtimePooled: (hostOnly(runtimeUrl) ?? "").includes("-pooler"),
    ignoredLocalProd: ["DATABASE_URL", "DIRECT_URL"] as const,
    connection_limit: 2,
    pool_timeout: 15,
  };

  const db = createIntegrationPrismaClient();
  const db2 = createIntegrationPrismaClient();

  // Lectura de identidad PG
  const pg = await db.$queryRaw<
    { db: string; user: string; addr: string | null }[]
  >`SELECT current_database() AS db, current_user AS user, inet_server_addr()::text AS addr`;
  rec("identity.pg", pg[0]?.db === "neondb", {
    database: pg[0]?.db ?? null,
    // no host secrets
  });

  const domain: OwnedTicketDomain = createOwnedTicketDomain();
  trackFixtureTicketCounter(domain);
  let suiteCreditosSnap: CreditosConfigSnapshot = { existed: false };
  let suiteCajaSnap: CajaSnap = { existed: false };
  let creditosLease: CreditosConfigLease | null = null;

  const allTicketIds: string[] = [];
  const perfSamples: number[] = [];

  try {
    await seedMinimalBusiness(db);
    suiteCreditosSnap = await readCreditosConfigSnapshot(db);
    suiteCajaSnap = await readCajaSnap(db);

    // Caja OFF por defecto al preparar fixtures.
    await setCaja(db, { activa: false, activadaEn: null, adminId: null });

    const admin = await createOwnedTestUser(db, domain, {
      usuario: `${TAG}_adm`.slice(0, 40),
      nombre: "B55A Admin",
      rol: "ADMIN",
    });
    const vendA = await createOwnedTestUser(db, domain, {
      usuario: `${TAG}_va`.slice(0, 40),
      nombre: "B55A Vend A",
      rol: "VENDEDOR",
    });
    const vendB = await createOwnedTestUser(db, domain, {
      usuario: `${TAG}_vb`.slice(0, 40),
      nombre: "B55A Vend B",
      rol: "VENDEDOR",
    });

    creditosLease = await enableCreditos(db, admin.id, suiteCreditosSnap);
    const store = createPrismaCreditosStore(db);
    await asignarCreditos(store, {
      vendedorId: vendA.id,
      importe: "100.00",
      actorAdminId: admin.id,
      idempotencyKey: newIdempotencyKey(),
    });
    await asignarCreditos(store, {
      vendedorId: vendB.id,
      importe: "100.00",
      actorAdminId: admin.id,
      idempotencyKey: newIdempotencyKey(),
    });

    // —— F3 funcional base ——
    {
      const t0 = performance.now();
      const r = await createTicket(
        {
          fechaJuego: FECHA,
          vendedorId: vendA.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [
            { hora: 14, numeroAnimal: "03", importe: "2.00" },
            { hora: 14, numeroAnimal: "05", importe: "3.00" },
          ],
        },
        AHORA,
        db,
        { actorRol: "VENDEDOR", actorUserId: vendA.id },
      );
      perfSamples.push(performance.now() - t0);
      trackOwnedTicketId(domain, r.ticket.id);
      allTicketIds.push(r.ticket.id);

      const row = await db.ticket.findUniqueOrThrow({
        where: { id: r.ticket.id },
        include: { lineas: true },
      });
      const sum = row.lineas.reduce(
        (a, l) => a.add(l.importe),
        new Prisma.Decimal(0),
      );
      const hist = await consultarSaldoYHistorial(store, vendA.id);
      const consumo = hist.movimientos.find(
        (m) => m.tipo === "CONSUMO_VENTA" && m.ticketId === r.ticket.id,
      );
      const audit = await db.auditoria.findFirst({
        where: {
          accion: "CREAR_TICKET",
          entidad: "TICKET",
          entidadId: r.ticket.id,
        },
      });
      const oblig = await db.cajaObligacion.findUnique({
        where: { ticketId: r.ticket.id },
      });

      rec("F3.base_emit", true, {
        ticketId: r.ticket.id,
        lineas: row.lineas.length,
        total: row.totalApostado.toFixed(2),
        sumLineas: sum.toFixed(2),
        multiplicador: row.multiplicadorUsado,
        codigoLen: row.codigoPublico.length,
        saldo: hist.cuenta?.saldoDisponible.toFixed(2),
        consumo: consumo?.importe.toFixed(2) ?? null,
        audit: Boolean(audit),
        obligacionConCajaOff: oblig == null,
        replay: r.idempotentReplay,
      });
      if (
        row.lineas.length !== 2 ||
        !sum.eq(row.totalApostado) ||
        row.totalApostado.toFixed(2) !== "5.00" ||
        !consumo ||
        !consumo.importe.eq("5.00") ||
        !audit ||
        oblig != null
      ) {
        cases[cases.length - 1]!.ok = false;
      }
    }

    // Caja ON + vendedor → 1 obligación
    {
      await setCaja(db, {
        activa: true,
        activadaEn: ACTIVADA_EN,
        adminId: admin.id,
      });
      const r = await createTicket(
        {
          fechaJuego: FECHA,
          vendedorId: vendA.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: "03", importe: "4.00" }],
        },
        AHORA,
        db,
        { actorRol: "VENDEDOR", actorUserId: vendA.id },
      );
      trackOwnedTicketId(domain, r.ticket.id);
      allTicketIds.push(r.ticket.id);
      const oblig = await db.cajaObligacion.findUnique({
        where: { ticketId: r.ticket.id },
      });
      rec("F3.caja_on_vendor_obligacion", oblig != null, {
        ticketId: r.ticket.id,
        bruto: oblig?.bruto.toFixed(2) ?? null,
        vendedorIdMatch: oblig?.vendedorId === vendA.id,
      });
    }

    // ADMIN directo sin atribución → sin obligación; sin consumo créditos admin
    {
      const saldoABefore = (
        await consultarSaldoYHistorial(store, vendA.id)
      ).cuenta!.saldoDisponible.toFixed(2);
      const r = await createTicket(
        {
          fechaJuego: FECHA,
          vendedorId: admin.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: "15", importe: "7.00" }],
        },
        AHORA,
        db,
        { actorRol: "ADMIN", actorUserId: admin.id },
      );
      trackOwnedTicketId(domain, r.ticket.id);
      allTicketIds.push(r.ticket.id);
      const oblig = await db.cajaObligacion.findUnique({
        where: { ticketId: r.ticket.id },
      });
      const saldoAAfter = (
        await consultarSaldoYHistorial(store, vendA.id)
      ).cuenta!.saldoDisponible.toFixed(2);
      rec("F3.admin_direct_no_obligacion", oblig == null && saldoABefore === saldoAAfter, {
        ticketVendedorId: r.ticket.vendedorId,
        obligacion: oblig != null,
        saldoVendAUnchanged: saldoABefore === saldoAAfter,
      });
    }

    // ADMIN atribuido → obligación del vendedor; créditos del actor ADMIN (skip)
    {
      const saldoABefore = (
        await consultarSaldoYHistorial(store, vendA.id)
      ).cuenta!.saldoDisponible.toFixed(2);
      const r = await createTicket(
        {
          fechaJuego: FECHA,
          vendedorId: admin.id,
          atribuidoAVendedorId: vendA.id,
          idempotencyKey: newIdempotencyKey(),
          lineas: [{ hora: 14, numeroAnimal: "00", importe: "6.00" }],
        },
        AHORA,
        db,
        {
          actorRol: "ADMIN",
          actorUserId: admin.id,
          atribuidoAVendedorId: vendA.id,
        },
      );
      trackOwnedTicketId(domain, r.ticket.id);
      allTicketIds.push(r.ticket.id);
      const oblig = await db.cajaObligacion.findUnique({
        where: { ticketId: r.ticket.id },
      });
      const saldoAAfter = (
        await consultarSaldoYHistorial(store, vendA.id)
      ).cuenta!.saldoDisponible.toFixed(2);
      const consumoA = (
        await consultarSaldoYHistorial(store, vendA.id)
      ).movimientos.find(
        (m) => m.tipo === "CONSUMO_VENTA" && m.ticketId === r.ticket.id,
      );
      rec(
        "F3.admin_atribuido_obligacion_creditos_actor",
        oblig?.vendedorId === vendA.id &&
          saldoABefore === saldoAAfter &&
          !consumoA,
        {
          obligVendedor: oblig?.vendedorId ?? null,
          saldoVendAUnchanged: saldoABefore === saldoAAfter,
          consumoSobreAtribuido: Boolean(consumoA),
          ticketVendedorId: r.ticket.vendedorId,
        },
      );
    }

    // Caja OFF otra vez para no contaminar concurrencia (salvo escenario A/B)
    await setCaja(db, {
      activa: true,
      activadaEn: ACTIVADA_EN,
      adminId: admin.id,
    });

    // —— F4 Escenario A: mismo vendedor, saldo limitado ——
    {
      // Vendedor fresco con saldo exacto 25 → como máximo 2 tickets de 10.00
      const vendLim = await createOwnedTestUser(db, domain, {
        usuario: `${TAG}_vl`.slice(0, 40),
        nombre: "B55A Vend Limited",
        rol: "VENDEDOR",
      });
      await asignarCreditos(store, {
        vendedorId: vendLim.id,
        importe: "25.00",
        actorAdminId: admin.id,
        idempotencyKey: newIdempotencyKey(),
      });
      const hist = await consultarSaldoYHistorial(store, vendLim.id);
      const saldo = hist.cuenta!.saldoDisponible;
      const importe = "10.00";
      const N = 5;
      const maxPossible = Math.floor(Number(saldo.toFixed(2)) / 10);
      const results = await Promise.allSettled(
        Array.from({ length: N }, () =>
          createTicket(
            {
              fechaJuego: FECHA,
              vendedorId: vendLim.id,
              idempotencyKey: newIdempotencyKey(),
              lineas: [{ hora: 15, numeroAnimal: "03", importe }],
            },
            AHORA,
            db,
            { actorRol: "VENDEDOR", actorUserId: vendLim.id },
          ),
        ),
      );
      const fulfilled = results.filter(
        (x) => x.status === "fulfilled",
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof createTicket>>>[];
      const rejected = results.filter((x) => x.status === "rejected");
      for (const f of fulfilled) {
        trackOwnedTicketId(domain, f.value.ticket.id);
        allTicketIds.push(f.value.ticket.id);
      }
      const after = await consultarSaldoYHistorial(store, vendLim.id);
      const okIds = fulfilled.map((f) => f.value.ticket.id);
      const obligs = await db.cajaObligacion.findMany({
        where: { ticketId: { in: okIds } },
      });
      const codes = fulfilled.map((f) => f.value.ticket.codigoPublico);
      const brutoOk = fulfilled.reduce(
        (a, f) => a.add(f.value.ticket.totalApostado),
        new Prisma.Decimal(0),
      );
      const insuf = rejected.filter(
        (r) => r.reason instanceof InsufficientCreditoSaldoError,
      ).length;
      const ok =
        after.cuenta!.saldoDisponible.gte(0) &&
        after.cuenta!.saldoDisponible.lt(10) &&
        fulfilled.length === maxPossible &&
        rejected.length === N - maxPossible &&
        insuf === rejected.length &&
        obligs.length === fulfilled.length &&
        new Set(codes).size === codes.length;
      rec("F4A.concurrent_same_vendor_limited", ok, {
        saldoAntes: saldo.toFixed(2),
        saldoDespues: after.cuenta?.saldoDisponible.toFixed(2),
        exitos: fulfilled.length,
        rechazos: rejected.length,
        insuficientes: insuf,
        maxPossibleBySaldo: maxPossible,
        saldoNoNegativo: !after.cuenta!.saldoDisponible.lt(0),
        codigosUnicos: new Set(codes).size === codes.length,
        obligacionesExactas: obligs.length === fulfilled.length,
        brutoOk: brutoOk.toFixed(2),
        ticketsParciales: (
          await db.ticket.findMany({
            where: { id: { in: okIds } },
            include: { _count: { select: { lineas: true } } },
          })
        ).filter((t) => t._count.lineas === 0).length,
      });
    }

    // —— F4 Escenario B: vendedores distintos ——
    {
      const t0 = performance.now();
      const [ra, rb] = await Promise.all([
        createTicket(
          {
            fechaJuego: FECHA,
            vendedorId: vendA.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 16, numeroAnimal: "05", importe: "1.00" }],
          },
          AHORA,
          db,
          { actorRol: "VENDEDOR", actorUserId: vendA.id },
        ),
        createTicket(
          {
            fechaJuego: FECHA,
            vendedorId: vendB.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 16, numeroAnimal: "05", importe: "1.00" }],
          },
          AHORA,
          db2,
          { actorRol: "VENDEDOR", actorUserId: vendB.id },
        ),
      ]);
      const elapsed = performance.now() - t0;
      trackOwnedTicketId(domain, ra.ticket.id);
      trackOwnedTicketId(domain, rb.ticket.id);
      allTicketIds.push(ra.ticket.id, rb.ticket.id);
      const ha = await consultarSaldoYHistorial(store, vendA.id);
      const hb = await consultarSaldoYHistorial(store, vendB.id);
      const ca = ha.movimientos.find(
        (m) => m.ticketId === ra.ticket.id && m.tipo === "CONSUMO_VENTA",
      );
      const cb = hb.movimientos.find(
        (m) => m.ticketId === rb.ticket.id && m.tipo === "CONSUMO_VENTA",
      );
      rec("F4B.concurrent_distinct_vendors", true, {
        elapsedMs: Math.round(elapsed),
        codesDistinct: ra.ticket.codigoPublico !== rb.ticket.codigoPublico,
        consumoA_ok: ca?.vendedorId === vendA.id,
        consumoB_ok: cb?.vendedorId === vendB.id,
        ticketA_vend: ra.ticket.vendedorId,
        ticketB_vend: rb.ticket.vendedorId,
      });
      if (
        ra.ticket.codigoPublico === rb.ticket.codigoPublico ||
        ca?.vendedorId !== vendA.id ||
        cb?.vendedorId !== vendB.id
      ) {
        cases[cases.length - 1]!.ok = false;
      }
    }

    // —— F4 Escenario C: idempotencia ——
    {
      const key = newIdempotencyKey();
      const input = {
        fechaJuego: FECHA,
        vendedorId: vendB.id,
        idempotencyKey: key,
        lineas: [{ hora: 17, numeroAnimal: "15", importe: "2.00" }],
      };
      const first = await createTicket(input, AHORA, db, {
        actorRol: "VENDEDOR",
        actorUserId: vendB.id,
      });
      trackOwnedTicketId(domain, first.ticket.id);
      allTicketIds.push(first.ticket.id);
      const saldo1 = (
        await consultarSaldoYHistorial(store, vendB.id)
      ).cuenta!.saldoDisponible.toFixed(2);
      const second = await createTicket(input, AHORA, db, {
        actorRol: "VENDEDOR",
        actorUserId: vendB.id,
      });
      const saldo2 = (
        await consultarSaldoYHistorial(store, vendB.id)
      ).cuenta!.saldoDisponible.toFixed(2);
      const obligCount = await db.cajaObligacion.count({
        where: { ticketId: first.ticket.id },
      });
      const parallel = await Promise.all(
        Array.from({ length: 8 }, () =>
          createTicket(input, AHORA, db, {
            actorRol: "VENDEDOR",
            actorUserId: vendB.id,
          }),
        ),
      );
      const ids = new Set(parallel.map((p) => p.ticket.id));
      rec("F4C.idempotency_replay", true, {
        exists: true,
        firstReplay: first.idempotentReplay === false,
        secondReplay: second.idempotentReplay === true,
        sameTicket: first.ticket.id === second.ticket.id,
        saldoUnchanged: saldo1 === saldo2,
        obligaciones: obligCount,
        parallelUniqueTickets: ids.size,
        parallelCreates: parallel.filter((p) => !p.idempotentReplay).length,
      });
      if (
        !second.idempotentReplay ||
        first.ticket.id !== second.ticket.id ||
        saldo1 !== saldo2 ||
        ids.size !== 1 ||
        obligCount > 1
      ) {
        cases[cases.length - 1]!.ok = false;
      }
    }

    // —— F4 Escenario D: códigos únicos concurrentes ——
    {
      // Top-up B si hace falta
      const hb = await consultarSaldoYHistorial(store, vendB.id);
      if (hb.cuenta!.saldoDisponible.lt(20)) {
        await asignarCreditos(store, {
          vendedorId: vendB.id,
          importe: "50.00",
          actorAdminId: admin.id,
          idempotencyKey: newIdempotencyKey(),
        });
      }
      const N = 6;
      const t0 = performance.now();
      const results = await Promise.all(
        Array.from({ length: N }, () =>
          createTicket(
            {
              fechaJuego: FECHA,
              vendedorId: vendB.id,
              idempotencyKey: newIdempotencyKey(),
              lineas: [{ hora: 18, numeroAnimal: "00", importe: "1.00" }],
            },
            AHORA,
            db,
            { actorRol: "VENDEDOR", actorUserId: vendB.id },
          ),
        ),
      );
      const elapsed = performance.now() - t0;
      for (const r of results) {
        trackOwnedTicketId(domain, r.ticket.id);
        allTicketIds.push(r.ticket.id);
        perfSamples.push(elapsed / N);
      }
      const codes = results.map((r) => r.ticket.codigoPublico);
      rec("F4D.codigo_publico_concurrente", new Set(codes).size === N, {
        n: N,
        uniqueCodes: new Set(codes).size,
        totalMs: Math.round(elapsed),
        avgMsApprox: Math.round(elapsed / N),
      });
    }

    // —— F5 Fallos / rollback ——
    const countOwnedArtifacts = async () => {
      const tickets = await db.ticket.count({
        where: { vendedorId: { in: [vendA.id, vendB.id, admin.id] } },
      });
      const lineas = await db.ticketLinea.count({
        where: {
          ticket: { vendedorId: { in: [vendA.id, vendB.id, admin.id] } },
        },
      });
      const movs = await db.creditoMovimiento.count({
        where: {
          vendedorId: { in: [vendA.id, vendB.id] },
          tipo: "CONSUMO_VENTA",
        },
      });
      const obligs = await db.cajaObligacion.count({
        where: { vendedorId: { in: [vendA.id, vendB.id] } },
      });
      const audits = await db.auditoria.count({
        where: {
          accion: "CREAR_TICKET",
          usuarioId: { in: [vendA.id, vendB.id, admin.id] },
        },
      });
      return { tickets, lineas, movs, obligs, audits };
    };

    const failPoints: {
      id: string;
      options: Parameters<typeof createTicket>[3];
    }[] = [
      {
        id: "F5.after_emisor_lock",
        options: {
          actorRol: "VENDEDOR",
          actorUserId: vendA.id,
          afterEmisorLocked: async () => {
            throw new Error("B55A_INJECT_AFTER_EMISOR_LOCK");
          },
        },
      },
      {
        id: "F5.before_caja_after_ticket_audit",
        options: {
          actorRol: "VENDEDOR",
          actorUserId: vendA.id,
          beforeCajaObligacion: async () => {
            throw new Error("B55A_INJECT_BEFORE_CAJA");
          },
        },
      },
      {
        id: "F5.after_caja_before_creditos",
        options: {
          actorRol: "VENDEDOR",
          actorUserId: vendA.id,
          afterCajaObligacion: async () => {
            throw new Error("B55A_INJECT_AFTER_CAJA");
          },
        },
      },
      {
        id: "F5.during_creditos",
        options: {
          actorRol: "VENDEDOR",
          actorUserId: vendA.id,
          bindCreditsStore: (tx) => {
            const inner = createPrismaCreditosStore(tx, {
              alreadyInTransaction: true,
            });
            // runInTransaction del store original cierra sobre `store` interno;
            // hay que reenviar el wrapper para que el throw aplique.
            const wrapped = { ...inner } as CreditosStore;
            wrapped.runInTransaction = async (fn) => fn(wrapped);
            wrapped.ajustarSaldoAtomico = async () => {
              throw new Error("B55A_INJECT_DURING_CREDITOS");
            };
            return wrapped;
          },
        },
      },
    ];

    // Top-up A for fail tests
    {
      const ha = await consultarSaldoYHistorial(store, vendA.id);
      if (ha.cuenta!.saldoDisponible.lt(30)) {
        await asignarCreditos(store, {
          vendedorId: vendA.id,
          importe: "50.00",
          actorAdminId: admin.id,
          idempotencyKey: newIdempotencyKey(),
        });
      }
    }

    for (const fp of failPoints) {
      const before = await countOwnedArtifacts();
      let threw = false;
      try {
        await createTicket(
          {
            fechaJuego: FECHA,
            vendedorId: vendA.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 19, numeroAnimal: "03", importe: "3.00" }],
          },
          AHORA,
          db,
          fp.options,
        );
      } catch (e) {
        threw = true;
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("B55A_INJECT")) {
          rec(fp.id, false, { unexpectedError: msg.slice(0, 160) });
          continue;
        }
      }
      const after = await countOwnedArtifacts();
      const unchanged =
        before.tickets === after.tickets &&
        before.lineas === after.lineas &&
        before.movs === after.movs &&
        before.obligs === after.obligs &&
        before.audits === after.audits;
      rec(fp.id, threw && unchanged, {
        threw,
        before,
        after,
        unchanged,
      });
    }

    // —— F6 rendimiento ——
    {
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const ha = await consultarSaldoYHistorial(store, vendB.id);
        if (ha.cuenta!.saldoDisponible.lt(5)) {
          await asignarCreditos(store, {
            vendedorId: vendB.id,
            importe: "30.00",
            actorAdminId: admin.id,
            idempotencyKey: newIdempotencyKey(),
          });
        }
        const t0 = performance.now();
        const r = await createTicket(
          {
            fechaJuego: FECHA,
            vendedorId: vendB.id,
            idempotencyKey: newIdempotencyKey(),
            lineas: [{ hora: 19, numeroAnimal: "05", importe: "1.00" }],
          },
          AHORA,
          db,
          { actorRol: "VENDEDOR", actorUserId: vendB.id },
        );
        samples.push(performance.now() - t0);
        trackOwnedTicketId(domain, r.ticket.id);
        allTicketIds.push(r.ticket.id);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(samples.length * 0.95) - 1)]!;
      rec("F6.latency_createTicket", true, {
        n: samples.length,
        avgMs: Math.round(avg),
        p95Ms: Math.round(p95),
        maxMs: Math.round(Math.max(...samples)),
        minMs: Math.round(Math.min(...samples)),
        prismaMaxWaitMs: 30_000,
        prismaTimeoutMs: 60_000,
        routeMaxDuration: null,
        note: "POST /api/venta/tickets no define maxDuration; solo cron=60s",
      });
      for (const s of samples) perfSamples.push(s);
    }

    // —— Integridad global ——
    const integ = await integrityCheck(db, [...domain.userIds], [
      ...domain.ticketIds,
    ]);
    rec(
      "F7.integrity",
      integ.lineasSumBad === 0 &&
        integ.saldosNegativos === 0 &&
        integ.codigosUnicos === true &&
        integ.consumosDuplicadosPorTicket === false &&
        integ.obligacionesDupTicket === false &&
        integ.ticketsSinLineas === 0,
      integ,
    );

    // Arquitectura (estática, documentada en salida)
    const architecture = {
      endpoint: "POST /api/venta/tickets",
      service: "lib/tickets/create-ticket.ts#createTicket",
      outsideTx: [
        "parse body + auth",
        "idempotency fast-path findUnique",
        "assertEmisorPuedeCrearTicket (sin lock)",
        "ADMIN atribución assertVendedorElegible (fast-fail)",
        "P2002 race → findUnique replay",
      ],
      insideTxOrder: [
        "1 Usuario(actor) FOR UPDATE",
        "2 Usuario(atribuido) FOR UPDATE si ≠ actor",
        "3 getMultiplicadorPremio",
        "4 validar horas abiertas + animales",
        "5 TicketCounter UPSERT +1",
        "6 generarCodigoPublicoUnico (hasta 5 intentos)",
        "7 Ticket + TicketLinea create",
        "8 Auditoría CREAR_TICKET",
        "9 maybeCreateCajaObligacion (VendedorComision FOR UPDATE)",
        "10 consumirCreditos (VendedorCreditoCuenta FOR UPDATE)",
      ],
      txOptions: { maxWait: 30_000, timeout: 60_000 },
      constraints: [
        "Ticket.idempotencyKey UNIQUE",
        "Ticket.codigoPublico UNIQUE",
        "Ticket.numeroVisible UNIQUE",
        "TicketLinea UNIQUE(ticketId,hora,numeroAnimal)",
        "CajaObligacion.ticketId UNIQUE",
        "CreditoMovimiento UNIQUE(ticketId,tipo)",
      ],
      idempotency: "UUID key + requestHash; replay sin re-consumo",
    };

    const passed = cases.filter((c) => c.ok).length;
    const failed = cases.filter((c) => !c.ok).length;

    console.log(
      JSON.stringify(
        {
          phase: "B5.5-A",
          identity,
          pg: { database: pg[0]?.db ?? null },
          architecture,
          fixtures: {
            tag: TAG,
            adminId: admin.id,
            vendAId: vendA.id,
            vendBId: vendB.id,
            ticketCount: domain.ticketIds.size,
          },
          summary: { passed, failed, total: cases.length },
          cases,
          perfSamplesMs: perfSamples.map((x) => Math.round(x)),
        },
        null,
        2,
      ),
    );

    if (failed > 0) process.exitCode = 2;
  } finally {
    try {
      await setCaja(db, { activa: false, activadaEn: null, adminId: null });
    } catch {
      /* ignore */
    }
    try {
      if (creditosLease) await restoreCreditosConfigLease(db, creditosLease);
    } catch {
      /* ignore */
    }
    try {
      await restoreCajaSnap(db, suiteCajaSnap);
    } catch {
      /* ignore */
    }
    try {
      if (domain) await cleanupOwnedTicketDomain(db, domain);
    } catch (e) {
      console.error(
        JSON.stringify({
          cleanupWarning:
            e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
        }),
      );
    }
    await db.$disconnect().catch(() => {});
    await db2.$disconnect().catch(() => {});
  }
}

main().catch((e) => {
  console.log(
    JSON.stringify({
      abort: true,
      reason: e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400),
    }),
  );
  process.exit(1);
});
