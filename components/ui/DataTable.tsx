import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type DataTableProps = {
  children: ReactNode;
  /** Clase min-width opcional para forzar scroll interno en pantallas estrechas. */
  minWidthClassName?: string;
  className?: string;
  caption?: string;
};

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
