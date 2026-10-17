import type { StatusBadgeTone } from "@/components/ui/StatusBadge";

/** Estado persistido del ticket (filtro / columna admin). */
export function ticketPersistidoBadge(estado: string): {
  label: string;
  tone: StatusBadgeTone;
} {
  if (estado === "ANULADO") {
    return { label: "Anulado", tone: "danger" };
  }
  return { label: "Emitido", tone: "success" };
}

/** Estado derivado de liquidación (ticket). */
export function ticketDerivadoBadge(estado: string): {
  label: string;
  tone: StatusBadgeTone;
} {
  switch (estado) {
    case "ANULADO":
      return { label: "ANULADO", tone: "danger" };
    case "PENDIENTE":
      return { label: "PENDIENTE", tone: "warning" };
    case "GANADOR":
      return { label: "GANADOR", tone: "success" };
    case "NO_GANADOR":
      return { label: "NO GANADOR", tone: "neutral" };
    default:
      return { label: estado, tone: "neutral" };
  }
}

/** Estado de línea pública. */
export function lineaEstadoBadge(estado: string): {
  label: string;
  tone: StatusBadgeTone;
} {
  switch (estado) {
    case "PENDIENTE":
      return { label: "PENDIENTE", tone: "warning" };
    case "GANADORA":
      return { label: "GANADORA", tone: "success" };
    case "NO_GANADORA":
      return { label: "NO GANADORA", tone: "neutral" };
    default:
      return { label: estado, tone: "neutral" };
  }
}

export function usuarioActivoBadge(activo: boolean): {
  label: string;
  tone: StatusBadgeTone;
} {
  return activo
    ? { label: "ACTIVO", tone: "success" }
    : { label: "INACTIVO", tone: "neutral" };
}
