import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ADMIN_NAV, VENDOR_NAV } from "@/components/nav/nav-config";
import { canAccessAdminApi } from "@/lib/acceptance/authorize-rules";
import {
  ADMIN_CAJA_PATH,
  LOGIN_PATH,
  VENTA_CAJA_PATH,
  decideVentaCajaAccess,
} from "@/lib/caja/venta-caja-access";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("B3.1 — acceso ADMIN a Mi Caja", () => {
  it("ADMIN en /venta/caja va a /admin/caja y no vuelve", () => {
    const decision = decideVentaCajaAccess("ADMIN");
    assert.deepEqual(decision, { kind: "redirect", to: ADMIN_CAJA_PATH });
    assert.notEqual(decision.kind === "redirect" ? decision.to : "", VENTA_CAJA_PATH);
    const adminPage = read("app/admin/caja/page.tsx");
    const adminLayout = read("app/admin/layout.tsx");
    assert.doesNotMatch(adminPage, /\/venta\/caja/);
    assert.doesNotMatch(adminLayout, /\/venta\/caja/);
    assert.match(read("app/venta/caja/page.tsx"), /decideVentaCajaAccess/);
    assert.match(read("app/venta/caja/page.tsx"), /redirect\(access\.to\)/);
  });

  it("VENDEDOR permanece en Mi Caja", () => {
    assert.deepEqual(decideVentaCajaAccess("VENDEDOR"), { kind: "vendor" });
    assert.match(read("app/venta/caja/page.tsx"), /CajaVendorPanel/);
    assert.match(read("app/venta/layout.tsx"), /rol === "VENDEDOR"/);
  });

  it("sin sesión sigue el flujo de login y el middleware no abre /venta", () => {
    assert.deepEqual(decideVentaCajaAccess(null), {
      kind: "redirect",
      to: LOGIN_PATH,
    });
    assert.deepEqual(decideVentaCajaAccess(undefined), {
      kind: "redirect",
      to: LOGIN_PATH,
    });
    const middleware = read("middleware.ts");
    assert.match(middleware, /pathname\.startsWith\("\/venta"\)/);
    assert.match(middleware, /redirect\(absoluteUrlFromRequest\(request, "\/login"\)\)/);
    assert.match(read("app/venta/layout.tsx"), /redirect\("\/login"\)/);
  });

  it("ADMIN sigue fuera de la API de venta y VENDEDOR fuera de la API admin", () => {
    const venta = read("app/api/venta/caja/route.ts");
    assert.match(venta, /rol !== "VENDEDOR"/);
    assert.match(venta, /CAJA_SOLO_VENDEDOR/);
    assert.match(read("app/api/admin/caja/route.ts"), /requireAdmin/);
    assert.equal(
      canAccessAdminApi({
        id: "1",
        nombre: "A",
        usuario: "a",
        rol: "ADMIN",
        activo: true,
      }),
      true,
    );
    assert.equal(
      canAccessAdminApi({
        id: "2",
        nombre: "V",
        usuario: "v",
        rol: "VENDEDOR",
        activo: true,
      }),
      false,
    );
  });

  it("la navegación no manda a ADMIN a /venta/caja", () => {
    assert.equal(
      ADMIN_NAV.some((item) => item.href === VENTA_CAJA_PATH),
      false,
    );
    assert.ok(ADMIN_NAV.some((item) => item.href === ADMIN_CAJA_PATH));
    assert.ok(VENDOR_NAV.some((item) => item.href === VENTA_CAJA_PATH));
    assert.equal(
      VENDOR_NAV.some((item) => item.href.startsWith("/admin")),
      false,
    );
  });
});
