import { Prisma } from "@prisma/client";

export function isUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Interpreta `meta.target` de un P2002.
 * - `slot`: restricción única (fecha, hora) — Resultado o ResultadoProgramado
 * - `other`: otra restricción única identificada
 * - `unknown`: Prisma no aportó target usable
 */
export function classifyP2002Target(
  error: Prisma.PrismaClientKnownRequestError,
): "slot" | "other" | "unknown" {
  const raw = error.meta?.target;
  const fields: string[] = Array.isArray(raw)
    ? raw.map((x) => String(x).toLowerCase())
    : typeof raw === "string"
      ? [raw.toLowerCase()]
      : [];

  if (fields.length === 0) return "unknown";

  const hasFecha = fields.some((f) => f === "fecha" || f.includes("fecha"));
  const hasHora = fields.some((f) => f === "hora" || f.endsWith("_hora"));
  const compound = fields.some(
    (f) =>
      f.includes("fecha_hora") ||
      f.includes("resultado_fecha_hora") ||
      f === "fecha_hora",
  );

  if (compound || (hasFecha && hasHora)) return "slot";
  return "other";
}
