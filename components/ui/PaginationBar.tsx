import React from "react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";

export type PaginationBarProps = {
  page: number;
  totalPages: number;
  total: number;
  itemLabel: string;
  prevHref: string | null;
  nextHref: string | null;
  className?: string;
};

const btnBase =
  "inline-flex min-h-11 min-w-[2.75rem] items-center justify-center rounded-lj-md border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2";

export function PaginationBar({
  page,
  totalPages,
  total,
  itemLabel,
  prevHref,
  nextHref,
  className,
}: PaginationBarProps) {
  const pageShown = totalPages === 0 ? 0 : page;

  return (
    <nav
      aria-label="Paginación"
      className={cn(
        "mt-4 flex flex-wrap items-center justify-between gap-3 text-sm",
        className,
      )}
    >
      {prevHref ? (
        <Link
          href={prevHref}
          className={cn(
            btnBase,
            "border-border-strong bg-surface text-ink hover:bg-surface-muted",
          )}
        >
          Anterior
        </Link>
      ) : (
        <span
          className={cn(
            btnBase,
            "cursor-not-allowed border-border bg-surface-muted text-ink-muted",
          )}
          aria-disabled="true"
        >
          Anterior
        </span>
      )}

      <p className="min-w-0 flex-1 text-center text-ink-secondary">
        Página {pageShown} de {totalPages}
        <span className="text-ink-muted">
          {" "}
          · {total} {itemLabel}
        </span>
      </p>

      {nextHref ? (
        <Link
          href={nextHref}
          className={cn(
            btnBase,
            "border-border-strong bg-surface text-ink hover:bg-surface-muted",
          )}
        >
          Siguiente
        </Link>
      ) : (
        <span
          className={cn(
            btnBase,
            "cursor-not-allowed border-border bg-surface-muted text-ink-muted",
          )}
          aria-disabled="true"
        >
          Siguiente
        </span>
      )}
    </nav>
  );
}
