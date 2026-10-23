import { timingSafeEqual } from "node:crypto";

/**
 * Compara secretos de longitud arbitraria sin filtrar longitud por timing
 * de igualdad carácter a carácter (padding al máximo).
 */
export function safeEqualSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Comparación dummy para no filtrar longitud de forma trivial.
    const pad = Buffer.alloc(Math.max(a.length, b.length));
    timingSafeEqual(
      Buffer.concat([a, pad]).subarray(0, pad.length),
      Buffer.concat([b, pad]).subarray(0, pad.length),
    );
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Extrae el secreto del request:
 * - `Authorization: Bearer <CRON_SECRET>` (Vercel Cron)
 * - `x-cron-secret: <CRON_SECRET>` (schedulers externos)
 */
export function extractCronSecret(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  const header = request.headers.get("x-cron-secret");
  if (header?.trim()) return header.trim();
  return null;
}

export function authorizeCronRequest(
  request: Request,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const expected = env.CRON_SECRET?.trim() ?? "";
  if (!expected) return false;
  return safeEqualSecret(extractCronSecret(request), expected);
}
