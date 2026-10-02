import type { Metadata } from "next";
import Link from "next/link";
import { listAdminTickets } from "@/lib/tickets/list-admin-tickets";
import { prisma } from "@/lib/prisma";
import { hoyYYYYMMDD } from "@/lib/fecha";
import { formatearFechaUi } from "@/components/tickets/pos-state";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tickets — Admin — Lotería La Jungla",
  description: "Listado administrativo de tickets.",
};

type Props = {
  searchParams: {
    fecha?: string;
    estado?: string;
    numero?: string;
    page?: string;
  };
};

function formatearHoraCreacion(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-VE", {
      timeZone: "America/Caracas",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function labelEstadoPersistido(estado: string): string {
  return estado === "ANULADO" ? "Anulado" : "Emitido";
}

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

export default async function AdminTicketsPage({ searchParams }: Props) {
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

  const result = await listAdminTickets(prisma, {
    fecha,
    estado: estado || undefined,
    numero: numero || undefined,
    page,
  });

  const baseParams = {
    fecha,
    estado: estado || undefined,
    numero: numero || undefined,
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
              Lotería La Jungla
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Tickets</h1>
            <p className="mt-2 text-stone-600">
              Consulta, filtra y anula tickets emitidos.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/reportes"
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              Reportes
            </Link>
            <Link
              href="/admin/auditoria"
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              Auditoría
            </Link>
            <Link
              href="/admin"
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              Resultados
            </Link>
          </div>
        </div>

        <form
          method="get"
          className="mt-6 grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Fecha
            <input
              type="date"
              name="fecha"
              defaultValue={fecha}
              className="rounded-xl border border-stone-300 px-3 py-2.5 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Estado
            <select
              name="estado"
              defaultValue={estado}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            >
              <option value="">Todos</option>
              <option value="EMITIDO">Emitidos</option>
              <option value="ANULADO">Anulados</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700 sm:col-span-2">
            Número de ticket
            <input
              type="search"
              name="numero"
              defaultValue={numero}
              placeholder="LJ-20261001-000001"
              className="rounded-xl border border-stone-300 px-3 py-2.5 font-mono text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>

          <button
            type="submit"
            className="rounded-xl bg-emerald-800 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 sm:col-span-2"
          >
            Buscar
          </button>
        </form>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Número</th>
                <th className="px-3 py-3 font-semibold">Fecha</th>
                <th className="px-3 py-3 font-semibold">Creación</th>
                <th className="px-3 py-3 font-semibold">Total</th>
                <th className="px-3 py-3 font-semibold">Estado</th>
                <th className="px-3 py-3 font-semibold">Resultado</th>
                <th className="px-3 py-3 font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {result.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-stone-500"
                  >
                    No hay tickets con estos filtros.
                  </td>
                </tr>
              ) : (
                result.items.map((t) => (
                  <tr key={t.id} className="hover:bg-stone-50/80">
                    <td className="px-3 py-3 font-mono text-xs font-semibold text-stone-900 sm:text-sm">
                      {t.numeroVisible}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {formatearFechaUi(t.fechaJuego)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-stone-600">
                      {formatearHoraCreacion(t.createdAt)}
                    </td>
                    <td className="px-3 py-3 tabular-nums font-semibold">
                      ${t.totalApostado}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={
                          t.estado === "ANULADO"
                            ? "font-semibold text-red-700"
                            : "text-stone-800"
                        }
                      >
                        {labelEstadoPersistido(t.estado)}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-stone-700">
                      {labelEstadoDerivado(t.estadoDerivado)}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/admin/tickets/${t.id}`}
                        className="font-semibold text-emerald-800 underline underline-offset-2"
                      >
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          {result.page > 1 ? (
            <Link
              href={`/admin/tickets${buildQuery({
                ...baseParams,
                page: String(result.page - 1),
              })}`}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 font-semibold text-stone-700 hover:bg-stone-50"
            >
              Anterior
            </Link>
          ) : (
            <span className="rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 font-semibold text-stone-400">
              Anterior
            </span>
          )}

          <p className="text-stone-600">
            Página {result.totalPages === 0 ? 0 : result.page} de{" "}
            {result.totalPages}
            <span className="text-stone-400"> · {result.total} tickets</span>
          </p>

          {result.page < result.totalPages ? (
            <Link
              href={`/admin/tickets${buildQuery({
                ...baseParams,
                page: String(result.page + 1),
              })}`}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 font-semibold text-stone-700 hover:bg-stone-50"
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
