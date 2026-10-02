"use client";

import {
  contarLineas,
  puedeCrearTicket,
  totalOrientativo,
} from "@/components/tickets/pos-state";
import type { PosApuestas } from "@/components/tickets/pos-state";

type Props = {
  apuestas: PosApuestas;
  creando: boolean;
  onCrear: () => void;
};

export function TicketSummary({ apuestas, creando, onCrear }: Props) {
  const total = totalOrientativo(apuestas);
  const lineas = contarLineas(apuestas);
  const ok = puedeCrearTicket(apuestas);

  return (
    <div className="sticky bottom-0 z-10 border-t border-emerald-800/20 bg-emerald-950 px-4 py-4 text-emerald-50 shadow-[0_-8px_24px_rgba(0,0,0,0.2)]">
      <div className="mx-auto flex max-w-lg flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-emerald-300">
            {lineas} línea{lineas === 1 ? "" : "s"}
          </p>
          <p className="text-2xl font-bold tabular-nums">
            TOTAL JUGADO: ${total}
          </p>
          <p className="text-xs text-emerald-400/80">
            Total orientativo; el servidor confirma el monto final.
          </p>
        </div>
        <button
          type="button"
          disabled={!ok || creando}
          onClick={onCrear}
          className="w-full rounded-xl bg-amber-400 px-5 py-4 text-base font-bold text-emerald-950 hover:bg-amber-300 disabled:opacity-50 sm:w-auto sm:min-w-[10rem]"
        >
          {creando ? "Creando ticket…" : "Crear ticket"}
        </button>
      </div>
    </div>
  );
}
