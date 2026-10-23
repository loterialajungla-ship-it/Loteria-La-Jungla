/**
 * Política de Resultado para `scripts/seed-manual-test.ts`.
 * Create-only vía dominio; nunca sobrescribe con upsert/update.
 */
import type { PrismaClient } from "@prisma/client";
import {
  createManualResult,
  ResultadoCorrectionRequiredError,
  type SaveManualResultRow,
} from "@/lib/resultados/save-manual";

/** Número fijo del smoke manual-test (ticket multihora espera 03). */
export const SEED_MANUAL_RESULT_NUMERO = "03";

type SeedResultDb = Pick<
  PrismaClient,
  "resultado" | "auditoria" | "animal" | "$transaction"
>;

export type EnsureSeedManualResultArgs = {
  fecha: Date;
  hora: number;
  /** Por defecto `SEED_MANUAL_RESULT_NUMERO` (`03`). */
  numero?: string;
  adminUserId: string;
};

export type EnsureSeedManualResultOk =
  | {
      status: "created";
      row: SaveManualResultRow;
    }
  | {
      status: "unchanged";
      id: string;
      numero: string;
      hora: number;
    };

/**
 * Conflicto: ya hay un resultado distinto, o carrera de unicidad al crear.
 * El caller debe abortar sin sobrescribir.
 */
export class SeedManualResultConflictError extends Error {
  readonly code = "SEED_RESULT_CONFLICT";
  readonly currentNumero: string | null;
  readonly race: boolean;

  constructor(currentNumero: string | null, race = false) {
    const numLabel = currentNumero ?? "(desconocido)";
    super(
      race
        ? `Conflicto de unicidad al crear el resultado de prueba: ya existe el número ${numLabel}. No se sobrescribe. Corrige con el flujo administrativo controlado si hace falta.`
        : `Ya existe un resultado distinto (${numLabel}) para esa fecha y hora. No se sobrescribe. Corrígelo con el flujo administrativo controlado (confirmación + motivo).`,
    );
    this.name = "SeedManualResultConflictError";
    this.currentNumero = currentNumero;
    this.race = race;
  }
}

/**
 * Asegura el resultado de smoke sin eludir el dominio:
 * - inexistente → `createManualResult`
 * - mismo número → no-op
 * - otro número o carrera P2002 → conflicto (sin update/upsert)
 */
export async function ensureSeedManualResult(
  db: SeedResultDb,
  args: EnsureSeedManualResultArgs,
): Promise<EnsureSeedManualResultOk> {
  const numero = (args.numero ?? SEED_MANUAL_RESULT_NUMERO).trim();
  const { fecha, hora, adminUserId } = args;

  const existing = await db.resultado.findUnique({
    where: { fecha_hora: { fecha, hora } },
    select: { id: true, numero: true, hora: true },
  });

  if (existing) {
    if (existing.numero === numero) {
      return {
        status: "unchanged",
        id: existing.id,
        numero: existing.numero,
        hora: existing.hora,
      };
    }
    throw new SeedManualResultConflictError(existing.numero, false);
  }

  try {
    const row = await createManualResult(db, {
      fecha,
      hora,
      numero,
      adminUserId,
    });
    return { status: "created", row };
  } catch (error) {
    if (error instanceof ResultadoCorrectionRequiredError) {
      // Carrera: otro writer creó entre el find y el create. Nunca upsert.
      throw new SeedManualResultConflictError(error.currentNumero, true);
    }
    throw error;
  }
}
