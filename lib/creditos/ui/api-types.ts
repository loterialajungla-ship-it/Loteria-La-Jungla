/** Tipos de respuesta HTTP de la API de créditos (solo lo que expone el contrato). */

export type CreditosConfigPublic = {
  /** false = fila singleton ausente (defaults virtuales; no es “control apagado”). */
  configPersisted: boolean;
  controlActivo: boolean;
  inicioEn: string | null;
  umbralSaldoBajo: string | null;
  updatedAt: string;
  updatedByAdminId: string | null;
};

export type CreditoResumenItem = {
  vendedorId: string;
  usuario: string;
  nombre: string;
  activo: boolean;
  tieneCuenta: boolean;
  saldoDisponible: string;
  totalAsignado: string;
  totalRetirado: string;
  totalConsumidoVentas: string;
  totalDevueltoAnulaciones: string;
  totalCorreccionesAumento: string;
  totalCorreccionesDisminucion: string;
  ultimaActividadCreditosAt: string | null;
  saldoBajo: boolean;
};

export type CreditosResumenResponse = {
  ok: true;
  items: CreditoResumenItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  config: CreditosConfigPublic;
};

export type CreditoMovimientoPublic = {
  id: string;
  tipo: string;
  importe: string;
  saldoAnterior: string;
  saldoPosterior: string;
  createdAt: string;
  motivo: string | null;
  actorAdminId: string | null;
  ticketId: string | null;
  movimientoOrigenId: string | null;
};

export type CreditoDetalleResponse = {
  ok: true;
  vendedor: {
    id: string;
    usuario: string;
    nombre: string;
    activo: boolean;
  };
  cuenta: {
    saldoDisponible: string;
    tieneCuenta: boolean;
    saldoBajo: boolean;
    umbralSaldoBajo: string | null;
  };
  movimientos: CreditoMovimientoPublic[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  config: CreditosConfigPublic;
};

export type ApiErrorBody = {
  ok?: false;
  error?: { code?: string; message?: string };
};

export function tipoMovimientoLabel(tipo: string): string {
  switch (tipo) {
    case "ASIGNACION":
      return "Asignación";
    case "RETIRO":
      return "Retiro";
    case "CONSUMO_VENTA":
      return "Consumo venta";
    case "DEVOLUCION_ANULACION":
      return "Devolución anulación";
    case "CORRECCION":
      return "Corrección";
    default:
      return tipo;
  }
}
