/**
 * Utilidades monetarias del módulo Caja.
 * Fuente de verdad: Prisma.Decimal — nunca Number/float para cálculos.
 * Redondeo oficial: ROUND_HALF_UP a 2 decimales.
 */
import { Prisma } from "@prisma/client";
import { CajaValidationError } from "@/lib/caja/errors";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
/** Máximo representable en Decimal(12,2). */
export const CAJA_IMPORTE_MAX = new Prisma.Decimal("9999999999.99");
const IMPORTE_REGEX = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const PCT_REGEX = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;

export const COMISION_PORCENTAJE_DEFAULT = new Prisma.Decimal("20.00");

export function cajaZero(): Prisma.Decimal {
  return ZERO;
}

export function toCajaDecimal(
  value: Prisma.Decimal | string | number,
): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CajaValidationError("Importe de caja no finito.");
    }
    const asFixed = value.toString();
    if (asFixed.includes("e") || asFixed.includes("E")) {
      throw new CajaValidationError(
        "Importe de caja en notación científica no permitido.",
      );
    }
    return toCajaDecimal(asFixed);
  }
  const texto = value.trim();
  if (!IMPORTE_REGEX.test(texto)) {
    throw new CajaValidationError(
      "Importe inválido: use un número no negativo con máximo 2 decimales.",
      "CAJA_IMPORTE_INVALIDO",
    );
  }
  return new Prisma.Decimal(texto);
}

/** ROUND_HALF_UP a exactamente 2 decimales. */
export function roundHalfUp2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function parseImporteCajaNoNegativo(
  raw: Prisma.Decimal | string | number,
): Prisma.Decimal {
  const importe = toCajaDecimal(raw);
  if (importe.lt(0)) {
    throw new CajaValidationError(
      "El importe no puede ser negativo.",
      "CAJA_IMPORTE_INVALIDO",
    );
  }
  if (importe.decimalPlaces() > 2) {
    throw new CajaValidationError(
      "El importe admite máximo 2 decimales.",
      "CAJA_IMPORTE_INVALIDO",
    );
  }
  if (importe.gt(CAJA_IMPORTE_MAX)) {
    throw new CajaValidationError(
      "El importe excede el máximo permitido (9999999999.99).",
      "CAJA_IMPORTE_INVALIDO",
    );
  }
  return roundHalfUp2(importe);
}

/** Importe estrictamente positivo (> 0), 2 decimales. */
export function parseImporteCajaPositivo(
  raw: Prisma.Decimal | string | number,
): Prisma.Decimal {
  const importe = parseImporteCajaNoNegativo(raw);
  if (importe.lte(0)) {
    throw new CajaValidationError(
      "El importe debe ser mayor que cero.",
      "CAJA_IMPORTE_INVALIDO",
    );
  }
  return importe;
}

export function parsePorcentajeComision(
  raw: Prisma.Decimal | string | number,
): Prisma.Decimal {
  let pct: Prisma.Decimal;
  if (raw instanceof Prisma.Decimal) {
    pct = raw;
  } else if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new CajaValidationError(
        "Porcentaje de comisión no finito.",
        "CAJA_PORCENTAJE_INVALIDO",
      );
    }
    const asFixed = raw.toString();
    if (asFixed.includes("e") || asFixed.includes("E")) {
      throw new CajaValidationError(
        "Porcentaje en notación científica no permitido.",
        "CAJA_PORCENTAJE_INVALIDO",
      );
    }
    pct = new Prisma.Decimal(asFixed);
  } else {
    const texto = raw.trim();
    if (!PCT_REGEX.test(texto)) {
      throw new CajaValidationError(
        "Porcentaje inválido: use 0–100 con máximo 2 decimales.",
        "CAJA_PORCENTAJE_INVALIDO",
      );
    }
    pct = new Prisma.Decimal(texto);
  }

  if (pct.lt(0) || pct.gt(100)) {
    throw new CajaValidationError(
      "El porcentaje de comisión debe estar entre 0 y 100.",
      "CAJA_PORCENTAJE_INVALIDO",
    );
  }
  if (pct.decimalPlaces() > 2) {
    throw new CajaValidationError(
      "El porcentaje admite máximo 2 decimales.",
      "CAJA_PORCENTAJE_INVALIDO",
    );
  }
  return roundHalfUp2(pct);
}

export type SplitComision = {
  bruto: Prisma.Decimal;
  porcentaje: Prisma.Decimal;
  comisionImporte: Prisma.Decimal;
  importeAdmin: Prisma.Decimal;
};

/**
 * comision = ROUND_HALF_UP(bruto × porcentaje / 100, 2)
 * importeAdmin = bruto − comision
 * Garantiza comision + importeAdmin = bruto.
 */
export function calcularSplitComision(
  brutoRaw: Prisma.Decimal | string | number,
  porcentajeRaw: Prisma.Decimal | string | number,
): SplitComision {
  const bruto = parseImporteCajaNoNegativo(brutoRaw);
  const porcentaje = parsePorcentajeComision(porcentajeRaw);
  const comisionImporte = roundHalfUp2(bruto.mul(porcentaje).div(HUNDRED));
  const importeAdmin = bruto.minus(comisionImporte);
  return { bruto, porcentaje, comisionImporte, importeAdmin };
}

export function moneyFixed2(value: Prisma.Decimal): string {
  return roundHalfUp2(value).toFixed(2);
}
