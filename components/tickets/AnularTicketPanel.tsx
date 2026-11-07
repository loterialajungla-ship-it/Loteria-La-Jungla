/**
 * Panel de anulación — retirado (C7.2).
 * Se conserva el módulo para no romper imports residuales de tests de UI;
 * no ofrece ninguna acción de anulación ni llama a la API.
 */
import { Alert } from "@/components/ui";

export type AnularTicketPanelProps = {
  ticketId: string;
  numeroVisible: string;
  fechaJuego: string;
  totalApostado: string;
};

export function AnularTicketPanel(props: AnularTicketPanelProps) {
  void props;
  return (
    <Alert variant="info" title="Anulación no disponible">
      La anulación de tickets y las devoluciones no están permitidas.
    </Alert>
  );
}
