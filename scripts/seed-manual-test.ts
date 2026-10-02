/**
 * Seed de datos para pruebas MANUALES — SOLO TEST_DATABASE_URL.
 *
 * Uso: npm run seed:manual-test
 *
 * ABORTA si:
 * - falta TEST_DATABASE_URL
 * - TEST_DATABASE_URL === DATABASE_URL
 * - TEST_DATABASE_URL === DIRECT_URL
 *
 * NO acepta URL por argumento CLI.
 * NO imprime contraseñas ni hashes ni tokens.
 */

import fs from "node:fs";
import path from "node:path";
import { assertSafeTestDatabase } from "../lib/tickets/integration/safe-test-db";

const ROOT = path.resolve(__dirname, "..");

const MANUAL_ADMIN_USER_DEFAULT = "manual_admin";
const MANUAL_VENDOR_USER_DEFAULT = "manual_vendedor";

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

function requireEnvPassword(name: string): string {
  const v = process.env[name]?.trim() ?? "";
  if (!v) {
    throw new Error(
      `Falta ${name}. Define las credenciales de prueba en .env (nunca en el código).`,
    );
  }
  if (v.length < 8) {
    throw new Error(`${name} debe tener al menos 8 caracteres.`);
  }
  return v;
}

function envUser(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v.toLowerCase() : fallback;
}

/** Idempotency UUID estable por fecha + slot (hex válido). */
function idemKeyForToday(fechaYYYYMMDD: string, slot: number): string {
  const d = fechaYYYYMMDD.replace(/-/g, "");
  return `${d}-0000-4000-8000-${String(slot).padStart(12, "0")}`;
}

