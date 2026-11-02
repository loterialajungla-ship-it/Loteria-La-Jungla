/**
 * Modelo puro del saldo POS (sin React).
 * El POS nunca calcula ni autoriza: solo presenta lo que devolvió la API.
 */
import type {
  ApiErrorBody,
  MiCuentaConfigPublic,
  MiCuentaCreditosResponse,
  MiCuentaCuentaPublic,
} from "@/lib/creditos/ui/api-types";

export const MI_CUENTA_SALDO_QUERY = "page=1&pageSize=1";

export type MiCuentaSaldoData = {
  activo: boolean;
  config: MiCuentaConfigPublic;
  cuenta: MiCuentaCuentaPublic;
};

export type MiCuentaSaldoState = {
  /** True mientras hay una petición en vuelo (incluida la inicial). */
  loading: boolean;
  /** Hay data previa pero el último refresh falló. */
  stale: boolean;
  error: string | null;
  data: MiCuentaSaldoData | null;
  /** Identificador de la última petición aceptada o en curso. */
  latestRequestId: number;
};

export type PosSaldoVisualKind =
  | "loading"
  | "error"
  | "config_ausente"
  | "control_inactivo"
  | "sin_cuenta"
  | "saldo";

export type PosSaldoViewModel = {
  kind: PosSaldoVisualKind;
  /** Línea principal legible. */
  primary: string;
  /** Línea secundaria opcional (p. ej. inicioEn). */
  secondary: string | null;
  showSaldoBajo: boolean;
  stale: boolean;
  error: string | null;
  canRetry: boolean;
  /**
   * Petición en curso (inicial o refresco).
   * Con data previa el saldo anterior sigue visible y `updating` es true.
   */
  busy: boolean;
  /** Refresco con data previa: mostrar «Actualizando saldo…». */
  updating: boolean;
};

export function initialMiCuentaSaldoState(): MiCuentaSaldoState {
  return {
    /** True hasta el primer ciclo del hook: evita flash de error antes del useEffect. */
    loading: true,
    stale: false,
    error: null,
    data: null,
    latestRequestId: 0,
  };
}

