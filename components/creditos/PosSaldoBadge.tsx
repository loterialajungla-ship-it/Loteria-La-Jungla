"use client";

import React from "react";
import { Button, StatusBadge } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import type { PosSaldoViewModel } from "@/lib/creditos/ui/mi-cuenta-saldo-model";

export type PosSaldoBadgeProps = {
  view: PosSaldoViewModel;
  onRetry?: () => void;
  className?: string;
};

/**
 * Indicador informativo de saldo en `/venta`.
 * No autoriza ventas ni inventa umbrales: solo presenta el view-model del hook.
 */
export function PosSaldoBadge({
  view,
  onRetry,
  className,
}: PosSaldoBadgeProps) {
  const toneBorder =
    view.kind === "error"
      ? "border-danger-100 bg-danger-50"
      : view.kind === "config_ausente" || view.stale
        ? "border-accent-100 bg-accent-50"
        : view.kind === "control_inactivo"
          ? "border-border bg-surface-muted"
          : "border-border bg-surface";

  const amountMatch =
    view.kind === "saldo"
      ? /^Tu saldo:\s*(.+)$/i.exec(view.primary)
      : null;
  const amount = amountMatch?.[1] ?? null;

  return (
    <div
      className={cn(
        "mt-4 rounded-lj-md border px-3 py-2.5 sm:px-4",
        toneBorder,
        className,
      )}
      data-testid="pos-saldo-badge"
      data-pos-saldo-kind={view.kind}
      data-pos-saldo-updating={view.updating ? "true" : undefined}
      aria-busy={view.busy ? true : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {view.kind === "saldo" && amount ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Tu saldo
              </p>
              <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-ink sm:text-xl">
                {amount}
                <span className="sr-only"> créditos</span>
              </p>
            </>
          ) : (
            <>
              <p
                className="text-sm font-semibold text-ink"
                aria-live={view.kind === "loading" ? "polite" : undefined}
              >
                {view.primary}
              </p>
              {view.secondary ? (
                <p className="mt-0.5 text-sm text-ink-secondary">
                  {view.secondary}
                </p>
              ) : null}
            </>
          )}
          {view.showSaldoBajo ? (
            <div className="mt-1.5">
              <StatusBadge tone="warning" label="Saldo bajo" />
            </div>
          ) : null}
          {view.updating ? (
            <p
              className="mt-1 text-xs font-medium text-ink-muted"
              aria-live="polite"
            >
              Actualizando saldo…
            </p>
          ) : null}
          {view.stale ? (
            <p
              className="mt-1 text-xs font-medium text-accent-800"
              aria-live="polite"
            >
              Datos desactualizados. El saldo mostrado puede no ser el actual.
            </p>
          ) : null}
          {view.error && view.kind !== "error" ? (
            <p className="mt-1 text-xs text-danger-800" role="status">
              {view.error}
            </p>
          ) : null}
          {view.kind === "error" && view.error ? (
            <p className="mt-1 text-xs text-danger-800" role="status">
              {view.error}
            </p>
          ) : null}
        </div>
        {view.canRetry && onRetry ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={onRetry}
          >
            Reintentar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
