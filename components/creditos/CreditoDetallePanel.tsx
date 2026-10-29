"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AsignarCreditosForm } from "@/components/creditos/AsignarCreditosForm";
import { CorregirCreditosForm } from "@/components/creditos/CorregirCreditosForm";
import { RetirarCreditosForm } from "@/components/creditos/RetirarCreditosForm";
import { UserStatusButton } from "@/components/users/UserStatusButton";
import {
  Alert,
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
  StatusBadge,
} from "@/components/ui";
import { buildQuery } from "@/lib/ui/build-query";
import type {
  ApiErrorBody,
  CreditoDetalleResponse,
} from "@/lib/creditos/ui/api-types";
import { tipoMovimientoLabel } from "@/lib/creditos/ui/api-types";
import { formatearInstanteVe } from "@/lib/creditos/ui/caracas-instant";

type Props = { vendedorId: string };

export function CreditoDetallePanel({ vendedorId }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = searchParams.get("page") || "1";
  const tipo = searchParams.get("tipo") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CreditoDetalleResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQuery({
        page,
        tipo: tipo || undefined,
      });
      const res = await fetch(
        `/api/admin/creditos/${encodeURIComponent(vendedorId)}${qs}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as CreditoDetalleResponse | ApiErrorBody;
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
      if (res.status === 404) {
        setError("Vendedor no encontrado.");
        setData(null);
        return;
      }
      if (!res.ok || !("ok" in json) || json.ok !== true) {
        setError(
          (json as ApiErrorBody).error?.message ??
            "No se pudo cargar el detalle.",
        );
        return;
      }
      setData(json);
    } catch {
      setError("Error de red al cargar el detalle.");
      // Conserva datos previos ante fallo de red; 401/403 ya limpian arriba.
    } finally {
      setLoading(false);
    }
  }, [vendedorId, page, tipo]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!vendedorId.trim()) {
    return (
      <div className="mt-6">
        <ErrorState title="Identificador inválido">
          Falta el identificador del vendedor en la URL.
        </ErrorState>
        <Link
          href="/admin/creditos"
          className="mt-3 inline-flex text-sm font-semibold text-brand-800 underline"
        >
          Volver a créditos
        </Link>
      </div>
    );
  }

  if (loading && !data) {
    return <LoadingState label="Cargando cuenta…" className="mt-6" />;
  }

  if (error && !data) {
    return (
      <div className="mt-6">
        <ErrorState title="No se pudo cargar">{error}</ErrorState>
        <Link
          href="/admin/creditos"
          className="mt-3 inline-flex text-sm font-semibold text-brand-800 underline"
        >
          Volver a créditos
        </Link>
      </div>
    );
  }

  function clearSessionData(message: string) {
    setData(null);
    setError(message);
  }

  if (!data) return null;

  const baseParams = { tipo: tipo || undefined };

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink">{data.vendedor.nombre}</h2>
            <p className="font-mono text-sm text-ink-muted">
              {data.vendedor.usuario}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge
                tone={data.vendedor.activo ? "success" : "neutral"}
                label={data.vendedor.activo ? "Activo" : "Inactivo"}
              />
              {data.cuenta.saldoBajo ? (
                <StatusBadge tone="warning" label="Saldo bajo" />
              ) : null}
              {!data.cuenta.tieneCuenta ? (
                <StatusBadge tone="info" label="Sin cuenta aún" />
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Saldo disponible
            </p>
            <p className="font-mono text-2xl font-bold tabular-nums text-ink">
              {data.cuenta.saldoDisponible}
            </p>
            {data.cuenta.umbralSaldoBajo ? (
              <p className="mt-1 text-xs text-ink-muted">
                Umbral: {data.cuenta.umbralSaldoBajo}
              </p>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Este endpoint no incluye totales históricos agregados del vendedor;
          consulta el listado o el historial de movimientos.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-ink">Estado de acceso</p>
          <UserStatusButton
            userId={data.vendedor.id}
            nombre={data.vendedor.nombre}
            activo={data.vendedor.activo}
            onSuccess={() => void load()}
          />
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Activar/desactivar usa la API de usuarios existente (no inventa un
          bloqueo de créditos aparte). Un usuario inactivo pierde la sesión
          (`resolveSessionByToken` exige activo) y no puede vender.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <AsignarCreditosForm
          vendedorId={data.vendedor.id}
          nombreVendedor={data.vendedor.nombre}
          onSuccess={() => void load()}
          onSessionExpired={() =>
            clearSessionData("Sesión expirada o sin permiso.")
          }
        />
        <RetirarCreditosForm
          vendedorId={data.vendedor.id}
          nombreVendedor={data.vendedor.nombre}
          saldoDisponible={data.cuenta.saldoDisponible}
          onSuccess={() => void load()}
          onSessionExpired={() =>
            clearSessionData("Sesión expirada o sin permiso.")
          }
        />
      </div>

      <CorregirCreditosForm
        vendedorId={data.vendedor.id}
        saldoDisponible={data.cuenta.saldoDisponible}
        movimientos={data.movimientos}
        onSuccess={() => void load()}
        onSessionExpired={() =>
          clearSessionData("Sesión expirada o sin permiso.")
        }
      />

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-base font-bold text-ink">Historial</h3>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-ink-secondary">
              Tipo
              <select
                name="tipo"
                defaultValue={tipo}
                className="ml-2 rounded-lj-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
              >
                <option value="">Todos</option>
                <option value="ASIGNACION">Asignación</option>
                <option value="RETIRO">Retiro</option>
                <option value="CONSUMO_VENTA">Consumo venta</option>
                <option value="DEVOLUCION_ANULACION">Devolución</option>
                <option value="CORRECCION">Corrección</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lj-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-semibold"
            >
              Filtrar
            </button>
          </form>
        </div>

        {data.movimientos.length === 0 ? (
          <EmptyState
            className="mt-4"
            title="Sin movimientos"
            description="Asigna créditos o ajusta el filtro de tipo."
          />
        ) : (
          <>
            <ul className="mt-4 flex flex-col gap-2 lg:hidden">
              {data.movimientos.map((m) => (
                <li key={m.id}>
                  <Card padding="sm">
                    <p className="text-xs text-ink-muted">
                      {formatearInstanteVe(m.createdAt)}
                    </p>
                    <p className="font-semibold text-ink">
                      {tipoMovimientoLabel(m.tipo)} ·{" "}
                      <span className="font-mono">{m.importe}</span>
                    </p>
                    <p className="text-xs text-ink-secondary">
                      {m.saldoAnterior} → {m.saldoPosterior}
                    </p>
                    {m.motivo ? (
                      <p className="mt-1 text-xs text-ink-muted">{m.motivo}</p>
                    ) : null}
                    {m.ticketId ? (
                      <p className="mt-1 font-mono text-[11px] text-ink-muted">
                        Ticket: {m.ticketId}
                      </p>
                    ) : null}
                    {m.actorAdminId ? (
                      <p className="mt-1 font-mono text-[11px] text-ink-muted">
                        Admin: {m.actorAdminId}
                      </p>
                    ) : null}
                    {m.movimientoOrigenId ? (
                      <p className="mt-1 font-mono text-[11px] text-ink-muted">
                        Origen: {m.movimientoOrigenId}
                      </p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>

            <div className="mt-4 hidden lg:block">
              <DataTable
                caption="Movimientos de crédito"
                minWidthClassName="min-w-[900px]"
              >
                <DataTableHead>
                  <tr>
                    <DataTableTh>Fecha</DataTableTh>
                    <DataTableTh>Tipo</DataTableTh>
                    <DataTableTh>Importe</DataTableTh>
                    <DataTableTh>Anterior</DataTableTh>
                    <DataTableTh>Posterior</DataTableTh>
                    <DataTableTh>Motivo / refs</DataTableTh>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {data.movimientos.map((m) => (
                    <DataTableRow key={m.id}>
                      <DataTableTd className="whitespace-nowrap text-xs">
                        {formatearInstanteVe(m.createdAt)}
                      </DataTableTd>
                      <DataTableTd>
                        {tipoMovimientoLabel(m.tipo)}
                      </DataTableTd>
                      <DataTableTd className="font-mono tabular-nums">
                        {m.importe}
                      </DataTableTd>
                      <DataTableTd className="font-mono tabular-nums text-xs">
                        {m.saldoAnterior}
                      </DataTableTd>
                      <DataTableTd className="font-mono tabular-nums text-xs">
                        {m.saldoPosterior}
                      </DataTableTd>
                      <DataTableTd className="max-w-[14rem] text-xs text-ink-secondary">
                        {m.motivo ? <p>{m.motivo}</p> : null}
                        {m.actorAdminId ? (
                          <p className="font-mono truncate" title={m.actorAdminId}>
                            Admin: {m.actorAdminId}
                          </p>
                        ) : null}
                        {m.ticketId ? (
                          <p className="font-mono truncate" title={m.ticketId}>
                            Ticket: {m.ticketId}
                          </p>
                        ) : null}
                        {m.movimientoOrigenId ? (
                          <p
                            className="font-mono truncate"
                            title={m.movimientoOrigenId}
                          >
                            Origen: {m.movimientoOrigenId}
                          </p>
                        ) : null}
                      </DataTableTd>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </div>

            <PaginationBar
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              itemLabel="movimientos"
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
      </Card>

      {error ? (
        <Alert variant="warning" title="Aviso al actualizar">
          {error}
        </Alert>
      ) : null}

      <Link
        href="/admin/creditos"
        className="inline-flex text-sm font-semibold text-brand-800 underline"
      >
        ← Volver a créditos
      </Link>
    </div>
  );
}
