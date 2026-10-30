/** Clave UUID de idempotencia para mutaciones administrativas de créditos. */

export function nuevaIdempotencyKeyCredito(): string {
  return crypto.randomUUID();
}

/**
 * Conserva la key mientras la huella de la operación no cambie.
 * Ante error de red ambiguo, no regenerar (reintento seguro).
 */
export function fingerprintOperacionCredito(parts: {
  tipo: "ASIGNAR" | "RETIRAR" | "CORREGIR";
  vendedorId: string;
  importe: string;
  motivo: string;
  efecto?: string;
  movimientoOrigenId?: string;
}): string {
  return [
    parts.tipo,
    parts.vendedorId,
    parts.importe.trim(),
    parts.motivo.trim(),
    parts.efecto ?? "",
    parts.movimientoOrigenId ?? "",
  ].join("|");
}
