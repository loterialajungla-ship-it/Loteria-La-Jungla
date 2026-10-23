import type { Metadata } from "next";
import Link from "next/link";
import { AdminFilaResultado } from "@/app/admin/AdminFilaResultado";
import {
  HORAS_SORTEO,
  formatearFechaLargaDesdeDate,
  formatearHoraSorteo,
  hoyYYYYMMDD,
  parseFechaYYYYMMDD,
} from "@/lib/fecha";
import { prisma } from "@/lib/prisma";
import { Button, Card, Input, PageHeader, StatusBadge } from "@/components/ui";
import { cn } from "@/components/ui/cn";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — Lotería La Jungla",
  description: "Carga de resultados de Lotería La Jungla.",
};

type Props = {
  searchParams: { fecha?: string };
};

function ordenAnimal(numero: string): number {
  if (numero === "0") return -1;
  if (numero === "00") return 0;
  return Number(numero);
}

const quickLinkClass =
  "inline-flex min-h-10 items-center rounded-lj-md border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2";

export default async function AdminPage({ searchParams }: Props) {
  const fechaParam = searchParams.fecha;
  const fechaParseada =
    typeof fechaParam === "string" ? parseFechaYYYYMMDD(fechaParam) : null;
  const fechaStr = fechaParseada
    ? fechaParam!.trim()
    : hoyYYYYMMDD();
  const fecha = parseFechaYYYYMMDD(fechaStr)!;
  const esHoy = fechaStr === hoyYYYYMMDD();

  const [animalesRaw, resultados] = await Promise.all([
    prisma.animal.findMany(),
    prisma.resultado.findMany({
      where: { fecha },
      include: { animal: true },
    }),
  ]);

  const animales = animalesRaw
    .slice()
    .sort((a, b) => ordenAnimal(a.numero) - ordenAnimal(b.numero))
    .map((animal) => ({ numero: animal.numero, nombre: animal.nombre }));

  const porHora = new Map(resultados.map((r) => [r.hora, r]));

  const totalSorteos = HORAS_SORTEO.length;
  const publicados = HORAS_SORTEO.filter((h) => porHora.has(h)).length;
  const pendientes = totalSorteos - publicados;
  const primeraPendiente = HORAS_SORTEO.find((h) => !porHora.has(h));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Resultados"
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <span>{formatearFechaLargaDesdeDate(fecha)}</span>
            <StatusBadge
              tone={esHoy ? "info" : "neutral"}
              label={esHoy ? "Hoy" : "Otra fecha"}
            />
          </span>
        }
        description="Consulta el estado de cada sorteo, publica resultados o corrígelos con confirmación y motivo. La liquidación de tickets se recalcula sola al consultar."
      />

      <nav
        aria-label="Accesos rápidos"
        className="mt-5 flex flex-wrap gap-2"
      >
        <Link href="/admin/tickets" className={quickLinkClass}>
          Tickets
        </Link>
        <Link href="/admin/reportes" className={quickLinkClass}>
          Informes
        </Link>
        <Link href="/admin/usuarios" className={quickLinkClass}>
          Usuarios
        </Link>
        <Link href="/admin/auditoria" className={quickLinkClass}>
          Auditoría
        </Link>
        <Link href="/venta" className={quickLinkClass}>
          Venta
        </Link>
        {primeraPendiente != null ? (
          <a
            href={`#sorteo-${primeraPendiente}`}
            className={cn(quickLinkClass, "border-accent-100 bg-accent-50 text-accent-800")}
          >
            Ir al primer pendiente
          </a>
        ) : null}
      </nav>

      <section
        aria-label="Resumen del día"
        className="mt-5 grid grid-cols-3 gap-2 sm:gap-3"
      >
        <Card padding="sm" className="text-center sm:text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Sorteos
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {totalSorteos}
          </p>
        </Card>
        <Card padding="sm" className="text-center sm:text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Publicados
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-brand-800">
            {publicados}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-brand-700">
            Con resultado
          </p>
        </Card>
        <Card padding="sm" className="text-center sm:text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Pendientes
          </p>
          <p
            className={cn(
              "mt-1 text-2xl font-bold tabular-nums",
              pendientes > 0 ? "text-accent-800" : "text-ink",
            )}
          >
            {pendientes}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-ink-muted">
            Sin publicar
          </p>
        </Card>
      </section>

      <Card className="mt-5">
        <form
          method="get"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Input
            type="date"
            name="fecha"
            label="Fecha de trabajo"
            defaultValue={fechaStr}
            containerClassName="flex-1"
          />
          <Button
            type="submit"
            variant="secondary"
            size="md"
            className="sm:min-w-[8.5rem]"
          >
            Ver fecha
          </Button>
        </form>
      </Card>

      <div className="mt-6 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">Sorteos del día</h2>
        <p className="text-xs font-medium text-ink-muted">
          {publicados}/{totalSorteos} publicados
        </p>
      </div>

      <ol className="mt-3 flex flex-col gap-2.5">
        {HORAS_SORTEO.map((hora) => {
          const actual = porHora.get(hora);
          return (
            <AdminFilaResultado
              key={hora}
              fecha={fechaStr}
              hora={hora}
              horaLabel={formatearHoraSorteo(hora)}
              animales={animales}
              numeroInicial={actual?.numero ?? ""}
              origenInicial={actual?.origen ?? null}
            />
          );
        })}
      </ol>
    </main>
  );
}
