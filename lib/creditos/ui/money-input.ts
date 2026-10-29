/**
 * Validación de importes en UI sin float ni Prisma.
 * Céntimos enteros seguros hasta Decimal(12,2).
 */

const IMPORTE_RE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const MAX_CENTS = 999_999_999_999; // 9999999999.99

export function parseImporteToCents(raw: string): number | null {
  const texto = raw.trim();
  if (!IMPORTE_RE.test(texto)) return null;
  const [entero, frac = ""] = texto.split(".");
  const cents =
    Number(entero) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  if (cents <= 0) return null;
  return cents;
}

export function isImporteCreditoValido(raw: string): boolean {
  return parseImporteToCents(raw) != null;
}

/** Compara dos cadenas decimales validadas (a > b). */
export function importeMayorQue(a: string, b: string): boolean {
  const ca = parseImporteToCents(a);
  const cb = parseImporteToCents(b);
  if (ca == null || cb == null) return false;
  return ca > cb;
}

export function formatearCents(cents: number): string {
  const neg = cents < 0;
  const n = Math.abs(cents);
  const whole = Math.floor(n / 100);
  const frac = String(n % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
