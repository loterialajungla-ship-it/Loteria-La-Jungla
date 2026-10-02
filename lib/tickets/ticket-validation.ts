import { Prisma } from "@prisma/client";
import {
  HORAS_SORTEO,
  fechaHoyParaPrisma,
  parseFechaYYYYMMDD,
} from "@/lib/fecha";
import {
  DuplicateTicketLineError,
  EmptyTicketLinesError,
  InvalidBetAmountError,
  InvalidDrawHourError,
  InvalidGameDateError,
  TicketValidationError,
} from "@/lib/tickets/errors";
import type { CreateTicketLineaInput } from "@/lib/tickets/types";

const IMPORTE_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

/**
 * Solo permite la fecha de hoy en America/Caracas.
 * Devuelve Date a medianoche UTC para `@db.Date`.
 */
export function validarFechaJuegoHoy(
  fechaStr: string,
  ahora = new Date(),
): Date {
  const parseada = parseFechaYYYYMMDD(fechaStr);
  if (!parseada) {
    throw new InvalidGameDateError("Fecha de juego inválida.");
  }

  const hoy = fechaHoyParaPrisma(ahora);
  if (parseada.getTime() !== hoy.getTime()) {
    throw new InvalidGameDateError();
  }

  return parseada;
}

export function validarHoraSorteo(hora: number): void {
  if (!Number.isInteger(hora) || !(HORAS_SORTEO as readonly number[]).includes(hora)) {
    throw new InvalidDrawHourError(hora);
  }
}

/**
 * Parsea y valida un importe monetario como Decimal (> 0, máx. 2 decimales).
 * No usa float como fuente de verdad.
 */
export function parsearImporte(raw: string | number): Prisma.Decimal {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new InvalidBetAmountError("Importe no finito.");
    }
    // Evitar artefacts de float: exigir representación limpia con ≤2 decimales.
    const asFixed = raw.toString();
    if (asFixed.includes("e") || asFixed.includes("E")) {
      throw new InvalidBetAmountError("Importe en notación científica no permitido.");
    }
    return parsearImporte(asFixed);
  }

  const texto = raw.trim();
  if (!IMPORTE_REGEX.test(texto)) {
    throw new InvalidBetAmountError(
      "Importe inválido: use un número positivo con máximo 2 decimales.",
    );
  }

  const importe = new Prisma.Decimal(texto);
  if (importe.lte(0)) {
    throw new InvalidBetAmountError("El importe debe ser mayor que 0.");
  }
  if (importe.decimalPlaces() > 2) {
    throw new InvalidBetAmountError("El importe admite máximo 2 decimales.");
  }

  return importe;
}

export function validarLineasBasicas(lineas: CreateTicketLineaInput[]): {
  hora: number;
  numeroAnimal: string;
  importe: Prisma.Decimal;
}[] {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new EmptyTicketLinesError();
  }

  const vistas = new Set<string>();
  const preparadas: {
    hora: number;
    numeroAnimal: string;
    importe: Prisma.Decimal;
  }[] = [];

  for (const linea of lineas) {
    validarHoraSorteo(linea.hora);

    const numeroAnimal =
      typeof linea.numeroAnimal === "string" ? linea.numeroAnimal.trim() : "";
    if (!numeroAnimal) {
      throw new TicketValidationError(
        "Número de animal requerido.",
        "ANIMAL_REQUIRED",
      );
    }

    const clave = `${linea.hora}|${numeroAnimal}`;
    if (vistas.has(clave)) {
      throw new DuplicateTicketLineError(linea.hora, numeroAnimal);
    }
    vistas.add(clave);

    preparadas.push({
      hora: linea.hora,
      numeroAnimal,
      importe: parsearImporte(linea.importe),
    });
  }

  return preparadas;
}

export function sumarImportes(importes: Prisma.Decimal[]): Prisma.Decimal {
  return importes.reduce(
    (acc, valor) => acc.plus(valor),
    new Prisma.Decimal(0),
  );
}
