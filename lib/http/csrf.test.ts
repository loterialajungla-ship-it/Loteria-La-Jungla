import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CSRF_ERROR_CODE,
  assertMutationSameOrigin,
  csrfForbiddenBody,
  csrfForbiddenResponse,
  expectedOriginFromRequestUrl,
  isMutationHttpMethod,
  originFromRefererHeader,
  parseBrowserOrigin,
  rejectCrossOriginMutation,
} from "@/lib/http/csrf";

const APP_ORIGIN = "https://app.lajungla.test";
const APP_URL = `${APP_ORIGIN}/api/admin/logout`;

function fakeRequest(
  method: string,
  url: string,
  headers: Record<string, string | undefined> = {},
) {
  return {
    method,
    url,
    headers: {
      get(name: string) {
        const key = name.toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === key) return v ?? null;
        }
        return null;
      },
    },
  };
}

describe("isMutationHttpMethod", () => {
  it("marca POST/PUT/PATCH/DELETE como mutación", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      assert.equal(isMutationHttpMethod(m), true);
    }
  });

  it("no marca GET/HEAD/OPTIONS", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      assert.equal(isMutationHttpMethod(m), false);
    }
  });
});

describe("parseBrowserOrigin / originFromRefererHeader", () => {
  it("rechaza Origin null literal y malformado", () => {
    assert.equal(parseBrowserOrigin("null").kind, "null_literal");
    assert.equal(parseBrowserOrigin("https://evil.test/path").kind, "malformed");
    assert.equal(parseBrowserOrigin("not-a-url").kind, "malformed");
    assert.equal(parseBrowserOrigin("").kind, "absent");
  });

  it("acepta Origin canónico", () => {
    const ok = parseBrowserOrigin("https://app.lajungla.test");
    assert.equal(ok.kind, "ok");
    assert.equal(ok.origin, "https://app.lajungla.test");
  });

  it("extrae origen estricto del Referer", () => {
    const ok = originFromRefererHeader(
      "https://app.lajungla.test/admin/caja?x=1",
    );
    assert.equal(ok.kind, "ok");
    assert.equal(ok.origin, "https://app.lajungla.test");
    assert.equal(originFromRefererHeader(":::").kind, "malformed");
  });
});