export function beginMiCuentaSaldoRequest(
  state: MiCuentaSaldoState,
  requestId: number,
): MiCuentaSaldoState {
  return {
    ...state,
    loading: true,
    error: state.data ? state.error : null,
    latestRequestId: requestId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfig(value: unknown): value is MiCuentaConfigPublic {
  if (!isRecord(value)) return false;
  return (
    typeof value.configPersisted === "boolean" &&
    typeof value.controlActivo === "boolean" &&
    (value.inicioEn === null || typeof value.inicioEn === "string")
  );
}

function isCuenta(value: unknown): value is MiCuentaCuentaPublic {
  if (!isRecord(value)) return false;
  return (
    typeof value.saldoDisponible === "string" &&
    typeof value.tieneCuenta === "boolean" &&
    typeof value.saldoBajo === "boolean" &&
    (value.umbralSaldoBajo === null || typeof value.umbralSaldoBajo === "string")
  );
}

/**
 * Valida el JSON de mi-cuenta. Ignora movimientos/paginación para el badge POS.
 */
export function parseMiCuentaSaldoPayload(
  json: unknown,
): MiCuentaSaldoData | null {
  if (!isRecord(json)) return null;
  if (json.ok !== true) return null;
  if (typeof json.activo !== "boolean") return null;
  if (!isConfig(json.config)) return null;
  if (!isCuenta(json.cuenta)) return null;
  return {
    activo: json.activo,
    config: json.config,
    cuenta: json.cuenta,
  };
}

export function applyMiCuentaSaldoSuccess(
  state: MiCuentaSaldoState,
  requestId: number,
  data: MiCuentaSaldoData,
): MiCuentaSaldoState {
  if (requestId !== state.latestRequestId) return state;
  return {
    loading: false,
    stale: false,
    error: null,
    data,
    latestRequestId: requestId,
  };
}

export function applyMiCuentaSaldoFailure(
  state: MiCuentaSaldoState,
  requestId: number,
  args: { status: number; message: string },
): MiCuentaSaldoState {
  if (requestId !== state.latestRequestId) return state;
  if (args.status === 401) {
    return {
      loading: false,
      stale: false,
      error: args.message,
      data: null,
      latestRequestId: requestId,
    };
  }
  return {
    loading: false,
    stale: state.data != null,
    error: args.message,
    data: state.data,
    latestRequestId: requestId,
  };
}

/** Abort o respuesta descartada: no altera data ni marca stale. */
export function applyMiCuentaSaldoIgnored(
  state: MiCuentaSaldoState,
  requestId: number,
): MiCuentaSaldoState {
  if (requestId !== state.latestRequestId) return state;
  return {
    ...state,
    loading: false,
  };
}

export function messageFromMiCuentaHttp(
  status: number,
  body: ApiErrorBody | null,
): string {
  if (status === 401) {
    return "Sesión expirada. Vuelve a iniciar sesión.";
  }
  if (status === 403) {
    return "No tienes permiso para consultar el saldo.";
  }
  const apiMsg = body?.error?.message?.trim();
  if (apiMsg) return apiMsg;
  if (status >= 500) {
    return "No se pudo consultar el saldo. Inténtalo de nuevo.";
  }
  return "No se pudo consultar el saldo.";
}

export function resolvePosSaldoViewModel(
  state: MiCuentaSaldoState,
): PosSaldoViewModel {
  if (state.loading && !state.data) {
    return {
      kind: "loading",
      primary: "Consultando saldo…",
      secondary: null,
      showSaldoBajo: false,
      stale: false,
      error: null,
      canRetry: false,
      busy: true,
      updating: false,
    };
  }

  if (!state.data) {
    return {
      kind: "error",
      primary: "Saldo no disponible",
      secondary: null,
      showSaldoBajo: false,
      stale: false,
      error: state.error ?? "No se pudo consultar el saldo.",
      canRetry: true,
      busy: false,
      updating: false,
    };
  }

  const { config, cuenta } = state.data;
  const refreshing = state.loading && state.data != null;
  // Durante refresco: solo «Actualizando…» + saldo previo (sin stale/error contradictorios).
  const stale = refreshing ? false : state.stale;
  const error = refreshing ? null : state.error;
  const canRetry = refreshing ? false : Boolean(state.error);

  if (!config.configPersisted) {
    return {
      kind: "config_ausente",
      primary: "Estado de créditos no configurado",
      secondary:
        "El control aún no está inicializado. El saldo no autoriza ventas por sí solo.",
      showSaldoBajo: false,
      stale,
      error,
      canRetry,
      busy: refreshing,
      updating: refreshing,
    };
  }

  if (!config.controlActivo) {
    const saldoLine = cuenta.tieneCuenta
      ? `Saldo informativo: ${cuenta.saldoDisponible}`
      : "Sin cuenta de créditos (informativo)";
    return {
      kind: "control_inactivo",
      primary: "Control de créditos inactivo · Saldo informativo",
      secondary: saldoLine,
      showSaldoBajo: false,
      stale,
      error,
      canRetry,
      busy: refreshing,
      updating: refreshing,
    };
  }

  if (!cuenta.tieneCuenta) {
    return {
      kind: "sin_cuenta",
      primary: "Sin cuenta de créditos",
      secondary: "Aún no tienes una cuenta de saldo asignada.",
      showSaldoBajo: false,
      stale,
      error,
      canRetry,
      busy: refreshing,
      updating: refreshing,
    };
  }

  return {
    kind: "saldo",
    primary: `Tu saldo: ${cuenta.saldoDisponible}`,
    secondary: null,
    showSaldoBajo: cuenta.saldoBajo === true,
    stale,
    error,
    canRetry,
    busy: refreshing,
    updating: refreshing,
  };
}

/** Type guard de respuesta completa (tests de contrato / consumidores). */
export function isMiCuentaCreditosResponse(
  json: unknown,
): json is MiCuentaCreditosResponse {
  if (!parseMiCuentaSaldoPayload(json)) return false;
  if (!isRecord(json)) return false;
  return Array.isArray(json.movimientos);
}
