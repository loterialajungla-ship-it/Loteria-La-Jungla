import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnularTicketPanel } from "@/components/tickets/AnularTicketPanel";
import { etiquetaHora, formatearFechaUi } from "@/components/tickets/pos-state";
import { prisma } from "@/lib/prisma";
import { getAdminTicketById } from "@/lib/tickets/get-admin-ticket";
import { TicketNotFoundError } from "@/lib/tickets/errors";
import type { EstadoLineaPublico } from "@/lib/tickets/ticket-liquidation";
import { lineaEstadoBadge, ticketDerivadoBadge, ticketPersistidoBadge } from "@/lib/ui/status-labels";
import { Alert, Card, PageHeader, StatusBadge } from "@/components/ui";

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

  const persistido = ticketPersistidoBadge(ticket.estado);
  const derivado = ticketDerivadoBadge(ticket.estadoDerivado);

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
        <PageHeader
          brand="Detalle administrativo"
          title={ticket.numeroVisible}
          className="[&_h1]:font-mono [&_h1]:text-2xl"
          meta={
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={persistido.tone} label={persistido.label} />
              <StatusBadge tone={derivado.tone} label={derivado.label} />
            </div>
          }
          actions={
            <>
              <Link
                href="/admin/tickets"
                className="font-semibold text-brand-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                ← Tickets
              </Link>
              <Link
                href={`/ticket/${ticket.codigoPublico}`}
                className="font-semibold text-ink-muted underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                target="_blank"
                rel="noreferrer"
              >
                Ver público
              </Link>
            </>
          }
        />

        {anulado ? (
          <Alert variant="error" title="Ticket anulado" className="mt-4">
            {ticket.anuladoAt ? (
              <p>Anulado: {formatearDateTimeVe(ticket.anuladoAt)}</p>
            ) : null}
            {ticket.motivoAnulacion ? (
              <p className="mt-1 whitespace-pre-wrap break-words">
                Motivo: {ticket.motivoAnulacion}
              </p>
            ) : null}
          </Alert>
        ) : null}

        <Card className="mt-6" padding="md">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Fecha de juego</dt>
              <dd className="font-semibold text-ink">
                {formatearFechaUi(ticket.fechaJuego)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Creación</dt>
              <dd className="font-semibold text-ink">
                {formatearDateTimeVe(ticket.createdAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Total jugado</dt>
              <dd className="font-semibold tabular-nums text-ink">
                ${ticket.totalApostado}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Multiplicador utilizado</dt>
              <dd className="font-semibold text-ink">
                {ticket.multiplicadorUsado}×
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">
                {ticket.liquidacionCompleta
                  ? "Premio total"
                  : "Premio acumulado"}
              </dt>
              <dd className="font-semibold tabular-nums text-brand-900">
                ${ticket.premioTotal}
                {!ticket.liquidacionCompleta && !anulado ? (
                  <span className="ml-1 text-xs font-normal text-accent-800">
                    (incompleto)
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        </Card>

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
                      Apostado:{" "}
                      <span className="font-semibold tabular-nums text-ink">
                        ${linea.importe}
                      </span>
                    </p>
                    <div className="mt-1">
                      <StatusBadge
                        tone={lineaBadge.tone}
                        label={lineaBadge.label}
                      />
                      <span className="sr-only">{labelLinea(linea.estado)}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-secondary">
                      Premio interno:{" "}
                      <span className="font-semibold tabular-nums text-ink">
                        {premioLabel(linea.estado, linea.premio)}
                      </span>
                    </p>
                    {linea.resultadoNumero ? (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Resultado sorteo: {linea.resultadoNumero} —{" "}
                        {linea.resultadoNombre}
                      </p>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            </Card>
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
  );
}
