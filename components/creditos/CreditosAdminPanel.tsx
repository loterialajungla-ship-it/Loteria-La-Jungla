"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CreditosConfigForm } from "@/components/creditos/CreditosConfigForm";
import {
  Alert,
  Button,
  Card,
  DataTable,
  DataTableBody,
  DataTableHead,
  DataTableRow,
  DataTableTd,
  DataTableTh,
  EmptyState,
  ErrorState,
  LoadingState,
  PaginationBar,
  Select,
  StatusBadge,
} from "@/components/ui";
import { buildQuery } from "@/lib/ui/build-query";
import type {
  CreditoResumenItem,
  CreditosConfigPublic,
  CreditosResumenResponse,
} from "@/lib/creditos/ui/api-types";
import type { ApiErrorBody } from "@/lib/creditos/ui/api-types";
import { formatearInstanteVe } from "@/lib/creditos/ui/caracas-instant";

function sumSaldoPagina(items: CreditoResumenItem[]): string {
  // Suma en céntimos de la página actual (no es total histórico global).
  let cents = 0;
  for (const it of items) {
    const [w, f = "00"] = it.saldoDisponible.split(".");
    cents += Number(w) * 100 + Number((f + "00").slice(0, 2));
  }
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

export function CreditosAdminPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = searchParams.get("page") || "1";
  const activo = searchParams.get("activo") || "";
  const saldoBajo = searchParams.get("saldoBajo") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CreditosResumenResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQuery({
        page,
        activo: activo || undefined,
        saldoBajo: saldoBajo || undefined,
      });
      const res = await fetch(`/api/admin/creditos${qs}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as CreditosResumenResponse | ApiErrorBody;
      if (res.status === 401) {
        setError("Sesión expirada. Vuelve a iniciar sesión.");
        setData(null);
        return;
      }
      if (res.status === 403) {
        setError("No tienes permiso de administrador.");
        setData(null);
        return;
      }
      if (!res.ok || !("ok" in json) || json.ok !== true) {
        setError(
          (json as ApiErrorBody).error?.message ??
            "No se pudo cargar el resumen de créditos.",
        );
        // Conserva datos previos (si los hay); 401/403 ya limpiaron arriba.
        return;
      }
      setData(json);
    } catch {
      setError("Error de red al cargar créditos.");
      // Conserva datos previos ante fallo de red ambiguo; no inventa estado.
    } finally {
      setLoading(false);
    }
  }, [page, activo, saldoBajo]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageSums = useMemo(() => {
    if (!data) return null;
    let asig = 0;
    let cons = 0;
    let dev = 0;
    let bajos = 0;
    let inactivos = 0;
    for (const it of data.items) {
      const parse = (s: string) => {
        const [w, f = "00"] = s.split(".");
        return Number(w) * 100 + Number((f + "00").slice(0, 2));
      };
      asig += parse(it.totalAsignado);
      cons += parse(it.totalConsumidoVentas);
      dev += parse(it.totalDevueltoAnulaciones);
      if (it.saldoBajo) bajos += 1;
      if (!it.activo) inactivos += 1;
    }
    const fmt = (c: number) =>
      `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
    return {
      asignado: fmt(asig),
      consumido: fmt(cons),
      devuelto: fmt(dev),
      saldoPagina: sumSaldoPagina(data.items),
      bajos,
      inactivos,
    };
  }, [data]);

  function onConfigSaved(config: CreditosConfigPublic) {
    setData((prev) => (prev ? { ...prev, config } : prev));
    void load();
  }

  if (loading && !data) {
    return <LoadingState label="Cargando créditos…" className="mt-6" />;
  }

  if (error && !data) {
    return (
      <div className="mt-6">
        <ErrorState title="No se pudo cargar">{error}</ErrorState>
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => void load()}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const baseParams = {
    activo: activo || undefined,
    saldoBajo: saldoBajo || undefined,
  };

  return (
    <div className="mt-6 space-y-6">
      {!data.config.controlActivo ? (
        <Alert variant="warning" title="Control de créditos desactivado">
          Las ventas no consumen saldo. Puedes preparar asignaciones y configurar
          inicioEn antes de activar.
        </Alert>
      ) : null}

      {pageSums ? (
        <section
          aria-label="Resumen de la página actual"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        >
          <Card padding="sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Asignado (página)
            </p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
              {pageSums.asignado}
            </p>
          </Card>
          <Card padding="sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Consumido (página)
            </p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
              {pageSums.consumido}
            </p>
          </Card>
          <Card padding="sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Devuelto (página)
            </p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
              {pageSums.devuelto}
            </p>
          </Card>
          <Card padding="sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Saldo (página)
            </p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
              {pageSums.saldoPagina}
            </p>
          </Card>
          <Card padding="sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Saldo bajo (página)
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums text-ink">
              {pageSums.bajos}
            </p>
          </Card>
          <Card padding="sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Inactivos (página)
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums text-ink">
              {pageSums.inactivos}
            </p>
          </Card>
        </section>
      ) : null}

      <p className="text-xs text-ink-muted">
        Las tarjetas suman solo los vendedores de esta página. La API no expone
        totales globales agregados en un solo campo.
      </p>

      <CreditosConfigForm
        initial={data.config}
        onSaved={onConfigSaved}
        onSessionExpired={() => {
          setData(null);
          setError("Sesión expirada o sin permiso.");
        }}
      />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Select
            name="activo"
            label="Estado cuenta"
            defaultValue={activo}
            containerClassName="min-w-[9rem]"
          >
            <option value="">Todos</option>
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
          </Select>
          <Select
            name="saldoBajo"
            label="Saldo bajo"
            defaultValue={saldoBajo}
            containerClassName="min-w-[9rem]"
            disabled={!data.config.umbralSaldoBajo}
          >
            <option value="">Todos</option>
            <option value="true">Solo bajo umbral</option>
            <option value="false">Sin alerta</option>
          </Select>
          <Button type="submit" variant="secondary" size="md">
            Filtrar
          </Button>
        </form>
        {!data.config.umbralSaldoBajo ? (
          <p className="mt-2 text-xs text-ink-muted">
            Configura un umbral para filtrar por saldo bajo.
          </p>
        ) : null}
      </Card>

      {error ? (
        <Alert variant="error" title="Aviso">
          {error}
        </Alert>
      ) : null}

      {data.items.length === 0 ? (
        <EmptyState
          title="No hay vendedores con estos filtros"
          description="Ajusta los filtros o crea vendedores en Usuarios."
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3 lg:hidden">
            {data.items.map((v) => (
              <li key={v.vendedorId}>
                <Card padding="sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{v.nombre}</p>
                      <p className="font-mono text-xs text-ink-muted">
                        {v.usuario}
                      </p>
                    </div>
                    <StatusBadge
                      tone={v.activo ? "success" : "neutral"}
                      label={v.activo ? "Activo" : "Inactivo"}
                    />
                  </div>
                  <p className="mt-2 font-mono text-sm text-ink">
                    Saldo: {v.saldoDisponible}
                    {v.saldoBajo ? (
                      <StatusBadge
                        className="ml-2"
                        tone="warning"
                        label="Saldo bajo"
                      />
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Última actividad:{" "}
                    {formatearInstanteVe(v.ultimaActividadCreditosAt)}
                  </p>
                  <Link
                    href={`/admin/creditos/${encodeURIComponent(v.vendedorId)}`}
                    className="mt-3 inline-flex text-sm font-semibold text-brand-800 underline"
                  >
                    Ver detalle
                  </Link>
                </Card>
              </li>
            ))}
          </ul>

          <div className="hidden lg:block">
            <DataTable
              caption="Vendedores y créditos"
              minWidthClassName="min-w-[880px]"
            >
              <DataTableHead>
                <tr>
                  <DataTableTh>Vendedor</DataTableTh>
                  <DataTableTh>Estado</DataTableTh>
                  <DataTableTh>Saldo</DataTableTh>
                  <DataTableTh>Asignado</DataTableTh>
                  <DataTableTh>Consumido</DataTableTh>
                  <DataTableTh>Última actividad</DataTableTh>
                  <DataTableTh>Acción</DataTableTh>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {data.items.map((v) => (
                  <DataTableRow key={v.vendedorId}>
                    <DataTableTd>
                      <p className="font-medium text-ink">{v.nombre}</p>
                      <p className="font-mono text-xs text-ink-muted">
                        {v.usuario}
                      </p>
                    </DataTableTd>
                    <DataTableTd>
                      <StatusBadge
                        tone={v.activo ? "success" : "neutral"}
                        label={v.activo ? "Activo" : "Inactivo"}
                      />
                      {v.saldoBajo ? (
                        <div className="mt-1">
                          <StatusBadge tone="warning" label="Saldo bajo" />
                        </div>
                      ) : null}
                    </DataTableTd>
                    <DataTableTd className="font-mono tabular-nums">
                      {v.saldoDisponible}
                      {!v.tieneCuenta ? (
                        <span className="ml-1 text-xs text-ink-muted">
                          (sin cuenta)
                        </span>
                      ) : null}
                    </DataTableTd>
                    <DataTableTd className="font-mono tabular-nums">
                      {v.totalAsignado}
                    </DataTableTd>
                    <DataTableTd className="font-mono tabular-nums">
                      {v.totalConsumidoVentas}
                    </DataTableTd>
                    <DataTableTd className="text-xs text-ink-secondary">
                      {formatearInstanteVe(v.ultimaActividadCreditosAt)}
                    </DataTableTd>
                    <DataTableTd>
                      <Link
                        href={`/admin/creditos/${encodeURIComponent(v.vendedorId)}`}
                        className="text-sm font-semibold text-brand-800 underline"
                      >
                        Detalle
                      </Link>
                    </DataTableTd>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </div>

          <PaginationBar
            className="mt-4"
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            itemLabel="vendedores"
            prevHref={
              data.page > 1
                ? `${pathname}${buildQuery({
                    ...baseParams,
                    page: String(data.page - 1),
                  })}`
                : null
            }
            nextHref={
              data.page < data.totalPages
                ? `${pathname}${buildQuery({
                    ...baseParams,
                    page: String(data.page + 1),
                  })}`
                : null
            }
          />
        </>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          Actualizar
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => router.push("/admin/usuarios")}
        >
          Ir a Usuarios
        </Button>
      </div>
    </div>
  );
}
