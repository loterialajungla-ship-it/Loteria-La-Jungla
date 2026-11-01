"use client";

import { useMemo, useState } from "react";
import { AdminExposicionPanel } from "@/components/tickets/AdminExposicionPanel";
import {
  codigoErrorResultado,
  etiquetaOrigenResultado,
  etiquetaResultadoAnimal,
  formatResultadoLabel,
  mensajeErrorResultado,
  mensajeExitoProgramacion,
  parseAdminResultadosApiOk,
  resumenExposicionCompacto,
  type AnimalOpcion,
  type OrigenResultadoUi,
  type ResultadoActual,
} from "@/app/admin/admin-resultados-ui";
import { MOTIVO_CORRECCION_MAX } from "@/lib/resultados/correction-constants";
import {
  Alert,
  Button,
  Card,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { cn } from "@/components/ui/cn";

type Props = {
  fecha: string;
  hora: number;
  horaLabel: string;
  animales: AnimalOpcion[];
  numeroInicial: string;
  origenInicial?: OrigenResultadoUi | null;
};

type PasoCorreccion = "idle" | "confirmar" | "motivo";

export function AdminFilaResultado({
  fecha,
  hora,
  horaLabel,
  animales,
  numeroInicial,
  origenInicial = null,
}: Props) {
  const inicial = useMemo(() => {
    const base = etiquetaResultadoAnimal(animales, numeroInicial);
    if (!base) return null;
    return {
      ...base,
      ...(origenInicial ? { origen: origenInicial } : {}),
    };
  }, [animales, numeroInicial, origenInicial]);

  const [numero, setNumero] = useState(numeroInicial);
  const [resultadoActual, setResultadoActual] = useState<ResultadoActual | null>(
    inicial,
  );
  /** Programación PENDIENTE conocida en esta sesión (no publicada). */
  const [programacionPendiente, setProgramacionPendiente] =
    useState<ResultadoActual | null>(null);
  const [estado, setEstado] = useState<"idle" | "guardando" | "ok" | "error">(
    "idle",
  );
  const [mensaje, setMensaje] = useState("");
  const [resumenApuestas, setResumenApuestas] = useState<string | null>(null);
  const [pasoCorreccion, setPasoCorreccion] = useState<PasoCorreccion>("idle");
  const [motivo, setMotivo] = useState("");

  const resultadoLabel = formatResultadoLabel(resultadoActual);
  const tieneResultado = resultadoActual != null;
  const origenBadge = etiquetaOrigenResultado(resultadoActual?.origen);

  function resetCorreccionUi() {
    setPasoCorreccion("idle");
    setMotivo("");
  }

  async function enviar(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/resultados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data: unknown = await res.json().catch(() => ({}));

    if (res.status === 401 || res.status === 403) {
      setEstado("error");
      setMensaje("No autorizado. Inicia sesión como ADMIN.");
      return;
    }

    if (!res.ok) {
      const errPayload = data as {
        error?: string | { message?: string; code?: string };
      };
      const code = codigoErrorResultado(errPayload);
      setEstado("error");
      if (code === "RESULT_CONFLICT" || code === "SCHEDULE_CONFLICT") {
        setMensaje(
          `${mensajeErrorResultado(errPayload)} Recarga la página para ver el valor actual.`,
        );
        resetCorreccionUi();
        return;
      }
      if (code === "CORRECTION_REQUIRED") {
        setMensaje(mensajeErrorResultado(errPayload));
        return;
      }
      setMensaje(mensajeErrorResultado(errPayload));
      return;
    }

    const ok = parseAdminResultadosApiOk(data);
    if (!ok) {
      setEstado("error");
      setMensaje("Respuesta inválida del servidor.");
      return;
    }

    if (ok.kind === "programacion") {
      const p = ok.programacion;
      if (p.action === "cancelled" || p.estado === "CANCELADO") {
        setProgramacionPendiente(null);
      } else if (p.estado === "PENDIENTE") {
        setProgramacionPendiente({
          numero: p.numero,
          nombre: p.nombre,
        });
        setNumero(p.numero);
      }
      setEstado("ok");
      setMensaje(mensajeExitoProgramacion(p));
      resetCorreccionUi();
      return;
    }

    setProgramacionPendiente(null);
    setResultadoActual({
      numero: ok.resultado.numero,
      nombre: ok.resultado.nombre,
      origen: ok.resultado.origen ?? "MANUAL",
    });
    setNumero(ok.resultado.numero);
    setEstado("ok");
    setMensaje(
      tieneResultado && body.confirmCorrection === true
        ? "Resultado corregido."
        : "Resultado guardado.",
    );
    resetCorreccionUi();
  }

  async function publicarNuevo() {
    if (estado === "guardando") return;

    if (!numero) {
      setEstado("error");
      setMensaje("Elige un animalito.");
      return;
    }

    setEstado("guardando");
    setMensaje("");

    try {
      await enviar({ fecha, hora, numero });
    } catch {
      setEstado("error");
      setMensaje("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
    }
  }

  async function cancelarProgramacion() {
    if (estado === "guardando" || !programacionPendiente) return;
    setEstado("guardando");
    setMensaje("");
    try {
      await enviar({ fecha, hora, action: "cancelProgramacion" });
    } catch {
      setEstado("error");
      setMensaje(
        "No se pudo cancelar la programación. Revisa tu conexión e inténtalo de nuevo.",
      );
    }
  }

  function iniciarCorreccion() {
    if (!numero) {
      setEstado("error");
      setMensaje("Elige el animalito corregido.");
      return;
    }
    if (resultadoActual && numero === resultadoActual.numero) {
      setEstado("error");
      setMensaje("Elige un animalito distinto al resultado publicado.");
      return;
    }
    setEstado("idle");
    setMensaje("");
    setPasoCorreccion("confirmar");
  }

  async function confirmarCorreccion() {
    if (estado === "guardando") return;
    if (!resultadoActual) return;

    const trimmed = motivo.trim();
    if (!trimmed) {
      setEstado("error");
      setMensaje("El motivo es obligatorio.");
      return;
    }
    if (trimmed.length > MOTIVO_CORRECCION_MAX) {
      setEstado("error");
      setMensaje(`Máximo ${MOTIVO_CORRECCION_MAX} caracteres.`);
      return;
    }

    setEstado("guardando");
    setMensaje("");

    try {
      await enviar({
        fecha,
        hora,
        numero,
        confirmCorrection: true,
        motivo: trimmed,
        expectedNumero: resultadoActual.numero,
      });
    } catch {
      setEstado("error");
      setMensaje("No se pudo corregir. Revisa tu conexión e inténtalo de nuevo.");
    }
  }

  return (
    <Card
      as="li"
      padding="sm"
      id={`sorteo-${hora}`}
      className={cn(
        "scroll-mt-28",
        tieneResultado
          ? "border-brand-200"
          : "border-accent-100 border-l-4 border-l-accent-700",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-1 pt-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-bold tabular-nums text-brand-900">
              {horaLabel}
            </p>
            <StatusBadge
              tone={
                tieneResultado
                  ? "success"
                  : programacionPendiente
                    ? "info"
                    : "warning"
              }
              label={
                tieneResultado
                  ? "Publicado"
                  : programacionPendiente
                    ? "Programado"
                    : "Pendiente"
              }
            />
            {origenBadge ? (
              <StatusBadge
                tone={origenBadge.tone}
                label={origenBadge.label}
              />
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-ink-secondary">
            <span className="font-medium text-ink-muted">Resultado:</span>{" "}
            {tieneResultado ? (
              <span className="font-semibold text-ink">
                <span className="font-mono tabular-nums">
                  {resultadoActual?.numero}
                </span>
                {resultadoActual?.nombre
                  ? ` — ${resultadoActual.nombre}`
                  : null}
              </span>
            ) : programacionPendiente ? (
              <span className="font-semibold text-ink">
                Programado (oculto):{" "}
                <span className="font-mono tabular-nums">
                  {programacionPendiente.numero}
                </span>
                {programacionPendiente.nombre
                  ? ` — ${programacionPendiente.nombre}`
                  : null}
              </span>
            ) : (
              <span className="font-semibold text-accent-800">
                Sin publicar
              </span>
            )}
          </p>
        </div>
        {resumenApuestas ? (
          <p className="max-w-[12rem] text-right text-xs font-medium tabular-nums text-ink-muted">
            {resumenApuestas}
          </p>
        ) : null}
      </div>

      {pasoCorreccion === "idle" ? (
        <div className="mt-3 flex flex-col gap-2.5 px-1 pb-1 sm:flex-row sm:items-end">
          <Select
            label={tieneResultado ? "Corregir animalito" : "Animalito ganador"}
            name={`animal-${hora}`}
            value={numero}
            containerClassName="min-w-0 flex-1"
            onChange={(e) => {
              setNumero(e.target.value);
              setEstado("idle");
              setMensaje("");
            }}
          >
            <option value="">— Seleccionar —</option>
            {animales.map((animal) => (
              <option key={animal.numero} value={animal.numero}>
                {animal.numero} - {animal.nombre}
              </option>
            ))}
          </Select>

          <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row">
            <Button
              type="button"
              variant={tieneResultado ? "secondary" : "primary"}
              size="md"
              onClick={() =>
                void (tieneResultado ? iniciarCorreccion() : publicarNuevo())
              }
              disabled={estado === "guardando"}
              className="sm:min-w-[11rem]"
            >
              {estado === "guardando"
                ? "Guardando…"
                : tieneResultado
                  ? "Corregir…"
                  : "Guardar"}
            </Button>
            {programacionPendiente && !tieneResultado ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => void cancelarProgramacion()}
                disabled={estado === "guardando"}
              >
                Cancelar programación
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {pasoCorreccion === "confirmar" ? (
        <div
          role="dialog"
          aria-labelledby={`corregir-confirm-${hora}`}
          className="mt-3 rounded-lj-lg border border-danger-100 bg-danger-50 p-3"
        >
          <h2
            id={`corregir-confirm-${hora}`}
            className="text-base font-bold text-danger-800"
          >
            ¿Corregir el resultado publicado?
          </h2>
          <p className="mt-2 text-sm text-ink">
            Esto puede cambiar qué líneas de ticket resultan ganadoras para las{" "}
            <span className="font-semibold">{horaLabel}</span> (
            <span className="font-mono">{fecha}</span>).
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Actual</dt>
              <dd className="font-mono font-semibold">
                {resultadoActual?.numero}
                {resultadoActual?.nombre
                  ? ` — ${resultadoActual.nombre}`
                  : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Nuevo</dt>
              <dd className="font-mono font-semibold">
                {formatResultadoLabel(etiquetaResultadoAnimal(animales, numero))}
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="danger"
              size="md"
              className="flex-1"
              onClick={() => setPasoCorreccion("motivo")}
            >
              Continuar
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={resetCorreccionUi}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {pasoCorreccion === "motivo" ? (
        <div className="mt-3 rounded-lj-lg border border-danger-100 bg-danger-50 p-3">
          <h2 className="text-base font-bold text-danger-800">
            Motivo de la corrección
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Obligatorio. Quedará en la auditoría con el valor anterior y el
            nuevo.
          </p>
          <Textarea
            name="motivo-correccion"
            label="Motivo"
            variant="danger"
            value={motivo}
            maxLength={MOTIVO_CORRECCION_MAX}
            disabled={estado === "guardando"}
            onChange={(e) => {
              setMotivo(e.target.value);
              setEstado("idle");
              setMensaje("");
            }}
            rows={3}
            placeholder="Describe el motivo…"
            containerClassName="mt-3"
          />
          <p className="mt-1 text-right text-xs text-ink-muted">
            {motivo.trim().length}/{MOTIVO_CORRECCION_MAX}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="danger"
              size="md"
              className="flex-1"
              disabled={estado === "guardando" || !motivo.trim()}
              onClick={() => void confirmarCorreccion()}
            >
              {estado === "guardando" ? "Corrigiendo…" : "Confirmar corrección"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1"
              disabled={estado === "guardando"}
              onClick={resetCorreccionUi}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {mensaje ? (
        <div className="mt-2.5 px-1">
          <Alert
            variant={estado === "ok" ? "success" : "error"}
            title={estado === "ok" ? "Correcto" : "Error"}
          >
            {mensaje}
          </Alert>
        </div>
      ) : null}

      <div className="px-1 pb-1">
        <AdminExposicionPanel
          fecha={fecha}
          hora={hora}
          resultadoLabel={resultadoLabel}
          onResumen={(r) => {
            if (!r) {
              setResumenApuestas(null);
              return;
            }
            setResumenApuestas(resumenExposicionCompacto(r));
          }}
        />
      </div>
    </Card>
  );
}
