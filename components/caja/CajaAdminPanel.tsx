"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CajaEstadoBadge } from "@/components/caja/CajaEstadoBadge";
import { CajaTotalesGrid } from "@/components/caja/CajaTotalesGrid";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  DataTableBody,
  DataTableHead,
  DataTableRow,
  DataTableTd,
  DataTableTh,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  StatusBadge,
} from "@/components/ui";
import type {
  CajaAdminListResponse,
  CajaApiError,
  CajaDeclaracionDto,
  CajaTotalesDto,
} from "@/lib/caja/ui/api-types";
import {
  formatCajaInstant,
  formatCajaMoney,
  formatCajaPct,
  newCajaIdempotencyKey,
} from "@/lib/caja/ui/format";

type DeclRow = CajaDeclaracionDto & {
  vendedorNombre: string;
  vendedorUsuario: string;
};

export function CajaAdminPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CajaAdminListResponse | null>(null);
  const [q, setQ] = useState("");
  const [detalles, setDetalles] = useState<
    Record<
      string,
      {
        declaraciones: CajaDeclaracionDto[];
        nombre: string;
        usuario: string;
      }
    >
  >({});
  const [confirmTarget, setConfirmTarget] = useState<DeclRow | null>(null);
  const [confirmImporte, setConfirmImporte] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [fifoResult, setFifoResult] = useState<{
    importe: string;
    apps: Array<{ ticketId: string | null; importeAplicado: string }>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/caja", { cache: "no-store" });
      const json = (await res.json()) as CajaAdminListResponse | CajaApiError;
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
          (json as CajaApiError).error?.message ??
            "No se pudo cargar el resumen de Caja.",
        );
        setData(null);
        return;
      }
      setData(json);
      // Precarga declaraciones por vendedor (detalle mínimo para cola de confirmación).
      const map: typeof detalles = {};
      await Promise.all(
        json.vendedores.map(async (v) => {
          const r = await fetch(`/api/admin/caja/vendedores/${v.vendedorId}`, {
            cache: "no-store",
          });
          if (!r.ok) return;
          const body = (await r.json()) as {
            ok?: boolean;
            nombre?: string;
            usuario?: string;
            declaraciones?: CajaDeclaracionDto[];
          };
          if (body.ok && body.declaraciones) {
            map[v.vendedorId] = {
              declaraciones: body.declaraciones,
              nombre: body.nombre ?? v.nombre ?? v.vendedorId,
              usuario: body.usuario ?? v.usuario ?? "",
            };
          }
        }),
      );
      setDetalles(map);
    } catch {
      setError("Error de red al cargar Caja.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data.vendedores;
    return data.vendedores.filter((v) => {
      const blob = `${v.nombre ?? ""} ${v.usuario ?? ""}`.toLowerCase();
      return blob.includes(needle);
    });
  }, [data, q]);

  const colaConfirmacion = useMemo(() => {
    const rows: DeclRow[] = [];
    for (const [vid, pack] of Object.entries(detalles)) {
      for (const d of pack.declaraciones) {
        if (d.estado === "CONFIRMADA") continue;
        if (Number(d.pendienteConfirmar) <= 0) continue;
        rows.push({
          ...d,
          vendedorId: vid,
          vendedorNombre: pack.nombre,
          vendedorUsuario: pack.usuario,
        });
      }
    }
    rows.sort(
      (a, b) =>
        new Date(a.declaradoAt).getTime() - new Date(b.declaradoAt).getTime(),
    );
    return rows;
  }, [detalles]);

  async function submitConfirmacion() {
    if (!confirmTarget) return;
    setConfirmBusy(true);
    setConfirmError(null);
    setFifoResult(null);
    try {
      const res = await fetch(
        `/api/admin/caja/declaraciones/${confirmTarget.id}/confirmar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            importe: confirmImporte.trim(),
            idempotencyKey: newCajaIdempotencyKey(),
          }),
        },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string };
        aplicaciones?: Array<{
          ticketId: string | null;
          importeAplicado: string;
        }>;
        confirmacion?: { importeConfirmado: string };
      };
      if (!res.ok || json.ok !== true) {
        setConfirmError(
          json.error?.message ?? "No se pudo registrar la confirmación.",
        );
        return;
      }
      setFifoResult({
        importe: json.confirmacion?.importeConfirmado ?? confirmImporte,
        apps: json.aplicaciones ?? [],
      });
      setConfirmTarget(null);
      setConfirmImporte("");
      await load();
    } catch {
      setConfirmError("Error de red al confirmar.");
    } finally {
      setConfirmBusy(false);
    }
  }

  if (loading && !data) {
    return <LoadingState label="Cargando Caja…" className="mt-6" />;
  }
  if (error && !data) {
    return (
      <div className="mt-6 space-y-3">
        <ErrorState title="No se pudo cargar Caja">{error}</ErrorState>
        <Button type="button" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!data) return null;

  const totales = data.totales as CajaTotalesDto;

  return (
    <div className="mt-6 space-y-8">
      {error ? (
        <Alert variant="warning" title="Datos posiblemente desactualizados">
          {error}
        </Alert>
      ) : null}

      <section aria-label="Estado de Caja">
        {data.caja.activa ? (
          <StatusBadge tone="success" label="Caja activa" />
        ) : (
          <Alert variant="info" title="Caja inactiva">
            El módulo está disponible en consulta, pero Caja no está activada.
            Esta pantalla no puede activarla.
          </Alert>
        )}
      </section>

      <section aria-label="Resumen general">
        <h2 className="text-base font-semibold text-ink">Resumen general</h2>
        <CajaTotalesGrid totales={totales} className="mt-3" />
      </section>

      {fifoResult ? (
        <Alert variant="success" title="Confirmación registrada">
          Importe confirmado: {formatCajaMoney(fifoResult.importe)}. FIFO
          aplicó a {fifoResult.apps.length} obligación(es). Pendiente de
          aplicar de esta operación: {formatCajaMoney("0.00")}.
          <ul className="mt-2 list-disc pl-5 text-sm">
            {fifoResult.apps.map((a, i) => (
              <li key={`${a.ticketId}-${i}`}>
                Ticket {a.ticketId ?? "—"}: {formatCajaMoney(a.importeAplicado)}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <section aria-label="Vendedores">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-base font-semibold text-ink">Vendedores</h2>
          <Input
            label="Buscar"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre o usuario"
            containerClassName="sm:max-w-xs"
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="Sin actividad de Caja"
            description="No hay vendedores con obligaciones, declaraciones o confirmaciones."
            className="mt-4"
          />
        ) : (
          <DataTable className="mt-4">
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Vendedor</DataTableTh>
                <DataTableTh>Estado</DataTableTh>
                <DataTableTh>% vigente</DataTableTh>
                <DataTableTh>Bruto</DataTableTh>
                <DataTableTh>Comisión</DataTableTh>
                <DataTableTh>Obligado</DataTableTh>
                <DataTableTh>Declarado</DataTableTh>
                <DataTableTh>Confirmado</DataTableTh>
                <DataTableTh>Deuda</DataTableTh>
                <DataTableTh>Pend. conf.</DataTableTh>
                <DataTableTh>Pend. FIFO</DataTableTh>
                <DataTableTh>
                  <span className="sr-only">Acciones</span>
                </DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {filtered.map((v) => (
                <DataTableRow key={v.vendedorId}>
                  <DataTableTd>
                    <div className="font-medium text-ink">
                      {v.nombre ?? "—"}
                    </div>
                    <div className="text-xs text-ink-muted">{v.usuario}</div>
                  </DataTableTd>
                  <DataTableTd>
                    <StatusBadge
                      tone={v.activo ? "success" : "neutral"}
                      label={v.activo ? "Activo" : "Inactivo"}
                    />
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaPct(v.comisionPorcentaje)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(v.totales.totalBruto)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(v.totales.totalComision)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(v.totales.totalObligado)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(v.totales.totalDeclarado)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(v.totales.totalConfirmado)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(v.totales.deudaPendienteEntregar)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(v.totales.pendienteConfirmar)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(v.totales.pendienteAplicar)}
                  </DataTableTd>
                  <DataTableTd>
                    <Link
                      href={`/admin/caja/vendedores/${v.vendedorId}`}
                      className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline"
                    >
                      Detalle
                    </Link>
                  </DataTableTd>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </section>

      <section aria-label="Declaraciones por confirmar">
        <h2 className="text-base font-semibold text-ink">
          Declaraciones pendientes de confirmar
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Una declaración no es dinero recibido. Solo confirma lo que ADMIN
          recibió realmente.
        </p>
        {colaConfirmacion.length === 0 ? (
          <EmptyState
            title="Nada pendiente"
            description="No hay declaraciones con saldo por confirmar."
            className="mt-4"
          />
        ) : (
          <DataTable className="mt-4">
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Fecha</DataTableTh>
                <DataTableTh>Vendedor</DataTableTh>
                <DataTableTh>Declarado</DataTableTh>
                <DataTableTh>Confirmado</DataTableTh>
                <DataTableTh>Pendiente</DataTableTh>
                <DataTableTh>Estado</DataTableTh>
                <DataTableTh>
                  <span className="sr-only">Acciones</span>
                </DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {colaConfirmacion.map((d) => (
                <DataTableRow key={d.id}>
                  <DataTableTd>{formatCajaInstant(d.declaradoAt)}</DataTableTd>
                  <DataTableTd>
                    {d.vendedorNombre}
                    <div className="text-xs text-ink-muted">
                      {d.vendedorUsuario}
                    </div>
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(d.importeDeclarado)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(d.totalConfirmado)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaMoney(d.pendienteConfirmar)}
                  </DataTableTd>
                  <DataTableTd>
                    <CajaEstadoBadge estado={d.estado} />
                  </DataTableTd>
                  <DataTableTd>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setConfirmTarget(d);
                        setConfirmImporte(d.pendienteConfirmar);
                        setConfirmError(null);
                      }}
                    >
                      Confirmar
                    </Button>
                  </DataTableTd>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </section>

      <ConfirmDialog
        open={confirmTarget != null}
        title="Confirmar recepción de efectivo"
        description={
          confirmTarget ? (
            <div className="space-y-2 text-sm">
              <p>
                Vendedor: <strong>{confirmTarget.vendedorNombre}</strong>
              </p>
              <p>
                Declarado: {formatCajaMoney(confirmTarget.importeDeclarado)}
              </p>
              <p>
                Ya confirmado: {formatCajaMoney(confirmTarget.totalConfirmado)}
              </p>
              <p>
                Pendiente: {formatCajaMoney(confirmTarget.pendienteConfirmar)}
              </p>
              <Input
                label="Importe a confirmar"
                value={confirmImporte}
                onChange={(e) => setConfirmImporte(e.target.value)}
                inputMode="decimal"
                disabled={confirmBusy}
              />
              {confirmError ? (
                <p className="text-sm font-medium text-danger-800">
                  {confirmError}
                </p>
              ) : null}
            </div>
          ) : null
        }
        confirmLabel="Registrar confirmación"
        loading={confirmBusy}
        onCancel={() => {
          if (confirmBusy) return;
          setConfirmTarget(null);
          setConfirmError(null);
        }}
        onConfirm={() => void submitConfirmacion()}
      />
    </div>
  );
}
