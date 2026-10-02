import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { fechaAYYYYMMDD } from "@/lib/fecha";

/** 2026-10-02 12:00 UTC ≈ 08:00 America/Caracas → horas 9–19 abiertas. */
export const AHORA_VE_MANANA = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));

/** Medianoche UTC del día de juego fijo de las pruebas. */
export function fechaJuegoDate(): Date {
  return new Date(Date.UTC(2026, 9, 2));
}

export function fechaJuegoTest(): string {
  return fechaAYYYYMMDD(fechaJuegoDate());
}

const ANIMALES_MIN = [
  { numero: "03", nombre: "Ciempiés" },
  { numero: "05", nombre: "León" },
  { numero: "15", nombre: "Zorro" },
  { numero: "00", nombre: "Ballena" },
] as const;

/**
 * Limpia datos mutables de tickets/usuarios. Conserva Animal y ConfigNegocio.
 * Usa DELETE (no TRUNCATE) para evitar deadlocks AccessExclusiveLock con
 * transacciones concurrentes aún abiertas en el pool.
 */
export async function resetTicketDomain(db: PrismaClient): Promise<void> {
  const maxAttempts = 6;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.ticketLinea.deleteMany();
      await db.ticket.deleteMany();
      await db.ticketCounter.deleteMany();
      await db.auditoria.deleteMany();
      await db.usuarioSesion.deleteMany();
      await db.usuario.deleteMany();
      await db.resultado.deleteMany();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("resetTicketDomain falló tras reintentos");
}

export async function seedMinimalBusiness(db: PrismaClient): Promise<void> {
  for (const a of ANIMALES_MIN) {
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
    update: { valorInt: 30 },
    create: { clave: "MULTIPLICADOR_PREMIO", valorInt: 30 },
  });
}

export async function createTestUser(
  db: PrismaClient,
  args: {
    usuario: string;
    nombre: string;
    rol: "ADMIN" | "VENDEDOR";
    password?: string;
  },
): Promise<{ id: string; usuario: string; rol: "ADMIN" | "VENDEDOR" }> {
  const passwordHash = await hashPassword(args.password ?? "testpass12");
  const row = await db.usuario.create({
    data: {
      nombre: args.nombre,
      usuario: args.usuario.toLowerCase(),
      passwordHash,
      rol: args.rol,
      activo: true,
    },
    select: { id: true, usuario: true, rol: true },
  });
  return row;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
