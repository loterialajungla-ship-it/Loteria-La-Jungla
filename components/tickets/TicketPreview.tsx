"use client";

import { forwardRef, useMemo } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  etiquetaHora,
  formatearFechaUi,
} from "@/components/tickets/pos-state";
import { buildTicketConsultaUrl } from "@/components/tickets/ticket-image";

export type TicketPreviewData = {
  numeroVisible: string;
  codigoPublico: string;
  fechaJuego: string;
  totalApostado: string;
  lineas: {
    hora: number;
    numeroAnimal: string;
    nombreAnimalSnapshot: string;
    importe: string;
  }[];
};

type Props = {
  ticket: TicketPreviewData;
  /** URL completa del QR; si no se pasa, se arma con origin + /ticket/{codigo}. */
  consultaUrl?: string;
};

export const QR_TICKET_SIZE = 168;

/**
 * Vista del ticket de venta (solo lo jugado).
 * QR visible en canvas; el PNG lo reinyecta TicketImageActions (móvil).
 */
export const TicketPreview = forwardRef<HTMLElement, Props>(
  function TicketPreview({ ticket, consultaUrl }, ref) {
    const url = useMemo(() => {
      if (consultaUrl) return consultaUrl;
      if (typeof window !== "undefined") {
        return buildTicketConsultaUrl(
          window.location.origin,
          ticket.codigoPublico,
        );
      }
      return `/ticket/${ticket.codigoPublico}`;
    }, [consultaUrl, ticket.codigoPublico]);

    const porHora = new Map<number, TicketPreviewData["lineas"]>();
    for (const linea of ticket.lineas) {
      const lista = porHora.get(linea.hora) ?? [];
      lista.push(linea);
      porHora.set(linea.hora, lista);
    }
    const horas = Array.from(porHora.keys()).sort((a, b) => a - b);

    return (
      <article
        ref={ref}
        data-ticket-export-root="true"
        className="mx-auto box-border rounded-2xl border border-emerald-800 bg-emerald-950 p-5 text-emerald-50 shadow-lg"
        style={{
          backgroundColor: "#022c22",
          width: "352px",
          maxWidth: "100%",
          boxSizing: "border-box",
        }}
      >
        <div className="border-b border-emerald-700/80 pb-3 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
            Lotería La Jungla
          </p>
          <h2 className="mt-2 text-xl font-bold tracking-tight">TICKET</h2>
          <p className="mt-1 font-mono text-lg font-semibold text-amber-300">
            {ticket.numeroVisible}
          </p>
          <p className="mt-2 text-sm text-emerald-200">
            {formatearFechaUi(ticket.fechaJuego)}
          </p>
        </div>

        <div className="mt-5 space-y-5">
          {horas.map((hora) => (
            <section key={hora}>
              <h3 className="border-b border-emerald-800 pb-1 text-sm font-bold text-emerald-300">
                {etiquetaHora(hora)}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {(porHora.get(hora) ?? []).map((linea) => (
                  <li
                    key={`${linea.hora}-${linea.numeroAnimal}`}
                    className="flex justify-between gap-3 text-base"
                  >
                    <span>
                      {linea.numeroAnimal} - {linea.nombreAnimalSnapshot}
                    </span>
                    <span className="tabular-nums font-semibold">
                      ${linea.importe}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-6 border-y border-emerald-700 py-3 text-center text-xl font-bold tabular-nums">
          TOTAL JUGADO: ${ticket.totalApostado}
        </p>

        <div className="mt-5 flex flex-col items-center gap-2">
          <div
            data-ticket-qr-frame="true"
            className="rounded-xl bg-white p-3"
            style={{ lineHeight: 0 }}
          >
            <QRCodeCanvas
              value={url}
              size={QR_TICKET_SIZE}
              level="M"
              includeMargin={false}
              bgColor="#ffffff"
              fgColor="#022c22"
              data-ticket-qr-canvas="true"
              style={{
                width: QR_TICKET_SIZE,
                height: QR_TICKET_SIZE,
                display: "block",
              }}
            />
          </div>
          <p
            data-export-hide="true"
            className="max-w-[16rem] break-all text-center text-xs text-emerald-400/90"
          >
            Escanea para consultar
          </p>
        </div>
      </article>
    );
  },
);

TicketPreview.displayName = "TicketPreview";
