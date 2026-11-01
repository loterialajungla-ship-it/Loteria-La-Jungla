"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { buildQuery } from "@/lib/ui/build-query";
import {
  ariaSortValue,
  cycleTableSort,
  isSortColumnActive,
  sortIndicatorGlyph,
  type TableSortState,
} from "@/lib/ui/table-sort";
import type { VendorTicketSortKey } from "@/lib/tickets/vendor-ticket-sort";

export type VendorTicketsListParams = {
  fecha?: string;
  estado?: string;
  numero?: string;
  pageSize?: string;
};

export const VENDOR_TICKET_SORT_COLUMNS: ReadonlyArray<{
  key: VendorTicketSortKey;
  label: string;
}> = [
  { key: "numeroVisible", label: "Número" },
  { key: "fechaJuego", label: "Fecha" },
  { key: "createdAt", label: "Creación" },
  { key: "totalApostado", label: "Total" },
  { key: "estado", label: "Estado" },
];

type SortButtonsProps = {
  sort: TableSortState<VendorTicketSortKey>;
  onSortClick: (column: VendorTicketSortKey) => void;
  className?: string;
};

type SortBarProps = {
  sort: TableSortState<VendorTicketSortKey>;
  listParams: VendorTicketsListParams;
};

/** URL de /venta/tickets tras ciclo de orden (page=1; filtros/pageSize intactos). */
export function buildVendorTicketsSortHref(
  listParams: VendorTicketsListParams,
  next: TableSortState<VendorTicketSortKey>,
): string {
  return `/venta/tickets${buildQuery({
    fecha: listParams.fecha,
    estado: listParams.estado,
    numero: listParams.numero,
    pageSize: listParams.pageSize,
    page: "1",
    sort: next.key ?? undefined,
    dir: next.dir ?? undefined,
  })}`;
}

export function nextVendorTicketsSortHref(
  listParams: VendorTicketsListParams,
  current: TableSortState<VendorTicketSortKey>,
  column: VendorTicketSortKey,
): string {
  return buildVendorTicketsSortHref(
    listParams,
    cycleTableSort(current, column),
  );
}

export function createVendorTicketsSortClickHandler(
  listParams: VendorTicketsListParams,
  sort: TableSortState<VendorTicketSortKey>,
  navigate: (href: string) => void,
): (column: VendorTicketSortKey) => void {
  return (column) => {
    navigate(nextVendorTicketsSortHref(listParams, sort, column));
  };
}

function sortButtonAriaLabel(
  label: string,
  column: VendorTicketSortKey,
  sort: TableSortState<VendorTicketSortKey>,
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
 * Botones táctiles (móvil y escritorio). Misma lógica/URL.
 * Accesibilidad vía botón nativo (sin roles de tabla artificiales).
 */
export function VendorTicketsSortButtons({
  sort,
  onSortClick,
  className,
}: SortButtonsProps) {
  return (
    <div
      className={cn(className)}
      role="group"
      aria-label="Ordenar tickets"
      data-testid="vendor-tickets-sort"
    >
      <p className="mb-2 text-sm font-semibold text-ink-secondary">Ordenar</p>
      <ul className="flex flex-wrap gap-2">
        {VENDOR_TICKET_SORT_COLUMNS.map(({ key, label }) => {
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

/** Barra de ordenación con navegación por URL (misma en móvil y escritorio). */
export function VendorTicketsSortBar({ sort, listParams }: SortBarProps) {
  const router = useRouter();
  const onSortClick = createVendorTicketsSortClickHandler(
    listParams,
    sort,
    (href) => {
      router.push(href);
    },
  );

  return (
    <VendorTicketsSortButtons sort={sort} onSortClick={onSortClick} />
  );
}
