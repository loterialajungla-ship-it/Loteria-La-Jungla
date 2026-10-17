import type { HTMLAttributes } from "react";
import { cn } from "@/components/ui/cn";

export type StatusBadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusBadgeTone;
  /** Texto visible del estado (no depende solo del color). */
  label: string;
};

const toneClasses: Record<StatusBadgeTone, string> = {
  neutral: "border-border-strong bg-surface-muted text-ink-secondary",
  success: "border-brand-200 bg-brand-50 text-brand-800",
  warning: "border-accent-100 bg-accent-50 text-accent-800",
  danger: "border-danger-100 bg-danger-50 text-danger-800",
  info: "border-brand-100 bg-brand-50 text-brand-700",
};

export function StatusBadge({
  tone = "neutral",
  label,
  className,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lj-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {label}
    </span>
  );
}
