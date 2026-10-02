import type { Metadata } from "next";
import Link from "next/link";
import { CreateVendorForm } from "@/components/users/CreateVendorForm";
import { ResetVendorPasswordButton } from "@/components/users/ResetVendorPasswordButton";
import { UserStatusButton } from "@/components/users/UserStatusButton";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { listAdminUsers } from "@/lib/users/admin-users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Usuarios — Admin — Lotería La Jungla",
  description: "Gestión de vendedores.",
};

type Props = {
  searchParams: {
    activo?: string;
    rol?: string;
    page?: string;
  };
};

function formatearFechaVe(iso: string | null): string {
  if (!iso) return "Nunca";
  try {
    return new Intl.DateTimeFormat("es-VE", {
      timeZone: "America/Caracas",
      dateStyle: "short",
      timeStyle: "short",
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

export default async function AdminUsuariosPage({ searchParams }: Props) {
  const activo =
    typeof searchParams.activo === "string" ? searchParams.activo.trim() : "";
  const rol =
    typeof searchParams.rol === "string" ? searchParams.rol.trim() : "";
  const page =
    typeof searchParams.page === "string" ? searchParams.page.trim() : "1";

  const [current, result] = await Promise.all([
    getCurrentUser(),
    listAdminUsers(prisma, {
      activo: activo || undefined,
      rol: rol || undefined,
      page,
    }),
  ]);

  const baseParams = {
    activo: activo || undefined,
    rol: rol || undefined,
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
              Lotería La Jungla
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Usuarios</h1>
            <p className="mt-2 text-stone-600">
              Gestiona vendedores. Los administradores se muestran solo de forma
              informativa.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/perfil"
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              Mi cuenta
            </Link>
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

        <div className="mt-6">
          <CreateVendorForm />
        </div>

        <form
          method="get"
          className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
        >
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Estado
            <select
              name="activo"
              defaultValue={activo}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600"
            >
              <option value="">Todos</option>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Rol
            <select
              name="rol"
              defaultValue={rol}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600"
            >
              <option value="">Todos</option>
              <option value="VENDEDOR">Vendedor</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-xl bg-stone-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-stone-700"
          >
            Filtrar
          </button>
        </form>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Nombre</th>
                <th className="px-3 py-3 font-semibold">Usuario</th>
                <th className="px-3 py-3 font-semibold">Rol</th>
                <th className="px-3 py-3 font-semibold">Estado</th>
                <th className="px-3 py-3 font-semibold">Último acceso</th>
                <th className="px-3 py-3 font-semibold">Creación</th>
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
                    No hay usuarios con estos filtros.
                  </td>
                </tr>
              ) : (
                result.items.map((u) => {
                  const esAdmin = u.rol === "ADMIN";
                  const esYo = current?.id === u.id;
                  const puedeGestionar = !esAdmin && !esYo;
                  return (
                    <tr key={u.id} className="hover:bg-stone-50/80">
                      <td className="px-3 py-3 font-medium text-stone-900">
                        {u.nombre}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs sm:text-sm">
                        {u.usuario}
                      </td>
                      <td className="px-3 py-3">{u.rol}</td>
                      <td className="px-3 py-3">
                        <span
                          className={
                            u.activo
                              ? "font-semibold text-emerald-800"
                              : "font-semibold text-stone-500"
                          }
                        >
                          {u.activo ? "ACTIVO" : "INACTIVO"}
                        </span>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-stone-600">
                        {formatearFechaVe(u.lastLoginAt)}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-stone-600">
                        {formatearFechaVe(u.createdAt)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {puedeGestionar ? (
                          <div className="flex flex-col items-end gap-2">
                            <UserStatusButton
                              userId={u.id}
                              nombre={u.nombre}
                              activo={u.activo}
                            />
                            <ResetVendorPasswordButton
                              userId={u.id}
                              nombre={u.nombre}
                              usuario={u.usuario}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-stone-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          {result.page > 1 ? (
            <Link
              href={`/admin/usuarios${buildQuery({
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
            <span className="text-stone-400"> · {result.total} usuarios</span>
          </p>
          {result.page < result.totalPages ? (
            <Link
              href={`/admin/usuarios${buildQuery({
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
