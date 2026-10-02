import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  absoluteUrlFromRequest,
  resolvePublicOrigin,
} from "@/lib/http/public-origin";

function fakeRequest(
  url: string,
  headers: Record<string, string | undefined> = {},
) {
  return {
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

describe("resolvePublicOrigin / absoluteUrlFromRequest", () => {
  it("usa Host LAN aunque request.url sea 0.0.0.0", () => {
    const origin = resolvePublicOrigin(
      fakeRequest("http://0.0.0.0:3000/api/admin/login", {
        host: "192.168.1.22:3000",
      }),
    );
    assert.equal(origin, "http://192.168.1.22:3000");
  });

  it("usa localhost Host cuando request.url es 0.0.0.0", () => {
    const origin = resolvePublicOrigin(
      fakeRequest("http://0.0.0.0:3000/api/admin/login", {
        host: "localhost:3000",
      }),
    );
    assert.equal(origin, "http://localhost:3000");
  });

  it("nunca redirige a hostname 0.0.0.0 (fallback localhost)", () => {
    const origin = resolvePublicOrigin(
      fakeRequest("http://0.0.0.0:3000/api/admin/login", {
        host: "0.0.0.0:3000",
      }),
    );
    assert.equal(origin, "http://localhost:3000");
  });

  it("respeta x-forwarded-host / proto", () => {
    const origin = resolvePublicOrigin(
      fakeRequest("http://0.0.0.0:3000/x", {
        host: "0.0.0.0:3000",
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https",
      }),
    );
    assert.equal(origin, "https://app.example.com");
  });

  it("absoluteUrlFromRequest arma Location correcta tras login fallido", () => {
    const url = absoluteUrlFromRequest(
      fakeRequest("http://0.0.0.0:3000/api/admin/login", {
        host: "192.168.1.22:3000",
      }),
      "/login?error=1",
    );
    assert.equal(url.href, "http://192.168.1.22:3000/login?error=1");
    assert.notEqual(url.hostname, "0.0.0.0");
  });

  it("absoluteUrlFromRequest arma destino de éxito /venta", () => {
    const url = absoluteUrlFromRequest(
      fakeRequest("http://0.0.0.0:3000/api/admin/login", {
        host: "192.168.1.22:3000",
      }),
      "/venta",
    );
    assert.equal(url.href, "http://192.168.1.22:3000/venta");
  });
});
