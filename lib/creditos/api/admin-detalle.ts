/**
 * Detalle de cuenta + historial paginado de un vendedor (ADMIN).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { getCreditosConfig } from "@/lib/creditos/config";
import { CreditoValidationError } from "@/lib/creditos/errors";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import { parseHistorialQuery } from "@/lib/creditos/api/parse";
import {
  serializeConfig,
  serializeCuentaBasica,
  serializeMovimiento,
  type CreditoMovimientoPublic,
} from "@/lib/creditos/api/serialize";
import { toCreditoDecimal } from "@/lib/creditos/money";

type Db = Pick<
  PrismaClient,
  | "usuario"
  | "vendedorCreditoCuenta"
  | "creditoMovimiento"
  | "creditosConfig"
>;

export type CreditoDetalleResult = {
  vendedor: {
    id: string;
    usuario: string;
    nombre: string;
    activo: boolean;
  };
  cuenta: ReturnType<typeof serializeCuentaBasica>;
  movimientos: CreditoMovimientoPublic[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  config: ReturnType<typeof serializeConfig>;
};

export async function getCreditoDetalleAdmin(
  db: Db,
  vendedorIdRaw: string,
  searchParams: URLSearchParams,
): Promise<CreditoDetalleResult> {
  const vendedorId = vendedorIdRaw.trim();
  if (!vendedorId) {
    throw new CreditoValidationError(
      "vendedorId requerido.",
      "CREDITO_VENDEDOR_NO_ENCONTRADO",
    );
  }

  const user = await db.usuario.findUnique({
    where: { id: vendedorId },
    select: { id: true, usuario: true, nombre: true, activo: true, rol: true },
  });
  if (!user || user.rol !== "VENDEDOR") {
    throw new CreditoValidationError(
      "Vendedor no encontrado.",
      "CREDITO_VENDEDOR_NO_ENCONTRADO",
    );
  }

  const hist = parseHistorialQuery(searchParams);
  const store = createPrismaCreditosStore(db as never);
  const config = await getCreditosConfig(store);
  const cuenta = await db.vendedorCreditoCuenta.findUnique({
    where: { vendedorId },
  });

  const where: Prisma.CreditoMovimientoWhereInput = {
    vendedorId,
    ...(hist.tipo ? { tipo: hist.tipo } : {}),
    ...(hist.ticketId ? { ticketId: hist.ticketId } : {}),
    ...(hist.desde || hist.hasta
      ? {
          createdAt: {
            ...(hist.desde ? { gte: hist.desde } : {}),
            ...(hist.hasta ? { lte: hist.hasta } : {}),
          },
        }
      : {}),
  };

  const total = await db.creditoMovimiento.count({ where });
  const totalPages = total === 0 ? 0 : Math.ceil(total / hist.pageSize);
  const rows = await db.creditoMovimiento.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (hist.page - 1) * hist.pageSize,
    take: hist.pageSize,
  });

  return {
    vendedor: {
      id: user.id,
      usuario: user.usuario,
      nombre: user.nombre,
      activo: user.activo,
    },
    cuenta: serializeCuentaBasica(
      cuenta
        ? {
            vendedorId: cuenta.vendedorId,
            saldoDisponible: toCreditoDecimal(cuenta.saldoDisponible),
            createdAt: cuenta.createdAt,
            updatedAt: cuenta.updatedAt,
          }
        : null,
      config.umbralSaldoBajo,
    ),
    movimientos: rows.map((row) =>
      serializeMovimiento({
        id: row.id,
        vendedorId: row.vendedorId,
        tipo: row.tipo,
        importe: toCreditoDecimal(row.importe),
        saldoAnterior: toCreditoDecimal(row.saldoAnterior),
        saldoPosterior: toCreditoDecimal(row.saldoPosterior),
        createdAt: row.createdAt,
        actorAdminId: row.actorAdminId,
        ticketId: row.ticketId,
        movimientoOrigenId: row.movimientoOrigenId,
        motivo: row.motivo,
        idempotencyKey: row.idempotencyKey,
      }),
    ),
    page: hist.page,
    pageSize: hist.pageSize,
    total,
    totalPages,
    config: serializeConfig(config),
  };
}
