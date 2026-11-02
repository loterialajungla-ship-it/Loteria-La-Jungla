/**
 * Lógica pura del ConfirmDialog (testeable sin DOM).
 */

export type ConfirmDialogVariant = "default" | "danger";

export type ConfirmMotivoConfig = {
  value: string;
  required?: boolean;
  maxLength?: number;
};

export type ConfirmInitialFocusTarget = "motivo" | "cancel" | "confirm";

/**
 * Destino del foco inicial al abrir.
 * `danger` → Cancelar (evita Enter accidental sobre la acción destructiva).
 * Motivo obligatorio tiene prioridad (hay que completar el campo).
 */
export function resolveConfirmDialogInitialFocus(args: {
  variant?: ConfirmDialogVariant;
  motivoRequired?: boolean;
}): ConfirmInitialFocusTarget {
  if (args.motivoRequired) return "motivo";
  if (args.variant === "danger") return "cancel";
  return "confirm";
}

/**
 * Política U1.1 tras fallo de la operación ya confirmada:
 * cerrar diálogo, dejar loading en false y exponer el error fuera del overlay.
 * Los campos del formulario no se tocan aquí (los conserva el caller).
 */
export function applyConfirmOperationFailure(args: {
  errorMessage: string;
}): {
  confirmOpen: false;
  busy: false;
  error: string;
} {
  return {
    confirmOpen: false,
    busy: false,
    error: args.errorMessage,
  };
}

/** ¿El motivo cumple la validación del diálogo? */
export function isConfirmMotivoValid(
  motivo: ConfirmMotivoConfig | null | undefined,
): boolean {
  if (!motivo) return true;
  if (!motivo.required) return true;
  const trimmed = motivo.value.trim();
  if (!trimmed) return false;
  if (
    typeof motivo.maxLength === "number" &&
    motivo.maxLength > 0 &&
    trimmed.length > motivo.maxLength
  ) {
    return false;
  }
  return true;
}

/**
 * ¿Se puede cerrar/cancelar el diálogo?
 * Durante `loading` (operación en curso) no se permite dismiss.
 */
export function canDismissConfirmDialog(loading: boolean): boolean {
  return !loading;
}

/**
 * ¿Se puede disparar la confirmación?
 * Bloquea si loading o si el motivo obligatorio es inválido.
 */
export function canSubmitConfirmDialog(args: {
  loading: boolean;
  motivo?: ConfirmMotivoConfig | null;
}): boolean {
  if (args.loading) return false;
  return isConfirmMotivoValid(args.motivo);
}
