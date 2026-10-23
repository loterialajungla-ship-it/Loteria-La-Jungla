/**
 * Helpers de presentación para el panel admin de resultados + exposición.
 * No calculan exposición ni premios: solo formatean datos ya obtenidos.
 */

export type AnimalOpcion = {
  numero: string;
  nombre: string;
};

export type OrigenResultadoUi = "MANUAL" | "AUTOMATICO";

export type ResultadoActual = {
  numero: string;
  nombre: string;
  origen?: OrigenResultadoUi;
};

export function etiquetaOrigenResultado(
  origen: OrigenResultadoUi | null | undefined,
): { label: string; tone: "info" | "neutral" } | null {
  if (origen === "AUTOMATICO") {
    return { label: "Automático", tone: "info" };
  }
  if (origen === "MANUAL") {
    return { label: "Manual", tone: "neutral" };
  }
  return null;
}

/** Etiqueta "03 - Ciempiés" a partir del catálogo Animal. */
export function etiquetaResultadoAnimal(
  animales: readonly AnimalOpcion[],
  numero: string,
): ResultadoActual | null {
  const n = numero.trim();
  if (!n) return null;
  const animal = animales.find((a) => a.numero === n);
  if (!animal) {
    return { numero: n, nombre: "" };
  }
  return { numero: animal.numero, nombre: animal.nombre };
}

export function formatResultadoLabel(r: ResultadoActual | null): string | null {
  if (!r) return null;
  if (!r.nombre) return r.numero;
  return `${r.numero} - ${r.nombre}`;
}

export function estadoResultadoTexto(tieneResultado: boolean): "PENDIENTE" | "PUBLICADO" {
  return tieneResultado ? "PUBLICADO" : "PENDIENTE";
}

/** Resumen compacto desde ExposicionSorteo (strings ya formateadas a 2 decimales). */
export function resumenExposicionCompacto(args: {
  ticketsAfectados: number;
  totalApostado: string;
}): string {
  return `Tickets: ${args.ticketsAfectados} · Jugado: $${args.totalApostado}`;
}

export type ResultadoApiOk = {
  ok: true;
  resultado: {
    hora: number;
    numero: string;
    nombre: string;
    origen?: OrigenResultadoUi;
  };
};

export type ResultadoApiError = {
  ok?: false;
  error?: string | { message?: string; code?: string };
};

export function mensajeErrorResultado(data: ResultadoApiError): string {
  if (typeof data.error === "string" && data.error.trim()) {
    return data.error.trim();
  }
  if (
    data.error &&
    typeof data.error === "object" &&
    typeof data.error.message === "string" &&
    data.error.message.trim()
  ) {
    return data.error.message.trim();
  }
  return "No se pudo guardar el resultado.";
}

/** Extrae código de error estructurado de la API de resultados. */
export function codigoErrorResultado(data: ResultadoApiError): string | null {
  if (
    data.error &&
    typeof data.error === "object" &&
    typeof data.error.code === "string" &&
    data.error.code.trim()
  ) {
    return data.error.code.trim();
  }
  return null;
}

export function parseResultadoApiOk(data: unknown): ResultadoApiOk | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.ok !== true) return null;
  const r = d.resultado;
  if (!r || typeof r !== "object") return null;
  const resultado = r as Record<string, unknown>;
  if (
    typeof resultado.numero !== "string" ||
    typeof resultado.nombre !== "string" ||
    typeof resultado.hora !== "number"
  ) {
    return null;
  }
  const origenRaw = resultado.origen;
  const origen: OrigenResultadoUi | undefined =
    origenRaw === "MANUAL" || origenRaw === "AUTOMATICO"
      ? origenRaw
      : undefined;

  return {
    ok: true,
    resultado: {
      hora: resultado.hora,
      numero: resultado.numero,
      nombre: resultado.nombre,
      ...(origen ? { origen } : {}),
    },
  };
}
