"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
  CajaApiError,
  CajaAplicacionDto,
  CajaConfirmacionDto,
  CajaDeclaracionDto,
  CajaObligacionDto,
  CajaTotalesDto,
} from "@/lib/caja/ui/api-types";
import {
  formatCajaInstant,
  formatCajaMoney,
  formatCajaPct,
} from "@/lib/caja/ui/format";

type DetalleResponse = {
  ok: true;
  nombre: string;
  usuario: string;
  activo: boolean;
  comision: {
    porcentaje: string;
    updatedAt: string;
    updatedByAdminId: string | null;
  } | null;
  historialComision: Array<{
    id: string;
    porcentajeAnterior: string | null;
    porcentajeNuevo: string;
    changedAt: string;
    changedByAdminId: string | null;
    motivo: string | null;
  }>;
  vendedorId: string;
  totales: CajaTotalesDto;
  declaraciones: CajaDeclaracionDto[];
  confirmaciones: CajaConfirmacionDto[];
  aplicaciones: CajaAplicacionDto[];
  obligaciones: CajaObligacionDto[];
};

export function CajaAdminVendedorDetalle({
  vendedorId,
}: {
  vendedorId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetalleResponse | null>(null);
  const [pct, setPct] = useState("");
  const [motivo, setMotivo] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/caja/vendedores/${vendedorId}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as DetalleResponse | CajaApiError;
      if (!res.ok || !("ok" in json) || json.ok !== true) {
        setError(
          (json as CajaApiError).error?.message ??
            "No se pudo cargar el detalle.",
        );
        setData(null);
        return;
      }
      setData(json);
      setPct(json.comision?.porcentaje ?? "20.00");
    } catch {
      setError("Error de red.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [vendedorId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveComision() {
    setBusy(true);
    setFormError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/caja/vendedores/${vendedorId}/comision`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            porcentaje: pct.trim(),
            motivo: motivo.trim() || null,
          }),
        },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        changed?: boolean;
        error?: { message?: string };
      };
      if (!res.ok || json.ok !== true) {
        setFormError(json.error?.message ?? "No se pudo guardar.");
        return;
      }
      setDialogOpen(false);
      setSuccess(
        json.changed
          ? "Comisión actualizada. Solo afecta tickets futuros."
          : "Sin cambios: el porcentaje ya era el mismo.",
      );
      await load();
    } catch {
      setFormError("Error de red al guardar.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return <LoadingState label="Cargando detalle…" className="mt-6" />;
  }
  if (error && !data) {
    return (
      <div className="mt-6 space-y-3">
        <ErrorState title="Detalle no disponible">{error}</ErrorState>
        <Button type="button" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="mt-6 space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/caja"
          className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline"
        >
          ← Volver a Caja
        </Link>
        <StatusBadge
          tone={data.activo ? "success" : "neutral"}
          label={data.activo ? "Activo" : "Inactivo"}
        />
      </div>

      <section>
        <h2 className="text-lg font-semibold text-ink">{data.nombre}</h2>
        <p className="text-sm text-ink-muted">@{data.usuario}</p>
      </section>

      {success ? (
        <Alert variant="success" title="Listo">
          {success}
        </Alert>
      ) : null}

      <section>
        <h3 className="text-base font-semibold text-ink">Totales</h3>
        <CajaTotalesGrid totales={data.totales} className="mt-3" />
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-ink">Comisión vigente</h3>
        <p className="text-sm text-ink-muted">
          El porcentaje actual no se aplica a tickets históricos: cada
          obligación guarda su snapshot.
        </p>
        <p className="text-xl font-bold tabular-nums">
          {formatCajaPct(data.comision?.porcentaje ?? null)}
        </p>
        <div className="flex max-w-md flex-col gap-3">
          <Input
            label="Nuevo porcentaje"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            inputMode="decimal"
          />
          <Input
            label="Motivo (opcional)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Button type="button" onClick={() => setDialogOpen(true)}>
            Cambiar comisión
          </Button>
        </div>
      </section>

      <section>
        <h3 className="text-base font-semibold text-ink">
          Historial de comisión
        </h3>
        {data.historialComision.length === 0 ? (
          <EmptyState
            title="Sin historial"
            description="Aún no hay cambios registrados."
            className="mt-3"
          />
        ) : (
          <DataTable className="mt-3">
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Fecha</DataTableTh>
                <DataTableTh>Anterior</DataTableTh>
                <DataTableTh>Nuevo</DataTableTh>
                <DataTableTh>Admin</DataTableTh>
                <DataTableTh>Motivo</DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {data.historialComision.map((h) => (
                <DataTableRow key={h.id}>
                  <DataTableTd>{formatCajaInstant(h.changedAt)}</DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaPct(h.porcentajeAnterior)}
                  </DataTableTd>
                  <DataTableTd className="tabular-nums">
                    {formatCajaPct(h.porcentajeNuevo)}
                  </DataTableTd>
                  <DataTableTd className="font-mono text-xs">
                    {h.changedByAdminId ?? "—"}
                  </DataTableTd>
                  <DataTableTd>{h.motivo ?? "—"}</DataTableTd>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </section>

      <section>
        <h3 className="text-base font-semibold text-ink">Obligaciones</h3>
        <DataTable className="mt-3">
          <DataTableHead>
            <DataTableRow>
              <DataTableTh>Ticket</DataTableTh>
              <DataTableTh>Fecha ticket</DataTableTh>
              <DataTableTh>Bruto</DataTableTh>
              <DataTableTh>% snap</DataTableTh>
              <DataTableTh>Comisión</DataTableTh>
              <DataTableTh>A entregar</DataTableTh>
              <DataTableTh>Aplicado</DataTableTh>
              <DataTableTh>Pendiente</DataTableTh>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {data.obligaciones.map((o) => (
              <DataTableRow key={o.obligacionId}>
                <DataTableTd className="font-mono text-xs">
                  {o.ticketId}
                </DataTableTd>
                <DataTableTd>
                  {formatCajaInstant(o.ticketCreatedAt)}
                </DataTableTd>
                <DataTableTd className="tabular-nums">
                  {formatCajaMoney(o.bruto)}
                </DataTableTd>
                <DataTableTd className="tabular-nums">
                  {formatCajaPct(o.comisionPorcentaje)}
                </DataTableTd>
                <DataTableTd className="tabular-nums">
                  {formatCajaMoney(o.comisionImporte)}
                </DataTableTd>
                <DataTableTd className="tabular-nums">
                  {formatCajaMoney(o.importeAdmin)}
                </DataTableTd>
                <DataTableTd className="tabular-nums">
                  {formatCajaMoney(o.totalAplicado)}
                </DataTableTd>
                <DataTableTd className="tabular-nums">
                  {formatCajaMoney(o.pendiente)}
                </DataTableTd>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </section>

      <section>
        <h3 className="text-base font-semibold text-ink">Declaraciones</h3>
        <DataTable className="mt-3">
          <DataTableHead>
            <DataTableRow>
              <DataTableTh>Fecha</DataTableTh>
              <DataTableTh>Declarado</DataTableTh>
              <DataTableTh>Confirmado</DataTableTh>
              <DataTableTh>Pendiente</DataTableTh>
              <DataTableTh>Estado</DataTableTh>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {data.declaraciones.map((d) => (
              <DataTableRow key={d.id}>
                <DataTableTd>{formatCajaInstant(d.declaradoAt)}</DataTableTd>
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
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </section>

      <section>
        <h3 className="text-base font-semibold text-ink">
          Confirmaciones y FIFO
        </h3>
        <DataTable className="mt-3">
          <DataTableHead>
            <DataTableRow>
              <DataTableTh>Confirmación</DataTableTh>
              <DataTableTh>Fecha</DataTableTh>
              <DataTableTh>Importe</DataTableTh>
              <DataTableTh>Admin</DataTableTh>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {data.confirmaciones.map((c) => (
              <DataTableRow key={c.id}>
                <DataTableTd className="font-mono text-xs">{c.id}</DataTableTd>
                <DataTableTd>{formatCajaInstant(c.confirmadoAt)}</DataTableTd>
                <DataTableTd className="tabular-nums">
                  {formatCajaMoney(c.importeConfirmado)}
                </DataTableTd>
                <DataTableTd className="font-mono text-xs">
                  {c.confirmadoPorAdminId}
                </DataTableTd>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
        <h4 className="mt-4 text-sm font-semibold text-ink">Aplicaciones</h4>
        <DataTable className="mt-2">
          <DataTableHead>
            <DataTableRow>
              <DataTableTh>Fecha</DataTableTh>
              <DataTableTh>Confirmación</DataTableTh>
              <DataTableTh>Ticket</DataTableTh>
              <DataTableTh>Importe</DataTableTh>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {data.aplicaciones.map((a) => (
              <DataTableRow key={a.id}>
                <DataTableTd>{formatCajaInstant(a.createdAt)}</DataTableTd>
                <DataTableTd className="font-mono text-xs">
                  {a.confirmacionId}
                </DataTableTd>
                <DataTableTd className="font-mono text-xs">
                  {a.ticketId ?? "—"}
                </DataTableTd>
                <DataTableTd className="tabular-nums">
                  {formatCajaMoney(a.importeAplicado)}
                </DataTableTd>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </section>

      <ConfirmDialog
        open={dialogOpen}
        title="Confirmar cambio de comisión"
        description={
          <div className="space-y-2 text-sm">
            <p>
              Anterior:{" "}
              <strong>
                {formatCajaPct(data.comision?.porcentaje ?? null)}
              </strong>
            </p>
            <p>
              Nuevo: <strong>{formatCajaPct(pct.trim() || null)}</strong>
            </p>
            <p className="text-ink-muted">
              Solo tickets futuros usarán el nuevo porcentaje. Las obligaciones
              existentes no cambian.
            </p>
            {formError ? (
              <p className="font-medium text-danger-800">{formError}</p>
            ) : null}
          </div>
        }
        confirmLabel="Guardar comisión"
        loading={busy}
        onCancel={() => {
          if (!busy) setDialogOpen(false);
        }}
        onConfirm={() => void saveComision()}
      />
    </div>
  );
}
