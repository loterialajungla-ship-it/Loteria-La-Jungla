import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnularTicketPanel } from "@/components/tickets/AnularTicketPanel";
import { etiquetaHora, formatearFechaUi } from "@/components/tickets/pos-state";
import { prisma } from "@/lib/prisma";
import { getAdminTicketById } from "@/lib/tickets/get-admin-ticket";
import { TicketNotFoundError } from "@/lib/tickets/errors";
import type { EstadoLineaPublico } from "@/lib/tickets/ticket-liquidation";

export const dynamic = "force-dynamic";

type Props = {
  params: { id: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const ticket = await getAdminTicketById(prisma, params.id);
    return {
      title: `${ticket.numeroVisible} — Admin tickets`,
    };
  } catch {
    return { title: "Ticket — Admin" };
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

function premioLabel(estado: EstadoLineaPublico, premio: string | null): string {
  if (estado === "PENDIENTE") return "Pendiente";
  if (premio === null) return "—";
  return `$${premio}`;
}

function formatearDateTimeVe(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-VE", {
      timeZone: "America/Caracas",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function AdminTicketDetallePage({ params }: Props) {
  let ticket;
  try {
    ticket = await getAdminTicketById(prisma, params.id);
  } catch (e) {
    if (e instanceof TicketNotFoundError) notFound();
    throw e;
  }

  const porHora = new Map<number, typeof ticket.lineas>();
  for (const linea of ticket.lineas) {
    const lista = porHora.get(linea.hora) ?? [];
    lista.push(linea);
    porHora.set(linea.hora, lista);
  }
  const horas = Array.from(porHora.keys()).sort((a, b) => a - b);
  const anulado = ticket.estado === "ANULADO";

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-3 text-sm">
          <Link
            href="/admin/tickets"
            className="font-semibold text-emerald-800 underline underline-offset-2"
          >
            ← Tickets
          </Link>
          <Link
            href={`/ticket/${ticket.codigoPublico}`}
            className="font-semibold text-stone-600 underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            Ver público
          </Link>
        </div>

        <header className="mt-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
            Detalle administrativo
          </p>
          <h1 className="mt-1 font-mono text-2xl font-bold tracking-tight">
            {ticket.numeroVisible}
          </h1>
        </header>

        {anulado ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
          >
            <p className="text-base font-bold text-red-900">TICKET ANULADO</p>
            {ticket.anuladoAt ? (
              <p className="mt-1 text-sm text-red-800">
                Anulado: {formatearDateTimeVe(ticket.anuladoAt)}
              </p>
            ) : null}
            {ticket.motivoAnulacion ? (
              <p className="mt-1 text-sm text-red-800">
                Motivo:{" "}
                <span className="whitespace-pre-wrap break-words">
                  {ticket.motivoAnulacion}
                </span>
              </p>
            ) : null}
            <p className="mt-2 text-xs text-red-700/80">
              anuladoPorId: {ticket.anuladoPorId ?? "null"} (pendiente Usuario)
            </p>
          </div>
        ) : null}

        <dl className="mt-6 space-y-2 rounded-2xl border border-stone-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">Fecha de juego</dt>
            <dd className="font-semibold">
              {formatearFechaUi(ticket.fechaJuego)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">Creación</dt>
            <dd className="font-semibold">
              {formatearDateTimeVe(ticket.createdAt)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">Total jugado</dt>
            <dd className="font-semibold tabular-nums">
              ${ticket.totalApostado}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">Estado persistido</dt>
            <dd className="font-semibold">{ticket.estado}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">Estado derivado</dt>
            <dd className="font-semibold">{ticket.estadoDerivado}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">Multiplicador utilizado</dt>
            <dd className="font-semibold">{ticket.multiplicadorUsado}×</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">
              {ticket.liquidacionCompleta
                ? "Premio total"
                : "Premio acumulado"}
            </dt>
            <dd className="font-semibold tabular-nums text-emerald-900">
              ${ticket.premioTotal}
              {!ticket.liquidacionCompleta && !anulado ? (
                <span className="ml-1 text-xs font-normal text-amber-700">
                  (incompleto)
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

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
                      Apostado:{" "}
                      <span className="tabular-nums font-semibold text-stone-800">
                        ${linea.importe}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm text-stone-600">
                      Estado:{" "}
                      <span className="font-semibold text-stone-900">
                        {labelLinea(linea.estado)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm text-stone-600">
                      Premio interno:{" "}
                      <span className="tabular-nums font-semibold text-stone-900">
                        {premioLabel(linea.estado, linea.premio)}
                      </span>
                    </p>
                    {linea.resultadoNumero ? (
                      <p className="mt-0.5 text-xs text-stone-500">
                        Resultado sorteo: {linea.resultadoNumero} —{" "}
                        {linea.resultadoNombre}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {!anulado ? (
          <AnularTicketPanel
            ticketId={ticket.id}
            numeroVisible={ticket.numeroVisible}
            fechaJuego={formatearFechaUi(ticket.fechaJuego)}
            totalApostado={ticket.totalApostado}
          />
        ) : null}
      </main>
    </div>
  );
}
