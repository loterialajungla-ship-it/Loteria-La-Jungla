"use client";

import { useRef } from "react";
import Link from "next/link";
import { TicketImageActions } from "@/components/tickets/TicketImageActions";
import { TicketPreview } from "@/components/tickets/TicketPreview";
import type { TicketPreviewData } from "@/components/tickets/TicketPreview";
import { etiquetaHora, formatearFechaUi } from "@/components/tickets/pos-state";
import type { EstadoLineaPublico } from "@/lib/tickets/ticket-liquidation";
import type { VendorTicketDetalle } from "@/lib/tickets/vendor-tickets";

function labelEstadoDerivado(estado: string): string {
  switch (estado) {
    case "ANULADO":
      return "ANULADO";
    case "PENDIENTE":
      return "PENDIENTE";
    case "GANADOR":
      return "GANADOR";
    case "NO_GANADOR":
      return "NO GANADOR";
    default:
      return estado;
  }
}

function labelLinea(estado: EstadoLineaPublico): string {
  switch (estado) {
    case "PENDIENTE":
      return "PENDIENTE";
    case "GANADORA":
      return "GANADORA";
    case "NO_GANADORA":
      return "NO GANADORA";
  }
}

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

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
        Lotería La Jungla
      </p>
      <h1 className="mt-1 font-mono text-2xl font-bold tracking-tight text-stone-900">
        {ticket.numeroVisible}
      </h1>
      <p className="mt-1 text-stone-600">
        Fecha: {formatearFechaUi(ticket.fechaJuego)}
      </p>
      <p className="mt-2 text-base font-bold text-stone-900">
        Estado: {labelEstadoDerivado(ticket.estadoDerivado)}
      </p>

      {anulado ? (
        <p
          role="status"
          className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-800"
        >
          TICKET ANULADO
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {horas.map((hora) => (
          <section
            key={hora}
            className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
          >
            <h2 className="text-base font-bold text-emerald-900">
              {etiquetaHora(hora)}
            </h2>
            <ul className="mt-3 divide-y divide-stone-100">
              {(porHora.get(hora) ?? []).map((linea) => (
                <li key={linea.id} className="py-3">
                  <p className="font-semibold text-stone-900">
                    {linea.numeroAnimal} — {linea.nombreAnimal}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">
                    ${linea.importe} · {labelLinea(linea.estado)}
                  </p>
                  <p className="mt-0.5 text-sm text-stone-600">
                    Premio:{" "}
                    <span className="font-semibold tabular-nums text-stone-900">
                      {premioUi(linea.estado, linea.premio)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-4 text-base font-semibold text-stone-800">
        Total jugado:{" "}
        <span className="tabular-nums text-emerald-900">
          ${ticket.totalApostado}
        </span>
      </p>
      {!anulado ? (
        <p className="mt-1 text-sm text-stone-600">
          {ticket.liquidacionCompleta ? "Premio total" : "Premio acumulado"}:{" "}
          <span className="font-semibold tabular-nums">
            ${ticket.premioTotal}
          </span>
        </p>
      ) : null}

      <div className="mt-8">
        <p className="mb-3 text-sm font-semibold text-stone-700">
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
          className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-center text-base font-semibold text-stone-800 hover:bg-stone-50"
        >
          Volver a mis tickets
        </Link>
        <Link
          href="/venta"
          className="rounded-xl bg-emerald-800 px-4 py-3 text-center text-base font-bold text-white hover:bg-emerald-700"
        >
          Nuevo ticket
        </Link>
      </div>
    </div>
  );
}
