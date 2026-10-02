import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { recordAuditEvent } from "@/lib/audit/audit";
import { HORAS_SORTEO, fechaAYYYYMMDD, parseFechaYYYYMMDD } from "@/lib/fecha";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
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

  const fechaStr = fechaAYYYYMMDD(fecha);

  const resultado = await prisma.$transaction(async (tx) => {
    const previo = await tx.resultado.findUnique({
      where: { fecha_hora: { fecha, hora } },
      select: { id: true, numero: true },
    });

    const upserted = await tx.resultado.upsert({
      where: {
        fecha_hora: { fecha, hora },
      },
      update: { numero },
      create: { fecha, hora, numero },
      include: { animal: true },
    });

    if (!previo) {
      await recordAuditEvent(tx, {
        usuarioId: admin.userId,
        accion: "CREAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: upserted.id,
        detalle: {
          fecha: fechaStr,
          hora,
          numeroAnterior: null,
          numeroNuevo: numero,
        },
      });
    } else if (previo.numero !== numero) {
      await recordAuditEvent(tx, {
        usuarioId: admin.userId,
        accion: "MODIFICAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: upserted.id,
        detalle: {
          fecha: fechaStr,
          hora,
          numeroAnterior: previo.numero,
          numeroNuevo: numero,
        },
      });
    }

    return upserted;
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
