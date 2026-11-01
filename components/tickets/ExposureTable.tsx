"use client";

import React, { useMemo, useState } from "react";
import type { ExposicionSorteo } from "@/lib/tickets/aggregate-exposure";
import {
  ariaSortValue,
  cycleExposureSort,
  EXPOSURE_SORT_DEFAULT,
  sortExposureAnimals,
  type ExposureSortKey,
  type ExposureSortState,
} from "@/lib/tickets/exposure-table-sort";
import { cn } from "@/components/ui/cn";

function formatMoney(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `$${value}`;
  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

type Props = {
  exposicion: ExposicionSorteo;
};

const COLUMNS: { key: ExposureSortKey; label: string }[] = [
  { key: "animal", label: "Animal" },
  { key: "totalApostado", label: "Jugado" },
  { key: "exposicion", label: "Exposición" },
  { key: "ticketsAfectados", label: "Tickets" },
];

function sortIndicator(column: ExposureSortKey, state: ExposureSortState): string {
  if (state.key !== column || state.dir == null) return "↕";
  return state.dir === "asc" ? "↑" : "↓";
}

export function ExposureTable({ exposicion }: Props) {
  const [sort, setSort] = useState<ExposureSortState>(EXPOSURE_SORT_DEFAULT);

  const rows = useMemo(
    () => sortExposureAnimals(exposicion.animales, sort),
    [exposicion.animales, sort],
  );

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm [&>*]:min-w-0 sm:grid-cols-4">
        <div className="min-w-0 rounded-lj-md bg-surface-muted p-3">
          <dt className="text-ink-muted">Total jugado</dt>
          <dd className="mt-1 break-words font-bold tabular-nums text-ink">
            {formatMoney(exposicion.totalApostado)}
          </dd>
        </div>
        <div className="min-w-0 rounded-lj-md bg-surface-muted p-3">
          <dt className="text-ink-muted">Exposición total</dt>
          <dd className="mt-1 break-words font-bold tabular-nums text-ink">
            {formatMoney(exposicion.totalExposicion)}
          </dd>
        </div>
        <div className="min-w-0 rounded-lj-md bg-accent-50 p-3">
          <dt className="text-accent-800">Mayor exposición</dt>
          <dd className="mt-1 break-words font-bold tabular-nums text-accent-800">
            {formatMoney(exposicion.mayorExposicion)}
          </dd>
        </div>
        <div className="min-w-0 rounded-lj-md bg-surface-muted p-3">
          <dt className="text-ink-muted">Tickets afectados</dt>
          <dd className="mt-1 font-bold tabular-nums text-ink">
            {exposicion.ticketsAfectados}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-ink-muted">
        Exposición total = suma de (importe × multiplicador del ticket). Mayor
        exposición = el animal con más riesgo si gana esa hora.
      </p>

      <div className="max-w-full overflow-x-auto rounded-lj-md border border-border">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="bg-surface-muted text-ink-secondary">
            <tr>
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSortValue(col.key, sort)}
                    className="px-1 py-1 font-semibold sm:px-2"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((prev) => cycleExposureSort(prev, col.key))
                      }
                      className={cn(
                        "inline-flex min-h-11 w-full items-center gap-1 rounded-sm px-2 py-2 text-left",
                        "hover:bg-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1",
                        active ? "text-brand-900" : "text-ink-secondary",
                      )}
                    >
                      <span>{col.label}</span>
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          active ? "text-brand-800" : "text-ink-muted",
                        )}
                        aria-hidden
                      >
                        {sortIndicator(col.key, sort)}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((animal) => (
              <tr
                key={animal.numeroAnimal}
                className="border-t border-border odd:bg-surface even:bg-surface-muted/60"
              >
                <td className="min-w-0 px-3 py-2 font-medium text-ink">
                  {animal.numeroAnimal} - {animal.nombreAnimal}
                </td>
                <td className="px-3 py-2 tabular-nums text-ink">
                  {formatMoney(animal.totalApostado)}
                </td>
                <td className="px-3 py-2 tabular-nums font-semibold text-ink">
                  {formatMoney(animal.exposicion)}
                </td>
                <td className="px-3 py-2 tabular-nums text-ink">
                  {animal.ticketsAfectados}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
