"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  DataTableTh,
  SortableDataTableTh,
} from "@/components/ui/DataTable";
import { cn } from "@/components/ui/cn";
import { buildQuery } from "@/lib/ui/build-query";
import {
  ariaSortValue,
  cycleTableSort,
  isSortColumnActive,
  sortIndicatorGlyph,
  type TableSortState,
} from "@/lib/ui/table-sort";
import type { AdminTicketSortKey } from "@/lib/tickets/admin-ticket-sort";

export type AdminTicketsListParams = {
  fecha?: string;
  estado?: string;
  numero?: string;
  pageSize?: string;
  sort?: string;
  dir?: string;
};

export const ADMIN_TICKET_SORT_COLUMNS: ReadonlyArray<{
  key: AdminTicketSortKey;
  label: string;
}> = [
  { key: "numeroVisible", label: "Número" },
  { key: "fechaJuego", label: "Fecha" },
  { key: "createdAt", label: "Creación" },
  { key: "totalApostado", label: "Total" },
  { key: "estado", label: "Estado" },
];

type SortViewProps = {
  sort: TableSortState<AdminTicketSortKey>;
  listParams: AdminTicketsListParams;
};

type MobileButtonsProps = {
  sort: TableSortState<AdminTicketSortKey>;
  onSortClick: (column: AdminTicketSortKey) => void;
  className?: string;
};

/** URL de listado tras un ciclo de ordenación (page=1; filtros/pageSize intactos). */
export function buildAdminTicketsSortHref(
  listParams: AdminTicketsListParams,
  next: TableSortState<AdminTicketSortKey>,
): string {
  return `/admin/tickets${buildQuery({
    fecha: listParams.fecha,
    estado: listParams.estado,
    numero: listParams.numero,
    pageSize: listParams.pageSize,
    page: "1",
    sort: next.key ?? undefined,
    dir: next.dir ?? undefined,
  })}`;
}

/** Aplica el mismo ciclo que escritorio/móvil y construye el href. */
export function nextAdminTicketsSortHref(
  listParams: AdminTicketsListParams,
  current: TableSortState<AdminTicketSortKey>,
  column: AdminTicketSortKey,
): string {
  return buildAdminTicketsSortHref(listParams, cycleTableSort(current, column));
}

/**
 * Handler compartido de clic de ordenación.
 * Escritorio y móvil lo usan con `router.push` (o un navigate de prueba).
 */
export function createAdminTicketsSortClickHandler(
  listParams: AdminTicketsListParams,
  sort: TableSortState<AdminTicketSortKey>,
  navigate: (href: string) => void,
): (column: AdminTicketSortKey) => void {
  return (column) => {
    navigate(nextAdminTicketsSortHref(listParams, sort, column));
  };
}

function sortButtonAriaLabel(
  label: string,
  column: AdminTicketSortKey,
  sort: TableSortState<AdminTicketSortKey>,
): string {
  const aria = ariaSortValue(column, sort);
  if (aria === "ascending") {
    return `${label}, orden ascendente. Pulsar para descendente`;
  }
  if (aria === "descending") {
    return `${label}, orden descendente. Pulsar para predeterminado`;
  }
  return `${label}, sin orden activo. Pulsar para ascendente`;
}

/**
 * Botones táctiles (presentacional). Sin router: apto para SSR en tests.
 * Accesibilidad vía botón nativo + aria-label / aria-pressed (sin roles de tabla).
 */
export function AdminTicketsMobileSortButtons({
  sort,
  onSortClick,
  className,
}: MobileButtonsProps) {
  return (
    <div
      className={cn(className)}
      role="group"
      aria-label="Ordenar tickets"
      data-testid="admin-tickets-mobile-sort"
    >
      <p className="mb-2 text-sm font-semibold text-ink-secondary">Ordenar</p>
      <ul className="flex flex-wrap gap-2">
        {ADMIN_TICKET_SORT_COLUMNS.map(({ key, label }) => {
          const active = isSortColumnActive(key, sort);
          const glyph = sortIndicatorGlyph(key, sort);
          return (
            <li key={key} className="min-w-0">
              <button
                type="button"
                onClick={() => onSortClick(key)}
                aria-label={sortButtonAriaLabel(label, key, sort)}
                aria-pressed={active}
                className={cn(
                  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1",
                  "rounded-lj-md border px-3 py-2 text-sm font-semibold",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
                  active
                    ? "border-brand-700 bg-brand-50 text-brand-900"
                    : "border-border bg-surface text-ink-secondary hover:bg-surface-muted",
                )}
              >
                <span>{label}</span>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    active ? "text-brand-800" : "text-ink-muted",
                  )}
                  aria-hidden
                >
                  {glyph}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Cabeceras ordenables (escritorio). Navega por URL; no ordena en cliente.
 */
export function AdminTicketsSortableHead({ sort, listParams }: SortViewProps) {
  const router = useRouter();
  const onSortClick = createAdminTicketsSortClickHandler(
    listParams,
    sort,
    (href) => {
      router.push(href);
    },
  );

  return (
    <tr>
      {ADMIN_TICKET_SORT_COLUMNS.map(({ key, label }) => (
        <SortableDataTableTh
          key={key}
          column={key}
          sort={sort}
          onSortClick={onSortClick}
        >
          {label}
        </SortableDataTableTh>
      ))}
      <DataTableTh>Resultado</DataTableTh>
      <DataTableTh>Acción</DataTableTh>
    </tr>
  );
}

/**
 * Controles táctiles de ordenación (móvil). Mismo ciclo y URL que escritorio.
 */
export function AdminTicketsMobileSortBar({ sort, listParams }: SortViewProps) {
  const router = useRouter();
  const onSortClick = createAdminTicketsSortClickHandler(
    listParams,
    sort,
    (href) => {
      router.push(href);
    },
  );

  return (
    <AdminTicketsMobileSortButtons
      sort={sort}
      onSortClick={onSortClick}
      className="md:hidden"
    />
  );
}
