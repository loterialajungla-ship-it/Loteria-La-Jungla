"use client";

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
} from "@/components/ui";
import type {
  CajaApiError,
  CajaConfirmacionDto,
  CajaDeclaracionDto,
  CajaVendorResumenResponse,
} from "@/lib/caja/ui/api-types";
import {
  formatCajaInstant,
  formatCajaMoney,
  newCajaIdempotencyKey,
} from "@/lib/caja/ui/format";

export function CajaVendorPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CajaVendorResumenResponse | null>(null);
  const [importe, setImporte] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/venta/caja", { cache: "no-store" });
      const json = (await res.json()) as
        | CajaVendorResumenResponse
        | CajaApiError;
      if (res.status === 401) {
        setError("Sesión expirada.");
        setData(null);
        return;
      }
      if (res.status === 403) {
        setError("Solo un vendedor puede consultar Mi Caja.");
        setData(null);
        return;
      }
      if (!res.ok || !("ok" in json) || json.ok !== true) {
        setError(
          (json as CajaApiError).error?.message ?? "No se pudo cargar Mi Caja.",
        );
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("Error de red.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitDeclaracion() {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch("/api/venta/caja/declaraciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          importe: importe.trim(),
          idempotencyKey: newCajaIdempotencyKey(),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!res.ok || json.ok !== true) {
        setFormError(json.error?.message ?? "No se pudo declarar.");
        return;
      }
      setDialogOpen(false);
      setImporte("");
      setSuccess(
        "Declaración registrada. Aún no cuenta como dinero recibido por ADMIN hasta que lo confirme.",
      );
      await load();
    } catch {
      setFormError("Error de red.");
    } finally {
      setBusy(false);
    }
  }

  function confsForDecl(
    declId: string,
    list: CajaConfirmacionDto[],
  ): CajaConfirmacionDto[] {
    return list.filter((c) => c.declaracionId === declId);
  }

  if (loading && !data) {
    return <LoadingState label="Cargando Mi Caja…" className="mt-6" />;
  }
  if (error && !data) {
    return (
      <div className="mt-6 space-y-3">
        <ErrorState title="No se pudo cargar Mi Caja">{error}</ErrorState>
        <Button type="button" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!data) return null;

  const maxDecl = data.totales.maxNuevaDeclaracion;

  return (
    <div className="mt-6 space-y-8">
      <Alert variant="info" title="Cómo leer estos importes">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Declarado</strong> es lo que afirmas haber entregado; no
            implica que ADMIN ya lo recibió.
          </li>
          <li>
            <strong>Confirmado</strong> es lo que ADMIN registró como recibido.
          </li>
          <li>
            <strong>Deuda pendiente</strong> = obligado − confirmado.
          </li>
        </ul>
      </Alert>

      {success ? (
        <Alert variant="success" title="Declaración guardada">
          {success}
        </Alert>
      ) : null}

      <section>
        <h2 className="text-base font-semibold text-ink">Resumen</h2>
        <CajaTotalesGrid
          className="mt-3"
          totales={data.totales}
          items={[
            { key: "totalBruto", label: "Bruto vendido" },
            { key: "totalComision", label: "Tu comisión" },
            {
              key: "totalObligado",
              label: "Debes entregar",
              emphasize: true,
            },
            { key: "totalDeclarado", label: "Declarado" },
            {
              key: "totalConfirmado",
              label: "Confirmado por ADMIN",
              emphasize: true,
            },
            {
              key: "deudaPendienteEntregar",
              label: "Deuda pendiente",
              emphasize: true,
            },
            { key: "pendienteConfirmar", label: "Pendiente de confirmación" },
            { key: "pendienteDeclarar", label: "Pendiente de declarar" },
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Declarar entrega</h2>
        <p className="text-sm text-ink-muted">
          Máximo disponible:{" "}
          <strong className="tabular-nums text-ink">
            {formatCajaMoney(maxDecl)}
          </strong>
        </p>
        <div className="flex max-w-sm flex-col gap-3">
          <Input
            label="Importe a declarar"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
          <Button
            type="button"
            disabled={Number(maxDecl) <= 0}
            onClick={() => {
              setFormError(null);
              setDialogOpen(true);
            }}
          >
            Continuar
          </Button>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-ink">Mis declaraciones</h2>
        {data.declaraciones.length === 0 ? (
          <EmptyState
            title="Sin declaraciones"
            description="Cuando entregues efectivo a ADMIN, regístralo aquí."
            className="mt-3"
          />
        ) : (
          <DataTable className="mt-3">
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Fecha</DataTableTh>
                <DataTableTh>Declarado</DataTableTh>
                <DataTableTh>Confirmado</DataTableTh>
                <DataTableTh>Pendiente</DataTableTh>
                <DataTableTh>Estado</DataTableTh>
                <DataTableTh>
                  <span className="sr-only">Detalle</span>
                </DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {data.declaraciones.map((d: CajaDeclaracionDto) => (
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
                  <DataTableTd>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setExpanded((cur) => (cur === d.id ? null : d.id))
                      }
                    >
                      {expanded === d.id ? "Ocultar" : "Confirmaciones"}
                    </Button>
                    {expanded === d.id ? (
                      <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                        {confsForDecl(d.id, data.confirmaciones).length ===
                        0 ? (
                          <li>Sin confirmaciones de ADMIN aún.</li>
                        ) : (
                          confsForDecl(d.id, data.confirmaciones).map((c) => (
                            <li key={c.id}>
                              {formatCajaInstant(c.confirmadoAt)} —{" "}
                              {formatCajaMoney(c.importeConfirmado)}
                            </li>
                          ))
                        )}
                      </ul>
                    ) : null}
                  </DataTableTd>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </section>

      <ConfirmDialog
        open={dialogOpen}
        title="Confirmar declaración"
        description={
          <div className="space-y-2 text-sm">
            <p>
              Vas a declarar{" "}
              <strong>{formatCajaMoney(importe.trim() || "0")}</strong>.
            </p>
            <p>
              Máximo permitido: {formatCajaMoney(maxDecl)}. Esto no confirma
              recepción: ADMIN debe confirmar el efectivo.
            </p>
            {formError ? (
              <p className="font-medium text-danger-800">{formError}</p>
            ) : null}
          </div>
        }
        confirmLabel="Declarar"
        loading={busy}
        onCancel={() => {
          if (!busy) setDialogOpen(false);
        }}
        onConfirm={() => void submitDeclaracion()}
      />
    </div>
  );
}
