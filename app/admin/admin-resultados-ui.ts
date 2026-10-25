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
  kind: "resultado";
  resultado: {
    hora: number;
    numero: string;
    nombre: string;
    origen?: OrigenResultadoUi;
  };
};

export type ProgramacionApiOk = {
  ok: true;
  kind: "programacion";
  programacion: {
    action: "created" | "updated" | "cancelled";
    hora: number;
    numero: string;
    nombre: string;
    estado: string;
  };
};

export type AdminResultadosApiOk = ResultadoApiOk | ProgramacionApiOk;

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
  // Una respuesta de programación válida no es un resultado publicado.
  if (d.programacion != null && d.resultado == null) return null;
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
    kind: "resultado",
    resultado: {
      hora: resultado.hora,
      numero: resultado.numero,
      nombre: resultado.nombre,
      ...(origen ? { origen } : {}),
    },
  };
}

const PROGRAMACION_ACTIONS = new Set(["created", "updated", "cancelled"]);

export function parseProgramacionApiOk(
  data: unknown,
): ProgramacionApiOk | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.ok !== true) return null;
  if (d.resultado != null) return null;
  const p = d.programacion;
  if (!p || typeof p !== "object") return null;
  const programacion = p as Record<string, unknown>;
  if (
    typeof programacion.action !== "string" ||
    !PROGRAMACION_ACTIONS.has(programacion.action) ||
    typeof programacion.numero !== "string" ||
    typeof programacion.nombre !== "string" ||
    typeof programacion.hora !== "number" ||
    typeof programacion.estado !== "string"
  ) {
    return null;
  }

  return {
    ok: true,
    kind: "programacion",
    programacion: {
      action: programacion.action as "created" | "updated" | "cancelled",
      hora: programacion.hora,
      numero: programacion.numero,
      nombre: programacion.nombre,
      estado: programacion.estado,
    },
  };
}

/** Éxito de POST /api/admin/resultados: resultado publicado o programación. */
export function parseAdminResultadosApiOk(
  data: unknown,
): AdminResultadosApiOk | null {
  return parseResultadoApiOk(data) ?? parseProgramacionApiOk(data);
}

export function mensajeExitoProgramacion(
  programacion: ProgramacionApiOk["programacion"],
): string {
  const label = programacion.nombre
    ? `${programacion.numero} — ${programacion.nombre}`
    : programacion.numero;
  if (programacion.action === "cancelled") {
    return `Programación cancelada (${label}). No se publicará automáticamente.`;
  }
  if (programacion.action === "updated") {
    return `Programación actualizada: ${label}. Se publicará al llegar la hora.`;
  }
  return `Resultado programado: ${label}. Se publicará al llegar la hora (no es público aún).`;
}
