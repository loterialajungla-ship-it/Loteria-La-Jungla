import {
  etiquetaHora,
  formatearFechaUi,
} from "@/components/tickets/pos-state";
import type { TicketPublico } from "@/lib/tickets/get-public-ticket";
import type { EstadoLineaPublico } from "@/lib/tickets/ticket-liquidation";

function labelEstadoLinea(estado: EstadoLineaPublico): string {
  switch (estado) {
    case "PENDIENTE":
      return "Pendiente";
    case "GANADORA":
      return "Ganadora";
    case "NO_GANADORA":
      return "No ganadora";
  }
}

function labelEstadoTicket(ticket: TicketPublico): string {
  switch (ticket.estado) {
    case "ANULADO":
      return "ANULADO";
    case "PENDIENTE":
      return "PENDIENTE";
    case "GANADOR":
      return "GANADOR";
    case "NO_GANADOR":
      return "NO GANADOR";
  }
}

function claseEstadoTicket(estado: TicketPublico["estado"]): string {
  switch (estado) {
    case "ANULADO":
      return "border-red-500/50 bg-red-950/50 text-red-100";
    case "PENDIENTE":
      return "border-amber-400/40 bg-amber-950/30 text-amber-100";
    case "GANADOR":
      return "border-amber-300/50 bg-emerald-900 text-amber-200";
    case "NO_GANADOR":
      return "border-emerald-700 bg-emerald-950/60 text-emerald-100";
  }
}

function claseEstadoLinea(estado: EstadoLineaPublico): string {
  switch (estado) {
    case "PENDIENTE":
      return "text-amber-200";
    case "GANADORA":
      return "text-amber-300";
    case "NO_GANADORA":
      return "text-emerald-300";
  }
}

type Props = {
  ticket: TicketPublico;
};

export function TicketConsultaView({ ticket }: Props) {
  const porHora = new Map<number, TicketPublico["lineas"]>();
  for (const linea of ticket.lineas) {
    const lista = porHora.get(linea.hora) ?? [];
    lista.push(linea);
    porHora.set(linea.hora, lista);
  }
  const horas = Array.from(porHora.keys()).sort((a, b) => a - b);
  const anulado = ticket.estado === "ANULADO";
  const estadoLabel = labelEstadoTicket(ticket);

  return (
    <article className="mx-auto w-full max-w-lg rounded-lj-lg border border-emerald-800 bg-emerald-950/80 p-5 text-emerald-50 shadow-lg sm:p-6">
      <p className="text-center text-sm font-semibold uppercase tracking-wide text-emerald-300">
        Lotería La Jungla
      </p>
      <h1 className="mt-2 text-center text-xl font-bold tracking-tight sm:text-2xl">
        Consulta de ticket
      </h1>

      <div className="mt-4 text-center">
        <p className="font-mono text-xl font-bold tracking-tight text-amber-300 break-all sm:text-2xl">
          {ticket.numeroVisible}
        </p>
        <p className="mt-1 text-sm text-emerald-200">
          Fecha de juego:{" "}
          <strong className="text-emerald-50">
            {formatearFechaUi(ticket.fechaJuego)}
          </strong>
        </p>
      </div>

      <p
        role="status"
        className={`mt-4 rounded-lj-md border px-3 py-2.5 text-center text-sm font-bold uppercase tracking-wide ${claseEstadoTicket(ticket.estado)}`}
      >
        Estado: {estadoLabel}
      </p>

      {anulado ? (
        <p className="mt-3 text-center text-sm font-medium text-red-200">
          Este ticket está anulado y no participa en la liquidación.
        </p>
      ) : null}

      <div className="mt-6 space-y-5">
        <h2 className="sr-only">Líneas del ticket</h2>
        {horas.map((hora) => (
          <section key={hora}>
            <h3 className="border-b border-emerald-800 pb-1 text-sm font-bold text-emerald-300">
              {etiquetaHora(hora)}
            </h3>
            <ul className="mt-2 space-y-3">
              {(porHora.get(hora) ?? []).map((linea) => (
                <li
                  key={linea.id}
                  className="rounded-lj-md border border-emerald-800/80 bg-emerald-900/40 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 text-base font-semibold">
                    <span className="min-w-0">
                      <span className="font-mono tabular-nums">
                        {linea.numeroAnimal}
                      </span>
                      <span className="text-emerald-400"> — </span>
                      <span className="break-words">{linea.nombreAnimal}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-emerald-50">
                      ${linea.importe}
                    </span>
                  </div>
                  {linea.resultadoNumero ? (
                    <p className="mt-1.5 text-sm text-emerald-200">
                      Resultado:{" "}
                      <span className="font-mono">{linea.resultadoNumero}</span>
                      {" — "}
                      {linea.resultadoNombre}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-sm text-emerald-400">
                      Resultado: pendiente
                    </p>
                  )}
                  <p
                    className={`mt-1 text-sm font-semibold ${claseEstadoLinea(linea.estado)}`}
                  >
                    Estado línea: {labelEstadoLinea(linea.estado)}
                  </p>
                  {linea.estado === "GANADORA" && linea.premio ? (
                    <p className="mt-1 text-sm font-bold text-amber-300">
                      Premio: ${linea.premio}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-6 space-y-2 border-t border-emerald-800 pt-4 text-center">
        <p className="text-xl font-bold tabular-nums text-emerald-50">
          Total jugado: ${ticket.totalApostado}
        </p>
        {!anulado ? (
          ticket.liquidacionCompleta ? (
            <p className="text-xl font-bold tabular-nums text-amber-300">
              Premio total: ${ticket.premioTotal}
            </p>
          ) : (
            <div>
              <p className="text-lg font-bold tabular-nums text-amber-200">
                Premio acumulado: ${ticket.premioTotal}
              </p>
              <p className="mt-1 text-sm text-emerald-300">
                Hay sorteos pendientes; el ticket aún no está liquidado por
                completo.
              </p>
            </div>
          )
        ) : (
          <p className="text-base font-semibold text-red-200">
            Premio total: $0.00
          </p>
        )}
      </div>
    </article>
  );
}
