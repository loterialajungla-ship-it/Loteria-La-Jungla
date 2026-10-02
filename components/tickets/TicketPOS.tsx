"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { HourBetSection } from "@/components/tickets/HourBetSection";
import type { AnimalOpcion } from "@/components/tickets/HourBetSection";
import { TicketImageActions } from "@/components/tickets/TicketImageActions";
import { TicketPreview } from "@/components/tickets/TicketPreview";
import type { TicketPreviewData } from "@/components/tickets/TicketPreview";
import { TicketSummary } from "@/components/tickets/TicketSummary";
import {
  apuestasALineasApi,
  etiquetaHora,
  formatearFechaUi,
  puedeCrearTicket,
  toggleHora,
} from "@/components/tickets/pos-state";
import type { PosApuestas } from "@/components/tickets/pos-state";
import { sanitizeTicketForClientImage } from "@/components/tickets/ticket-image";

export type HoraDisponibilidadUi = {
  hora: number;
  abierta: boolean;
  motivoCierre?: "HORA_LLEGADA" | "RESULTADO_PUBLICADO";
};

type Props = {
  fechaJuego: string;
  horasIniciales: HoraDisponibilidadUi[];
  animales: AnimalOpcion[];
};

type Modo = "pos" | "exito";

function quitarHorasCerradas(
  apuestas: PosApuestas,
  horas: HoraDisponibilidadUi[],
): PosApuestas {
  const abiertas = new Set(
    horas.filter((h) => h.abierta).map((h) => String(h.hora)),
  );
  const siguiente: PosApuestas = {};
  for (const [key, value] of Object.entries(apuestas)) {
    if (abiertas.has(key)) siguiente[key] = value;
  }
  return siguiente;
}

function etiquetaEstadoHora(h: HoraDisponibilidadUi): string {
  if (h.abierta) return "ABIERTA";
  if (h.motivoCierre === "RESULTADO_PUBLICADO") return "CERRADO · Resultado";
  return "CERRADO";
}

function nuevaIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback raro (navegadores antiguos): no ideal, pero evita romper UX.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function TicketPOS({ fechaJuego, horasIniciales, animales }: Props) {
  const [horas, setHoras] = useState<HoraDisponibilidadUi[]>(horasIniciales);
  const [actualizandoHoras, setActualizandoHoras] = useState(false);
  const [apuestas, setApuestas] = useState<PosApuestas>({});
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("pos");
  const [ticket, setTicket] = useState<TicketPreviewData | null>(null);
  const ticketRef = useRef<HTMLElement | null>(null);
  /** Misma key mientras la operación pendiente/reintento; nueva venta = nueva key. */
  const idempotencyKeyRef = useRef<string | null>(null);

  const horasSeleccionadas = useMemo(
    () =>
      Object.keys(apuestas)
        .map(Number)
        .sort((a, b) => a - b),
    [apuestas],
  );

  const actualizarHoras = useCallback(async (): Promise<HoraDisponibilidadUi[] | null> => {
    setActualizandoHoras(true);
    try {
      const res = await fetch("/api/venta/horas-disponibles", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        horas?: HoraDisponibilidadUi[];
      };
      if (!res.ok || !data.ok || !Array.isArray(data.horas)) {
        return null;
      }
      setHoras(data.horas);
      setApuestas((prev) => quitarHorasCerradas(prev, data.horas!));
      return data.horas;
    } catch {
      return null;
    } finally {
      setActualizandoHoras(false);
    }
  }, []);

  async function crearTicket() {
    if (creando || !puedeCrearTicket(apuestas)) return;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = nuevaIdempotencyKey();
    }
    const idempotencyKey = idempotencyKeyRef.current;

    setCreando(true);
    setError(null);

    try {
      const res = await fetch("/api/venta/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fechaJuego,
          idempotencyKey,
          lineas: apuestasALineasApi(apuestas),
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        ticket?: TicketPreviewData;
        idempotentReplay?: boolean;
        error?: { code?: string; message?: string };
      };

      if (res.status === 401) {
        setError("Tu sesión ha expirado. Inicia sesión nuevamente.");
        return;
      }
      if (res.status === 409) {
        // Conflicto de idempotencia / payload: nueva operación en el próximo intento.
        idempotencyKeyRef.current = null;
        setError(
          data.error?.message ??
            "Se produjo un conflicto al generar el ticket. Inténtalo nuevamente.",
        );
        return;
      }
      if (res.status === 400 && data.error?.code === "DRAW_CLOSED") {
        const horaMatch = /(\d{1,2}):00/.exec(data.error.message ?? "");
        const label = horaMatch
          ? `${horaMatch[1].padStart(2, "0")}:00`
          : "seleccionada";
        setError(
          `El sorteo de las ${label} ya cerró. Actualiza las horas disponibles.`,
        );
        await actualizarHoras();
        return;
      }
      if ((!res.ok && res.status !== 200) || !data.ticket) {
        setError(
          data.error?.message ??
            "No se pudo crear el ticket. Revisa los datos e inténtalo nuevamente.",
        );
        return;
      }

      // 201 crear o 200 replay: éxito. Siguiente venta = nueva key.
      idempotencyKeyRef.current = null;
      setTicket(sanitizeTicketForClientImage(data.ticket));
      setModo("exito");
      setApuestas({});
    } catch {
      // Error de red/timeout: conservar la misma idempotencyKey para reintento.
      setError(
        "No se pudo crear el ticket. Puedes reintentar: no se duplicará la venta.",
      );
    } finally {
      setCreando(false);
    }
  }

  function nuevoTicket() {
    setTicket(null);
    setModo("pos");
    setApuestas({});
    setError(null);
    idempotencyKeyRef.current = null;
    void actualizarHoras();
  }

  function onToggleHora(hora: number) {
    const info = horas.find((h) => h.hora === hora);
    if (!info?.abierta) return;
    setApuestas((prev) => toggleHora(prev, hora));
  }

  if (modo === "exito" && ticket) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <p className="text-center text-sm font-semibold uppercase tracking-wide text-emerald-800">
          Ticket generado
        </p>
        <div className="mt-4">
          <TicketPreview ref={ticketRef} ticket={ticket} />
        </div>
        <TicketImageActions
          targetRef={ticketRef}
          numeroVisible={ticket.numeroVisible}
        />
        <button
          type="button"
          onClick={nuevoTicket}
          className="mt-4 w-full rounded-xl bg-emerald-800 px-4 py-4 text-base font-bold text-white hover:bg-emerald-700"
        >
          Nuevo ticket
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-0px)] flex-col pb-4">
      <header className="mx-auto w-full max-w-lg px-4 pt-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          Lotería La Jungla
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">
          Punto de venta
        </h1>
        <p className="mt-2 text-base text-stone-600">
          Fecha de juego:{" "}
          <strong className="text-stone-900">
            {formatearFechaUi(fechaJuego)}
          </strong>
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Solo se vende para hoy (hora Venezuela). Las horas cerradas no son
          seleccionables; el servidor valida de nuevo al crear.
        </p>
      </header>

      <div className="mx-auto mt-6 w-full max-w-lg flex-1 px-4">
        <div className="flex items-end justify-between gap-3">
          <p className="text-sm font-semibold text-stone-700">
            Horas del sorteo
          </p>
          <button
            type="button"
            disabled={creando || actualizandoHoras}
            onClick={() => void actualizarHoras()}
            className="text-sm font-semibold text-emerald-800 underline underline-offset-2 disabled:opacity-50"
          >
            {actualizandoHoras ? "Actualizando…" : "Actualizar horas"}
          </button>
        </div>

        <fieldset disabled={creando} className="mt-2">
          <legend className="sr-only">Seleccionar horas abiertas</legend>
          <div className="flex flex-wrap gap-2">
            {horas.map((h) => {
              const activa = String(h.hora) in apuestas;
              const cerrada = !h.abierta;
              return (
                <button
                  key={h.hora}
                  type="button"
                  aria-pressed={activa}
                  aria-disabled={cerrada}
                  disabled={cerrada}
                  title={
                    cerrada
                      ? h.motivoCierre === "RESULTADO_PUBLICADO"
                        ? "Cerrado — resultado publicado"
                        : "Cerrado — el sorteo ya comenzó"
                      : undefined
                  }
                  onClick={() => onToggleHora(h.hora)}
                  className={`rounded-full px-4 py-2.5 text-sm font-bold tabular-nums ${
                    cerrada
                      ? "cursor-not-allowed border border-stone-200 bg-stone-100 text-stone-400"
                      : activa
                        ? "bg-emerald-800 text-white"
                        : "border border-stone-300 bg-white text-stone-800 hover:border-emerald-600"
                  }`}
                >
                  <span
                    className={`block leading-tight ${cerrada ? "line-through" : ""}`}
                  >
                    {etiquetaHora(h.hora)}
                  </span>
                  <span
                    className={`block text-[10px] font-semibold uppercase tracking-wide ${
                      cerrada
                        ? "text-stone-400"
                        : activa
                          ? "text-emerald-100"
                          : "text-emerald-700"
                    }`}
                  >
                    {etiquetaEstadoHora(h)}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-6 flex flex-col gap-4">
          {horasSeleccionadas.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-4 py-6 text-center text-stone-500">
              Selecciona una o varias horas abiertas para comenzar.
            </p>
          ) : (
            horasSeleccionadas.map((hora) => (
              <HourBetSection
                key={hora}
                hora={hora}
                animales={animales}
                apuestas={apuestas}
                apuestasHora={apuestas[String(hora)] ?? {}}
                onChange={setApuestas}
                disabled={creando}
              />
            ))
          )}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="mt-8">
        <TicketSummary
          apuestas={apuestas}
          creando={creando}
          onCrear={crearTicket}
        />
      </div>
    </div>
  );
}
