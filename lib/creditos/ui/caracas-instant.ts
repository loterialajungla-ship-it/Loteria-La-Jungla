/**
 * Conversión inequívoca Caracas ↔ ISO con offset.
 * America/Caracas es UTC−04:00 todo el año (sin DST).
 */

export const CARACAS_OFFSET = "-04:00";

/**
 * `fecha` = YYYY-MM-DD, `hora` = HH:mm → ISO con zona -04:00.
 */
export function caracasLocalToIsoOffset(
  fecha: string,
  hora: string,
): string | null {
  const f = fecha.trim();
  const h = hora.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  if (!/^\d{2}:\d{2}$/.test(h)) return null;
  const iso = `${f}T${h}:00.000${CARACAS_OFFSET}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return iso;
}

/** Descompone un ISO (cualquier zona) a fecha/hora de pared en Caracas. */
export function isoToCaracasLocalParts(iso: string): {
  fecha: string;
  hora: string;
} | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  const fecha = `${parts.year}-${parts.month}-${parts.day}`;
  const hora = `${parts.hour}:${parts.minute}`;
  return { fecha, hora };
}

export function formatearInstanteVe(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-VE", {
      timeZone: "America/Caracas",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
