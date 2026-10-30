/**
 * Enganche de consumo de créditos tras emitir un ticket (misma TX).
 * No decide política de negocio duplicada: usa ventaSujetaAControlCreditos.
 *
 * Fail-closed: esquema ausente o config no persistida no autorizan omitir el control.
 */
import { Prisma, type RolUsuario } from "@prisma/client";
import { getCreditosConfig } from "@/lib/creditos/config";
import { ventaSujetaAControlCreditos } from "@/lib/creditos/control";
import {
  CreditosConfigIncompleteError,
} from "@/lib/creditos/errors";
import { consumirCreditosPorVenta } from "@/lib/creditos/operaciones";
import { rethrowCreditosSchemaOrPropagate } from "@/lib/creditos/schema-guard";
import type { CreditosStore } from "@/lib/creditos/store";

export type ConsumoTrasEmitirResult =
  | { status: "skipped" }
  | { status: "consumed"; movimientoId: string };

/**
 * Si la venta está sujeta al control, consume exactamente `totalApostado`.
 * Debe invocarse dentro de la misma transacción que creó el ticket.
 *
 * Errores de esquema / infra se propagan → rollback de la TX de emisión.
 * InsufficientCreditoSaldoError y demás errores de dominio no se reetiquetan.
 */
export async function consumirCreditosTrasEmitirTicket(
  store: CreditosStore,
  args: {
    actorRol: RolUsuario;
    vendedorId: string | null | undefined;
    ticketId: string;
    ticketCreatedAt: Date;
    totalApostado: Prisma.Decimal | string;
    ahora?: Date;
  },
): Promise<ConsumoTrasEmitirResult> {
  // Exención ADMIN y tickets sin vendedor: no requieren leer config
  // (permite emitir ADMIN aunque el esquema de créditos falle).
  if (args.actorRol === "ADMIN") {
    return { status: "skipped" };
  }
  if (!args.vendedorId?.trim()) {
    return { status: "skipped" };
  }

  let config;
  try {
    config = await getCreditosConfig(store);
  } catch (error) {
    rethrowCreditosSchemaOrPropagate(error);
  }

  // Defaults virtuales (sin fila id=1) ≠ control desactivado de forma explícita.
  if (!config.configPersisted) {
    throw new CreditosConfigIncompleteError();
  }

  if (
    !ventaSujetaAControlCreditos({
      config,
      actorRol: args.actorRol,
      vendedorId: args.vendedorId,
      ticketCreatedAt: args.ticketCreatedAt,
    })
  ) {
    return { status: "skipped" };
  }

  const vendedorId = args.vendedorId.trim();
  try {
    const { movimiento } = await consumirCreditosPorVenta(store, {
      vendedorId,
      ticketId: args.ticketId,
      importe: args.totalApostado,
      ahora: args.ahora,
    });
    return { status: "consumed", movimientoId: movimiento.id };
  } catch (error) {
    rethrowCreditosSchemaOrPropagate(error);
  }
}
