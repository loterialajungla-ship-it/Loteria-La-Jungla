import { createHash } from "node:crypto";
import { TicketValidationError } from "@/lib/tickets/errors";

/** UUID v1–v5 (RFC 4122). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validarIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new TicketValidationError(
      "idempotencyKey es obligatoria.",
      "INVALID_IDEMPOTENCY_KEY",
    );
  }
  const key = raw.trim();
  if (!key) {
    throw new TicketValidationError(
      "idempotencyKey es obligatoria.",
      "INVALID_IDEMPOTENCY_KEY",
    );
  }
  if (key.length > 64 || !UUID_RE.test(key)) {
    throw new TicketValidationError(
      "idempotencyKey debe ser un UUID válido.",
      "INVALID_IDEMPOTENCY_KEY",
    );
  }
  return key.toLowerCase();
}

export type LineaParaHash = {
  hora: number;
  numeroAnimal: string;
  /** Importe canónico con 2 decimales, p. ej. "2.00" */
  importe: string;
};

/**
 * Hash SHA-256 determinista de la operación (sin vendedorId ni campos de servidor).
 * Ordena líneas por hora + numeroAnimal.
 */
export function buildIdempotencyRequestHash(args: {
  fechaJuego: string;
  lineas: LineaParaHash[];
}): string {
  const lineas = [...args.lineas].sort((a, b) => {
    if (a.hora !== b.hora) return a.hora - b.hora;
    return a.numeroAnimal.localeCompare(b.numeroAnimal);
  });

  const payload = JSON.stringify({
    fechaJuego: args.fechaJuego,
    lineas: lineas.map((l) => ({
      hora: l.hora,
      numeroAnimal: l.numeroAnimal,
      importe: l.importe,
    })),
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}
