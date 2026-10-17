import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type PageHeaderProps = {
  brand?: string;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  brand = "Lotería La Jungla",
  title,
  description,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {brand ? (
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-800">
            {brand}
          </p>
        ) : null}
        <h1
          className={cn(
            "text-3xl font-bold tracking-tight text-ink text-balance",
            brand && "mt-1",
          )}
        >
          {title}
        </h1>
        {meta ? (
          <div className="mt-2 text-base font-medium text-ink-secondary">
            {meta}
          </div>
        ) : null}
        {description ? (
          <div className="mt-2 max-w-prose text-sm text-ink-muted sm:text-base">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
