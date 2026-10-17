import type { Metadata } from "next";
import {
  formatearFechaLargaDesdeDate,
  hoyYYYYMMDD,
  parseFechaYYYYMMDD,
} from "@/lib/fecha";
import { getDailyReport } from "@/lib/reports/get-daily-report";
import { prisma } from "@/lib/prisma";
import { Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";

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
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Reportes"
        meta={formatearFechaLargaDesdeDate(fecha)}
        description="Resumen operativo por fecha de juego. Sin pagos ni utilidades."
      />

      <Card className="mt-6">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input
            type="date"
            name="fecha"
            label="Fecha"
            defaultValue={fechaStr}
            containerClassName="flex-1"
          />
          <Button type="submit" variant="primary" size="md" className="sm:w-auto">
            Ver reporte
          </Button>
        </form>
      </Card>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-ink">Resumen</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card padding="sm">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Tickets emitidos
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {reporte.tickets.emitidos}
            </dd>
          </Card>
          <Card padding="sm">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Tickets anulados
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {reporte.tickets.anulados}
            </dd>
          </Card>
          <Card padding="sm" className="col-span-2 sm:col-span-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Total jugado
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-brand-900">
              {money(reporte.ventas.totalJugado)}
            </dd>
          </Card>
          <Card padding="sm">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Ganadores
            </dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-ink">
              {reporte.tickets.ganadores}
            </dd>
          </Card>
          <Card padding="sm">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              No ganadores
            </dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-ink">
              {reporte.tickets.noGanadores}
            </dd>
          </Card>
          <Card padding="sm">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Pendientes
            </dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-ink">
              {reporte.tickets.pendientes}
            </dd>
          </Card>
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold text-ink">Ventas por vendedor</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Solo tickets emitidos. Históricos sin vendedor aparecen agrupados.
        </p>
        {reporte.porVendedor.length === 0 ? (
          <EmptyState
            className="mt-3"
            title="Sin ventas emitidas en esta fecha."
          />
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lj-lg border border-border bg-surface">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-3 font-semibold">Vendedor</th>
                  <th className="px-3 py-3 font-semibold text-right">Tickets</th>
                  <th className="px-3 py-3 font-semibold text-right">
                    Total jugado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reporte.porVendedor.map((v) => (
                  <tr key={v.vendedorId ?? "null"}>
                    <td className="px-3 py-3">
                      <span className="font-medium text-ink">{v.nombre}</span>
                      {v.usuario ? (
                        <span className="ml-2 font-mono text-xs text-ink-muted">
                          {v.usuario}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">
                      {v.tickets}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-ink">
                      {money(v.totalJugado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold text-ink">Ventas por hora</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Suma de líneas emitidas por sorteo (un ticket puede aportar a varias
          horas).
        </p>
        <div className="mt-3 overflow-x-auto rounded-lj-lg border border-border bg-surface">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-3 font-semibold">Hora</th>
                <th className="px-3 py-3 font-semibold text-right">
                  Total jugado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reporte.porHora.map((h) => (
                <tr key={h.hora}>
                  <td className="px-3 py-2.5 font-medium text-ink">
                    {h.horaLabel}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                    {money(h.totalJugado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold text-ink">Ventas por animal</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Catálogo completo en orden. Incluye ceros para comparar fechas.
        </p>
        <div className="mt-3 max-h-96 overflow-x-auto overflow-y-auto rounded-lj-lg border border-border bg-surface">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-3 font-semibold">Animal</th>
                <th className="px-3 py-3 font-semibold text-right">
                  Total jugado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reporte.porAnimal.map((a) => (
                <tr key={a.numeroAnimal}>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-ink-muted">
                      {a.numeroAnimal}
                    </span>{" "}
                    <span className="font-medium text-ink">{a.nombreAnimal}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {money(a.totalJugado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 mb-8">
        <h2 className="text-lg font-bold text-ink">Exposición por hora</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Usa el multiplicador de cada ticket. La exposición total teórica no es
          un pago comprometido; la mayor exposición es el peor caso por hora.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lj-lg border border-border bg-surface">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
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
            <tbody className="divide-y divide-border">
              {reporte.exposicion.map((e) => (
                <tr key={e.hora}>
                  <td className="px-3 py-2.5 font-medium text-ink">
                    {e.horaLabel}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                    {money(e.totalApostado)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                    {money(e.exposicionTotalTeorica)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-ink">
                    {money(e.mayorExposicion)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                    {e.ticketsAfectados}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
