/**
 * Helpers de TX para créditos: detección UNIQUE y compensación de saldo
 * si el insert del movimiento falla tras un ajuste ya aplicado.
 */
import { Prisma } from "@prisma/client";
import type { CreditosStore, NuevoCreditoMovimiento } from "@/lib/creditos/store";
import type { CreditoMovimientoView } from "@/lib/creditos/types";
import { movimientoSaldosCoherentesConTipo } from "@/lib/creditos/control";
import { CreditoValidationError } from "@/lib/creditos/errors";

export function isCreditoUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "P2002";
}

/**
 * Ajusta saldo e inserta movimiento. Si el insert choca con UNIQUE,
 * revierte el delta de saldo y delega en `onUnique` (replay / conflicto).
 *
 * Crítico para no dejar saldo desalineado del libro cuando exista
 * carrera o reintento concurrente (Postgres).
 */
export async function ajustarEInsertarMovimiento(
  tx: CreditosStore,
  args: {
    vendedorId: string;
    delta: Prisma.Decimal;
    ahora: Date;
    buildMovimiento: (saldos: {
      saldoAnterior: Prisma.Decimal;
      saldoPosterior: Prisma.Decimal;
    }) => NuevoCreditoMovimiento;
    onUnique: () => Promise<CreditoMovimientoView>;
  },
): Promise<CreditoMovimientoView> {
  const saldos = await tx.ajustarSaldoAtomico({
    vendedorId: args.vendedorId,
    delta: args.delta,
    ahora: args.ahora,
  });

  const mov = args.buildMovimiento(saldos);
  if (
    !movimientoSaldosCoherentesConTipo({
      tipo: mov.tipo,
      importe: mov.importe,
      saldoAnterior: mov.saldoAnterior,
      saldoPosterior: mov.saldoPosterior,
    })
  ) {
    // Revertir antes de fallar para no dejar saldo huérfano en la TX en memoria.
    await tx.ajustarSaldoAtomico({
      vendedorId: args.vendedorId,
      delta: args.delta.negated(),
      ahora: args.ahora,
    });
    throw new CreditoValidationError(
      "Saldos del movimiento incoherentes con el tipo.",
      "CREDITO_SALDOS_INCOHERENTES",
    );
  }

  try {
    return await tx.insertMovimiento(mov);
  } catch (error) {
    if (!isCreditoUniqueViolation(error)) throw error;

    await tx.ajustarSaldoAtomico({
      vendedorId: args.vendedorId,
      delta: args.delta.negated(),
      ahora: args.ahora,
    });
    return args.onUnique();
  }
}
