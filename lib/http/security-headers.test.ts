import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ACTIVE_SECURITY_HEADERS,
  CSP_CANDIDATE_DIRECTIVES,
  HSTS_RECOMMENDATION,
  buildCspCandidateHeaderValue,
} from "@/lib/http/security-headers";

describe("ACTIVE_SECURITY_HEADERS (B5.6-C)", () => {
  function valueOf(key: string): string | undefined {
    return ACTIVE_SECURITY_HEADERS.find((h) => h.key === key)?.value;
  }

  it("incluye nosniff, referrer, frame deny y Permissions-Policy", () => {
    assert.equal(valueOf("X-Content-Type-Options"), "nosniff");
    assert.equal(
      valueOf("Referrer-Policy"),
      "strict-origin-when-cross-origin",
    );
    assert.equal(valueOf("X-Frame-Options"), "DENY");
    const pp = valueOf("Permissions-Policy");
    assert.ok(pp);
    assert.match(pp!, /camera=\(\)/);
    assert.match(pp!, /microphone=\(\)/);
    assert.match(pp!, /geolocation=\(\)/);
  });

  it("no activa CSP ni HSTS en el conjunto activo", () => {
    const keys = ACTIVE_SECURITY_HEADERS.map((h) => h.key);
    assert.equal(keys.includes("Content-Security-Policy"), false);
    assert.equal(
      keys.includes("Content-Security-Policy-Report-Only"),
      false,
    );
    assert.equal(keys.includes("Strict-Transport-Security"), false);
  });

  it("no usa comodines amplios ni unsafe-eval en valores activos", () => {
    for (const { value } of ACTIVE_SECURITY_HEADERS) {
      assert.doesNotMatch(value, /\*/);
      assert.doesNotMatch(value, /unsafe-eval/i);
    }
  });
});

describe("CSP candidata (documentada, no activa)", () => {
  it("serializa directivas same-origin sin * ni unsafe-eval", () => {
    const header = buildCspCandidateHeaderValue();
    assert.match(header, /default-src 'self'/);
    assert.match(header, /frame-ancestors 'none'/);
    assert.match(header, /object-src 'none'/);
    assert.match(header, /img-src 'self' data: blob:/);
    assert.match(header, /connect-src 'self'/);
    assert.doesNotMatch(header, /\*/);
    assert.doesNotMatch(header, /unsafe-eval/);
    assert.equal(CSP_CANDIDATE_DIRECTIVES["frame-src"], "'none'");
  });

  it("documenta HSTS como recomendación futura, no como cabecera activa", () => {
    assert.match(HSTS_RECOMMENDATION, /^Strict-Transport-Security:/);
    assert.equal(
      ACTIVE_SECURITY_HEADERS.some(
        (h) => h.key === "Strict-Transport-Security",
      ),
      false,
    );
  });
});

describe("next.config.mjs cablea las cabeceras activas", () => {
  it("importa ACTIVE_SECURITY_HEADERS y declara headers()", () => {
    const src = readFileSync(
      path.join(process.cwd(), "next.config.mjs"),
      "utf8",
    );
    assert.match(src, /security-headers\.mjs/);
    assert.match(src, /ACTIVE_SECURITY_HEADERS/);
    assert.match(src, /async headers\(/);
    assert.match(src, /source:\s*"\/:path\*"/);
    assert.doesNotMatch(src, /Content-Security-Policy/);
  });
});

