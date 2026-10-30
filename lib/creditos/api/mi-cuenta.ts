/**
 * Consulta de créditos del actor autenticado (VENDEDOR o ADMIN).
 * Nunca acepta vendedorId del cliente: usa session.userId.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { getCreditosConfig } from "@/lib/creditos/config";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import { parseHistorialQuery } from "@/lib/creditos/api/parse";
import {
  serializeCuentaBasica,
  serializeMovimiento,
  type CreditoMovimientoPublic,
} from "@/lib/creditos/api/serialize";
import { toCreditoDecimal } from "@/lib/creditos/money";

type Db = Pick<
  PrismaClient,
  "usuario" | "vendedorCreditoCuenta" | "creditoMovimiento" | "creditosConfig"
>;

export type MiCuentaCreditosResult = {
  activo: boolean;
  cuenta: ReturnType<typeof serializeCuentaBasica>;
  movimientos: CreditoMovimientoPublic[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export async function getMiCuentaCreditos(
  db: Db,
  args: {
    /** Identidad de sesión — no proviene del cliente. */
    sessionUserId: string;
    searchParams: URLSearchParams;
  },
): Promise<MiCuentaCreditosResult> {
  const userId = args.sessionUserId.trim();
  const user = await db.usuario.findUnique({
    where: { id: userId },
    select: { id: true, activo: true },
  });
  // Sesión ya validó activo; refuerzo defensivo.
  const activo = user?.activo === true;

  const hist = parseHistorialQuery(args.searchParams);
  const store = createPrismaCreditosStore(db as never);
  const config = await getCreditosConfig(store);
  const cuenta = await db.vendedorCreditoCuenta.findUnique({
    where: { vendedorId: userId },
  });

  const where: Prisma.CreditoMovimientoWhereInput = {
    vendedorId: userId,
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
    activo,
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
  };
}
