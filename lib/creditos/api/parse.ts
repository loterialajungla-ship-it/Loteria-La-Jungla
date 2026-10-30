/**
 * Validación de query/body para API de créditos.
 * Identidad del actor NUNCA se toma del cliente: solo sesión.
 */
import type { TipoCreditoMovimiento as PrismaTipo } from "@prisma/client";
import { CreditoValidationError } from "@/lib/creditos/errors";
import type { CorreccionEfecto } from "@/lib/creditos/types";

export const CREDITO_MOTIVO_MAX_LENGTH = 500;
export const CREDITO_PAGE_SIZE_DEFAULT = 20;
export const CREDITO_PAGE_SIZE_MAX = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TIPOS_MOVIMIENTO = new Set<string>([
  "ASIGNACION",
  "RETIRO",
  "CONSUMO_VENTA",
  "DEVOLUCION_ANULACION",
  "CORRECCION",
]);

const FORBIDDEN_BODY_KEYS = new Set([
  "actorAdminId",
  "updatedByAdminId",
  "vendedorId",
  "tipo",
  "saldoAnterior",
  "saldoPosterior",
  "saldoDisponible",
  "userId",
  "rol",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoForbiddenKeys(raw: Record<string, unknown>): void {
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_BODY_KEYS.has(key)) {
      throw new CreditoValidationError(
        `Campo no permitido: ${key}.`,
        "CREDITO_CAMPO_PROHIBIDO",
      );
    }
  }
}

export function parsePositiveInt(
  raw: string | number | null | undefined,
  fallback: number,
): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new CreditoValidationError(
      "Parámetro de paginación inválido.",
      "CREDITO_INVALID_QUERY",
    );
  }
  return n;
}

export function parsePagination(query: {
  page?: string | number | null;
  pageSize?: string | number | null;
}): { page: number; pageSize: number } {
  const page = parsePositiveInt(query.page, 1);
  const pageSize = parsePositiveInt(query.pageSize, CREDITO_PAGE_SIZE_DEFAULT);
  if (pageSize > CREDITO_PAGE_SIZE_MAX) {
    throw new CreditoValidationError(
      `pageSize máximo ${CREDITO_PAGE_SIZE_MAX}.`,
      "CREDITO_INVALID_QUERY",
    );
  }
  return { page, pageSize };
}

/** UUID RFC obligatorio (mismo criterio que tickets). */
export function parseCreditoIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new CreditoValidationError(
      "idempotencyKey es obligatoria.",
      "CREDITO_INVALID_IDEMPOTENCY_KEY",
    );
  }
  const key = raw.trim();
  if (!key) {
    throw new CreditoValidationError(
      "idempotencyKey es obligatoria.",
      "CREDITO_INVALID_IDEMPOTENCY_KEY",
    );
  }
  if (key.length > 64 || !UUID_RE.test(key)) {
    throw new CreditoValidationError(
      "idempotencyKey debe ser un UUID válido.",
      "CREDITO_INVALID_IDEMPOTENCY_KEY",
    );
  }
  return key.toLowerCase();
}

export function parseMotivoOpcional(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new CreditoValidationError("motivo inválido.");
  }
  const motivo = raw.trim();
  if (!motivo) return null;
  if (motivo.length > CREDITO_MOTIVO_MAX_LENGTH) {
    throw new CreditoValidationError(
      `motivo admite máximo ${CREDITO_MOTIVO_MAX_LENGTH} caracteres.`,
    );
  }
  return motivo;
}

/**
 * Instante inequívoco: ISO-8601 con zona (Z u offset).
 * Rechaza fechas locales ambiguas sin offset.
 */
export function parseInicioEnInstante(raw: unknown): Date | null {
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw new CreditoValidationError(
      "inicioEn debe ser ISO-8601 con zona (p. ej. …Z) o null.",
      "CREDITO_INICIO_INVALIDO",
    );
  }
  const texto = raw.trim();
  if (!texto) {
    throw new CreditoValidationError(
      "inicioEn vacío no es válido; use null o un instante ISO.",
      "CREDITO_INICIO_INVALIDO",
    );
  }
  // Exige Z o ±HH:MM al final.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(texto)) {
    throw new CreditoValidationError(
      "inicioEn debe incluir zona horaria explícita (Z u offset).",
      "CREDITO_INICIO_INVALIDO",
    );
  }
  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) {
    throw new CreditoValidationError(
      "inicioEn no es una fecha válida.",
      "CREDITO_INICIO_INVALIDO",
    );
  }
  return d;
}

