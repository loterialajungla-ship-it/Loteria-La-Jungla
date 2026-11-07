import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { canAccessAdminApi } from "@/lib/acceptance/authorize-rules";
import { ADMIN_NAV, VENDOR_NAV } from "@/components/nav/nav-config";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("C6 — rutas y permisos de Caja UI", () => {
  it("navegación expone Caja ADMIN y Mi Caja VENDEDOR", () => {
    assert.ok(ADMIN_NAV.some((i) => i.href === "/admin/caja"));
    assert.ok(VENDOR_NAV.some((i) => i.href === "/venta/caja"));
    assert.ok(!VENDOR_NAV.some((i) => i.href.startsWith("/admin")));
  });

  it("páginas existen y no activan Caja", () => {
    const admin = read("app/admin/caja/page.tsx");
    const vendor = read("app/venta/caja/page.tsx");
    const detalle = read("app/admin/caja/vendedores/[vendedorId]/page.tsx");
    assert.match(admin, /CajaAdminPanel/);
    assert.match(vendor, /CajaVendorPanel/);
    assert.match(detalle, /CajaAdminVendedorDetalle/);
    assert.doesNotMatch(admin + vendor + detalle, /activarCaja\(/);
  });

  it("APIs ADMIN usan requireAdmin; venta exige VENDEDOR", () => {
    assert.match(read("app/api/admin/caja/route.ts"), /requireAdmin/);
    assert.match(
      read("app/api/admin/caja/vendedores/[vendedorId]/comision/route.ts"),
      /requireAdmin/,
    );
    assert.match(
      read("app/api/admin/caja/declaraciones/[id]/confirmar/route.ts"),
      /requireAdmin/,
    );
    const venta = read("app/api/venta/caja/route.ts");
    assert.match(venta, /requireVendorOrAdmin/);
    assert.match(venta, /CAJA_SOLO_VENDEDOR|rol !== "VENDEDOR"/);
    const decl = read("app/api/venta/caja/declaraciones/route.ts");
    assert.match(decl, /CAJA_SOLO_VENDEDOR|rol !== "VENDEDOR"/);
  });

  it("authorize-rules: ADMIN sí / VENDEDOR no a admin API", () => {
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

  it("UI no ofrece activar Caja ni endpoint de confirmación desde vendedor", () => {
    const vendorUi = read("components/caja/CajaVendorPanel.tsx");
    assert.doesNotMatch(vendorUi, /activarCaja\(/);
    assert.doesNotMatch(vendorUi, /\/confirmar/);
    assert.doesNotMatch(vendorUi, /crearConfirmacionAdmin/);
    assert.match(vendorUi, /Declarar/);
    const adminUi = read("components/caja/CajaAdminPanel.tsx");
    assert.match(adminUi, /Caja inactiva/);
    assert.doesNotMatch(adminUi, /activarCaja\(/);
  });
});
