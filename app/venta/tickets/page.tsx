import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { prisma } from "@/lib/prisma";
import { hoyYYYYMMDD } from "@/lib/fecha";
import { formatearFechaUi } from "@/components/tickets/pos-state";
import { listVendorTickets } from "@/lib/tickets/vendor-tickets";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mis tickets — Lotería La Jungla",
  description: "Historial de tickets del vendedor.",
};

type Props = {
  searchParams: {
    fecha?: string;
    estado?: string;
    numero?: string;
    page?: string;
  };
};

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

function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

export default async function VentaTicketsPage({ searchParams }: Props) {
  let actor;
  try {
    actor = await requireVendorOrAdmin();
  } catch (e) {
    if (e instanceof AuthError && e.httpStatus === 401) {
      redirect("/login");
    }
    redirect("/login");
  }

  const fechaDefault = hoyYYYYMMDD();
  const fecha =
    typeof searchParams.fecha === "string" && searchParams.fecha.trim()
      ? searchParams.fecha.trim()
      : fechaDefault;
  const estado =
    typeof searchParams.estado === "string" ? searchParams.estado.trim() : "";
  const numero =
    typeof searchParams.numero === "string" ? searchParams.numero.trim() : "";
  const page =
    typeof searchParams.page === "string" ? searchParams.page.trim() : "1";

  const result = await listVendorTickets(
    prisma,
    { userId: actor.userId, rol: actor.user.rol },
    {
      fecha,
      estado: estado || undefined,
      numero: numero || undefined,
      page,
    },
  );

  const baseParams = {
    fecha,
    estado: estado || undefined,
    numero: numero || undefined,
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3 text-sm">
          <Link
            href="/venta"
            className="font-semibold text-emerald-800 underline underline-offset-2"
          >
            ← Venta
          </Link>
          <Link
            href="/venta"
            className="font-semibold text-stone-700 underline underline-offset-2"
          >
            Nuevo ticket
          </Link>
        </div>
      </div>

      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          Lotería La Jungla
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Mis tickets</h1>
        <p className="mt-2 text-stone-600">
          {actor.user.rol === "VENDEDOR"
            ? "Solo ves los tickets que tú emitiste."
            : "Vista de venta (ADMIN puede ver todos)."}
        </p>

        <form
          method="get"
          className="mt-6 grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
        >
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Fecha
            <input
              type="date"
              name="fecha"
              defaultValue={fecha}
              className="rounded-xl border border-stone-300 px-3 py-2.5 text-base outline-none focus:border-emerald-600"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Estado
            <select
              name="estado"
              defaultValue={estado}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600"
            >
              <option value="">Todos</option>
              <option value="EMITIDO">Emitidos</option>
              <option value="ANULADO">Anulados</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Número de ticket
            <input
              type="search"
              name="numero"
              defaultValue={numero}
              placeholder="LJ-20261002-000125"
              className="rounded-xl border border-stone-300 px-3 py-2.5 font-mono text-base outline-none focus:border-emerald-600"
            />
          </label>
          <button
            type="submit"
            className="rounded-xl bg-emerald-800 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700"
          >
            Buscar
          </button>
        </form>

        <ul className="mt-6 space-y-3">
          {result.tickets.length === 0 ? (
            <li className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-4 py-8 text-center text-stone-500">
              No hay tickets con estos filtros.
            </li>
          ) : (
            result.tickets.map((t) => (
              <li
                key={t.id}
                className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-bold text-stone-900">
                      {t.numeroVisible}
                    </p>
                    <p className="mt-1 text-sm text-stone-600">
                      {formatearFechaUi(t.fechaJuego)} · ${t.totalApostado}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-stone-800">
                      {labelEstadoDerivado(t.estadoDerivado)}
                    </p>
                  </div>
                  <Link
                    href={`/venta/tickets/${t.id}`}
                    className="rounded-lg bg-stone-800 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700"
                  >
                    Ver
                  </Link>
                </div>
              </li>
            ))
          )}
        </ul>

        <div className="mt-6 flex items-center justify-between gap-3 text-sm">
          {result.pagination.page > 1 ? (
            <Link
              href={`/venta/tickets${buildQuery({
                ...baseParams,
                page: String(result.pagination.page - 1),
              })}`}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 font-semibold text-stone-700"
            >
              Anterior
            </Link>
          ) : (
            <span className="rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 font-semibold text-stone-400">
              Anterior
            </span>
          )}
          <p className="text-stone-600">
            Página{" "}
            {result.pagination.totalPages === 0
              ? 0
              : result.pagination.page}{" "}
            de {result.pagination.totalPages}
          </p>
          {result.pagination.page < result.pagination.totalPages ? (
            <Link
              href={`/venta/tickets${buildQuery({
                ...baseParams,
                page: String(result.pagination.page + 1),
              })}`}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 font-semibold text-stone-700"
            >
              Siguiente
            </Link>
          ) : (
            <span className="rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 font-semibold text-stone-400">
              Siguiente
            </span>
          )}
        </div>
      </main>
    </div>
  );
}