async function main(): Promise<void> {
  loadEnvFile(path.join(ROOT, ".env"));

  if (process.argv.length > 2) {
    console.error(
      "Este script no acepta argumentos. Usa solo TEST_DATABASE_URL del entorno.",
    );
    process.exit(1);
  }

  let testUrl: string;
  try {
    testUrl = assertSafeTestDatabase(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  process.env.DATABASE_URL = testUrl;
  process.env.DIRECT_URL = testUrl;
  delete (globalThis as { prisma?: unknown }).prisma;

  const adminUser = envUser("MANUAL_TEST_ADMIN_USER", MANUAL_ADMIN_USER_DEFAULT);
  const vendorUser = envUser(
    "MANUAL_TEST_VENDOR_USER",
    MANUAL_VENDOR_USER_DEFAULT,
  );
  let adminPassword: string;
  let vendorPassword: string;
  try {
    adminPassword = requireEnvPassword("MANUAL_TEST_ADMIN_PASSWORD");
    vendorPassword = requireEnvPassword("MANUAL_TEST_VENDOR_PASSWORD");
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (adminUser === vendorUser) {
    console.error(
      "MANUAL_TEST_ADMIN_USER y MANUAL_TEST_VENDOR_USER deben ser distintos.",
    );
    process.exit(1);
  }

  const { PrismaClient } = await import("@prisma/client");
  const { hashPassword } = await import("../lib/auth/password");
  const { createTicket } = await import("../lib/tickets/create-ticket");
  const { anularTicket } = await import("../lib/tickets/anular-ticket");
  const { recordAuditEvent } = await import("../lib/audit/audit");
  const {
    hoyYYYYMMDD,
    fechaHoyParaPrisma,
    HORAS_SORTEO,
  } = await import("../lib/fecha");
  const {
    esHoraAbiertaParaVenta,
    horaActualVenezuela,
  } = await import("../lib/tickets/draw-hours");

  const db = new PrismaClient({
    datasources: { db: { url: testUrl } },
  });

  const ahora = new Date();
  const fechaStr = hoyYYYYMMDD(ahora);
  const fechaDate = fechaHoyParaPrisma(ahora);
  const horaActualVe = horaActualVenezuela(ahora);

  console.log("→ seed:manual-test (solo TEST_DATABASE_URL)");
  console.log(`→ fecha juego (America/Caracas): ${fechaStr}`);
  console.log(`→ hora actual VE: ${horaActualVe}:00`);

  try {
    const animales = [
      { numero: "0", nombre: "Delfín" },
      { numero: "00", nombre: "Ballena" },
      { numero: "03", nombre: "Ciempiés" },
      { numero: "05", nombre: "León" },
      { numero: "15", nombre: "Zorro" },
      { numero: "22", nombre: "Camello" },
    ] as const;

    for (const a of animales) {
      await db.animal.upsert({
        where: { numero: a.numero },
        update: { nombre: a.nombre },
        create: {
          numero: a.numero,
          nombre: a.nombre,
          imagen: `/animals/${a.numero}.png`,
        },
      });
    }

    await db.configNegocio.upsert({
      where: { clave: "MULTIPLICADOR_PREMIO" },
      update: {},
      create: { clave: "MULTIPLICADOR_PREMIO", valorInt: 30 },
    });

    const adminHash = await hashPassword(adminPassword);
    const vendorHash = await hashPassword(vendorPassword);

    const admin = await db.usuario.upsert({
      where: { usuario: adminUser },
      update: {
        nombre: "Admin Manual Test",
        passwordHash: adminHash,
        rol: "ADMIN",
        activo: true,
      },
      create: {
        nombre: "Admin Manual Test",
        usuario: adminUser,
        passwordHash: adminHash,
        rol: "ADMIN",
        activo: true,
      },
      select: { id: true, usuario: true, rol: true },
    });

    if (admin.rol !== "ADMIN") {
      throw new Error(`El usuario ${adminUser} existe pero no es ADMIN.`);
    }

    const vendorBefore = await db.usuario.findUnique({
      where: { usuario: vendorUser },
      select: { id: true },
    });

    const vendor = await db.usuario.upsert({
      where: { usuario: vendorUser },
      update: {
        nombre: "Vendedor Manual Test",
        passwordHash: vendorHash,
        rol: "VENDEDOR",
        activo: true,
      },
      create: {
        nombre: "Vendedor Manual Test",
        usuario: vendorUser,
        passwordHash: vendorHash,
        rol: "VENDEDOR",
        activo: true,
      },
      select: { id: true, usuario: true, nombre: true, rol: true },
    });

    if (vendor.rol !== "VENDEDOR") {
      throw new Error(`El usuario ${vendorUser} existe pero no es VENDEDOR.`);
    }

    if (!vendorBefore) {
      await recordAuditEvent(db, {
        usuarioId: admin.id,
        accion: "CREAR_VENDEDOR",
        entidad: "USUARIO",
        entidadId: vendor.id,
        detalle: {
          nombre: vendor.nombre,
          usuario: vendor.usuario,
          rol: vendor.rol,
          origen: "seed:manual-test",
        },
      });
    }

    // createTicket usa el singleton — DATABASE_URL ya es TEST.
    const { prisma: appPrisma } = await import("../lib/prisma");

    const keyMulti = idemKeyForToday(fechaStr, 1);
    const keyExpo = idemKeyForToday(fechaStr, 2);
    const keyAnular = idemKeyForToday(fechaStr, 3);

    const existingMulti = await appPrisma.ticket.findUnique({
      where: { idempotencyKey: keyMulti },
      include: { lineas: { select: { hora: true } } },
    });

    const createOrReplayTicket = async (args: {
      key: string;
      lineas: {
        hora: number;
        numeroAnimal: string;
        importe: string;
      }[];
    }) => {
      const result = await createTicket(
        {
          fechaJuego: fechaStr,
          vendedorId: vendor.id,
          idempotencyKey: args.key,
          lineas: args.lineas,
        },
        ahora,
      );
      return result.ticket;
    };

    let horaA: number;
    let horaB: number;

    if (existingMulti && existingMulti.lineas.length > 0) {
      const horas = Array.from(
        new Set(existingMulti.lineas.map((l) => l.hora)),
      ).sort((a, b) => a - b);
      horaA = horas[0]!;
      horaB = horas[1] ?? horas[0]!;
      console.log(
        `→ reutilizando tickets del día (idempotencia). Horas: ${horaA}:00 / ${horaB}:00`,
      );
    } else {
      const resultadosHoy = await db.resultado.findMany({
        where: { fecha: fechaDate },
        select: { hora: true },
      });
      const horasConResultado = new Set(resultadosHoy.map((r) => r.hora));
      const horasAbiertas = HORAS_SORTEO.filter((hora) =>
        esHoraAbiertaParaVenta({
          hora,
          horaActualVe,
          horasConResultado,
        }),
      );

      if (horasAbiertas.length < 2) {
        console.error(
          "No hay al menos 2 horas abiertas hoy (America/Caracas) para armar el dataset.",
        );
        console.error(
          "Ejecuta este seed más temprano, o limpia resultados futuros de prueba en TEST.",
        );
        process.exit(1);
      }

      horaA = horasAbiertas[0]!;
      horaB = horasAbiertas[1]!;
      console.log(`→ horas abiertas usadas: ${horaA}:00 y ${horaB}:00`);
    }

    const ticketMulti = await createOrReplayTicket({
      key: keyMulti,
      lineas: [
        { hora: horaA, numeroAnimal: "03", importe: "2.00" },
        { hora: horaA, numeroAnimal: "15", importe: "5.00" },
        { hora: horaB, numeroAnimal: "03", importe: "3.00" },
        { hora: horaB, numeroAnimal: "22", importe: "10.00" },
      ],
    });

    const ticketExpo = await createOrReplayTicket({
      key: keyExpo,
      lineas: [
        { hora: horaA, numeroAnimal: "03", importe: "4.00" },
        { hora: horaA, numeroAnimal: "05", importe: "1.50" },
      ],
    });

    const ticketAnular = await createOrReplayTicket({
      key: keyAnular,
      lineas: [{ hora: horaA, numeroAnimal: "15", importe: "7.00" }],
    });

    const anularRow = await appPrisma.ticket.findUnique({
      where: { id: ticketAnular.id },
      select: { estado: true },
    });
    if (anularRow?.estado === "EMITIDO") {
      await anularTicket(appPrisma, {
        id: ticketAnular.id,
        motivo: "Ticket de prueba anulado (seed:manual-test)",
        anuladoPorId: admin.id,
      });
    }

    const previoResultado = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: fechaDate, hora: horaA } },
      select: { id: true, numero: true },
    });

    const resultado = await db.resultado.upsert({
      where: { fecha_hora: { fecha: fechaDate, hora: horaA } },
      update: { numero: "03" },
      create: { fecha: fechaDate, hora: horaA, numero: "03" },
      select: { id: true, numero: true, hora: true },
    });

    if (!previoResultado) {
      await recordAuditEvent(db, {
        usuarioId: admin.id,
        accion: "CREAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: resultado.id,
        detalle: {
          fecha: fechaStr,
          hora: horaA,
          numeroAnterior: null,
          numeroNuevo: "03",
          origen: "seed:manual-test",
        },
      });
    } else if (previoResultado.numero !== "03") {
      await recordAuditEvent(db, {
        usuarioId: admin.id,
        accion: "MODIFICAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: resultado.id,
        detalle: {
          fecha: fechaStr,
          hora: horaA,
          numeroAnterior: previoResultado.numero,
          numeroNuevo: "03",
          origen: "seed:manual-test",
        },
      });
    }

    const publicBase =
      process.env.MANUAL_TEST_PUBLIC_BASE_URL?.trim() ||
      "http://localhost:3000";

    console.log("");
    console.log("=== Seed manual-test listo (TEST DB) ===");
    console.log(`fechaJuego: ${fechaStr}`);
    console.log(`admin usuario: ${admin.usuario}`);
    console.log(`vendedor usuario: ${vendor.usuario}`);
    console.log("(contraseñas: solo en variables de entorno; no se imprimen)");
    console.log("");
    console.log("Tickets:");
    console.log(
      `  multihora  numeroVisible=${ticketMulti.numeroVisible}  total=${ticketMulti.totalApostado}`,
    );
    console.log(
      `  exposición numeroVisible=${ticketExpo.numeroVisible}  total=${ticketExpo.totalApostado}`,
    );
    console.log(
      `  anulado    numeroVisible=${ticketAnular.numeroVisible}  (ANULADO)`,
    );
    console.log("");
    console.log("Resultado de prueba:");
    console.log(`  ${fechaStr} ${horaA}:00 → animal 03`);
    console.log(
      "  Ticket multihora: 03 GANADORA, 15 NO_GANADORA, líneas hora B PENDIENTES",
    );
    console.log("");
    console.log("URL pública (ticket multihora):");
    console.log(`  ${publicBase}/ticket/${ticketMulti.codigoPublico}`);
    console.log("");
    console.log(
      "Siguiente: apuntar npm run dev a TEST_DATABASE_URL — docs/manual-test-environment.md",
    );
  } finally {
    await db.$disconnect();
    try {
      const { prisma: appPrisma } = await import("../lib/prisma");
      await appPrisma.$disconnect();
    } catch {
      /* ignore */
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
