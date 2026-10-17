import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-lj-lg border border-dashed border-border bg-surface-muted/40 px-4 py-8 text-center",
        className,
      )}
    >
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? (
        <div className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
