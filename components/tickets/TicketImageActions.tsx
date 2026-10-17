"use client";

import { useState, type RefObject } from "react";
import { toCanvas } from "html-to-image";
import {
  compositeQrOntoExportCanvas,
  exportCanvasToPngBlob,
  measureQrFrameRelative,
  puedeCompartirArchivos,
  readQrCanvasDataUrl,
  scaleQrFrameToCanvas,
  ticketExportSizeFromElement,
  ticketPngFileName,
} from "@/components/tickets/ticket-image";
import { Alert, Button } from "@/components/ui";

type Props = {
  targetRef: RefObject<HTMLElement | null>;
  numeroVisible: string;
};

/**
 * Genera PNG del TicketPreview.
 * En móvil/iOS html-to-image deja el QR en blanco: se lee el canvas vivo
 * y se reinyecta el QR sobre el canvas exportado.
 */
export function TicketImageActions({ targetRef, numeroVisible }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareDisponible] = useState(() => puedeCompartirArchivos());

  async function generarBlob(): Promise<{ blob: Blob; fileName: string }> {
    const nodo = targetRef.current;
    if (!nodo) {
      throw new Error("NO_TARGET");
    }

    const prev = {
      width: nodo.style.width,
      maxWidth: nodo.style.maxWidth,
      boxSizing: nodo.style.boxSizing,
      marginLeft: nodo.style.marginLeft,
      marginRight: nodo.style.marginRight,
    };

    nodo.style.width = "352px";
    nodo.style.maxWidth = "352px";
    nodo.style.boxSizing = "border-box";
    nodo.style.marginLeft = "0";
    nodo.style.marginRight = "0";

    try {
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );

      // Snapshot del QR desde el canvas VISIBLE (antes de html-to-image).
      const qrDataUrl = readQrCanvasDataUrl(nodo);
      if (!qrDataUrl) {
        throw new Error("QR_NOT_READY");
      }

      const qrFrameEl = nodo.querySelector<HTMLElement>(
        "[data-ticket-qr-frame]",
      );
      if (!qrFrameEl) {
        throw new Error("QR_FRAME_MISSING");
      }

      const frameCss = measureQrFrameRelative(nodo, qrFrameEl);
      const { width, height } = ticketExportSizeFromElement(nodo);

      const exportCanvas = await toCanvas(nodo, {
        cacheBust: false,
        pixelRatio: 2,
        backgroundColor: "#022c22",
        width,
        height,
        canvasWidth: width * 2,
        canvasHeight: height * 2,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          maxWidth: `${width}px`,
          margin: "0",
          transform: "none",
          boxSizing: "border-box",
        },
        filter: (node) => {
          if (
            node instanceof HTMLElement &&
            node.dataset.exportHide === "true"
          ) {
            return false;
          }
          return true;
        },
      });

      const frameOnCanvas = scaleQrFrameToCanvas(
        frameCss,
        width,
        exportCanvas.width,
      );
      await compositeQrOntoExportCanvas(
        exportCanvas,
        qrDataUrl,
        frameOnCanvas,
      );

      const blob = await exportCanvasToPngBlob(exportCanvas);
      return { blob, fileName: ticketPngFileName(numeroVisible) };
    } finally {
      nodo.style.width = prev.width;
      nodo.style.maxWidth = prev.maxWidth;
      nodo.style.boxSizing = prev.boxSizing;
      nodo.style.marginLeft = prev.marginLeft;
      nodo.style.marginRight = prev.marginRight;
    }
  }

  function descargarBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onDescargar() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, fileName } = await generarBlob();
      descargarBlob(blob, fileName);
    } catch {
      setError("No se pudo generar la imagen del ticket.");
    } finally {
      setBusy(false);
    }
  }

  async function onCompartir() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, fileName } = await generarBlob();
      const file = new File([blob], fileName, { type: "image/png" });

      if (
        typeof navigator.share === "function" &&
        (typeof navigator.canShare !== "function" ||
          navigator.canShare({ files: [file] }))
      ) {
        await navigator.share({
          files: [file],
          title: "Ticket Lotería La Jungla",
          text: `Ticket ${numeroVisible}`,
        });
        return;
      }

      descargarBlob(blob, fileName);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError("No se pudo generar la imagen del ticket.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={busy}
          onClick={onDescargar}
          className="flex-1"
        >
          {busy ? "Generando imagen…" : "Descargar imagen"}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={busy}
          onClick={onCompartir}
          className="flex-1 bg-accent-100 text-brand-950 hover:bg-accent-50 focus-visible:ring-accent-700"
        >
          {busy
            ? "Generando imagen…"
            : shareDisponible
              ? "Compartir"
              : "Compartir (descarga)"}
        </Button>
      </div>
      {!shareDisponible ? (
        <p className="text-center text-xs text-ink-muted">
          Este navegador no comparte archivos: se descargará el PNG para
          adjuntarlo en WhatsApp.
        </p>
      ) : (
        <p className="text-center text-xs text-ink-muted">
          En el móvil, usa Compartir para enviarlo por WhatsApp u otras apps.
        </p>
      )}
      {error ? (
        <Alert variant="error" title="Error al generar imagen">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
