import type { Metadata } from "next";
import { listAuditoria } from "@/lib/audit/list-auditoria";
import { prisma } from "@/lib/prisma";
import { buildQuery } from "@/lib/ui/build-query";
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
  Input,
  PageHeader,
  PaginationBar,
  Select,
} from "@/components/ui";

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
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Auditoría"
        description="Historial de acciones administrativas. Sin contraseñas ni tokens."
      />

      <Card className="mt-6">
        <form
          method="get"
          className="grid gap-3 [&>*]:min-w-0 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(4,minmax(0,1fr))]"
        >
          <Input
            type="date"
            name="fecha"
            label="Fecha"
            defaultValue={fecha}
          />
          <Select name="accion" label="Acción" defaultValue={accion}>
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
          </Select>
          <Select name="entidad" label="Entidad" defaultValue={entidad}>
            <option value="">Todas</option>
            <option value="TICKET">TICKET</option>
            <option value="USUARIO">USUARIO</option>
            <option value="RESULTADO">RESULTADO</option>
            <option value="AUTH">AUTH</option>
          </Select>
          <div className="flex min-w-0 items-end">
            <Button type="submit" variant="secondary" size="md" fullWidth>
              Filtrar
            </Button>
          </div>
        </form>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No hay eventos con estos filtros"
          description="Prueba otra fecha, acción o entidad."
        />
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-3 lg:hidden">
            {result.items.map((ev) => (
              <li key={ev.id}>
                <Card padding="sm">
                  <p className="text-xs font-medium tabular-nums text-ink-muted">
                    {formatearFechaHora(ev.createdAt)}
                  </p>
                  <p className="mt-1 font-mono text-xs font-bold text-ink">
                    {ev.accion}
                  </p>
                  <p className="mt-1 text-sm text-ink">
                    <span className="font-semibold">{ev.usuarioNombre}</span>{" "}
                    <span className="font-mono text-xs text-ink-muted">
                      {ev.usuarioLogin}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {ev.entidad}
                    {ev.entidadId ? ` · ${ev.entidadId}` : ""}
                  </p>
                  <p className="mt-2 text-sm text-ink-secondary">
                    {ev.detalleLegible}
                  </p>
                </Card>
              </li>
            ))}
          </ul>

          <div className="mt-6 hidden lg:block">
            <DataTable
              caption="Eventos de auditoría"
              minWidthClassName="min-w-[720px]"
            >
              <DataTableHead>
                <tr>
                  <DataTableTh>Fecha/hora</DataTableTh>
                  <DataTableTh>Usuario</DataTableTh>
                  <DataTableTh>Acción</DataTableTh>
                  <DataTableTh>Entidad</DataTableTh>
                  <DataTableTh>Detalle</DataTableTh>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {result.items.map((ev) => (
                  <DataTableRow key={ev.id}>
                    <DataTableTd className="whitespace-nowrap tabular-nums text-ink-secondary">
                      {formatearFechaHora(ev.createdAt)}
                    </DataTableTd>
                    <DataTableTd>
                      <span className="font-medium">{ev.usuarioNombre}</span>
                      <span className="ml-1 font-mono text-xs text-ink-muted">
                        {ev.usuarioLogin}
                      </span>
                    </DataTableTd>
                    <DataTableTd className="font-mono text-xs font-semibold">
                      {ev.accion}
                    </DataTableTd>
                    <DataTableTd>
                      <span className="text-xs font-semibold text-ink-muted">
                        {ev.entidad}
                      </span>
                      <div className="max-w-[8rem] truncate font-mono text-xs text-ink-muted">
                        {ev.entidadId}
                      </div>
                    </DataTableTd>
                    <DataTableTd className="text-ink">
                      {ev.detalleLegible}
                    </DataTableTd>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </div>
        </>
      )}

      <PaginationBar
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        itemLabel="eventos"
        prevHref={
          result.page > 1
            ? `/admin/auditoria${buildQuery({
                ...baseParams,
                page: String(result.page - 1),
              })}`
            : null
        }
        nextHref={
          result.page < result.totalPages
            ? `/admin/auditoria${buildQuery({
                ...baseParams,
                page: String(result.page + 1),
              })}`
            : null
        }
      />
    </main>
  );
}
