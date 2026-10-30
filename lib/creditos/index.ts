/**
 * Sistema de créditos de vendedores — dominio + API admin/mi-cuenta.
 *
 * Consumo/devolución cableados a createTicket / anularTicket.
 * API: `lib/creditos/api/*` y rutas `/api/admin/creditos`, `/api/creditos/mi-cuenta`.
 *
 * Coherencia saldo ↔ libro: `cuentaCoherenteConLibro` /
 * `saldoEsperadoDesdeMovimientos` en control.ts.
 */

export * from "@/lib/creditos/errors";
export * from "@/lib/creditos/money";
export * from "@/lib/creditos/control";
export * from "@/lib/creditos/types";
export {
  createMemoryCreditosStore,
  type CreditosStore,
  type NuevoCreditoMovimiento,
} from "@/lib/creditos/store";
export {
  createPrismaCreditosStore,
  type CreatePrismaCreditosStoreOptions,
} from "@/lib/creditos/prisma-store";
export {
  ajustarEInsertarMovimiento,
  isCreditoUniqueViolation,
} from "@/lib/creditos/tx-helpers";
export {
  ensureVendedorCreditoCuenta,
  asignarCreditos,
  retirarCreditos,
  registrarCorreccionCredito,
  consumirCreditosPorVenta,
  devolverCreditosPorAnulacion,
  consultarSaldoYHistorial,
} from "@/lib/creditos/operaciones";
export {
  getCreditosConfig,
  getCreditosControlSnapshot,
  actualizarCreditosConfig,
} from "@/lib/creditos/config";
export {
  consumirCreditosTrasEmitirTicket,
  type ConsumoTrasEmitirResult,
} from "@/lib/creditos/aplicar-en-venta";
export {
  isCreditosSchemaMissing,
  rethrowCreditosSchemaOrPropagate,
} from "@/lib/creditos/schema-guard";
