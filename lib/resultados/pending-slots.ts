import {
  HORAS_SORTEO,
  fechaHoyParaPrisma,
  haLlegadoFranja,
} from "@/lib/fecha";

export type DrawSlot = {
  fecha: Date;
  hora: number;
};

/**
 * Franjas del día calendario America/Caracas cuya hora ya llegó
 * (incluye la hora en curso). No incluye horas futuras.
 */
export function listDueDrawSlots(ahora = new Date()): DrawSlot[] {
  const fecha = fechaHoyParaPrisma(ahora);
  const slots: DrawSlot[] = [];
  for (const hora of HORAS_SORTEO) {
    if (haLlegadoFranja(hora, ahora)) {
      slots.push({ fecha, hora });
    }
  }
  return slots;
}
