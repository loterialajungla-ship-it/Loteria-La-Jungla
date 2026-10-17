"use client";

import { useRef } from "react";
import Link from "next/link";
import { TicketImageActions } from "@/components/tickets/TicketImageActions";
import { TicketPreview } from "@/components/tickets/TicketPreview";
import type { TicketPreviewData } from "@/components/tickets/TicketPreview";
import { etiquetaHora, formatearFechaUi } from "@/components/tickets/pos-state";
import type { EstadoLineaPublico } from "@/lib/tickets/ticket-liquidation";
import type { VendorTicketDetalle } from "@/lib/tickets/vendor-tickets";
import {
  lineaEstadoBadge,
  ticketDerivadoBadge,
} from "@/lib/ui/status-labels";
import { Alert, Card, StatusBadge } from "@/components/ui";

function premioUi(estado: EstadoLineaPublico, premio: string | null): string {
  if (estado === "PENDIENTE") return "Pendiente";
  if (premio === null) return "—";
  return `$${premio}`;
}

type Props = {
  ticket: VendorTicketDetalle;
};

export function VendorTicketDetalleView({ ticket }: Props) {
  const ticketRef = useRef<HTMLElement | null>(null);

  const preview: TicketPreviewData = {
    numeroVisible: ticket.numeroVisible,
    codigoPublico: ticket.codigoPublico,
    fechaJuego: ticket.fechaJuego,
    totalApostado: ticket.totalApostado,
    lineas: ticket.lineas.map((l) => ({
      hora: l.hora,
      numeroAnimal: l.numeroAnimal,
      nombreAnimalSnapshot: l.nombreAnimal,
      importe: l.importe,
    })),
  };

  const porHora = new Map<number, typeof ticket.lineas>();
  for (const linea of ticket.lineas) {
    const lista = porHora.get(linea.hora) ?? [];
    lista.push(linea);
    porHora.set(linea.hora, lista);
  }
  const horas = Array.from(porHora.keys()).sort((a, b) => a - b);
  const anulado = ticket.estadoDerivado === "ANULADO";
  const derivado = ticketDerivadoBadge(ticket.estadoDerivado);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      <h1 className="font-mono text-2xl font-bold tracking-tight text-ink">
        {ticket.numeroVisible}
      </h1>
      <p className="mt-1 text-ink-secondary">
        Fecha: {formatearFechaUi(ticket.fechaJuego)}
      </p>
      <div className="mt-2">
        <StatusBadge tone={derivado.tone} label={derivado.label} />
      </div>

      {anulado ? (
        <Alert variant="error" title="Ticket anulado" className="mt-3">
          Este ticket no participa en liquidación.
        </Alert>
      ) : null}

      <div className="mt-6 space-y-4">
        {horas.map((hora) => (
          <Card key={hora} padding="md">
            <h2 className="text-base font-bold text-brand-900">
              {etiquetaHora(hora)}
            </h2>
            <ul className="mt-3 divide-y divide-border">
              {(porHora.get(hora) ?? []).map((linea) => {
                const lineaBadge = lineaEstadoBadge(linea.estado);
                return (
                  <li key={linea.id} className="py-3">
                    <p className="font-semibold text-ink">
                      {linea.numeroAnimal} — {linea.nombreAnimal}
                    </p>
                    <p className="mt-1 text-sm text-ink-secondary">
                      ${linea.importe}
                    </p>
                    <div className="mt-1">
                      <StatusBadge
                        tone={lineaBadge.tone}
                        label={lineaBadge.label}
                      />
                    </div>
                    <p className="mt-1 text-sm text-ink-secondary">
                      Premio:{" "}
                      <span className="font-semibold tabular-nums text-ink">
                        {premioUi(linea.estado, linea.premio)}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <p className="mt-4 text-base font-semibold text-ink">
        Total jugado:{" "}
        <span className="tabular-nums text-brand-900">
          ${ticket.totalApostado}
        </span>
      </p>
      {!anulado ? (
        <p className="mt-1 text-sm text-ink-secondary">
          {ticket.liquidacionCompleta ? "Premio total" : "Premio acumulado"}:{" "}
          <span className="font-semibold tabular-nums text-ink">
            ${ticket.premioTotal}
          </span>
        </p>
      ) : null}

      <div className="mt-8">
        <p className="mb-3 text-sm font-semibold text-ink-secondary">
          Ticket para compartir
        </p>
        <TicketPreview ref={ticketRef} ticket={preview} />
        <TicketImageActions
          targetRef={ticketRef}
          numeroVisible={ticket.numeroVisible}
        />
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <Link
          href="/venta/tickets"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lj-md border border-border-strong bg-surface px-4 py-3 text-base font-semibold text-ink hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          Volver a mis tickets
        </Link>
        <Link
          href="/venta"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lj-md bg-brand-800 px-4 py-3 text-base font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          Nuevo ticket
        </Link>
      </div>
    </div>
  );
}
