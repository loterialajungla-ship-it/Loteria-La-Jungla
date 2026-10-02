import type { TicketPreviewData } from "@/components/tickets/TicketPreview";

/** URL del QR / consulta pública. */
export function buildTicketConsultaUrl(
  origin: string,
  codigoPublico: string,
): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/ticket/${codigoPublico}`;
}

/** Nombre de archivo amigable: ticket-LJ-YYYYMMDD-NNNNNN.png */
export function ticketPngFileName(numeroVisible: string): string {
  const safe = numeroVisible.trim().replace(/[^\w.-]+/g, "-");
  return `ticket-${safe}.png`;
}

/**
 * Garantiza que el payload usado para la imagen de venta
 * no incluye campos internos (multiplicador, premio, exposición).
 */
export function sanitizeTicketForClientImage(
  ticket: TicketPreviewData & Record<string, unknown>,
): TicketPreviewData {
  const prohibidos = [
    "multiplicador",
    "multiplicadorUsado",
    "premio",
    "premioTotal",
    "exposicion",
    "riesgo",
    "ganancia",
  ] as const;

  for (const key of prohibidos) {
    if (key in ticket) {
      throw new Error(`Campo prohibido en imagen de ticket: ${key}`);
    }
  }

  return {
    numeroVisible: ticket.numeroVisible,
    codigoPublico: ticket.codigoPublico,
    fechaJuego: ticket.fechaJuego,
    totalApostado: ticket.totalApostado,
    lineas: ticket.lineas.map((l) => ({
      hora: l.hora,
      numeroAnimal: l.numeroAnimal,
      nombreAnimalSnapshot: l.nombreAnimalSnapshot,
      importe: l.importe,
    })),
  };
}

export function horasEnTicket(ticket: TicketPreviewData): number[] {
  return Array.from(new Set(ticket.lineas.map((l) => l.hora))).sort(
    (a, b) => a - b,
  );
}

export function puedeCompartirArchivos(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return true;
  try {
    const probe = new File([new Uint8Array([1])], "t.png", {
      type: "image/png",
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Dimensiones para html-to-image: evita PNG cortado a la derecha
 * (scrollWidth/offsetWidth vs clientWidth + bordes).
 */
export function resolveTicketExportSize(metrics: {
  scrollWidth: number;
  offsetWidth: number;
  clientWidth: number;
  scrollHeight: number;
  offsetHeight: number;
  clientHeight: number;
}): { width: number; height: number } {
  return {
    width: Math.ceil(
      Math.max(metrics.scrollWidth, metrics.offsetWidth, metrics.clientWidth),
    ),
    height: Math.ceil(
      Math.max(
        metrics.scrollHeight,
        metrics.offsetHeight,
        metrics.clientHeight,
      ),
    ),
  };
}

export function ticketExportSizeFromElement(el: HTMLElement): {
  width: number;
  height: number;
} {
  return resolveTicketExportSize({
    scrollWidth: el.scrollWidth,
    offsetWidth: el.offsetWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    offsetHeight: el.offsetHeight,
    clientHeight: el.clientHeight,
  });
}

/** PNG data URL no vacío (canvas en blanco a veces da data:,). */
export function isUsablePngDataUrl(dataUrl: string): boolean {
  return (
    typeof dataUrl === "string" &&
    dataUrl.startsWith("data:image/png;base64,") &&
    dataUrl.length > 256
  );
}

export type QrFrameRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Posición del QR relativa al root (para reinyectar en el canvas exportado). */
export function measureQrFrameRelative(
  root: HTMLElement,
  frame: HTMLElement,
): QrFrameRect {
  const rootRect = root.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  return {
    x: frameRect.left - rootRect.left,
    y: frameRect.top - rootRect.top,
    width: frameRect.width,
    height: frameRect.height,
  };
}

export function scaleQrFrameToCanvas(
  frame: QrFrameRect,
  rootCssWidth: number,
  canvasWidth: number,
): QrFrameRect {
  const scale = rootCssWidth > 0 ? canvasWidth / rootCssWidth : 1;
  return {
    x: frame.x * scale,
    y: frame.y * scale,
    width: frame.width * scale,
    height: frame.height * scale,
  };
}

export function readQrCanvasDataUrl(root: HTMLElement): string | null {
  const canvas =
    root.querySelector<HTMLCanvasElement>("canvas[data-ticket-qr-canvas]") ??
    root.querySelector<HTMLCanvasElement>("canvas");
  if (!canvas) return null;
  try {
    const dataUrl = canvas.toDataURL("image/png");
    return isUsablePngDataUrl(dataUrl) ? dataUrl : null;
  } catch {
    return null;
  }
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("IMG_LOAD_FAILED"));
    img.src = src;
  });
}

/** Dibuja el QR encima del canvas exportado (evita hueco blanco en móvil/iOS). */
export async function compositeQrOntoExportCanvas(
  exportCanvas: HTMLCanvasElement,
  qrDataUrl: string,
  frameOnCanvas: QrFrameRect,
): Promise<void> {
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) throw new Error("NO_2D_CONTEXT");
  const img = await loadHtmlImage(qrDataUrl);
  // Fondo blanco del marco (por si el hueco quedó transparente/verde).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(
    frameOnCanvas.x,
    frameOnCanvas.y,
    frameOnCanvas.width,
    frameOnCanvas.height,
  );
  // p-3 = 12px en el marco CSS → escalar padding con el marco.
  const pad = frameOnCanvas.width * (12 / (168 + 24));
  ctx.drawImage(
    img,
    frameOnCanvas.x + pad,
    frameOnCanvas.y + pad,
    Math.max(1, frameOnCanvas.width - pad * 2),
    Math.max(1, frameOnCanvas.height - pad * 2),
  );
}

export function exportCanvasToPngBlob(
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("EMPTY_BLOB"));
        else resolve(blob);
      },
      "image/png",
      1,
    );
  });
}
