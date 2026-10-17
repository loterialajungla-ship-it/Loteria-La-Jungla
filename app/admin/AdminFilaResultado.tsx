"use client";

import { useMemo, useState } from "react";
import { AdminExposicionPanel } from "@/components/tickets/AdminExposicionPanel";
import {
  etiquetaResultadoAnimal,
  formatResultadoLabel,
  mensajeErrorResultado,
  parseResultadoApiOk,
  resumenExposicionCompacto,
  type AnimalOpcion,
  type ResultadoActual,
} from "@/app/admin/admin-resultados-ui";
import { Alert, Button, Card, Select, StatusBadge } from "@/components/ui";
import { cn } from "@/components/ui/cn";

type Props = {
  fecha: string;
  hora: number;
  horaLabel: string;
  animales: AnimalOpcion[];
  numeroInicial: string;
};

export function AdminFilaResultado({
  fecha,
  hora,
  horaLabel,
  animales,
  numeroInicial,
}: Props) {
  const inicial = useMemo(
    () => etiquetaResultadoAnimal(animales, numeroInicial),
    [animales, numeroInicial],
  );

  const [numero, setNumero] = useState(numeroInicial);
  const [resultadoActual, setResultadoActual] = useState<ResultadoActual | null>(
    inicial,
  );
  const [estado, setEstado] = useState<"idle" | "guardando" | "ok" | "error">(
    "idle",
  );
  const [mensaje, setMensaje] = useState("");
  const [resumenApuestas, setResumenApuestas] = useState<string | null>(null);

  const resultadoLabel = formatResultadoLabel(resultadoActual);
  const tieneResultado = resultadoActual != null;

  async function guardar() {
    if (estado === "guardando") return;

    if (!numero) {
      setEstado("error");
      setMensaje("Elige un animalito.");
      return;
    }

    setEstado("guardando");
    setMensaje("");

    try {
      const res = await fetch("/api/admin/resultados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, hora, numero }),
      });

      const data: unknown = await res.json().catch(() => ({}));

      if (res.status === 401 || res.status === 403) {
        setEstado("error");
        setMensaje("No autorizado. Inicia sesión como ADMIN.");
        return;
      }

      if (!res.ok) {
        setEstado("error");
        setMensaje(mensajeErrorResultado(data as { error?: string }));
        return;
      }

      const ok = parseResultadoApiOk(data);
      if (!ok) {
        setEstado("error");
        setMensaje("Respuesta inválida del servidor.");
        return;
      }

      setResultadoActual({
        numero: ok.resultado.numero,
        nombre: ok.resultado.nombre,
      });
      setNumero(ok.resultado.numero);
      setEstado("ok");
      setMensaje("Resultado guardado.");
    } catch {
      setEstado("error");
      setMensaje("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
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
              tone={tieneResultado ? "success" : "warning"}
              label={tieneResultado ? "Publicado" : "Pendiente"}
            />
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

      <div className="mt-3 flex flex-col gap-2.5 px-1 pb-1 sm:flex-row sm:items-end">
        <Select
          label={tieneResultado ? "Modificar animalito" : "Animalito ganador"}
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

        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={() => void guardar()}
          disabled={estado === "guardando"}
          className="sm:min-w-[11rem] sm:shrink-0"
        >
          {estado === "guardando"
            ? "Guardando…"
            : tieneResultado
              ? "Actualizar"
              : "Guardar"}
        </Button>
      </div>

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
