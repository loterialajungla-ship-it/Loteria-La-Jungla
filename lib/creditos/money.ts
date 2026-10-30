/**
 * Utilidades monetarias para créditos.
 * Fuente de verdad: Prisma.Decimal — nunca float para cálculos.
 */
import { Prisma } from "@prisma/client";
import { CreditoValidationError } from "@/lib/creditos/errors";

const ZERO = new Prisma.Decimal(0);
/** Máximo representable en Decimal(12,2) del esquema. */
export const CREDITO_IMPORTE_MAX = new Prisma.Decimal("9999999999.99");
const IMPORTE_REGEX = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

export function creditoZero(): Prisma.Decimal {
  return ZERO;
}

export function toCreditoDecimal(
  value: Prisma.Decimal | string | number,
): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CreditoValidationError("Importe de crédito no finito.");
    }
    const asFixed = value.toString();
    if (asFixed.includes("e") || asFixed.includes("E")) {
      throw new CreditoValidationError(
        "Importe de crédito en notación científica no permitido.",
      );
    }
    return toCreditoDecimal(asFixed);
  }
  const texto = value.trim();
  if (!IMPORTE_REGEX.test(texto)) {
    throw new CreditoValidationError(
      "Importe inválido: use un número no negativo con máximo 2 decimales.",
      "CREDITO_IMPORTE_INVALIDO",
    );
  }
  return new Prisma.Decimal(texto);
}

/** Importe de movimiento: estrictamente > 0, máx. 2 decimales. */
export function parseImporteCreditoPositivo(
  raw: Prisma.Decimal | string | number,
): Prisma.Decimal {
  const importe = toCreditoDecimal(raw);
  if (importe.lte(0)) {
    throw new CreditoValidationError(
      "El importe del movimiento debe ser mayor que 0.",
      "CREDITO_IMPORTE_INVALIDO",
    );
  }
  if (importe.decimalPlaces() > 2) {
    throw new CreditoValidationError(
      "El importe admite máximo 2 decimales.",
      "CREDITO_IMPORTE_INVALIDO",
    );
  }
  if (importe.gt(CREDITO_IMPORTE_MAX)) {
    throw new CreditoValidationError(
      "El importe excede el máximo permitido (9999999999.99).",
      "CREDITO_IMPORTE_INVALIDO",
    );
  }
  return importe;
}

export function assertSaldoNoNegativo(saldo: Prisma.Decimal): void {
  if (saldo.lt(0)) {
    throw new CreditoValidationError(
      "El saldo de créditos no puede ser negativo.",
      "CREDITO_SALDO_NEGATIVO",
    );
  }
}

export function moneyEq(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  return a.eq(b);
}

export function moneyFixed2(value: Prisma.Decimal): string {
  return value.toFixed(2);
}
