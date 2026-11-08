"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingState,
  StatusBadge,
} from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatearHoraSorteo } from "@/lib/fecha";

type AtrasadoItem = {
  fecha: string;
  hora: number;
  tieneResultado: false;
  requiereIntervencionAdmin: true;
  tieneProgramacionPendiente: boolean;
  programacion: {
    estado: string;
    numero: string;
  } | null;
};

type AtrasadosPayload = {
  ok: true;
  items: AtrasadoItem[];
  resumen: {
    totalSinResultado: number;
    totalConProgramacionPendiente: number;
    totalSinProgramacionPendiente: number;
  };
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rango: { desde: string; hasta: string };
  inicioOperativo: string | null;
};

type Props = {
  /** Valores iniciales del formulario (ayer Caracas sugerido en el servidor). */
  desdeInicial: string;
  hastaInicial: string;
};

function estadoFranjaLabel(item: AtrasadoItem): {
  label: string;
  tone: "warning" | "info" | "neutral";
} {
  if (item.tieneProgramacionPendiente) {
    return { label: "Programación pendiente", tone: "info" };
  }
  if (item.programacion?.estado === "PUBLICADO") {
    return { label: "Programación huérfana", tone: "warning" };
  }
  return { label: "Sin resultado", tone: "warning" };
}

export function AdminSorteosAtrasados({
  desdeInicial,
  hastaInicial,
}: Props) {
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AtrasadosPayload | null>(null);

  const cargar = useCallback(
    async (args: { desde: string; hasta: string; page: number }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          desde: args.desde,
          hasta: args.hasta,
          page: String(args.page),
          pageSize: "22",
        });
        const res = await fetch(
          `/api/admin/resultados/atrasados?${params.toString()}`,
          { cache: "no-store" },
        );
        const body: unknown = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) {
          setError("No autorizado. Inicia sesión como ADMIN.");
          setData(null);
          return;
        }
        if (!res.ok) {
          const message =
            body &&
            typeof body === "object" &&
            "error" in body &&
            body.error &&
            typeof body.error === "object" &&
            "message" in body.error &&
            typeof (body.error as { message?: unknown }).message === "string"
              ? (body.error as { message: string }).message
              : "No se pudieron cargar los sorteos atrasados.";
          setError(message);
          setData(null);
          return;
        }
        setData(body as AtrasadosPayload);
      } catch {
        setError("No se pudieron cargar los sorteos atrasados.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void cargar({ desde: desdeInicial, hasta: hastaInicial, page: 1 });
  }, [cargar, desdeInicial, hastaInicial]);

  function onConsultar(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    void cargar({ desde, hasta, page: 1 });
  }

  function cambiarPagina(next: number) {
    setPage(next);
    void cargar({ desde, hasta, page: next });
  }

  const resumen = data?.resumen;

  return (
    <section aria-label="Sorteos atrasados" className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">Sorteos atrasados</h2>
        <p className="text-xs font-medium text-ink-muted">
          Solo lectura · días anteriores
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Franjas de fechas anteriores a hoy (America/Caracas) sin resultado
        publicado. La publicación se hace con el formulario manual de la fecha
        correspondiente. El cron no recupera días anteriores.
      </p>

      <Card className="mt-4">
        <form
          onSubmit={onConsultar}
          className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Input
            type="date"
            name="desde"
            label="Desde"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            containerClassName="min-w-0 flex-1"
          />
          <Input
            type="date"
            name="hasta"
            label="Hasta"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            containerClassName="min-w-0 flex-1"
          />
          <Button
            type="submit"
            variant="secondary"
            size="md"
            className="shrink-0 sm:min-w-[8.5rem]"
            disabled={loading}
          >
            Consultar
          </Button>
        </form>
        {data?.inicioOperativo ? (
          <p className="mt-2 text-xs text-ink-muted">
            Inicio operativo observado en datos: {data.inicioOperativo}
          </p>
        ) : data ? (
          <p className="mt-2 text-xs text-ink-muted">
            No hay fecha de inicio operativa en los datos consultados.
          </p>
        ) : null}
      </Card>

      {resumen ? (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          <Card padding="sm" className="text-center sm:text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Sin resultado
            </p>
            <p
              className={cn(
                "mt-1 text-2xl font-bold tabular-nums",
                resumen.totalSinResultado > 0
                  ? "text-accent-800"
                  : "text-ink",
              )}
            >
              {resumen.totalSinResultado}
            </p>
          </Card>
          <Card padding="sm" className="text-center sm:text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Con pendiente
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {resumen.totalConProgramacionPendiente}
            </p>
          </Card>
          <Card padding="sm" className="text-center sm:text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Sin pendiente
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {resumen.totalSinProgramacionPendiente}
            </p>
          </Card>
        </div>
      ) : null}

      <div className="mt-4">
        {loading ? <LoadingState label="Cargando sorteos atrasados…" /> : null}
        {!loading && error ? (
          <Alert variant="error" title="No se pudo consultar">
            {error}
          </Alert>
        ) : null}
        {!loading && !error && data && data.total === 0 ? (
          <EmptyState
            title="Sin incidencias"
            description="No hay franjas atrasadas sin resultado en el intervalo consultado."
          />
        ) : null}
        {!loading && !error && data && data.items.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {data.items.map((item) => {
              const badge = estadoFranjaLabel(item);
              return (
                <li key={`${item.fecha}|${item.hora}`}>
                  <Card padding="sm" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">
                        {item.fecha} · {formatearHoraSorteo(item.hora)}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusBadge tone={badge.tone} label={badge.label} />
                        {item.tieneProgramacionPendiente ? (
                          <span className="text-xs font-medium text-ink-muted">
                            Número programado: {item.programacion?.numero}
                          </span>
                        ) : null}
                        <span className="text-xs font-medium text-accent-800">
                          Requiere intervención ADMIN
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`/admin?fecha=${item.fecha}#sorteo-${item.hora}`}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lj-md border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    >
                      Abrir publicación manual
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      {data && data.totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || page <= 1}
            onClick={() => cambiarPagina(page - 1)}
          >
            Anterior
          </Button>
          <p className="text-xs font-medium text-ink-muted">
            Página {data.page} de {data.totalPages}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || page >= data.totalPages}
            onClick={() => cambiarPagina(page + 1)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
    </section>
  );
}