describe("assertMutationSameOrigin (B5.6-D)", () => {
  it("permite Origin same-origin", () => {
    const d = assertMutationSameOrigin(
      fakeRequest("POST", APP_URL, { origin: APP_ORIGIN }),
    );
    assert.deepEqual(d, { ok: true, matched: "origin" });
  });

  it("rechaza Origin externo", () => {
    const d = assertMutationSameOrigin(
      fakeRequest("POST", APP_URL, { origin: "https://evil.example" }),
    );
    assert.deepEqual(d, { ok: false, reason: "mismatch" });
  });

  it("rechaza Origin malformado", () => {
    const d = assertMutationSameOrigin(
      fakeRequest("POST", APP_URL, { origin: "https://evil.example/x" }),
    );
    assert.deepEqual(d, { ok: false, reason: "malformed" });
  });

  it("permite Origin ausente con Referer same-origin", () => {
    const d = assertMutationSameOrigin(
      fakeRequest("POST", APP_URL, {
        referer: `${APP_ORIGIN}/admin`,
      }),
    );
    assert.deepEqual(d, { ok: true, matched: "referer" });
  });

  it("rechaza Origin y Referer ausentes", () => {
    const d = assertMutationSameOrigin(fakeRequest("POST", APP_URL));
    assert.deepEqual(d, { ok: false, reason: "missing" });
  });

  it("rechaza Origin externo aunque Referer sea same-origin", () => {
    const d = assertMutationSameOrigin(
      fakeRequest("POST", APP_URL, {
        origin: "https://attacker.test",
        referer: `${APP_ORIGIN}/admin`,
      }),
    );
    assert.deepEqual(d, { ok: false, reason: "mismatch" });
  });

  it("compara protocolo, host y puerto de forma estricta", () => {
    const httpsApp = assertMutationSameOrigin(
      fakeRequest("POST", "https://app.test:443/api/x", {
        origin: "http://app.test",
      }),
    );
    assert.deepEqual(httpsApp, { ok: false, reason: "mismatch" });

    const portMismatch = assertMutationSameOrigin(
      fakeRequest("POST", "http://localhost:3000/api/x", {
        origin: "http://localhost:3001",
      }),
    );
    assert.deepEqual(portMismatch, { ok: false, reason: "mismatch" });

    const hostMismatch = assertMutationSameOrigin(
      fakeRequest("POST", "https://app.lajungla.test/api/x", {
        origin: "https://app.lajungla.test.evil",
      }),
    );
    assert.deepEqual(hostMismatch, { ok: false, reason: "mismatch" });
  });

  it("no confía en Host ni X-Forwarded-Host para el origen esperado", () => {
    const expected = expectedOriginFromRequestUrl(APP_URL);
    assert.equal(expected, APP_ORIGIN);

    const d = assertMutationSameOrigin(
      fakeRequest("POST", APP_URL, {
        origin: "https://spoofed.example",
        host: "spoofed.example",
        "x-forwarded-host": "spoofed.example",
        "x-forwarded-proto": "https",
      }),
    );
    assert.deepEqual(d, { ok: false, reason: "mismatch" });

    // Cabeceras de borde no cambian el expected: Origin legítimo sigue OK.
    const ok = assertMutationSameOrigin(
      fakeRequest("POST", APP_URL, {
        origin: APP_ORIGIN,
        host: "spoofed.example",
        "x-forwarded-host": "spoofed.example",
      }),
    );
    assert.deepEqual(ok, { ok: true, matched: "origin" });
  });

  it("no bloquea GET/HEAD por CSRF", () => {
    for (const method of ["GET", "HEAD"]) {
      const d = assertMutationSameOrigin(fakeRequest(method, APP_URL));
      assert.equal(d.ok, true);
      assert.equal(rejectCrossOriginMutation(fakeRequest(method, APP_URL)), null);
    }
  });

  it("rechaza Sec-Fetch-Site: cross-site", () => {
    const d = assertMutationSameOrigin(
      fakeRequest("POST", APP_URL, {
        origin: APP_ORIGIN,
        "sec-fetch-site": "cross-site",
      }),
    );
    assert.deepEqual(d, { ok: false, reason: "cross_site_fetch" });
  });

  it("rechaza Origin literal null", () => {
    const d = assertMutationSameOrigin(
      fakeRequest("POST", APP_URL, { origin: "null" }),
    );
    assert.deepEqual(d, { ok: false, reason: "unsafe_null" });
  });

  it("rejectCrossOriginMutation devuelve 403 CSRF_ORIGIN_REJECTED", () => {
    const res = rejectCrossOriginMutation(
      fakeRequest("POST", APP_URL, { origin: "https://evil.example" }),
    );
    assert.ok(res);
    assert.equal(res!.status, 403);
    const body = csrfForbiddenBody("mismatch");
    assert.equal(body.error.code, CSRF_ERROR_CODE);
    const forbidden = csrfForbiddenResponse("mismatch");
    assert.equal(forbidden.status, 403);
  });
});

describe("política login/logout y cron (cableado)", () => {
  const root = process.cwd();

  it("login y logout usan rejectCrossOriginMutation", () => {
    for (const rel of [
      "app/api/admin/login/route.ts",
      "app/api/admin/logout/route.ts",
      "app/api/auth/change-password/route.ts",
    ]) {
      const src = readFileSync(path.join(root, rel), "utf8");
      assert.match(src, /rejectCrossOriginMutation/);
    }
  });

  it("cron no usa helper CSRF de sesión; conserva CRON_SECRET", () => {
    const src = readFileSync(
      path.join(root, "app/api/cron/resultados-automaticos/route.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /rejectCrossOriginMutation|assertMutationSameOrigin/);
    assert.match(src, /CRON_SECRET|authorizeCronRequest|handleAutomaticResultsRequest/);
  });

  it("todas las mutaciones cookie-auth (excepto cron) cablean CSRF", () => {
    const apiRoot = path.join(root, "app", "api");
    const wired: string[] = [];
    const missing: string[] = [];

    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (name !== "route.ts") continue;
        const rel = path.relative(root, full).replace(/\\/g, "/");
        if (rel.startsWith("app/api/cron/")) continue;
        const src = readFileSync(full, "utf8");
        const mutates =
          /export async function (POST|PUT|PATCH|DELETE)\b/.test(src);
        if (!mutates) continue;
        if (/rejectCrossOriginMutation/.test(src)) wired.push(rel);
        else missing.push(rel);
      }
    }

    walk(apiRoot);
    assert.equal(
      missing.length,
      0,
      `Rutas mutables sin CSRF: ${missing.join(", ")}`,
    );
    assert.ok(wired.length >= 17, `esperado >=17 rutas cableadas, hay ${wired.length}`);
  });
});
