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

  return (
    <article className="mx-auto w-full max-w-lg rounded-2xl border border-emerald-800 bg-emerald-950 p-5 text-emerald-50 shadow-lg">
      <p className="text-center text-sm font-semibold uppercase tracking-wide text-emerald-300">
        Lotería La Jungla
      </p>
      <h1 className="mt-2 text-center text-2xl font-bold tracking-tight">
        Consulta de ticket
      </h1>
      <p className="mt-2 text-center font-mono text-lg font-semibold text-amber-300">
        {ticket.numeroVisible}
      </p>
      <p className="mt-1 text-center text-sm text-emerald-200">
        Fecha: {formatearFechaUi(ticket.fechaJuego)}
      </p>

      {anulado ? (
        <p
          role="status"
          className="mt-4 rounded-xl bg-red-900/60 px-4 py-3 text-center text-base font-bold text-red-100"
        >
          TICKET ANULADO
        </p>
      ) : null}

      <div className="mt-6 space-y-5">
        {horas.map((hora) => (
          <section key={hora}>
            <h2 className="border-b border-emerald-800 pb-1 text-sm font-bold text-emerald-300">
              {etiquetaHora(hora)}
            </h2>
            <ul className="mt-2 space-y-3">
              {(porHora.get(hora) ?? []).map((linea) => (
                <li
                  key={linea.id}
                  className="rounded-xl border border-emerald-800/80 bg-emerald-900/40 px-3 py-3"
                >
                  <div className="flex justify-between gap-3 text-base font-semibold">
                    <span>
                      {linea.numeroAnimal} - {linea.nombreAnimal}
                    </span>
                    <span className="tabular-nums">${linea.importe}</span>
                  </div>
                  {linea.resultadoNumero ? (
                    <p className="mt-1 text-sm text-emerald-200">
                      Resultado: {linea.resultadoNumero} -{" "}
                      {linea.resultadoNombre}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm font-medium text-emerald-100">
                    Estado: {labelEstadoLinea(linea.estado)}
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
        <p className="text-xl font-bold tabular-nums">
          TOTAL JUGADO: ${ticket.totalApostado}
        </p>
        <p className="text-base font-semibold">
          Estado: {labelEstadoTicket(ticket)}
        </p>
        {!anulado ? (
          ticket.liquidacionCompleta ? (
            <p className="text-xl font-bold tabular-nums text-amber-300">
              PREMIO TOTAL: ${ticket.premioTotal}
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
            PREMIO TOTAL: $0.00
          </p>
        )}
      </div>
    </article>
  );
}
