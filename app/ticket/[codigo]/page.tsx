import type { Metadata } from "next";
import Link from "next/link";
import { TicketConsultaView } from "@/components/tickets/TicketConsultaView";
import { getPublicTicketByCodigo } from "@/lib/tickets/get-public-ticket";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  params: { codigo: string };
};

export function generateMetadata(): Metadata {
  return {
    title: "Consulta de ticket — Lotería La Jungla",
    description: "Consulta pública de ticket.",
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    },
  };
}

export default async function TicketPublicoPage({ params }: Props) {
  const codigo = decodeURIComponent(params.codigo ?? "").trim();
  const ticket = codigo ? await getPublicTicketByCodigo(codigo) : null;

  return (
    <div className="min-h-screen bg-emerald-950 px-4 py-8 text-emerald-50 sm:px-6">
      {!ticket ? (
        <main className="mx-auto max-w-lg text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
            Lotería La Jungla
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            Ticket no encontrado
          </h1>
          <p className="mt-3 text-base text-emerald-200">
            El código no corresponde a ningún ticket, o el enlace es incorrecto.
            Revisa el código e inténtalo de nuevo.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-lj-md bg-amber-400 px-5 py-2.5 text-sm font-bold text-emerald-950 hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              Ver resultados de hoy
            </Link>
          </div>
        </main>
      ) : (
        <main>
          <TicketConsultaView ticket={ticket} />
          <p className="mx-auto mt-6 max-w-lg text-center">
            <Link
              href="/"
              className="text-sm font-semibold text-emerald-300 underline underline-offset-2 hover:text-amber-200 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              Ver resultados de hoy
            </Link>
          </p>
        </main>
      )}
    </div>
  );
}
