import type { Metadata } from "next";
import Link from "next/link";
import {
  formatearFechaLargaDesdeDate,
  hoyYYYYMMDD,
  parseFechaYYYYMMDD,
} from "@/lib/fecha";
import { getDailyReport } from "@/lib/reports/get-daily-report";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reportes — Admin — Lotería La Jungla",
  description: "Reportes operativos por fecha de juego.",
};

type Props = {
  searchParams: { fecha?: string };
};

function money(v: string): string {
  return `$${v}`;
}

export default async function AdminReportesPage({ searchParams }: Props) {
  const fechaParam = searchParams.fecha;
  const fechaParseada =
    typeof fechaParam === "string" ? parseFechaYYYYMMDD(fechaParam) : null;
  const fechaStr = fechaParseada ? fechaParam!.trim() : hoyYYYYMMDD();
  const fecha = parseFechaYYYYMMDD(fechaStr)!;

  const reporte = await getDailyReport(prisma, fechaStr);

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
              Lotería La Jungla
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Reportes</h1>
            <p className="mt-2 text-stone-600">
              {formatearFechaLargaDesdeDate(fecha)}
            </p>
            <p className="mt-1 text-sm text-stone-500">
              Resumen operativo por fecha de juego. Sin pagos ni utilidades.
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            Resultados
          </Link>
        </div>

        <form
          method="get"
          className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
        >
          <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
            Fecha
            <input
              type="date"
              name="fecha"
              defaultValue={fechaStr}
              className="rounded-xl border border-stone-300 px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>
          <button
            type="submit"
            className="mt-3 w-full rounded-xl bg-stone-800 px-4 py-3 text-base font-semibold text-white hover:bg-stone-700 sm:w-auto"
          >
            Ver reporte
          </button>
        </form>

        <p className="mt-4 text-sm text-stone-500">
          <Link
            href="/admin"
            className="underline underline-offset-2 hover:text-stone-800"
          >
            Resultados
          </Link>
          {" · "}
          <Link
            href="/admin/tickets"
            className="underline underline-offset-2 hover:text-stone-800"
          >
            Tickets
          </Link>
          {" · "}
          <Link
            href="/admin/auditoria"
            className="underline underline-offset-2 hover:text-stone-800"
          >
            Auditoría
          </Link>
          {" · "}
          <Link
            href="/admin/usuarios"
            className="underline underline-offset-2 hover:text-stone-800"
          >
            Usuarios
          </Link>
          {" · "}
          <Link
            href="/perfil"
            className="underline underline-offset-2 hover:text-stone-800"
          >
            Mi cuenta
          </Link>
        </p>

        {/* Resumen */}
        <section className="mt-8">
          <h2 className="text-lg font-bold text-stone-900">Resumen</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Tickets emitidos
              </dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums">
                {reporte.tickets.emitidos}
              </dd>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Tickets anulados
              </dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums">
                {reporte.tickets.anulados}
              </dd>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm col-span-2 sm:col-span-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Total jugado
              </dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">
                {money(reporte.ventas.totalJugado)}
              </dd>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Ganadores
              </dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">
                {reporte.tickets.ganadores}
              </dd>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                No ganadores
              </dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">
                {reporte.tickets.noGanadores}
              </dd>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Pendientes
              </dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">
                {reporte.tickets.pendientes}
              </dd>
            </div>
          </dl>
        </section>

        {/* Por vendedor */}
        <section className="mt-10">
          <h2 className="text-lg font-bold text-stone-900">
            Ventas por vendedor
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Solo tickets emitidos. Históricos sin vendedor aparecen agrupados.
          </p>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">Vendedor</th>
                  <th className="px-3 py-3 font-semibold text-right">Tickets</th>
                  <th className="px-3 py-3 font-semibold text-right">
                    Total jugado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {reporte.porVendedor.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-6 text-center text-stone-500"
                    >
                      Sin ventas emitidas en esta fecha.
                    </td>
                  </tr>
                ) : (
                  reporte.porVendedor.map((v) => (
                    <tr key={v.vendedorId ?? "null"}>
                      <td className="px-3 py-3">
                        <span className="font-medium text-stone-900">
                          {v.nombre}
                        </span>
                        {v.usuario ? (
                          <span className="ml-2 font-mono text-xs text-stone-500">
                            {v.usuario}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {v.tickets}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">
                        {money(v.totalJugado)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Por hora */}
        <section className="mt-10">
          <h2 className="text-lg font-bold text-stone-900">Ventas por hora</h2>
          <p className="mt-1 text-sm text-stone-500">
            Suma de líneas emitidas por sorteo (un ticket puede aportar a varias
            horas).
          </p>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">Hora</th>
                  <th className="px-3 py-3 font-semibold text-right">
                    Total jugado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {reporte.porHora.map((h) => (
                  <tr key={h.hora}>
                    <td className="px-3 py-2.5 font-medium">{h.horaLabel}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {money(h.totalJugado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Por animal */}
        <section className="mt-10">
          <h2 className="text-lg font-bold text-stone-900">Ventas por animal</h2>
          <p className="mt-1 text-sm text-stone-500">
            Catálogo completo en orden. Incluye ceros para comparar fechas.
          </p>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm max-h-96 overflow-y-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">Animal</th>
                  <th className="px-3 py-3 font-semibold text-right">
                    Total jugado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {reporte.porAnimal.map((a) => (
                  <tr key={a.numeroAnimal}>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-stone-500">
                        {a.numeroAnimal}
                      </span>{" "}
                      <span className="font-medium">{a.nombreAnimal}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(a.totalJugado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Exposición */}
        <section className="mt-10 mb-8">
          <h2 className="text-lg font-bold text-stone-900">
            Exposición por hora
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Usa el multiplicador de cada ticket. La exposición total teórica no
            es un pago comprometido; la mayor exposición es el peor caso por
            hora.
          </p>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">Hora</th>
                  <th className="px-3 py-3 font-semibold text-right">Jugado</th>
                  <th className="px-3 py-3 font-semibold text-right">
                    Exp. teórica
                  </th>
                  <th className="px-3 py-3 font-semibold text-right">
                    Mayor exp.
                  </th>
                  <th className="px-3 py-3 font-semibold text-right">Tickets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {reporte.exposicion.map((e) => (
                  <tr key={e.hora}>
                    <td className="px-3 py-2.5 font-medium">{e.horaLabel}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {money(e.totalApostado)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {money(e.exposicionTotalTeorica)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                      {money(e.mayorExposicion)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {e.ticketsAfectados}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
