"use client";

import type { ExposicionSorteo } from "@/lib/tickets/aggregate-exposure";

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

export function ExposureTable({ exposicion }: Props) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-lj-md bg-surface-muted p-3">
          <dt className="text-ink-muted">Total jugado</dt>
          <dd className="mt-1 font-bold tabular-nums text-ink">
            {formatMoney(exposicion.totalApostado)}
          </dd>
        </div>
        <div className="rounded-lj-md bg-surface-muted p-3">
          <dt className="text-ink-muted">Exposición total</dt>
          <dd className="mt-1 font-bold tabular-nums text-ink">
            {formatMoney(exposicion.totalExposicion)}
          </dd>
        </div>
        <div className="rounded-lj-md bg-accent-50 p-3">
          <dt className="text-accent-800">Mayor exposición</dt>
          <dd className="mt-1 font-bold tabular-nums text-accent-800">
            {formatMoney(exposicion.mayorExposicion)}
          </dd>
        </div>
        <div className="rounded-lj-md bg-surface-muted p-3">
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

      <div className="overflow-x-auto rounded-lj-md border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-surface-muted text-ink-secondary">
            <tr>
              <th className="px-3 py-2 font-semibold">Animal</th>
              <th className="px-3 py-2 font-semibold">Jugado</th>
              <th className="px-3 py-2 font-semibold">Exposición</th>
              <th className="px-3 py-2 font-semibold">Tickets</th>
            </tr>
          </thead>
          <tbody>
            {exposicion.animales.map((animal) => (
              <tr
                key={animal.numeroAnimal}
                className="border-t border-border odd:bg-surface even:bg-surface-muted/60"
              >
                <td className="px-3 py-2 font-medium text-ink">
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
