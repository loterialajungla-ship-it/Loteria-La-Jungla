import type { Metadata } from "next";
import { CreateVendorForm } from "@/components/users/CreateVendorForm";
import { ResetVendorPasswordButton } from "@/components/users/ResetVendorPasswordButton";
import { UserStatusButton } from "@/components/users/UserStatusButton";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { listAdminUsers } from "@/lib/users/admin-users";
import { buildQuery } from "@/lib/ui/build-query";
import { usuarioActivoBadge } from "@/lib/ui/status-labels";
import {
  Button,
  Card,
  DataTable,
  DataTableBody,
  DataTableHead,
  DataTableRow,
  DataTableTd,
  DataTableTh,
  EmptyState,
  PageHeader,
  PaginationBar,
  Select,
  StatusBadge,
} from "@/components/ui";

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
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Usuarios"
        description="Gestiona vendedores. Los administradores se muestran solo de forma informativa."
      />

      <div className="mt-6">
        <CreateVendorForm />
      </div>

      <Card className="mt-6">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Select
            name="activo"
            label="Estado"
            defaultValue={activo}
            containerClassName="min-w-[9rem]"
          >
            <option value="">Todos</option>
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
          </Select>
          <Select
            name="rol"
            label="Rol"
            defaultValue={rol}
            containerClassName="min-w-[9rem]"
          >
            <option value="">Todos</option>
            <option value="VENDEDOR">Vendedor</option>
            <option value="ADMIN">Admin</option>
          </Select>
          <Button type="submit" variant="secondary" size="md">
            Filtrar
          </Button>
        </form>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No hay usuarios con estos filtros"
          description="Ajusta el estado o el rol, o crea un vendedor nuevo."
        />
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-3 lg:hidden">
            {result.items.map((u) => {
              const badge = usuarioActivoBadge(u.activo);
              const esAdmin = u.rol === "ADMIN";
              const esYo = current?.id === u.id;
              const puedeGestionar = !esAdmin && !esYo;
              return (
                <li key={u.id}>
                  <Card padding="sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{u.nombre}</p>
                        <p className="font-mono text-xs text-ink-muted">
                          {u.usuario}
                        </p>
                      </div>
                      <StatusBadge tone={badge.tone} label={badge.label} />
                    </div>
                    <p className="mt-2 text-sm text-ink-secondary">
                      Rol: <strong className="text-ink">{u.rol}</strong>
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Último acceso: {formatearFechaVe(u.lastLoginAt)}
                    </p>
                    {puedeGestionar ? (
                      <div className="mt-3 flex flex-wrap gap-2">
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
                      <p className="mt-2 text-xs text-ink-muted">
                        Sin acciones de gestión
                      </p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 hidden lg:block">
            <DataTable
              caption="Listado de usuarios"
              minWidthClassName="min-w-[720px]"
            >
              <DataTableHead>
                <tr>
                  <DataTableTh>Nombre</DataTableTh>
                  <DataTableTh>Usuario</DataTableTh>
                  <DataTableTh>Rol</DataTableTh>
                  <DataTableTh>Estado</DataTableTh>
                  <DataTableTh>Último acceso</DataTableTh>
                  <DataTableTh>Creación</DataTableTh>
                  <DataTableTh>Acción</DataTableTh>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {result.items.map((u) => {
                  const badge = usuarioActivoBadge(u.activo);
                  const esAdmin = u.rol === "ADMIN";
                  const esYo = current?.id === u.id;
                  const puedeGestionar = !esAdmin && !esYo;
                  return (
                    <DataTableRow key={u.id}>
                      <DataTableTd className="font-medium text-ink">
                        {u.nombre}
                      </DataTableTd>
                      <DataTableTd className="font-mono text-xs sm:text-sm">
                        {u.usuario}
                      </DataTableTd>
                      <DataTableTd>{u.rol}</DataTableTd>
                      <DataTableTd>
                        <StatusBadge tone={badge.tone} label={badge.label} />
                      </DataTableTd>
                      <DataTableTd className="tabular-nums text-ink-secondary">
                        {formatearFechaVe(u.lastLoginAt)}
                      </DataTableTd>
                      <DataTableTd className="tabular-nums text-ink-secondary">
                        {formatearFechaVe(u.createdAt)}
                      </DataTableTd>
                      <DataTableTd className="text-right">
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
                          <span className="text-xs text-ink-muted">—</span>
                        )}
                      </DataTableTd>
                    </DataTableRow>
                  );
                })}
              </DataTableBody>
            </DataTable>
          </div>
        </>
      )}

      <PaginationBar
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        itemLabel="usuarios"
        prevHref={
          result.page > 1
            ? `/admin/usuarios${buildQuery({
                ...baseParams,
                page: String(result.page - 1),
              })}`
            : null
        }
        nextHref={
          result.page < result.totalPages
            ? `/admin/usuarios${buildQuery({
                ...baseParams,
                page: String(result.page + 1),
              })}`
            : null
        }
      />
    </main>
  );
}
