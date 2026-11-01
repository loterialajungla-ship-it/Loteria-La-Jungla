import React, { type PropsWithChildren, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import {
  ariaSortValue,
  isSortColumnActive,
  sortIndicatorGlyph,
  type TableSortState,
} from "@/lib/ui/table-sort";

export type DataTableProps = PropsWithChildren<{
  /** Clase min-width opcional para forzar scroll interno en pantallas estrechas. */
  minWidthClassName?: string;
  className?: string;
  caption?: string;
}>;

/**
 * Contenedor de tabla con scroll horizontal local (no de página).
 * En móvil las páginas pueden preferir cards; este shell es para escritorio/tablet.
 */
export function DataTable({
  children,
  minWidthClassName = "min-w-[640px]",
  className,
  caption,
}: DataTableProps) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-lj-lg border border-border bg-surface shadow-surface",
        className,
      )}
    >
      <table className={cn("w-full text-left text-sm", minWidthClassName)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function DataTableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-border bg-surface-muted text-ink-secondary">
      {children}
    </thead>
  );
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

/**
 * Encabezado estático (comportamiento histórico).
 * No activa ordenación: mantener usos existentes sin cambios.
 */
export function DataTableTh({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-3 font-semibold", className)}>{children}</th>
  );
}

export type SortableDataTableThProps<K extends string = string> =
  PropsWithChildren<{
    className?: string;
    /** Identificador de columna (lista blanca en el caller / servidor). */
    column: K;
    /** Estado de ordenación de la tabla. */
    sort: TableSortState<K>;
    /** Notifica clic; el caller aplica `cycleTableSort`. */
    onSortClick: (column: K) => void;
  }>;

/**
 * Encabezado opt-in con ordenación.
 * Separado de `DataTableTh` para no alterar firmas ni markup de tablas actuales.
 */
export function SortableDataTableTh<K extends string>({
  children,
  className,
  column,
  sort,
  onSortClick,
}: SortableDataTableThProps<K>) {
  const active = isSortColumnActive(column, sort);

  return (
    <th
      scope="col"
      aria-sort={ariaSortValue(column, sort)}
      className={cn("px-1 py-1 font-semibold sm:px-2", className)}
    >
      <button
        type="button"
        onClick={() => onSortClick(column)}
        className={cn(
          "inline-flex min-h-10 w-full items-center gap-1 rounded-sm px-2 py-2 text-left",
          "hover:bg-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
          active ? "text-brand-900" : "text-ink-secondary",
        )}
      >
        <span>{children}</span>
        <span
          className={cn(
            "text-xs tabular-nums",
            active ? "text-brand-800" : "text-ink-muted",
          )}
          aria-hidden
        >
          {sortIndicatorGlyph(column, sort)}
        </span>
      </button>
    </th>
  );
}

export function DataTableTd({
  children,
  className,
  colSpan,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td className={cn("px-3 py-3", className)} colSpan={colSpan}>
      {children}
    </td>
  );
}

export function DataTableRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn("hover:bg-surface-muted/60", className)}>{children}</tr>
  );
}
