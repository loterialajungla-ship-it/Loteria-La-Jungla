/**
 * Estado del POS: Record<hora, Record<numeroAnimal, importeString>>
 * Equivalente serializable a Map<hora, Map<numeroAnimal, importe>>.
 */

export type PosApuestas = Record<string, Record<string, string>>;

export function toggleHora(apuestas: PosApuestas, hora: number): PosApuestas {
  const key = String(hora);
  if (key in apuestas) {
    const siguiente = { ...apuestas };
    delete siguiente[key];
    return siguiente;
  }
  return { ...apuestas, [key]: { ...(apuestas[key] ?? {}) } };
}

/** Upsert: misma hora+animal actualiza importe; no duplica. */
export function upsertLinea(
  apuestas: PosApuestas,
  hora: number,
  numeroAnimal: string,
  importe: string,
): PosApuestas {
  const key = String(hora);
  const porHora = { ...(apuestas[key] ?? {}) };
  porHora[numeroAnimal] = importe;
  return { ...apuestas, [key]: porHora };
}

export function eliminarLinea(
  apuestas: PosApuestas,
  hora: number,
  numeroAnimal: string,
): PosApuestas {
  const key = String(hora);
  const porHora = { ...(apuestas[key] ?? {}) };
  delete porHora[numeroAnimal];
  return { ...apuestas, [key]: porHora };
}

export function contarLineas(apuestas: PosApuestas): number {
  let n = 0;
  for (const porHora of Object.values(apuestas)) {
    n += Object.keys(porHora).length;
  }
  return n;
}

/** Total orientativo UX (string con 2 decimales). No es fuente de verdad. */
export function totalOrientativo(apuestas: PosApuestas): string {
  let centavos = 0;
  for (const porHora of Object.values(apuestas)) {
    for (const importe of Object.values(porHora)) {
      const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(importe.trim());
      if (!m) continue;
      const enteros = Number(m[1]);
      const frac = (m[2] ?? "").padEnd(2, "0").slice(0, 2);
      centavos += enteros * 100 + Number(frac || "0");
    }
  }
  const enteros = Math.floor(centavos / 100);
  const frac = String(centavos % 100).padStart(2, "0");
  return `${enteros}.${frac}`;
}

export function apuestasALineasApi(apuestas: PosApuestas): {
  hora: number;
  numeroAnimal: string;
  importe: string;
}[] {
  const lineas: { hora: number; numeroAnimal: string; importe: string }[] = [];
  const horas = Object.keys(apuestas)
    .map(Number)
    .sort((a, b) => a - b);

  for (const hora of horas) {
    const porHora = apuestas[String(hora)] ?? {};
    const animales = Object.keys(porHora).sort();
    for (const numeroAnimal of animales) {
      const importe = normalizarImporteUi(porHora[numeroAnimal] ?? "");
      if (!importe) continue;
      lineas.push({ hora, numeroAnimal, importe });
    }
  }
  return lineas;
}

/** Normaliza a "X.XX" o "" si inválido/vacío. */
export function normalizarImporteUi(raw: string): string {
  const t = raw.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(t)) return "";
  const [a, b = ""] = t.split(".");
  if (a === "0" && (!b || Number(b) === 0)) return "";
  return `${a}.${b.padEnd(2, "0").slice(0, 2)}`;
}

export function puedeCrearTicket(apuestas: PosApuestas): boolean {
  if (Object.keys(apuestas).length === 0) return false;
  const lineas = apuestasALineasApi(apuestas);
  return lineas.length > 0;
}

export function formatearFechaUi(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) return yyyyMmDd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function etiquetaHora(hora: number): string {
  return `${String(hora).padStart(2, "0")}:00`;
}
