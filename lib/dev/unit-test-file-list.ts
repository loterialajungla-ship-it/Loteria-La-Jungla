/**
 * Inventario determinista de archivos para `npm test` (runner unitario).
 * Expande directorios en disco y excluye integración/aceptación/funcionales
 * por sufijo, de modo que archivos untracked o modificados no se cuelen por glob.
 */

import fs from "node:fs";
import path from "node:path";

/** Sufijos prohibidos aunque el archivo termine en `.test.ts`. */
export const UNIT_TEST_EXCLUDED_SUFFIXES = [
  ".integration.test.ts",
  ".acceptance.test.ts",
  ".functional.test.ts",
] as const;

/**
 * Misma cobertura que los globs históricos del runner, sin `**` opaco:
 * - `lib/tickets/*.test.ts`
 * - `lib/tickets/integration/*.test.ts` (solo unitarios; integration.* se filtra)
 * - recursivo en el resto de raíces de dominio.
 */
export const UNIT_TEST_ROOTS: ReadonlyArray<{
  relativeDir: string;
  recursive: boolean;
}> = [
  { relativeDir: path.join("lib", "tickets"), recursive: false },
  { relativeDir: path.join("lib", "tickets", "integration"), recursive: false },
  { relativeDir: path.join("lib", "auth"), recursive: true },
  { relativeDir: path.join("lib", "users"), recursive: true },
  { relativeDir: path.join("lib", "reports"), recursive: true },
  { relativeDir: path.join("lib", "audit"), recursive: true },
  { relativeDir: path.join("lib", "dev"), recursive: true },
  { relativeDir: path.join("lib", "db"), recursive: true },
  { relativeDir: path.join("lib", "http"), recursive: true },
  { relativeDir: path.join("lib", "resultados"), recursive: true },
  { relativeDir: path.join("lib", "creditos"), recursive: true },
  { relativeDir: path.join("lib", "ui"), recursive: true },
  { relativeDir: path.join("components", "tickets"), recursive: true },
  { relativeDir: path.join("app", "admin"), recursive: true },
];

export function isExcludedUnitTestFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return UNIT_TEST_EXCLUDED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function isUnitTestFileName(fileName: string): boolean {
  if (!fileName.endsWith(".test.ts")) return false;
  if (isExcludedUnitTestFileName(fileName)) return false;
  return true;
}

function collectTestFiles(absDir: string, recursive: boolean, out: string[]): void {
  if (!fs.existsSync(absDir)) return;
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) collectTestFiles(full, true, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isUnitTestFileName(entry.name)) continue;
    out.push(full);
  }
}

/**
 * Lista absoluta de archivos unitarios bajo `projectRoot`, ordenada.
 * No carga `.env`. No crea clientes Prisma.
 */
export function listUnitTestFiles(projectRoot: string): string[] {
  const root = path.resolve(projectRoot);
  const files: string[] = [];
  for (const spec of UNIT_TEST_ROOTS) {
    collectTestFiles(path.join(root, spec.relativeDir), spec.recursive, files);
  }
  // Dedup por si una raíz anida otra (hoy no ocurre) y orden estable.
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

/** Vars de conexión que el runner unitario no debe heredar del shell. */
export const UNIT_TEST_STRIPPED_ENV_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "TEST_DATABASE_URL",
  "RUN_INTEGRATION",
  "RUN_ACCEPTANCE",
] as const;

/**
 * Entorno hijo para unitarios: copia el padre sin flags/URLs de DB de integración.
 */
export function buildUnitTestChildEnv(
  parentEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parentEnv } as NodeJS.ProcessEnv;
  for (const key of UNIT_TEST_STRIPPED_ENV_KEYS) {
    delete env[key];
  }
  return env;
}
