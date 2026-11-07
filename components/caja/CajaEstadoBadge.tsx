import { StatusBadge } from "@/components/ui";

export function CajaEstadoBadge({
  estado,
}: {
  estado: "PENDIENTE" | "PARCIAL" | "CONFIRMADA";
}) {
  if (estado === "CONFIRMADA") {
    return <StatusBadge tone="success" label="Confirmada" />;
  }
  if (estado === "PARCIAL") {
    return <StatusBadge tone="warning" label="Parcial" />;
  }
  return <StatusBadge tone="neutral" label="Pendiente" />;
}
