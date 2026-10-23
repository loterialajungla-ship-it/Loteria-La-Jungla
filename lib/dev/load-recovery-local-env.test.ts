import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyParsedRecoveryLocalEnv,
  loadRecoveryLocalEnvFile,
  parseRecoveryLocalEnvContent,
} from "@/lib/dev/load-recovery-local-env";

const SECRET = "recovery-local-secret-xyz-never-leak";
const SYNTH_POOLED =
  `postgresql://u:${SECRET}@ep-delicate-river-b4n3lose-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require`;
const SYNTH_DIRECT =
  `postgresql://u:${SECRET}@ep-delicate-river-b4n3lose.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require`;

function assertNoSecrets(text: string): void {
  assert.doesNotMatch(text, /postgresql:\/\//i);
  assert.doesNotMatch(text, new RegExp(SECRET, "i"));
  assert.doesNotMatch(text, /sslmode/i);
  assert.doesNotMatch(text, /:\/\/[^/\s]+@/i);
}

describe("parseRecoveryLocalEnvContent", () => {
  it("carga solo las dos claves permitidas (comillas y comentarios)", () => {
    const parsed = parseRecoveryLocalEnvContent(`
# comentario
DEV_FROM_RECOVERY_DATABASE_URL="${SYNTH_POOLED}"
DEV_FROM_RECOVERY_DIRECT_URL='${SYNTH_DIRECT}'

DATABASE_URL=postgresql://evil:${SECRET}@host/db
DIRECT_URL=postgresql://evil:${SECRET}@host/db
EXTRA=ignored
`);
    assert.equal(parsed.values.DEV_FROM_RECOVERY_DATABASE_URL, SYNTH_POOLED);
    assert.equal(parsed.values.DEV_FROM_RECOVERY_DIRECT_URL, SYNTH_DIRECT);
    assert.deepEqual(parsed.ignoredKeys, [
      "DATABASE_URL",
      "DIRECT_URL",
      "EXTRA",
    ]);
  });

  it("ignora claves prohibidas aunque sean las únicas del archivo", () => {
    const parsed = parseRecoveryLocalEnvContent(
      `DATABASE_URL=${SYNTH_POOLED}\nDIRECT_URL=${SYNTH_DIRECT}\n`,
    );
    assert.deepEqual(parsed.values, {});
    assert.deepEqual(parsed.ignoredKeys, ["DATABASE_URL", "DIRECT_URL"]);
  });

  it("admite valores vacíos o ausentes de claves permitidas", () => {
    const empty = parseRecoveryLocalEnvContent(
      "DEV_FROM_RECOVERY_DATABASE_URL=\nDEV_FROM_RECOVERY_DIRECT_URL=\"\"\n",
    );
    assert.equal(empty.values.DEV_FROM_RECOVERY_DATABASE_URL, "");
    assert.equal(empty.values.DEV_FROM_RECOVERY_DIRECT_URL, "");

    const missing = parseRecoveryLocalEnvContent("# solo comentario\n");
    assert.deepEqual(missing.values, {});
    assert.deepEqual(missing.ignoredKeys, []);
  });
});

describe("applyParsedRecoveryLocalEnv", () => {
  it("da prioridad a las variables de sesión", () => {
    const sessionPooled = "postgresql://session-pooled";
    const sessionDirect = "postgresql://session-direct";
    const target: Record<string, string | undefined> = {
      DEV_FROM_RECOVERY_DATABASE_URL: sessionPooled,
      DEV_FROM_RECOVERY_DIRECT_URL: sessionDirect,
      DATABASE_URL: "postgresql://parent-prod-should-stay",
    };
    const parsed = parseRecoveryLocalEnvContent(`
DEV_FROM_RECOVERY_DATABASE_URL=${SYNTH_POOLED}
DEV_FROM_RECOVERY_DIRECT_URL=${SYNTH_DIRECT}
DATABASE_URL=postgresql://should-never-apply:${SECRET}@x/db
`);
    const result = applyParsedRecoveryLocalEnv(target, parsed);
    assert.deepEqual(result.appliedKeys, []);
    assert.deepEqual(result.skippedKeys, [
      "DEV_FROM_RECOVERY_DATABASE_URL",
      "DEV_FROM_RECOVERY_DIRECT_URL",
    ]);
    assert.equal(target.DEV_FROM_RECOVERY_DATABASE_URL, sessionPooled);
    assert.equal(target.DEV_FROM_RECOVERY_DIRECT_URL, sessionDirect);
    assert.equal(target.DATABASE_URL, "postgresql://parent-prod-should-stay");
  });

  it("aplica claves permitidas ausentes y no toca DATABASE_URL/DIRECT_URL", () => {
    const target: Record<string, string | undefined> = {
      DATABASE_URL: "postgresql://untouched",
      DIRECT_URL: "postgresql://untouched-direct",
    };
    const parsed = parseRecoveryLocalEnvContent(`
DEV_FROM_RECOVERY_DATABASE_URL=${SYNTH_POOLED}
DEV_FROM_RECOVERY_DIRECT_URL=${SYNTH_DIRECT}
DATABASE_URL=postgresql://attacker:${SECRET}@x/db
DIRECT_URL=postgresql://attacker:${SECRET}@x/db
`);
    const result = applyParsedRecoveryLocalEnv(target, parsed);
    assert.deepEqual(result.appliedKeys, [
      "DEV_FROM_RECOVERY_DATABASE_URL",
      "DEV_FROM_RECOVERY_DIRECT_URL",
    ]);
    assert.equal(target.DEV_FROM_RECOVERY_DATABASE_URL, SYNTH_POOLED);
    assert.equal(target.DEV_FROM_RECOVERY_DIRECT_URL, SYNTH_DIRECT);
    assert.equal(target.DATABASE_URL, "postgresql://untouched");
    assert.equal(target.DIRECT_URL, "postgresql://untouched-direct");
  });
});

describe("loadRecoveryLocalEnvFile", () => {
  it("archivo inexistente → no muta el target", () => {
    const target: Record<string, string | undefined> = {};
    const missing = path.join(
      os.tmpdir(),
      `lj-recovery-local-missing-${Date.now()}.env`,
    );
    const result = loadRecoveryLocalEnvFile(missing, target);
    assert.equal(result.fileFound, false);
    assert.deepEqual(result.appliedKeys, []);
    assert.deepEqual(Object.keys(target), []);
  });

  it("lee archivo temporal sintético con allowlist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-recovery-local-"));
    const filePath = path.join(dir, ".env.recovery.local");
    fs.writeFileSync(
      filePath,
      [
        `DEV_FROM_RECOVERY_DATABASE_URL="${SYNTH_POOLED}"`,
        `DEV_FROM_RECOVERY_DIRECT_URL=${SYNTH_DIRECT}`,
        `DATABASE_URL=postgresql://leak:${SECRET}@evil/db`,
        "",
      ].join("\n"),
      "utf8",
    );

    const target: Record<string, string | undefined> = {
      DIRECT_URL: "postgresql://parent-direct-untouched",
    };
    const result = loadRecoveryLocalEnvFile(filePath, target);
    assert.equal(result.fileFound, true);
    assert.deepEqual(result.appliedKeys, [
      "DEV_FROM_RECOVERY_DATABASE_URL",
      "DEV_FROM_RECOVERY_DIRECT_URL",
    ]);
    assert.ok(result.ignoredKeys.includes("DATABASE_URL"));
    assert.equal(target.DEV_FROM_RECOVERY_DATABASE_URL, SYNTH_POOLED);
    assert.equal(target.DEV_FROM_RECOVERY_DIRECT_URL, SYNTH_DIRECT);
    assert.equal(target.DATABASE_URL, undefined);
    assert.equal(target.DIRECT_URL, "postgresql://parent-direct-untouched");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("mensajes/metadatos del cargador no filtran secretos", () => {
    const parsed = parseRecoveryLocalEnvContent(
      `DEV_FROM_RECOVERY_DATABASE_URL=${SYNTH_POOLED}\nDATABASE_URL=${SECRET}\n`,
    );
    const meta = JSON.stringify(parsed.ignoredKeys);
    assertNoSecrets(meta);
    assert.deepEqual(parsed.ignoredKeys, ["DATABASE_URL"]);
  });
});
