/**
 * Totales agregados de Caja por vendedor (C4 + C5).
 * No toca créditos ni premios. Solo lectura + agregaciones Decimal.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  listAplicacionesVendedor,
  listSaldosObligacionesVendedor,
  sumAplicadoVendedor,
} from "@/lib/caja/aplicacion";
import { cajaZero, moneyFixed2, roundHalfUp2 } from "@/lib/caja/money";
import type {
  CajaConfirmacionView,
  CajaDeclaracionEstado,
  CajaDeclaracionView,
  CajaResumenVendedorView,
  CajaTotalesView,
} from "@/lib/caja/types";

export type CajaResumenDb = Pick<
  PrismaClient,
  | "cajaObligacion"
  | "cajaDeclaracion"
  | "cajaConfirmacion"
  | "cajaAplicacion"
  | "usuario"
  | "$queryRaw"
>;

function dec(v: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return v == null ? cajaZero() : roundHalfUp2(new Prisma.Decimal(v));
}

export function calcularTotalesCaja(args: {
  totalBruto?: Prisma.Decimal;
  totalComision?: Prisma.Decimal;
  totalObligado: Prisma.Decimal;
  totalDeclarado: Prisma.Decimal;
  totalConfirmado: Prisma.Decimal;
  totalAplicado?: Prisma.Decimal;
}): CajaTotalesView {
  const totalBruto = roundHalfUp2(args.totalBruto ?? cajaZero());
  const totalComision = roundHalfUp2(args.totalComision ?? cajaZero());
  const totalObligado = roundHalfUp2(args.totalObligado);
  const totalDeclarado = roundHalfUp2(args.totalDeclarado);
  const totalConfirmado = roundHalfUp2(args.totalConfirmado);
  const totalAplicado = roundHalfUp2(args.totalAplicado ?? cajaZero());

  const deudaPendienteEntregar = roundHalfUp2(
    totalObligado.minus(totalConfirmado),
  );
  const pendienteConfirmar = roundHalfUp2(
    totalDeclarado.minus(totalConfirmado),
  );
  const pendienteDeclarar = roundHalfUp2(totalObligado.minus(totalDeclarado));
  const maxNuevaDeclaracion = pendienteDeclarar.gt(0)
    ? pendienteDeclarar
    : cajaZero();
  const pendienteAplicar = roundHalfUp2(totalConfirmado.minus(totalAplicado));
  const totalPendienteObligaciones = roundHalfUp2(
    totalObligado.minus(totalAplicado),
  );

  return {
    totalBruto,
    totalComision,
    totalObligado,
    totalDeclarado,
    totalConfirmado,
    totalAplicado,
    pendienteAplicar,
    totalPendienteObligaciones,
    deudaPendienteEntregar,
    pendienteConfirmar,
    pendienteDeclarar,
    maxNuevaDeclaracion,
  };
}

export function estadoDeclaracion(args: {
  importeDeclarado: Prisma.Decimal;
  totalConfirmado: Prisma.Decimal;
}): CajaDeclaracionEstado {
  const conf = roundHalfUp2(args.totalConfirmado);
  if (conf.lte(0)) return "PENDIENTE";
  if (conf.gte(roundHalfUp2(args.importeDeclarado))) return "CONFIRMADA";
  return "PARCIAL";
}

export function totalesToFixed(t: CajaTotalesView): Record<string, string> {
  return {
    totalBruto: moneyFixed2(t.totalBruto),
    totalComision: moneyFixed2(t.totalComision),
    totalObligado: moneyFixed2(t.totalObligado),
    totalDeclarado: moneyFixed2(t.totalDeclarado),
    totalConfirmado: moneyFixed2(t.totalConfirmado),
    totalAplicado: moneyFixed2(t.totalAplicado),
    pendienteAplicar: moneyFixed2(t.pendienteAplicar),
    totalPendienteObligaciones: moneyFixed2(t.totalPendienteObligaciones),
    deudaPendienteEntregar: moneyFixed2(t.deudaPendienteEntregar),
    pendienteConfirmar: moneyFixed2(t.pendienteConfirmar),
    pendienteDeclarar: moneyFixed2(t.pendienteDeclarar),
    maxNuevaDeclaracion: moneyFixed2(t.maxNuevaDeclaracion),
  };
}

export async function sumObligadoVendedor(
  db: Pick<PrismaClient, "cajaObligacion">,
  vendedorId: string,
): Promise<Prisma.Decimal> {
  const agg = await db.cajaObligacion.aggregate({
    where: { vendedorId },
    _sum: { importeAdmin: true },
  });
  return dec(agg._sum.importeAdmin);
}

export async function sumBrutoVendedor(
  db: Pick<PrismaClient, "cajaObligacion">,
  vendedorId: string,
): Promise<Prisma.Decimal> {
  const agg = await db.cajaObligacion.aggregate({
    where: { vendedorId },
    _sum: { bruto: true },
  });
  return dec(agg._sum.bruto);
}

export async function sumComisionVendedor(
  db: Pick<PrismaClient, "cajaObligacion">,
  vendedorId: string,
): Promise<Prisma.Decimal> {
  const agg = await db.cajaObligacion.aggregate({
    where: { vendedorId },
    _sum: { comisionImporte: true },
  });
  return dec(agg._sum.comisionImporte);
}

export async function sumDeclaradoVendedor(
  db: Pick<PrismaClient, "cajaDeclaracion">,
  vendedorId: string,
): Promise<Prisma.Decimal> {
  const agg = await db.cajaDeclaracion.aggregate({
    where: { vendedorId },
    _sum: { importeDeclarado: true },
  });
  return dec(agg._sum.importeDeclarado);
}

export async function sumConfirmadoVendedor(
  db: Pick<PrismaClient, "cajaConfirmacion" | "cajaDeclaracion">,
  vendedorId: string,
): Promise<Prisma.Decimal> {
  const decls = await db.cajaDeclaracion.findMany({
    where: { vendedorId },
    select: { id: true },
  });
  if (decls.length === 0) return cajaZero();
  const agg = await db.cajaConfirmacion.aggregate({
    where: { declaracionId: { in: decls.map((d) => d.id) } },
    _sum: { importeConfirmado: true },
  });
  return dec(agg._sum.importeConfirmado);
}

export async function sumConfirmadoDeclaracion(
  db: Pick<PrismaClient, "cajaConfirmacion">,
  declaracionId: string,
): Promise<Prisma.Decimal> {
  const agg = await db.cajaConfirmacion.aggregate({
    where: { declaracionId },
    _sum: { importeConfirmado: true },
  });
  return dec(agg._sum.importeConfirmado);
}

export async function getTotalesVendedor(
  db: CajaResumenDb,
  vendedorId: string,
): Promise<CajaTotalesView> {
  const id = vendedorId.trim();
  const [
    totalBruto,
    totalComision,
    totalObligado,
    totalDeclarado,
    totalConfirmado,
    totalAplicado,
  ] = await Promise.all([
    sumBrutoVendedor(db, id),
    sumComisionVendedor(db, id),
    sumObligadoVendedor(db, id),
    sumDeclaradoVendedor(db, id),
    sumConfirmadoVendedor(db, id),
    sumAplicadoVendedor(db, id),
  ]);
  return calcularTotalesCaja({
    totalBruto,
    totalComision,
    totalObligado,
    totalDeclarado,
    totalConfirmado,
    totalAplicado,
  });
}

export async function getResumenVendedor(
  db: CajaResumenDb,
  vendedorId: string,
): Promise<CajaResumenVendedorView> {
  const id = vendedorId.trim();
  const totales = await getTotalesVendedor(db, id);

  const declaracionesRaw = await db.cajaDeclaracion.findMany({
    where: { vendedorId: id },
    orderBy: [{ declaradoAt: "asc" }, { id: "asc" }],
    include: {
      confirmaciones: {
        orderBy: [{ confirmadoAt: "asc" }, { id: "asc" }],
      },
    },
  });

  const declaraciones: CajaDeclaracionView[] = [];
  const confirmaciones: CajaConfirmacionView[] = [];

  for (const d of declaracionesRaw) {
    let confSum = cajaZero();
    for (const c of d.confirmaciones) {
      confSum = confSum.plus(c.importeConfirmado);
      confirmaciones.push({
        id: c.id,
        declaracionId: c.declaracionId,
        importeConfirmado: roundHalfUp2(c.importeConfirmado),
        confirmadoPorAdminId: c.confirmadoPorAdminId,
        confirmadoAt: c.confirmadoAt,
      });
    }
    confSum = roundHalfUp2(confSum);
    const importeDeclarado = roundHalfUp2(d.importeDeclarado);
    const pendiente = roundHalfUp2(importeDeclarado.minus(confSum));
    declaraciones.push({
      id: d.id,
      vendedorId: d.vendedorId,
      importeDeclarado,
      declaradoAt: d.declaradoAt,
      nota: d.nota,
      totalConfirmado: confSum,
      pendienteConfirmar: pendiente.gt(0) ? pendiente : cajaZero(),
      estado: estadoDeclaracion({
        importeDeclarado,
        totalConfirmado: confSum,
      }),
    });
  }

  const [aplicacionesRaw, obligaciones] = await Promise.all([
    listAplicacionesVendedor(db, id),
    listSaldosObligacionesVendedor(db, id),
  ]);

  const oblById = new Map(obligaciones.map((o) => [o.obligacionId, o]));
  const aplicaciones = aplicacionesRaw.map((a) => {
    const obl = oblById.get(a.obligacionId);
    return obl
      ? {
          ...a,
          ticketId: obl.ticketId,
          ticketCreatedAt: obl.ticketCreatedAt,
        }
      : a;
  });

  return {
    vendedorId: id,
    totales,
    declaraciones,
    confirmaciones,
    aplicaciones,
    obligaciones,
  };
}

export async function listResumenesVendedores(
  db: CajaResumenDb &
    Pick<PrismaClient, "vendedorComision">,
): Promise<
  Array<{
    vendedorId: string;
    nombre: string | null;
    usuario: string | null;
    activo: boolean;
    comisionPorcentaje: string | null;
    totales: CajaTotalesView;
  }>
> {
  const vendedores = await db.usuario.findMany({
    where: { rol: "VENDEDOR" },
    select: { id: true, nombre: true, usuario: true, activo: true },
    orderBy: { usuario: "asc" },
  });

  const out: Array<{
    vendedorId: string;
    nombre: string | null;
    usuario: string | null;
    activo: boolean;
    comisionPorcentaje: string | null;
    totales: CajaTotalesView;
  }> = [];

  for (const v of vendedores) {
    const totales = await getTotalesVendedor(db, v.id);
    if (
      totales.totalObligado.eq(0) &&
      totales.totalDeclarado.eq(0) &&
      totales.totalConfirmado.eq(0) &&
      totales.totalAplicado.eq(0)
    ) {
      continue;
    }
    const comision = await db.vendedorComision.findUnique({
      where: { vendedorId: v.id },
      select: { porcentaje: true },
    });
    out.push({
      vendedorId: v.id,
      nombre: v.nombre,
      usuario: v.usuario,
      activo: v.activo,
      comisionPorcentaje: comision
        ? moneyFixed2(comision.porcentaje)
        : null,
      totales,
    });
  }
  return out;
}

/** Suma totales de varios vendedores (panel ADMIN global). */
export function agregarTotalesVendedores(
  rows: Array<{ totales: CajaTotalesView }>,
): CajaTotalesView {
  let totalBruto = cajaZero();
  let totalComision = cajaZero();
  let totalObligado = cajaZero();
  let totalDeclarado = cajaZero();
  let totalConfirmado = cajaZero();
  let totalAplicado = cajaZero();
  for (const r of rows) {
    totalBruto = totalBruto.plus(r.totales.totalBruto);
    totalComision = totalComision.plus(r.totales.totalComision);
    totalObligado = totalObligado.plus(r.totales.totalObligado);
    totalDeclarado = totalDeclarado.plus(r.totales.totalDeclarado);
    totalConfirmado = totalConfirmado.plus(r.totales.totalConfirmado);
    totalAplicado = totalAplicado.plus(r.totales.totalAplicado);
  }
  return calcularTotalesCaja({
    totalBruto,
    totalComision,
    totalObligado,
    totalDeclarado,
    totalConfirmado,
    totalAplicado,
  });
}
