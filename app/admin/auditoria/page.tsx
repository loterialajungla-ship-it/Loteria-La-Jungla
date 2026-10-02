import type { Metadata } from "next";
import Link from "next/link";
import { listAuditoria } from "@/lib/audit/list-auditoria";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Auditoría — Admin — Lotería La Jungla",
  description: "Historial de acciones administrativas.",
};

type Props = {
  searchParams: {
    fecha?: string;
    accion?: string;
    usuarioId?: string;
    entidad?: string;
    page?: string;
  };
};

function formatearFechaHora(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-VE", {
      timeZone: "America/Caracas",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return iso;
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

export default async function AdminAuditoriaPage({ searchParams }: Props) {
  const fecha =
    typeof searchParams.fecha === "string" && searchParams.fecha.trim()
      ? searchParams.fecha.trim()
      : "";
  const accion =
    typeof searchParams.accion === "string" ? searchParams.accion.trim() : "";
  const entidad =
    typeof searchParams.entidad === "string"
      ? searchParams.entidad.trim()
      : "";
  const usuarioId =
    typeof searchParams.usuarioId === "string"
      ? searchParams.usuarioId.trim()
      : "";
  const page =
    typeof searchParams.page === "string" ? searchParams.page.trim() : "1";

  const result = await listAuditoria(prisma, {
    fecha: fecha || null,
    accion: accion || null,
    entidad: entidad || null,
    usuarioId: usuarioId || null,
    page,
  });

  const baseParams = {
    fecha: fecha || undefined,
    accion: accion || undefined,
    entidad: entidad || undefined,
    usuarioId: usuarioId || undefined,
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
              Lotería La Jungla
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Auditoría
            </h1>
            <p className="mt-2 text-stone-600">
              Historial de acciones administrativas. Sin contraseñas ni tokens.
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            Resultados
          </Link>
        </div>

        <form
          method="get"
          className="mt-6 grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
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
            Acción
            <select
              name="accion"
              defaultValue={accion}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            >
              <option value="">Todas</option>
              <option value="CREAR_TICKET">CREAR_TICKET</option>
              <option value="ANULAR_TICKET">ANULAR_TICKET</option>
              <option value="CREAR_VENDEDOR">CREAR_VENDEDOR</option>
              <option value="ACTIVAR_VENDEDOR">ACTIVAR_VENDEDOR</option>
              <option value="DESACTIVAR_VENDEDOR">DESACTIVAR_VENDEDOR</option>
              <option value="CAMBIAR_PASSWORD">CAMBIAR_PASSWORD</option>
              <option value="RESET_PASSWORD">RESET_PASSWORD</option>
              <option value="CREAR_RESULTADO">CREAR_RESULTADO</option>
              <option value="MODIFICAR_RESULTADO">MODIFICAR_RESULTADO</option>
              <option value="LOGIN">LOGIN</option>
              <option value="LOGOUT">LOGOUT</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Entidad
            <select
              name="entidad"
              defaultValue={entidad}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            >
              <option value="">Todas</option>
              <option value="TICKET">TICKET</option>
              <option value="USUARIO">USUARIO</option>
              <option value="RESULTADO">RESULTADO</option>
              <option value="AUTH">AUTH</option>
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-xl bg-stone-800 px-4 py-2.5 text-base font-semibold text-white hover:bg-stone-700"
            >
              Filtrar
            </button>
          </div>
        </form>

        <p className="mt-4 text-sm text-stone-500">
          <Link
            href="/admin"
            className="underline underline-offset-2 hover:text-stone-800"
          >
            Resultados
          </Link>
          {" · "}
          <Link
            href="/admin/tickets"
            className="underline underline-offset-2 hover:text-stone-800"
          >
            Tickets
          </Link>
          {" · "}
          <Link
            href="/admin/reportes"
            className="underline underline-offset-2 hover:text-stone-800"
          >
            Reportes
          </Link>
          {" · "}
          <Link
            href="/admin/usuarios"
            className="underline underline-offset-2 hover:text-stone-800"
          >
            Usuarios
          </Link>
        </p>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-3 font-semibold">Fecha/hora</th>
                <th className="px-3 py-3 font-semibold">Usuario</th>
                <th className="px-3 py-3 font-semibold">Acción</th>
                <th className="px-3 py-3 font-semibold">Entidad</th>
                <th className="px-3 py-3 font-semibold">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {result.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-stone-500"
                  >
                    No hay eventos con estos filtros.
                  </td>
                </tr>
              ) : (
                result.items.map((ev) => (
                  <tr key={ev.id} className="hover:bg-stone-50/80">
                    <td className="px-3 py-3 tabular-nums text-stone-700 whitespace-nowrap">
                      {formatearFechaHora(ev.createdAt)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-medium">{ev.usuarioNombre}</span>
                      <span className="ml-1 font-mono text-xs text-stone-500">
                        {ev.usuarioLogin}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs font-semibold">
                      {ev.accion}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-semibold text-stone-500">
                        {ev.entidad}
                      </span>
                      <div className="font-mono text-xs text-stone-400 truncate max-w-[8rem]">
                        {ev.entidadId}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-stone-800">
                      {ev.detalleLegible}
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
              href={`/admin/auditoria${buildQuery({
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
            <span className="text-stone-400"> · {result.total} eventos</span>
          </p>
          {result.page < result.totalPages ? (
            <Link
              href={`/admin/auditoria${buildQuery({
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
