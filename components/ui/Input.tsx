import React, { type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  error?: string;
  hint?: string;
  containerClassName?: string;
};

export function Input({
  id,
  name,
  label,
  error,
  hint,
  className,
  containerClassName,
  required,
  ...props
}: InputProps) {
  const fieldId = id ?? (typeof name === "string" ? name : undefined);
  const errorId = fieldId && error ? `${fieldId}-error` : undefined;
  const hintId = fieldId && hint && !error ? `${fieldId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      className={cn(
        // min-w-0: permite encoger en flex/grid; evita overflow de date/time nativos.
        "flex w-full min-w-0 flex-col gap-2",
        containerClassName,
      )}
    >
      {label ? (
        <label
          htmlFor={fieldId}
          className="text-sm font-medium text-ink"
        >
          {label}
          {required ? (
            <span className="sr-only"> (obligatorio)</span>
          ) : null}
        </label>
      ) : null}
      <input
        id={fieldId}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          // max-w-full + min-w-0: ancla el ancho intrínseco de date/time/number.
          "box-border w-full min-w-0 max-w-full rounded-lj-md border border-border-strong bg-surface px-4 py-3 text-base text-ink",
          "placeholder:text-ink-muted",
          "outline-none transition-colors",
          "focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60",
          error &&
            "border-danger-700 focus-visible:border-danger-700 focus-visible:ring-danger-100",
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
