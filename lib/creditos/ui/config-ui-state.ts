/**
 * Estados de presentación de CreditosConfig en la UI admin.
 * Distingue ausencia de fila vs control apagado persistido vs error de carga.
 */
import type { CreditosConfigPublic } from "@/lib/creditos/ui/api-types";

export type CreditosConfigUiState =
  | "ausente"
  | "persistida_apagada"
  | "persistida_activa"
  | "error";

/**
 * @param config respuesta de configuración si la carga tuvo éxito
 * @param loadFailed true si la consulta falló (red/5xx/esquema); no inventa defaults
 */
export function resolveCreditosConfigUiState(
  config: CreditosConfigPublic | null | undefined,
  loadFailed: boolean,
): CreditosConfigUiState {
  if (loadFailed) return "error";
  if (!config) return "error";
  if (!config.configPersisted) return "ausente";
  if (config.controlActivo) return "persistida_activa";
  return "persistida_apagada";
}

export const CREDITOS_CONFIG_UI_COPY = {
  ausente: {
    title: "Configuración de créditos no inicializada.",
    body: "Las ventas de vendedores fallarán hasta inicializarla mediante el procedimiento operativo autorizado. Esto no equivale a control desactivado.",
  },
  persistida_apagada: {
    title: "Control de créditos desactivado.",
    body: "Puedes preparar saldos sin consumirlos en ventas. El control permanece apagado hasta una activación explícita con inicioEn.",
  },
  persistida_activa: {
    title: "Control de créditos activo.",
    body: "Las ventas de vendedor con Ticket.createdAt ≥ inicioEn consumen saldo.",
  },
  error: {
    title: "No se pudo consultar la configuración. Inténtalo nuevamente.",
    body: "No se muestran valores virtuales como si fueran configuración persistida.",
  },
} as const;
