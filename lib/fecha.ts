/** Zona horaria de los sorteos. Usar esta misma fuente en admin y en la web pública. */
export const ZONA_HORARIA_VE = "America/Caracas";

/** 11 sorteos diarios, uno por hora. */
export const HORAS_SORTEO = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;

export type FechaHoraVE = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function valorParte(
  partes: Intl.DateTimeFormatPart[],
  tipo: Intl.DateTimeFormatPartTypes,
): string {
  return partes.find((parte) => parte.type === tipo)?.value ?? "0";
}

export function ahoraVenezuela(ahora = new Date()): FechaHoraVE {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_HORARIA_VE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ahora);

  return {
    year: Number(valorParte(partes, "year")),
    month: Number(valorParte(partes, "month")),
    day: Number(valorParte(partes, "day")),
    hour: Number(valorParte(partes, "hour")),
    minute: Number(valorParte(partes, "minute")),
  };
}

/** Medianoche UTC del día calendario en Venezuela — para filtrar `Resultado.fecha` (@db.Date). */
export function fechaHoyParaPrisma(ahora = new Date()): Date {
  const { year, month, day } = ahoraVenezuela(ahora);
  return new Date(Date.UTC(year, month - 1, day));
}

/** `YYYY-MM-DD` del día calendario en Venezuela (para date pickers). */
export function hoyYYYYMMDD(ahora = new Date()): string {
  const { year, month, day } = ahoraVenezuela(ahora);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Convierte `YYYY-MM-DD` a medianoche UTC para `Resultado.fecha` (@db.Date). */
export function parseFechaYYYYMMDD(valor: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const fecha = new Date(Date.UTC(year, month - 1, day));

  if (
    fecha.getUTCFullYear() !== year ||
    fecha.getUTCMonth() !== month - 1 ||
    fecha.getUTCDate() !== day
  ) {
    return null;
  }

  return fecha;
}

export function fechaAYYYYMMDD(fecha: Date): string {
  const year = fecha.getUTCFullYear();
  const month = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const day = String(fecha.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatearFechaLargaDesdeDate(fecha: Date): string {
  const texto = new Intl.DateTimeFormat("es-VE", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(fecha);

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function formatearFechaLarga(ahora = new Date()): string {
  const texto = new Intl.DateTimeFormat("es-VE", {
    timeZone: ZONA_HORARIA_VE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(ahora);

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function formatearHoraSorteo(hora: number): string {
  const referencia = new Date(Date.UTC(2000, 0, 1, hora, 0, 0));
  return new Intl.DateTimeFormat("es-VE", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(referencia);
}

/** La franja ya empezó en Venezuela (incluye la hora en curso). */
export function haLlegadoFranja(horaFranja: number, ahora = new Date()): boolean {
  return horaFranja <= ahoraVenezuela(ahora).hour;
}

/** Suma/resta días sobre una fecha @db.Date (medianoche UTC). */
export function sumarDiasUTC(fecha: Date, dias: number): Date {
  const siguiente = new Date(fecha);
  siguiente.setUTCDate(siguiente.getUTCDate() + dias);
  return siguiente;
}

/**
 * Resuelve `?fecha=YYYY-MM-DD` para la página pública.
 * Inválida o futura → hoy (America/Caracas).
 */
export function resolverFechaConsulta(
  param: string | undefined,
  ahora = new Date(),
): { fecha: Date; fechaStr: string; esHoy: boolean } {
  const hoy = fechaHoyParaPrisma(ahora);
  const hoyStr = hoyYYYYMMDD(ahora);
  const parseada = typeof param === "string" ? parseFechaYYYYMMDD(param) : null;

  if (!parseada || parseada.getTime() > hoy.getTime()) {
    return { fecha: hoy, fechaStr: hoyStr, esHoy: true };
  }

  const fechaStr = fechaAYYYYMMDD(parseada);
  return {
    fecha: parseada,
    fechaStr,
    esHoy: fechaStr === hoyStr,
  };
}
