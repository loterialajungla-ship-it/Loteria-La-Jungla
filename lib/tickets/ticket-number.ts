import { fechaAYYYYMMDD } from "@/lib/fecha";

/**
 * Formato: LJ-YYYYMMDD-NNNNNN (secuencia diaria 1-based, 6 dígitos).
 */
export function formatearNumeroVisible(
  fechaJuego: Date,
  secuencia: number,
): string {
  if (!Number.isInteger(secuencia) || secuencia < 1) {
    throw new Error(`Secuencia de ticket inválida: ${secuencia}`);
  }

  const yyyymmdd = fechaAYYYYMMDD(fechaJuego).replace(/-/g, "");
  const nnnnnn = String(secuencia).padStart(6, "0");
  return `LJ-${yyyymmdd}-${nnnnnn}`;
}
