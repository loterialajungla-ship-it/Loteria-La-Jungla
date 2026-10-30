/**
 * Lógica pura + guardas del bootstrap operativo de CreditosConfig.
 * Sin Prisma, sin red, sin lectura automática de .env.
 *
 * Destino explícito vía CREDITS_ENSURE_TARGET + CREDITS_ENSURE_DATABASE_URL.
 * Nunca usa DATABASE_URL / DIRECT_URL / TEST_DATABASE_URL como fallback.
 */
import {
  CONFIRM_PRODUCTION_BOOTSTRAP_VALUE,
  FORBIDDEN_WRITE_ENDPOINTS,
  NEON_ENDPOINTS,
  extractNeonEndpointId,
} from "@/lib/db/neon-endpoint-guard";

export const CREDITS_ENSURE_TARGET_TEST = "test";
export const CREDITS_ENSURE_TARGET_PRODUCTION = "production";

/** Opt-in adicional obligatorio para escrituras en producción. */
export const CREDITS_ENSURE_PRODUCTION_OPT_IN = "1";

/**
 * Reutiliza la misma frase documentada de confirmación de escritura en prod
 * (no es un secreto de conexión).
 */
export const CONFIRM_CREDITS_ENSURE_PRODUCTION_VALUE =
  CONFIRM_PRODUCTION_BOOTSTRAP_VALUE;

export type CreditsEnsureTarget = "test" | "production";

export type CreditsEnsurePlan =
  | { action: "skip"; reason: "already_persisted" }
  | {
      action: "insert";
      values: {
        id: 1;
        controlActivo: false;
        inicioEn: null;
        umbralSaldoBajo: null;
        updatedByAdminId: null;
      };
    };

export type CreditsEnsureVerify = {
  id: number;
  controlActivo: boolean;
  inicioEn: Date | null;
  umbralSaldoBajo: unknown;
  updatedByAdminId: string | null;
};

export type CreditsEnsureGuardResult = {
  target: CreditsEnsureTarget;
  endpointId: string;
  /** URL autorizada; el caller la usa solo para conectar — nunca se imprime. */
  databaseUrl: string;
};

export class CreditsEnsureError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CreditsEnsureError";
    this.code = code;
  }
}

/** Valores iniciales equivalentes a la migración ON CONFLICT DO NOTHING. */
export const INITIAL_CREDITOS_CONFIG = {
  id: 1 as const,
  controlActivo: false as const,
  inicioEn: null,
  umbralSaldoBajo: null,
  updatedByAdminId: null,
};

export function planEnsureCreditosConfig(existing: {
  id: number;
} | null): CreditsEnsurePlan {
  if (existing != null && existing.id === 1) {
    return { action: "skip", reason: "already_persisted" };
  }
  return {
    action: "insert",
    values: { ...INITIAL_CREDITOS_CONFIG },
  };
}

/**
 * Tras insert: la fila debe existir con valores iniciales.
 * No se usa cuando ON CONFLICT no insertó (fila preexistente).
 */
export function verifyInsertedCreditosConfig(row: CreditsEnsureVerify | null): {
  ok: true;
} | { ok: false; reason: string } {
  if (!row) {
    return { ok: false, reason: "Fila CreditosConfig(id=1) ausente tras la operación." };
  }
  if (row.id !== 1) {
    return { ok: false, reason: "CreditosConfig no es el singleton id=1." };
  }
  if (row.controlActivo !== false) {
    return {
      ok: false,
      reason: "Tras insert, controlActivo debe ser false.",
    };
  }
  if (row.inicioEn != null) {
    return {
      ok: false,
      reason: "Tras insert, inicioEn debe ser null.",
    };
  }
  if (row.umbralSaldoBajo != null) {
    return {
      ok: false,
      reason: "Tras insert, umbralSaldoBajo debe ser null.",
    };
  }
  if (row.updatedByAdminId != null) {
    return {
      ok: false,
      reason: "Tras insert, updatedByAdminId debe ser null.",
    };
  }
  return { ok: true };
}

/**
 * Resuelve la URL dedicada. Si falta, rechaza con mensaje anti-fallback
 * cuando solo hay variables genéricas (nunca las usa como conexión).
 */
export function resolveCreditsEnsureDatabaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string {
  const dedicated = env.CREDITS_ENSURE_DATABASE_URL?.trim() ?? "";
  if (dedicated) return dedicated;

  const hasGeneric = Boolean(
    env.DATABASE_URL?.trim() ||
      env.DIRECT_URL?.trim() ||
      env.TEST_DATABASE_URL?.trim(),
  );
  if (hasGeneric) {
    throw new CreditsEnsureError(
      "URL_REQUIRED",
      "credits:ensure-config abortado: falta CREDITS_ENSURE_DATABASE_URL. No uses DATABASE_URL, DIRECT_URL ni TEST_DATABASE_URL como fallback.",
    );
  }
  throw new CreditsEnsureError(
    "URL_REQUIRED",
    "credits:ensure-config abortado: falta CREDITS_ENSURE_DATABASE_URL. No hay fallback a DATABASE_URL, DIRECT_URL ni TEST_DATABASE_URL.",
  );
}

/**
 * Valida destino + URL dedicada + opt-in de producción.
 * No acepta DATABASE_URL / DIRECT_URL / TEST_DATABASE_URL como fuente de conexión.
 */
export function assertCreditsEnsureTarget(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CreditsEnsureGuardResult {
  const targetRaw = env.CREDITS_ENSURE_TARGET?.trim().toLowerCase() ?? "";
  if (
    targetRaw !== CREDITS_ENSURE_TARGET_TEST &&
    targetRaw !== CREDITS_ENSURE_TARGET_PRODUCTION
  ) {
    throw new CreditsEnsureError(
      "TARGET_REQUIRED",
      'credits:ensure-config abortado: define CREDITS_ENSURE_TARGET=test|production y CREDITS_ENSURE_DATABASE_URL (URL dedicada). No se usa DATABASE_URL/DIRECT_URL/TEST_DATABASE_URL.',
    );
  }
  const target = targetRaw as CreditsEnsureTarget;

  const urlRaw = resolveCreditsEnsureDatabaseUrl(env);

  const ep = extractNeonEndpointId(urlRaw);
  if (!ep.ok) {
    throw new CreditsEnsureError(
      "URL_INVALID",
      `credits:ensure-config abortado (CREDITS_ENSURE_DATABASE_URL): ${ep.reason}`,
    );
  }

  if (target === "test") {
    if (FORBIDDEN_WRITE_ENDPOINTS.has(ep.endpointId)) {
      throw new CreditsEnsureError(
        "ENDPOINT_FORBIDDEN",
        `credits:ensure-config abortado: endpoint prohibido para destino test (${ep.endpointId}).`,
      );
    }
    if (ep.endpointId !== NEON_ENDPOINTS.TEST) {
      throw new CreditsEnsureError(
        "ENDPOINT_MISMATCH",
        `credits:ensure-config abortado: destino test exige endpoint ${NEON_ENDPOINTS.TEST}; recibido ${ep.endpointId}.`,
      );
    }
    return { target, endpointId: ep.endpointId, databaseUrl: urlRaw };
  }

  // production
  const optIn = env.CREDITS_ENSURE_PRODUCTION?.trim() ?? "";
  if (optIn !== CREDITS_ENSURE_PRODUCTION_OPT_IN) {
    throw new CreditsEnsureError(
      "PROD_OPT_IN_REQUIRED",
      "credits:ensure-config abortado: producción exige CREDITS_ENSURE_PRODUCTION=1 además del destino explícito.",
    );
  }
  const confirm = env.CONFIRM_CREDITS_ENSURE_PRODUCTION?.trim() ?? "";
  if (confirm !== CONFIRM_CREDITS_ENSURE_PRODUCTION_VALUE) {
    throw new CreditsEnsureError(
      "PROD_CONFIRM_REQUIRED",
      "credits:ensure-config abortado: CONFIRM_CREDITS_ENSURE_PRODUCTION no coincide con la frase de confirmación documentada.",
    );
  }
  if (ep.endpointId !== NEON_ENDPOINTS.PRODUCTION) {
    throw new CreditsEnsureError(
      "ENDPOINT_MISMATCH",
      `credits:ensure-config abortado: destino production exige endpoint ${NEON_ENDPOINTS.PRODUCTION}; recibido ${ep.endpointId}.`,
    );
  }

  return { target, endpointId: ep.endpointId, databaseUrl: urlRaw };
}

export function parseCreditsEnsureDryRun(argv: string[]): boolean {
  return argv.includes("--dry-run");
}

/** Puerto DB inyectable (tests sin Neon). */
export type EnsureCreditosConfigDb = {
  findConfigSingleton: () => Promise<CreditsEnsureVerify | null>;
  /** Devuelve filas insertadas (0 = ON CONFLICT no escribió). */
  insertBootstrapIfAbsent: () => Promise<number>;
  disconnect?: () => Promise<void>;
};

export type EnsureCreditosConfigRunResult = {
  exitCode: number;
  wrote: boolean;
  dryRun: boolean;
  outcome:
    | "skipped_existing"
    | "dry_run_would_insert"
    | "inserted"
    | "conflict_noop"
    | "guard_error"
    | "verify_error"
    | "unexpected_error";
  messages: string[];
};

const MSG_UNEXPECTED =
  "credits:ensure-config: error inesperado. Verifica CREDITS_ENSURE_TARGET, CREDITS_ENSURE_DATABASE_URL y (en prod) CREDITS_ENSURE_PRODUCTION + CONFIRM_CREDITS_ENSURE_PRODUCTION. No se mostraron detalles internos.";

/**
 * Núcleo ejecutable del comando (inyectable). No llama a process.exit.
 * Conecta a DB solo después de pasar los guards (vía createDb).
 */
export async function runEnsureCreditosConfig(args: {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  argv: string[];
  createDb: (
    guard: CreditsEnsureGuardResult,
  ) => EnsureCreditosConfigDb | Promise<EnsureCreditosConfigDb>;
  log?: (message: string) => void;
}): Promise<EnsureCreditosConfigRunResult> {
  const messages: string[] = [];
  const log = (m: string) => {
    messages.push(m);
    args.log?.(m);
  };
  const dryRun = parseCreditsEnsureDryRun(args.argv);

  let guard: CreditsEnsureGuardResult;
  try {
    guard = assertCreditsEnsureTarget(args.env);
  } catch (e) {
    if (e instanceof CreditsEnsureError) {
      log(e.message);
      return {
        exitCode: 2,
        wrote: false,
        dryRun,
        outcome: "guard_error",
        messages,
      };
    }
    log(MSG_UNEXPECTED);
    return {
      exitCode: 1,
      wrote: false,
      dryRun,
      outcome: "unexpected_error",
      messages,
    };
  }

  log(
    `credits:ensure-config: destino=${guard.target} endpoint=${guard.endpointId}${dryRun ? " dry-run" : ""}`,
  );

  let db: EnsureCreditosConfigDb | null = null;
  try {
    db = await args.createDb(guard);
    const existing = await db.findConfigSingleton();
    const plan = planEnsureCreditosConfig(existing);

    if (plan.action === "skip") {
      log(
        "credits:ensure-config: CreditosConfig(id=1) ya existe; no se modifica ningún campo.",
      );
      return {
        exitCode: 0,
        wrote: false,
        dryRun,
        outcome: "skipped_existing",
        messages,
      };
    }

    if (dryRun) {
      log(
        "credits:ensure-config: dry-run — se insertaría la fila inicial (controlActivo=false, inicioEn=null); no se escribió nada.",
      );
      return {
        exitCode: 0,
        wrote: false,
        dryRun: true,
        outcome: "dry_run_would_insert",
        messages,
      };
    }

    const inserted = await db.insertBootstrapIfAbsent();
    const after = await db.findConfigSingleton();

    if (!after || after.id !== 1) {
      log(
        "credits:ensure-config: verificación fallida: Fila CreditosConfig(id=1) ausente tras la operación.",
      );
      return {
        exitCode: 3,
        wrote: false,
        dryRun: false,
        outcome: "verify_error",
        messages,
      };
    }

    if (Number(inserted) > 0) {
      const verified = verifyInsertedCreditosConfig(after);
      if (!verified.ok) {
        log(`credits:ensure-config: verificación fallida: ${verified.reason}`);
        return {
          exitCode: 3,
          wrote: true,
          dryRun: false,
          outcome: "verify_error",
          messages,
        };
      }
      log(
        "credits:ensure-config: fila inicial insertada (controlActivo=false, inicioEn=null).",
      );
      return {
        exitCode: 0,
        wrote: true,
        dryRun: false,
        outcome: "inserted",
        messages,
      };
    }

    log(
      "credits:ensure-config: CreditosConfig(id=1) ya existía (ON CONFLICT); no se modificó ningún campo.",
    );
    return {
      exitCode: 0,
      wrote: false,
      dryRun: false,
      outcome: "conflict_noop",
      messages,
    };
  } catch (e) {
    if (e instanceof CreditsEnsureError) {
      log(e.message);
      return {
        exitCode: 2,
        wrote: false,
        dryRun,
        outcome: "guard_error",
        messages,
      };
    }
    log(MSG_UNEXPECTED);
    return {
      exitCode: 1,
      wrote: false,
      dryRun,
      outcome: "unexpected_error",
      messages,
    };
  } finally {
    if (db?.disconnect) {
      await db.disconnect().catch(() => undefined);
    }
  }
}
