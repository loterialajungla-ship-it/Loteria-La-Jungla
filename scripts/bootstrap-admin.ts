/**
 * Bootstrap del primer Usuario ADMIN.
 *
 * Uso:
 *   npx tsx scripts/bootstrap-admin.ts
 *
 * Requiere en .env:
 *   ADMIN_BOOTSTRAP_PASSWORD → se hashea; no se imprime
 *   ADMIN_BOOTSTRAP_USER     → opcional (default: admin)
 *   DATABASE_URL / DIRECT_URL
 *
 * Si ya existe algún Usuario con rol ADMIN, no crea otro.
 * No escribe la contraseña en consola.
 * No usa ADMIN_PASSWORD ni ADMIN_SESSION_SECRET (retirados del runtime).
 */

import { PrismaClient } from "@prisma/client";
import {
  bootstrapAdminPassword,
  bootstrapAdminUser,
} from "../lib/auth/constants";
import { assertPasswordPolicy, hashPassword } from "../lib/auth/password";

const prisma = new PrismaClient();

async function main() {
  const password = bootstrapAdminPassword();
  if (!password) {
    console.error(
      "Falta ADMIN_BOOTSTRAP_PASSWORD en el entorno. No se puede hacer bootstrap.",
    );
    process.exit(1);
  }

  try {
    assertPasswordPolicy(password);
  } catch (e) {
    console.error(
      e instanceof Error ? e.message : "Contraseña no cumple la política mínima.",
    );
    process.exit(1);
  }

  const login = bootstrapAdminUser();
  if (!login) {
    console.error("ADMIN_BOOTSTRAP_USER inválido.");
    process.exit(1);
  }

  const existingAdmin = await prisma.usuario.findFirst({
    where: { rol: "ADMIN" },
    select: { id: true, usuario: true },
  });

  if (existingAdmin) {
    console.log(
      `Ya existe un ADMIN (usuario="${existingAdmin.usuario}"). Bootstrap omitido.`,
    );
    return;
  }

  const conflict = await prisma.usuario.findUnique({
    where: { usuario: login },
    select: { id: true, rol: true },
  });
  if (conflict) {
    console.error(
      `El usuario "${login}" ya existe con rol ${conflict.rol}. Elige otro ADMIN_BOOTSTRAP_USER.`,
    );
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const created = await prisma.usuario.create({
    data: {
      nombre: "Administrador",
      usuario: login,
      passwordHash,
      rol: "ADMIN",
      activo: true,
    },
    select: { id: true, usuario: true, rol: true },
  });

  console.log(
    `ADMIN creado: usuario="${created.usuario}" id=${created.id}. Usa /login.`,
  );
}

main()
  .catch((e) => {
    console.error("Bootstrap falló.");
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