export function parseAsignarRetirarBody(raw: unknown): {
  importe: string;
  motivo: string | null;
  idempotencyKey: string;
} {
  if (!isPlainObject(raw)) {
    throw new CreditoValidationError("Cuerpo JSON inválido.");
  }
  assertNoForbiddenKeys(raw);
  const allowed = new Set(["importe", "motivo", "idempotencyKey"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new CreditoValidationError(
        `Campo no permitido: ${key}.`,
        "CREDITO_CAMPO_PROHIBIDO",
      );
    }
  }
  if (raw.importe === undefined || raw.importe === null) {
    throw new CreditoValidationError("importe es obligatorio.");
  }
  // Solo string: evita float de JSON number (p. ej. 0.1+0.2).
  if (typeof raw.importe !== "string") {
    throw new CreditoValidationError(
      "importe debe ser una cadena decimal (p. ej. \"10.00\").",
      "CREDITO_IMPORTE_INVALIDO",
    );
  }
  return {
    importe: raw.importe.trim(),
    motivo: parseMotivoOpcional(raw.motivo),
    idempotencyKey: parseCreditoIdempotencyKey(raw.idempotencyKey),
  };
}

export function parseCorregirBody(raw: unknown): {
  importe: string;
  efecto: CorreccionEfecto;
  movimientoOrigenId: string;
  motivo: string | null;
  idempotencyKey: string;
} {
  if (!isPlainObject(raw)) {
    throw new CreditoValidationError("Cuerpo JSON inválido.");
  }
  assertNoForbiddenKeys(raw);
  const allowed = new Set([
    "importe",
    "efecto",
    "movimientoOrigenId",
    "motivo",
    "idempotencyKey",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new CreditoValidationError(
        `Campo no permitido: ${key}.`,
        "CREDITO_CAMPO_PROHIBIDO",
      );
    }
  }
  if (raw.importe === undefined || raw.importe === null) {
    throw new CreditoValidationError("importe es obligatorio.");
  }
  if (typeof raw.importe !== "string") {
    throw new CreditoValidationError(
      "importe debe ser una cadena decimal (p. ej. \"10.00\").",
      "CREDITO_IMPORTE_INVALIDO",
    );
  }
  const efectoRaw =
    typeof raw.efecto === "string" ? raw.efecto.trim().toUpperCase() : "";
  if (efectoRaw !== "AUMENTAR" && efectoRaw !== "DISMINUIR") {
    throw new CreditoValidationError(
      "efecto debe ser AUMENTAR o DISMINUIR.",
      "CREDITO_EFECTO_INVALIDO",
    );
  }
  const origen =
    typeof raw.movimientoOrigenId === "string"
      ? raw.movimientoOrigenId.trim()
      : "";
  if (!origen) {
    throw new CreditoValidationError("movimientoOrigenId es obligatorio.");
  }
  return {
    importe: raw.importe.trim(),
    efecto: efectoRaw,
    movimientoOrigenId: origen,
    motivo: parseMotivoOpcional(raw.motivo),
    idempotencyKey: parseCreditoIdempotencyKey(raw.idempotencyKey),
  };
}

