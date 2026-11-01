import type { Metadata } from "next";
import Link from "next/link";
import { listAdminTickets } from "@/lib/tickets/list-admin-tickets";
import { parseAdminListTicketsQuery } from "@/lib/tickets/admin-ticket-query";
import {
  ADMIN_TICKET_SORT_KEYS,
  type AdminTicketSortKey,
} from "@/lib/tickets/admin-ticket-sort";
import { prisma } from "@/lib/prisma";
import { hoyYYYYMMDD } from "@/lib/fecha";
import { formatearFechaUi } from "@/components/tickets/pos-state";
import { AdminTicketsSortableHead } from "@/components/tickets/AdminTicketsSortControls";
import { buildQuery } from "@/lib/ui/build-query";
import {
  ticketDerivadoBadge,
  ticketPersistidoBadge,
} from "@/lib/ui/status-labels";
import {
  Button,
  Card,
  DataTable,
  DataTableBody,
  DataTableHead,
  DataTableRow,
  DataTableTd,
  EmptyState,
  Input,
  PageHeader,
  PaginationBar,
  Select,
  StatusBadge,
} from "@/components/ui";

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
    pageSize?: string;
    sort?: string;
    dir?: string;
  };
};

const SORT_LABELS: Record<AdminTicketSortKey, string> = {
  numeroVisible: "Número",
  fechaJuego: "Fecha",
  createdAt: "Creación",
  totalApostado: "Total",
  estado: "Estado",
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
  const pageSize =
    typeof searchParams.pageSize === "string" && searchParams.pageSize.trim()
      ? searchParams.pageSize.trim()
      : undefined;
  const sortRaw =
    typeof searchParams.sort === "string" ? searchParams.sort.trim() : "";
  const dirRaw =
    typeof searchParams.dir === "string" ? searchParams.dir.trim() : "";

  const query = {
    fecha,
    estado: estado || undefined,
    numero: numero || undefined,
    page,
    pageSize,
    sort: sortRaw || undefined,
    dir: dirRaw || undefined,
  };
  const sortState = parseAdminListTicketsQuery(query).sort;
  const result = await listAdminTickets(prisma, query);

  const baseParams = {
    fecha,
    estado: estado || undefined,
    numero: numero || undefined,
    pageSize,
    sort: sortState.key ?? undefined,
    dir: sortState.dir ?? undefined,
  };

  const listParams = {
    fecha,
    estado: estado || undefined,
    numero: numero || undefined,
    pageSize,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Tickets"
        description="Consulta, filtra y anula tickets emitidos."
      />

      <Card className="mt-6">
        <form method="get" className="grid gap-3 sm:grid-cols-2">
          <Input
            type="date"
            name="fecha"
            label="Fecha"
            defaultValue={fecha}
          />
          <Select name="estado" label="Estado" defaultValue={estado}>
            <option value="">Todos</option>
            <option value="EMITIDO">Emitidos</option>
            <option value="ANULADO">Anulados</option>
          </Select>
          <Input
            type="search"
            name="numero"
            label="Número de ticket"
            defaultValue={numero}
            placeholder="LJ-20261001-000001"
            containerClassName="sm:col-span-2"
            className="font-mono"
          />
          {pageSize ? (
            <input type="hidden" name="pageSize" value={pageSize} />
          ) : null}
          {/* Escritorio: sort se controla por cabeceras; se preserva al buscar. */}
          {sortState.key && sortState.dir ? (
            <>
              <input type="hidden" name="sort" value={sortState.key} />
              <input type="hidden" name="dir" value={sortState.dir} />
            </>
          ) : null}
          <Button type="submit" variant="primary" size="md" className="sm:col-span-2">
            Buscar
          </Button>
        </form>
      </Card>

      {/* Móvil: controles de ordenación (sin cabeceras de tabla). */}
      <Card className="mt-4 md:hidden">
        <form method="get" className="grid gap-3">
          <input type="hidden" name="fecha" value={fecha} />
          {estado ? <input type="hidden" name="estado" value={estado} /> : null}
          {numero ? <input type="hidden" name="numero" value={numero} /> : null}
          {pageSize ? (
            <input type="hidden" name="pageSize" value={pageSize} />
          ) : null}
          {/* Sin page → reinicia a 1 */}
          <Select
            name="sort"
            label="Ordenar por"
            defaultValue={sortState.key ?? ""}
          >
            <option value="">Predeterminado (creación ↓)</option>
            {ADMIN_TICKET_SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </Select>
          <Select
            name="dir"
            label="Dirección"
            defaultValue={sortState.dir ?? "asc"}
          >
            <option value="asc">Ascendente</option>
            <option value="desc">Descendente</option>
          </Select>
          <Button type="submit" variant="secondary" size="md">
            Aplicar orden
          </Button>
        </form>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No hay tickets con estos filtros"
          description="Prueba otra fecha, estado o número de ticket."
        />
      ) : (
        <>
          {/* Móvil: cards */}
          <ul className="mt-6 flex flex-col gap-3 md:hidden">
            {result.items.map((t) => {
              const persistido = ticketPersistidoBadge(t.estado);
              const derivado = ticketDerivadoBadge(t.estadoDerivado);
              return (
                <li key={t.id}>
                  <Card padding="sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-sm font-bold text-ink">
                        {t.numeroVisible}
                      </p>
                      <StatusBadge
                        tone={persistido.tone}
                        label={persistido.label}
                      />
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <div>
                        <dt className="text-ink-muted">Fecha</dt>
                        <dd className="font-medium tabular-nums text-ink">
                          {formatearFechaUi(t.fechaJuego)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Total</dt>
                        <dd className="font-semibold tabular-nums text-ink">
                          ${t.totalApostado}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Creación</dt>
                        <dd className="tabular-nums text-ink-secondary">
                          {formatearHoraCreacion(t.createdAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Resultado</dt>
                        <dd className="mt-0.5">
                          <StatusBadge
                            tone={derivado.tone}
                            label={derivado.label}
                          />
                        </dd>
                      </div>
                    </dl>
                    <Link
                      href={`/admin/tickets/${t.id}`}
                      className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-brand-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    >
                      Ver detalle
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>

          {/* Escritorio: tabla */}
          <div className="mt-6 hidden md:block">
            <DataTable caption="Listado de tickets">
              <DataTableHead>
                <AdminTicketsSortableHead
                  sort={sortState}
                  listParams={listParams}
                />
              </DataTableHead>
              <DataTableBody>
                {result.items.map((t) => {
                  const persistido = ticketPersistidoBadge(t.estado);
                  const derivado = ticketDerivadoBadge(t.estadoDerivado);
                  return (
                    <DataTableRow key={t.id}>
                      <DataTableTd className="font-mono text-xs font-semibold text-ink sm:text-sm">
                        {t.numeroVisible}
                      </DataTableTd>
                      <DataTableTd className="tabular-nums">
                        {formatearFechaUi(t.fechaJuego)}
                      </DataTableTd>
                      <DataTableTd className="tabular-nums text-ink-secondary">
                        {formatearHoraCreacion(t.createdAt)}
                      </DataTableTd>
                      <DataTableTd className="font-semibold tabular-nums">
                        ${t.totalApostado}
                      </DataTableTd>
                      <DataTableTd>
                        <StatusBadge
                          tone={persistido.tone}
                          label={persistido.label}
                        />
                      </DataTableTd>
                      <DataTableTd>
                        <StatusBadge
                          tone={derivado.tone}
                          label={derivado.label}
                        />
                      </DataTableTd>
                      <DataTableTd>
                        <Link
                          href={`/admin/tickets/${t.id}`}
                          className="font-semibold text-brand-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                        >
                          Ver
                        </Link>
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
        itemLabel="tickets"
        prevHref={
          result.page > 1
            ? `/admin/tickets${buildQuery({
                ...baseParams,
                page: String(result.page - 1),
              })}`
            : null
        }
        nextHref={
          result.page < result.totalPages
            ? `/admin/tickets${buildQuery({
                ...baseParams,
                page: String(result.page + 1),
              })}`
            : null
        }
      />
    </main>
  );
}
