import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_ADMIN_SESSION, isAdminSession } from "@/lib/auth";
import { HORAS_SORTEO, parseFechaYYYYMMDD } from "@/lib/fecha";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = cookies().get(COOKIE_ADMIN_SESSION)?.value;
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = (await request.json()) as {
    fecha?: string;
    hora?: number;
    numero?: string;
  };

  const fecha = typeof body.fecha === "string" ? parseFechaYYYYMMDD(body.fecha) : null;
  const hora = Number(body.hora);
  const numero = typeof body.numero === "string" ? body.numero.trim() : "";

  if (
    !fecha ||
    !(HORAS_SORTEO as readonly number[]).includes(hora) ||
    !numero
  ) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const animal = await prisma.animal.findUnique({ where: { numero } });
  if (!animal) {
    return NextResponse.json({ error: "Animal no encontrado" }, { status: 400 });
  }

  const resultado = await prisma.resultado.upsert({
    where: {
      fecha_hora: { fecha, hora },
    },
    update: { numero },
    create: { fecha, hora, numero },
    include: { animal: true },
  });

  return NextResponse.json({
    ok: true,
    resultado: {
      hora: resultado.hora,
      numero: resultado.numero,
      nombre: resultado.animal.nombre,
    },
  });
}
