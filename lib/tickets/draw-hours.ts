import { HORAS_SORTEO, ahoraVenezuela } from "@/lib/fecha";

export type MotivoCierreHora = "HORA_LLEGADA" | "RESULTADO_PUBLICADO";

export type HoraDisponibilidad = {
  hora: number;
  abierta: boolean;
  motivoCierre?: MotivoCierreHora;
};

/**
 * Una hora está abierta para venta solo si:
 * - aún no ha llegado (horaActual < hora) en America/Caracas; y
 * - no existe Resultado para esa fecha+hora.
 *
 * La hora en curso (hora === horaActual) está CERRADA.
 */
export function esHoraAbiertaParaVenta(args: {
  hora: number;
  horaActualVe: number;
  horasConResultado: ReadonlySet<number> | readonly number[];
}): boolean {
  const conResultado =
    args.horasConResultado instanceof Set
      ? args.horasConResultado
      : new Set(args.horasConResultado);

  if (args.hora <= args.horaActualVe) return false;
  if (conResultado.has(args.hora)) return false;
  return true;
}

export function motivoCierreHora(args: {
  hora: number;
  horaActualVe: number;
  horasConResultado: ReadonlySet<number> | readonly number[];
}): MotivoCierreHora | undefined {
  const conResultado =
    args.horasConResultado instanceof Set
      ? args.horasConResultado
      : new Set(args.horasConResultado);

  if (conResultado.has(args.hora)) return "RESULTADO_PUBLICADO";
  if (args.hora <= args.horaActualVe) return "HORA_LLEGADA";
  return undefined;
}

export function listarDisponibilidadHoras(args: {
  horaActualVe: number;
  horasConResultado: ReadonlySet<number> | readonly number[];
}): HoraDisponibilidad[] {
  return HORAS_SORTEO.map((hora) => {
    const abierta = esHoraAbiertaParaVenta({
      hora,
      horaActualVe: args.horaActualVe,
      horasConResultado: args.horasConResultado,
    });
    return {
      hora,
      abierta,
      motivoCierre: abierta
        ? undefined
        : motivoCierreHora({
            hora,
            horaActualVe: args.horaActualVe,
            horasConResultado: args.horasConResultado,
          }),
    };
  });
}

export function horaActualVenezuela(ahora = new Date()): number {
  return ahoraVenezuela(ahora).hour;
}
