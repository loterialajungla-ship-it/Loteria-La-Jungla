/**
 * Tipos serializables del reporte diario ADMIN.
 * Todos los importes son strings con 2 decimales.
 */

export type ReportTicketsSummary = {
  emitidos: number;
  anulados: number;
  /** Solo tickets EMITIDO; estados derivados vía liquidación. */
  ganadores: number;
  noGanadores: number;
  pendientes: number;
};

export type ReportVentasSummary = {
  /** SUM(Ticket.totalApostado) de EMITIDO. */
  totalJugado: string;
};

export type ReportVendorRow = {
  vendedorId: string | null;
  nombre: string;
  usuario: string | null;
  tickets: number;
  totalJugado: string;
};

export type ReportHourRow = {
  hora: number;
  horaLabel: string;
  /** SUM(TicketLinea.importe) de EMITIDO en esa hora. */
  totalJugado: string;
};

export type ReportAnimalRow = {
  numeroAnimal: string;
  nombreAnimal: string;
  totalJugado: string;
};

export type ReportExposureHourRow = {
  hora: number;
  horaLabel: string;
  totalApostado: string;
  /** Exposición total teórica (suma por animales). */
  exposicionTotalTeorica: string;
  mayorExposicion: string;
  ticketsAfectados: number;
};

export type DailyReport = {
  fechaJuego: string;
  tickets: ReportTicketsSummary;
  ventas: ReportVentasSummary;
  porVendedor: ReportVendorRow[];
  porHora: ReportHourRow[];
  porAnimal: ReportAnimalRow[];
  exposicion: ReportExposureHourRow[];
};
