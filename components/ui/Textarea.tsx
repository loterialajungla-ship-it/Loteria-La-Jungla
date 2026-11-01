import React, {
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/components/ui/cn";

export type TextareaVariant = "default" | "danger";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  error?: string;
  hint?: string;
  containerClassName?: string;
  /**
   * Variante de énfasis visual. `danger` usa anillo/borde danger en foco
   * sin mezclar clases brand contradictorias (cn no hace twMerge).
   */
  variant?: TextareaVariant;
};

const focusByVariant: Record<TextareaVariant, string> = {
  default:
    "focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
  danger:
    "focus-visible:border-danger-700 focus-visible:ring-2 focus-visible:ring-danger-100 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
};

/**
 * Textarea alineado con Input/Select: ancho fluido, min-w-0, accesible.
 * `resize` por defecto vertical; el caller puede sobrescribir con className
 * (evitar overrides de focus que choquen con `variant`).
 */
export function Textarea({
  id,
  name,
  label,
  error,
  hint,
  className,
  containerClassName,
  required,
  rows = 3,
  variant = "default",
  ...props
}: TextareaProps) {
  const fieldId = id ?? (typeof name === "string" ? name : undefined);
  const errorId = fieldId && error ? `${fieldId}-error` : undefined;
  const hintId = fieldId && hint && !error ? `${fieldId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const tone: TextareaVariant = error ? "danger" : variant;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-2",
        containerClassName,
      )}
    >
      {label ? (
        <label htmlFor={fieldId} className="text-sm font-medium text-ink">
          {label}
          {required ? (
            <span className="sr-only"> (obligatorio)</span>
          ) : null}
        </label>
      ) : null}
      <textarea
        id={fieldId}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        data-variant={tone}
        className={cn(
          "box-border w-full min-w-0 max-w-full resize-y rounded-lj-md border bg-surface px-4 py-3 text-base text-ink",
          "placeholder:text-ink-muted",
          "outline-none transition-colors",
          "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60",
          tone === "danger" ? "border-danger-700" : "border-border-strong",
          focusByVariant[tone],
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
