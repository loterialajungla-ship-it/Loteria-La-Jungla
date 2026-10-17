import { cn } from "@/components/ui/cn";

export type LoadingStateProps = {
  label?: string;
  className?: string;
};

export function LoadingState({
  label = "Cargando…",
  className,
}: LoadingStateProps) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-lj-md border border-border bg-surface px-4 py-6 text-center text-sm font-medium text-ink-muted",
        className,
      )}
    >
      {label}
    </p>
  );
}
