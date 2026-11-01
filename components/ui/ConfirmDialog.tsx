"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/components/ui/cn";
import {
  canDismissConfirmDialog,
  canSubmitConfirmDialog,
  resolveConfirmDialogInitialFocus,
  type ConfirmDialogVariant,
} from "@/lib/ui/confirm-dialog";

export type { ConfirmDialogVariant };

export type ConfirmDialogMotivoProps = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  label?: string;
  maxLength?: number;
  placeholder?: string;
  error?: string;
};

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  /** Operación irreversible en curso: bloquea cerrar y doble envío. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Campo opcional de motivo dentro del diálogo. */
  motivo?: ConfirmDialogMotivoProps;
  children?: ReactNode;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo de confirmación compartido (créditos, usuarios, etc.).
 * Accesible: alertdialog, foco contenido, Escape seguro, restauración de foco.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
  motivo,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const initialFocus = resolveConfirmDialogInitialFocus({
    variant,
    motivoRequired: Boolean(motivo?.required),
  });

  const motivoSnapshot = motivo
    ? {
        value: motivo.value,
        required: motivo.required,
        maxLength: motivo.maxLength,
      }
    : undefined;

  const canSubmit = canSubmitConfirmDialog({
    loading,
    motivo: motivoSnapshot,
  });
  const canDismiss = canDismissConfirmDialog(loading);

  const requestCancel = useCallback(() => {
    if (!canDismissConfirmDialog(loading)) return;
    onCancel();
  }, [loading, onCancel]);

  const requestConfirm = useCallback(() => {
    if (
      !canSubmitConfirmDialog({
        loading,
        motivo: motivo
          ? {
              value: motivo.value,
              required: motivo.required,
              maxLength: motivo.maxLength,
            }
          : undefined,
      })
    ) {
      return;
    }
    onConfirm();
  }, [loading, motivo, onConfirm]);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    const focusInitial = () => {
      const target = resolveConfirmDialogInitialFocus({
        variant,
        motivoRequired: Boolean(motivo?.required),
      });
      if (target === "motivo") {
        const ta = panelRef.current?.querySelector<HTMLTextAreaElement>(
          "textarea[name='confirm-dialog-motivo']",
        );
        if (ta) {
          ta.focus();
          return;
        }
      }
      if (target === "cancel") {
        cancelBtnRef.current?.focus();
        return;
      }
      confirmBtnRef.current?.focus();
    };
    const t = window.setTimeout(focusInitial, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!canDismissConfirmDialog(loading)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }

      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      const restore = previouslyFocused.current;
      if (restore && typeof restore.focus === "function") {
        restore.focus();
      }
    };
  }, [open, loading, onCancel, motivo?.required, variant]);

  if (!open) return null;

  const isDanger = variant === "danger";
  const motivoRequiredEmpty =
    Boolean(motivo?.required) && !motivo!.value.trim();

  const panel = (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-ink/50"
        aria-hidden="true"
        onClick={() => requestCancel()}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={
          description || children || motivo ? descId : undefined
        }
        data-initial-focus={initialFocus}
        className={cn(
          "relative z-10 w-full max-w-md rounded-lj-lg border bg-surface p-4 shadow-lg",
          "max-h-[min(90vh,36rem)] overflow-y-auto",
          isDanger ? "border-danger-100" : "border-border-strong",
        )}
      >
        <h2
          id={titleId}
          className={cn(
            "text-lg font-bold",
            isDanger ? "text-danger-800" : "text-ink",
          )}
        >
          {title}
        </h2>

        <div id={descId} className="mt-2 space-y-2 text-sm text-ink-secondary">
          {description ? (
            <div className="whitespace-pre-line">{description}</div>
          ) : null}
          {children}
        </div>

        {motivo ? (
          <Textarea
            name="confirm-dialog-motivo"
            label={
              motivo.label ??
              (motivo.required ? "Motivo" : "Motivo (opcional)")
            }
            value={motivo.value}
            maxLength={motivo.maxLength}
            disabled={loading}
            required={motivo.required}
            placeholder={motivo.placeholder}
            error={
              motivo.error ??
              (motivoRequiredEmpty
                ? "El motivo es obligatorio."
                : undefined)
            }
            variant={isDanger ? "danger" : "default"}
            rows={3}
            containerClassName="mt-3"
            onChange={(e) => motivo.onChange(e.target.value)}
          />
        ) : null}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            ref={cancelBtnRef}
            type="button"
            variant="secondary"
            size="md"
            className="sm:min-w-[7rem]"
            disabled={!canDismiss}
            data-autofocus-target={
              initialFocus === "cancel" ? "true" : undefined
            }
            onClick={requestCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmBtnRef}
            type="button"
            variant={isDanger ? "danger" : "primary"}
            size="md"
            className="sm:min-w-[7rem]"
            disabled={!canSubmit}
            aria-busy={loading || undefined}
            data-autofocus-target={
              initialFocus === "confirm" ? "true" : undefined
            }
            onClick={requestConfirm}
          >
            {loading ? "Procesando…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return panel;
  }
  return createPortal(panel, document.body);
}
