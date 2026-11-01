import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { prisma } from "@/lib/prisma";
import { hoyYYYYMMDD } from "@/lib/fecha";
import { formatearFechaUi } from "@/components/tickets/pos-state";
import { VendorTicketsSortBar } from "@/components/tickets/VendorTicketsSortControls";
import { listVendorTickets } from "@/lib/tickets/vendor-tickets";
import {
  VENDOR_TICKET_SORT_KEYS,
  type VendorTicketSortKey,
} from "@/lib/tickets/vendor-ticket-sort";
import { buildQuery } from "@/lib/ui/build-query";
import { ticketDerivadoBadge } from "@/lib/ui/status-labels";
import { parseTableSortState } from "@/lib/ui/table-sort-query";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  PaginationBar,
  Select,
  StatusBadge,
} from "@/components/ui";

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
    pageSize?: string;
    sort?: string;
    dir?: string;
  };
};

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
  // Whitelist vendor propia (sin cast desde parser admin). Paridad de claves
  // con ADMIN_TICKET_SORT_KEYS cubierta en vendor-ticket-sort.test.ts.
  const sortState = parseTableSortState<VendorTicketSortKey>(
    sortRaw || undefined,
    dirRaw || undefined,
    VENDOR_TICKET_SORT_KEYS,
  );

  const result = await listVendorTickets(
    prisma,
    { userId: actor.userId, rol: actor.user.rol },
    query,
  );

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
    <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Mis tickets"
        description={
          actor.user.rol === "VENDEDOR"
            ? "Solo ves los tickets que tú emitiste."
            : "Vista de venta (ADMIN puede ver todos)."
        }
      />

      <Card className="mt-6">
        <form method="get" className="grid gap-3">
          <Input type="date" name="fecha" label="Fecha" defaultValue={fecha} />
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
            placeholder="LJ-20261002-000125"
            className="font-mono"
          />
          {pageSize ? (
            <input type="hidden" name="pageSize" value={pageSize} />
          ) : null}
          {sortState.key && sortState.dir ? (
            <>
              <input type="hidden" name="sort" value={sortState.key} />
              <input type="hidden" name="dir" value={sortState.dir} />
            </>
          ) : null}
          <Button type="submit" variant="primary" size="md" fullWidth>
            Buscar
          </Button>
        </form>
      </Card>

      <Card className="mt-4" padding="sm">
        <VendorTicketsSortBar sort={sortState} listParams={listParams} />
      </Card>

      {result.tickets.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No hay tickets con estos filtros"
          description="Cambia la fecha o el estado, o emite un ticket nuevo."
          action={
            <Link
              href="/venta"
              className="text-sm font-semibold text-brand-800 underline underline-offset-2"
            >
              Ir a venta
            </Link>
          }
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {result.tickets.map((t) => {
            const derivado = ticketDerivadoBadge(t.estadoDerivado);
            return (
              <li key={t.id}>
                <Card padding="sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold text-ink">
                        {t.numeroVisible}
                      </p>
                      <p className="mt-1 text-sm text-ink-secondary">
                        {formatearFechaUi(t.fechaJuego)} · ${t.totalApostado}
                      </p>
                      <div className="mt-2">
                        <StatusBadge
                          tone={derivado.tone}
                          label={derivado.label}
                        />
                      </div>
                    </div>
                    <Link
                      href={`/venta/tickets/${t.id}`}
                      className="inline-flex min-h-10 shrink-0 items-center rounded-lj-md bg-brand-800 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    >
                      Ver
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <PaginationBar
        page={result.pagination.page}
        totalPages={result.pagination.totalPages}
        total={result.pagination.total}
        itemLabel="tickets"
        prevHref={
          result.pagination.page > 1
            ? `/venta/tickets${buildQuery({
                ...baseParams,
                page: String(result.pagination.page - 1),
              })}`
            : null
        }
        nextHref={
          result.pagination.page < result.pagination.totalPages
            ? `/venta/tickets${buildQuery({
                ...baseParams,
                page: String(result.pagination.page + 1),
              })}`
            : null
        }
      />
    </main>
  );
}
