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
        <div className="rounded-xl bg-stone-50 p-3">
          <dt className="text-stone-500">Total jugado</dt>
          <dd className="mt-1 font-bold tabular-nums text-stone-900">
            {formatMoney(exposicion.totalApostado)}
          </dd>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <dt className="text-stone-500">Exposición total</dt>
          <dd className="mt-1 font-bold tabular-nums text-stone-900">
            {formatMoney(exposicion.totalExposicion)}
          </dd>
        </div>
        <div className="rounded-xl bg-amber-50 p-3">
          <dt className="text-amber-800/80">Mayor exposición</dt>
          <dd className="mt-1 font-bold tabular-nums text-amber-950">
            {formatMoney(exposicion.mayorExposicion)}
          </dd>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <dt className="text-stone-500">Tickets afectados</dt>
          <dd className="mt-1 font-bold tabular-nums text-stone-900">
            {exposicion.ticketsAfectados}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-stone-500">
        Exposición total = suma de (importe × multiplicador del ticket). Mayor
        exposición = el animal con más riesgo si gana esa hora.
      </p>

      <div className="overflow-x-auto rounded-xl border border-stone-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-100 text-stone-600">
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
                className="border-t border-stone-100 odd:bg-white even:bg-stone-50/60"
              >
                <td className="px-3 py-2 font-medium text-stone-800">
                  {animal.numeroAnimal} - {animal.nombreAnimal}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatMoney(animal.totalApostado)}
                </td>
                <td className="px-3 py-2 tabular-nums font-semibold">
                  {formatMoney(animal.exposicion)}
                </td>
                <td className="px-3 py-2 tabular-nums">
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
