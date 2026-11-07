export {
  CAJA_IMPORTE_MAX,
  COMISION_PORCENTAJE_DEFAULT,
  cajaZero,
  calcularSplitComision,
  moneyFixed2,
  parseImporteCajaNoNegativo,
  parseImporteCajaPositivo,
  parsePorcentajeComision,
  roundHalfUp2,
  toCajaDecimal,
} from "@/lib/caja/money";
export type { SplitComision } from "@/lib/caja/money";

export {
  CajaError,
  CajaForbiddenError,
  CajaIdempotencyConflictError,
  CajaNotFoundError,
  CajaValidationError,
} from "@/lib/caja/errors";

export type {
  ActivarCajaResult,
  CajaAplicacionView,
  CajaConfigView,
  CajaConfirmacionView,
  CajaDeclaracionEstado,
  CajaDeclaracionView,
  CajaObligacionSaldoView,
  CajaObligacionView,
  CajaResumenVendedorView,
  CajaTotalesView,
  VendedorComisionHistorialView,
  VendedorComisionView,
} from "@/lib/caja/types";

export { activarCaja, getCajaConfig } from "@/lib/caja/config";
export type { CajaConfigDb } from "@/lib/caja/config";

export {
  ensureComisionInicialSiAusente,
  ensureComisionParaVendedorNuevoSiCajaActiva,
  getComisionVigente,
  listComisionHistorial,
  lockVendedorComisionForUpdate,
  lockVendedorUsuarioForUpdate,
  setComisionVendedor,
} from "@/lib/caja/comision";
export type { ComisionDb, ComisionTx } from "@/lib/caja/comision";

export {
  assertVendedorElegibleParaAtribucion,
  debeGenerarObligacion,
  maybeCreateCajaObligacionEnTx,
} from "@/lib/caja/obligacion";
export type { ObligacionTx } from "@/lib/caja/obligacion";

export {
  agregarTotalesVendedores,
  calcularTotalesCaja,
  estadoDeclaracion,
  getResumenVendedor,
  getTotalesVendedor,
  listResumenesVendedores,
  sumBrutoVendedor,
  sumComisionVendedor,
  sumConfirmadoDeclaracion,
  sumConfirmadoVendedor,
  sumDeclaradoVendedor,
  sumObligadoVendedor,
  totalesToFixed,
} from "@/lib/caja/resumen";
export type { CajaResumenDb } from "@/lib/caja/resumen";

export {
  crearDeclaracionVendedor,
  hashDeclaracionRequest,
  listDeclaracionesVendedor,
} from "@/lib/caja/declaracion";
export type {
  CrearDeclaracionResult,
  DeclaracionDb,
} from "@/lib/caja/declaracion";

export {
  crearConfirmacionAdmin,
  hashConfirmacionRequest,
} from "@/lib/caja/confirmacion";
export type {
  ConfirmacionDb,
  CrearConfirmacionResult,
} from "@/lib/caja/confirmacion";

export {
  distribuirConfirmacionFifoEnTx,
  listAplicacionesConfirmacion,
  listAplicacionesObligacion,
  listAplicacionesVendedor,
  listSaldosObligacionesVendedor,
  lockConfirmacionForUpdate,
  lockObligacionesFifoForUpdate,
  mapAplicacion,
  planFifoAplicaciones,
  sumAplicadoConfirmacion,
  sumAplicadoObligacion,
  sumAplicadoVendedor,
} from "@/lib/caja/aplicacion";
export type { AplicacionDb } from "@/lib/caja/aplicacion";

export { mapCajaErrorToHttp } from "@/lib/caja/map-caja-http-error";
export type { CajaHttpErrorBody } from "@/lib/caja/map-caja-http-error";

export {
  serializeAplicacion,
  serializeConfirmacion,
  serializeDeclaracion,
  serializeObligacionSaldo,
  serializeResumenVendedor,
  serializeTotales,
} from "@/lib/caja/serializers";
