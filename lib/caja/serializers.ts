import { moneyFixed2 } from "@/lib/caja/money";
import { totalesToFixed } from "@/lib/caja/resumen";
import type {
  CajaAplicacionView,
  CajaConfirmacionView,
  CajaDeclaracionView,
  CajaObligacionSaldoView,
  CajaResumenVendedorView,
  CajaTotalesView,
} from "@/lib/caja/types";

export function serializeTotales(t: CajaTotalesView) {
  return totalesToFixed(t);
}

export function serializeDeclaracion(d: CajaDeclaracionView) {
  return {
    id: d.id,
    vendedorId: d.vendedorId,
    importeDeclarado: moneyFixed2(d.importeDeclarado),
    declaradoAt: d.declaradoAt.toISOString(),
    nota: d.nota,
    totalConfirmado: moneyFixed2(d.totalConfirmado),
    pendienteConfirmar: moneyFixed2(d.pendienteConfirmar),
    estado: d.estado,
  };
}

export function serializeConfirmacion(c: CajaConfirmacionView) {
  return {
    id: c.id,
    declaracionId: c.declaracionId,
    importeConfirmado: moneyFixed2(c.importeConfirmado),
    confirmadoPorAdminId: c.confirmadoPorAdminId,
    confirmadoAt: c.confirmadoAt.toISOString(),
  };
}

export function serializeAplicacion(a: CajaAplicacionView) {
  return {
    id: a.id,
    confirmacionId: a.confirmacionId,
    obligacionId: a.obligacionId,
    vendedorId: a.vendedorId,
    importeAplicado: moneyFixed2(a.importeAplicado),
    createdAt: a.createdAt.toISOString(),
    ticketId: a.ticketId ?? null,
    ticketCreatedAt: a.ticketCreatedAt
      ? a.ticketCreatedAt.toISOString()
      : null,
  };
}

export function serializeObligacionSaldo(o: CajaObligacionSaldoView) {
  return {
    obligacionId: o.obligacionId,
    ticketId: o.ticketId,
    ticketCreatedAt: o.ticketCreatedAt.toISOString(),
    vendedorId: o.vendedorId,
    bruto: moneyFixed2(o.bruto),
    comisionPorcentaje: moneyFixed2(o.comisionPorcentaje),
    comisionImporte: moneyFixed2(o.comisionImporte),
    importeAdmin: moneyFixed2(o.importeAdmin),
    totalAplicado: moneyFixed2(o.totalAplicado),
    pendiente: moneyFixed2(o.pendiente),
  };
}

export function serializeResumenVendedor(r: CajaResumenVendedorView) {
  return {
    vendedorId: r.vendedorId,
    totales: serializeTotales(r.totales),
    declaraciones: r.declaraciones.map(serializeDeclaracion),
    confirmaciones: r.confirmaciones.map(serializeConfirmacion),
    aplicaciones: r.aplicaciones.map(serializeAplicacion),
    obligaciones: r.obligaciones.map(serializeObligacionSaldo),
  };
}
