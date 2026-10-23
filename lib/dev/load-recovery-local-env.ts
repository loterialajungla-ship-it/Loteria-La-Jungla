/**
 * Cargador restringido de `.env.recovery.local` para `npm run dev:recovery`.
 *
 * Solo admite DEV_FROM_RECOVERY_DATABASE_URL y DEV_FROM_RECOVERY_DIRECT_URL.
 * Nunca importa DATABASE_URL ni DIRECT_URL. No evalúa el contenido del archivo.
 * La sesión (variables ya definidas) tiene prioridad sobre el archivo.
 */

import fs from "node:fs";

export const RECOVERY_LOCAL_ENV_FILENAME = ".env.recovery.local";

export const RECOVERY_LOCAL_ALLOWED_KEYS = [
  "DEV_FROM_RECOVERY_DATABASE_URL",
  "DEV_FROM_RECOVERY_DIRECT_URL",
] as const;

export type RecoveryLocalAllowedKey =
  (typeof RECOVERY_LOCAL_ALLOWED_KEYS)[number];

const ALLOWED = new Set<string>(RECOVERY_LOCAL_ALLOWED_KEYS);

export type ParsedRecoveryLocalEnv = {
  /** Valores parseados solo de claves permitidas (pueden estar vacíos). */
  values: Partial<Record<RecoveryLocalAllowedKey, string>>;
  /** Claves presentes en el archivo pero ignoradas (p. ej. DATABASE_URL). */
  ignoredKeys: string[];
};

export type ApplyRecoveryLocalEnvResult = {
  /** true si el archivo existía y se leyó. */
  fileFound: boolean;
  /** Claves permitidas que se escribieron en el target (antes estaban ausentes). */
  appliedKeys: RecoveryLocalAllowedKey[];
  /** Claves permitidas presentes en el archivo pero no aplicadas (sesión ya las tenía). */
  skippedKeys: RecoveryLocalAllowedKey[];
  ignoredKeys: string[];
};

function stripQuotes(val: string): string {
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    return val.slice(1, -1);
  }
  return val;
}

/**
 * Parsea texto estilo dotenv. Solo retiene las dos claves permitidas.
 * No lanza; no incluye secretos en ningún mensaje (no produce mensajes).
 */
export function parseRecoveryLocalEnvContent(
  content: string,
): ParsedRecoveryLocalEnv {
  const values: Partial<Record<RecoveryLocalAllowedKey, string>> = {};
  const ignored = new Set<string>();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    if (!ALLOWED.has(key)) {
      ignored.add(key);
      continue;
    }

    const rawVal = stripQuotes(trimmed.slice(eq + 1).trim());
    values[key as RecoveryLocalAllowedKey] = rawVal;
  }

  return {
    values,
    ignoredKeys: [...ignored].sort(),
  };
}

/**
 * Fusiona valores parseados en `target` sin sobrescribir claves ya definidas
 * (incluida la cadena vacía si está definida — `undefined` = ausente).
 */
export function applyParsedRecoveryLocalEnv(
  target: NodeJS.ProcessEnv | Record<string, string | undefined>,
  parsed: ParsedRecoveryLocalEnv,
): Pick<ApplyRecoveryLocalEnvResult, "appliedKeys" | "skippedKeys" | "ignoredKeys"> {
  const appliedKeys: RecoveryLocalAllowedKey[] = [];
  const skippedKeys: RecoveryLocalAllowedKey[] = [];

  for (const key of RECOVERY_LOCAL_ALLOWED_KEYS) {
    if (!(key in parsed.values)) continue;
    if (target[key] !== undefined) {
      skippedKeys.push(key);
      continue;
    }
    target[key] = parsed.values[key];
    appliedKeys.push(key);
  }

  return {
    appliedKeys,
    skippedKeys,
    ignoredKeys: parsed.ignoredKeys,
  };
}

/**
 * Lee `.env.recovery.local` (u otra ruta) y aplica solo claves permitidas.
 * Si el archivo no existe, no falla: fileFound=false y no muta el target.
 */
export function loadRecoveryLocalEnvFile(
  filePath: string,
  target: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ApplyRecoveryLocalEnvResult {
  if (!fs.existsSync(filePath)) {
    return {
      fileFound: false,
      appliedKeys: [],
      skippedKeys: [],
      ignoredKeys: [],
    };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseRecoveryLocalEnvContent(content);
  const applied = applyParsedRecoveryLocalEnv(target, parsed);

  return {
    fileFound: true,
    ...applied,
  };
}