export function parseConfigPatchBody(raw: unknown): {
  controlActivo?: boolean;
  inicioEn?: Date | null;
  umbralSaldoBajo?: string | null;
} {
  if (!isPlainObject(raw)) {
    throw new CreditoValidationError("Cuerpo JSON inválido.");
  }
  assertNoForbiddenKeys(raw);
  const allowed = new Set([
    "controlActivo",
    "inicioEn",
    "umbralSaldoBajo",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new CreditoValidationError(
        `Campo no permitido: ${key}.`,
        "CREDITO_CAMPO_PROHIBIDO",
      );
    }
  }
  if (Object.keys(raw).length === 0) {
    throw new CreditoValidationError("Debe indicar al menos un campo a actualizar.");
  }

  const out: {
    controlActivo?: boolean;
    inicioEn?: Date | null;
    umbralSaldoBajo?: string | null;
  } = {};

  if (raw.controlActivo !== undefined) {
    if (typeof raw.controlActivo !== "boolean") {
      throw new CreditoValidationError("controlActivo debe ser boolean.");
    }
    out.controlActivo = raw.controlActivo;
  }
  if (raw.inicioEn !== undefined) {
    out.inicioEn = parseInicioEnInstante(raw.inicioEn);
  }
  if (raw.umbralSaldoBajo !== undefined) {
    if (raw.umbralSaldoBajo === null) {
      out.umbralSaldoBajo = null;
    } else if (typeof raw.umbralSaldoBajo === "string") {
      out.umbralSaldoBajo = raw.umbralSaldoBajo.trim();
    } else {
      throw new CreditoValidationError(
        "umbralSaldoBajo debe ser cadena decimal o null.",
      );
    }
  }
  return out;
}

export function parseResumenQuery(searchParams: URLSearchParams): {
  activo: boolean | undefined;
  saldoBajo: boolean | undefined;
  page: number;
  pageSize: number;
} {
  const { page, pageSize } = parsePagination({
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize"),
  });

  let activo: boolean | undefined;
  const activoRaw = (searchParams.get("activo") ?? "").trim().toLowerCase();
  if (activoRaw === "true" || activoRaw === "1" || activoRaw === "activos") {
    activo = true;
  } else if (
    activoRaw === "false" ||
    activoRaw === "0" ||
    activoRaw === "inactivos"
  ) {
    activo = false;
  } else if (activoRaw && activoRaw !== "todos" && activoRaw !== "all") {
    throw new CreditoValidationError(
      "Filtro activo inválido.",
      "CREDITO_INVALID_QUERY",
    );
  }

  let saldoBajo: boolean | undefined;
  const bajoRaw = (searchParams.get("saldoBajo") ?? "").trim().toLowerCase();
  if (bajoRaw === "true" || bajoRaw === "1") {
    saldoBajo = true;
  } else if (bajoRaw === "false" || bajoRaw === "0") {
    saldoBajo = false;
  } else if (bajoRaw) {
    throw new CreditoValidationError(
      "Filtro saldoBajo inválido.",
      "CREDITO_INVALID_QUERY",
    );
  }

  return { activo, saldoBajo, page, pageSize };
}

export function parseHistorialQuery(searchParams: URLSearchParams): {
  page: number;
  pageSize: number;
  tipo: PrismaTipo | undefined;
  ticketId: string | undefined;
  desde: Date | undefined;
  hasta: Date | undefined;
} {
  const { page, pageSize } = parsePagination({
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize"),
  });

  let tipo: PrismaTipo | undefined;
  const tipoRaw = (searchParams.get("tipo") ?? "").trim().toUpperCase();
  if (tipoRaw) {
    if (!TIPOS_MOVIMIENTO.has(tipoRaw)) {
      throw new CreditoValidationError(
        "Filtro tipo inválido.",
        "CREDITO_INVALID_QUERY",
      );
    }
    tipo = tipoRaw as PrismaTipo;
  }

  const ticketRaw = (searchParams.get("ticketId") ?? "").trim();
  const ticketId = ticketRaw || undefined;

  let desde: Date | undefined;
  let hasta: Date | undefined;
  const desdeRaw = searchParams.get("desde");
  const hastaRaw = searchParams.get("hasta");
  if (desdeRaw) {
    const d = parseInicioEnInstante(desdeRaw);
    if (!d) {
      throw new CreditoValidationError(
        "desde inválido.",
        "CREDITO_INVALID_QUERY",
      );
    }
    desde = d;
  }
  if (hastaRaw) {
    const d = parseInicioEnInstante(hastaRaw);
    if (!d) {
      throw new CreditoValidationError(
        "hasta inválido.",
        "CREDITO_INVALID_QUERY",
      );
    }
    hasta = d;
  }
  if (desde && hasta && desde.getTime() > hasta.getTime()) {
    throw new CreditoValidationError(
      "desde no puede ser posterior a hasta.",
      "CREDITO_INVALID_QUERY",
    );
  }

  return { page, pageSize, tipo, ticketId, desde, hasta };
}

export type { CorreccionEfecto };
