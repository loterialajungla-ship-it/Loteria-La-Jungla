"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimalGrid } from "@/components/tickets/AnimalGrid";
import type { AnimalOpcion } from "@/components/tickets/animal-types";
import { PosHourTabs } from "@/components/tickets/PosHourTabs";
import { TicketImageActions } from "@/components/tickets/TicketImageActions";
import { TicketPreview } from "@/components/tickets/TicketPreview";
import type { TicketPreviewData } from "@/components/tickets/TicketPreview";
import {
  TicketSummary,
  TicketSummaryHint,
} from "@/components/tickets/TicketSummary";
import { Alert, Button, PageHeader } from "@/components/ui";
import {
  apuestasALineasApi,
  eliminarLinea,
  formatearFechaUi,
  puedeCrearTicket,
  upsertLinea,
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

function nuevaIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function primeraHoraAbierta(
  horas: HoraDisponibilidadUi[],
): number | null {
  return horas.find((h) => h.abierta)?.hora ?? null;
}

export function TicketPOS({ fechaJuego, horasIniciales, animales }: Props) {
  const [horas, setHoras] = useState<HoraDisponibilidadUi[]>(horasIniciales);
  const [horaActiva, setHoraActiva] = useState<number | null>(() =>
    primeraHoraAbierta(horasIniciales),
  );
  const [actualizandoHoras, setActualizandoHoras] = useState(false);
  const [apuestas, setApuestas] = useState<PosApuestas>({});
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("pos");
  const [ticket, setTicket] = useState<TicketPreviewData | null>(null);
  const ticketRef = useRef<HTMLElement | null>(null);
  /** Misma key mientras la operación pendiente/reintento; nueva venta = nueva key. */
  const idempotencyKeyRef = useRef<string | null>(null);

  const conteos = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [hora, porHora] of Object.entries(apuestas)) {
      out[hora] = Object.keys(porHora).length;
    }
    return out;
  }, [apuestas]);

  const seleccionActiva = useMemo(() => {
    if (horaActiva == null) return {};
    return apuestas[String(horaActiva)] ?? {};
  }, [apuestas, horaActiva]);

  useEffect(() => {
    if (horaActiva == null) {
      setHoraActiva(primeraHoraAbierta(horas));
      return;
    }
    const info = horas.find((h) => h.hora === horaActiva);
    if (!info?.abierta) {
      setHoraActiva(primeraHoraAbierta(horas));
    }
  }, [horas, horaActiva]);

  const actualizarHoras = useCallback(async (): Promise<
    HoraDisponibilidadUi[] | null
  > => {
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

      idempotencyKeyRef.current = null;
      setTicket(sanitizeTicketForClientImage(data.ticket));
      setModo("exito");
      setApuestas({});
    } catch {
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

  function onSelectHora(hora: number) {
    const info = horas.find((h) => h.hora === hora);
    if (!info?.abierta) return;
    setHoraActiva(hora);
  }

  function onToggleAnimal(numero: string) {
    if (horaActiva == null) return;
    setApuestas((prev) => {
      const porHora = prev[String(horaActiva)] ?? {};
      if (numero in porHora) {
        return eliminarLinea(prev, horaActiva, numero);
      }
      return upsertLinea(prev, horaActiva, numero, "");
    });
  }

  function onImporteAnimal(numero: string, importe: string) {
    if (horaActiva == null) return;
    setApuestas((prev) => upsertLinea(prev, horaActiva, numero, importe));
  }

  if (modo === "exito" && ticket) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <p className="text-center text-sm font-semibold uppercase tracking-wide text-brand-800">
          Ticket generado
        </p>
        <div className="mt-4">
          <TicketPreview ref={ticketRef} ticket={ticket} />
        </div>
        <TicketImageActions
          targetRef={ticketRef}
          numeroVisible={ticket.numeroVisible}
        />
        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          className="mt-4"
          onClick={nuevoTicket}
        >
          Nuevo ticket
        </Button>
      </div>
    );
  }

  return (
    <div className="pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] lg:pb-8">
      <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <PageHeader
            brand=""
            title="Punto de venta"
            meta={
              <>
                Fecha de juego:{" "}
                <strong className="text-ink">
                  {formatearFechaUi(fechaJuego)}
                </strong>
              </>
            }
            description="Solo se vende para hoy (hora Venezuela). Las horas cerradas no son seleccionables; el servidor valida de nuevo al crear."
          />

          <div className="mt-6">
            <PosHourTabs
              horas={horas}
              horaActiva={horaActiva}
              conteos={conteos}
              disabled={creando}
              actualizando={actualizandoHoras}
              onSelectHora={onSelectHora}
              onActualizar={() => void actualizarHoras()}
              panelId="pos-animal-panel"
            />
          </div>

          <div
            id="pos-animal-panel"
            role="tabpanel"
            aria-labelledby={
              horaActiva != null ? `pos-hora-tab-${horaActiva}` : undefined
            }
            className="mt-6"
          >
            {horaActiva == null ? (
              <p className="rounded-lj-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-ink-muted">
                No hay horas abiertas para vender ahora. Actualiza las horas o
                vuelve más tarde.
              </p>
            ) : (
              <fieldset disabled={creando} className="min-w-0">
                <legend className="sr-only">
                  Animales para la hora activa
                </legend>
                <AnimalGrid
                  animales={animales}
                  seleccion={seleccionActiva}
                  disabled={creando}
                  onToggle={onToggleAnimal}
                  onImporteChange={onImporteAnimal}
                />
              </fieldset>
            )}
          </div>

          {error ? (
            <div className="mt-4">
              <Alert variant="error" title="No se pudo crear el ticket">
                {error}
              </Alert>
            </div>
          ) : (
            <div className="mt-4">
              <TicketSummaryHint apuestas={apuestas} />
            </div>
          )}
        </div>

        <TicketSummary
          fechaJuego={fechaJuego}
          apuestas={apuestas}
          animales={animales}
          creando={creando}
          onChange={setApuestas}
          onCrear={() => void crearTicket()}
        />
      </div>
    </div>
  );
}
