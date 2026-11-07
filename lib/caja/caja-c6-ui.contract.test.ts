/**
 * C6 — contratos de UI/API (sin activar Caja, sin tocar producción).
 * Cubre los requisitos obligatorios de pantallas, roles e integración con C1–C5.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { canAccessAdminApi } from "@/lib/acceptance/authorize-rules";
import { ADMIN_NAV, VENDOR_NAV } from "@/components/nav/nav-config";
import { calcularTotalesCaja } from "@/lib/caja/resumen";
import {
  moneyFixed2,
  parseImporteCajaPositivo,
  cajaZero,
} from "@/lib/caja/money";
import { Prisma } from "@prisma/client";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("C6 — contratos UI ADMIN / VENDEDOR", () => {
  it("1. ADMIN tiene ruta /admin/caja en nav y página", () => {
    assert.ok(ADMIN_NAV.some((i) => i.href === "/admin/caja"));
    assert.ok(fs.existsSync(path.join(ROOT, "app/admin/caja/page.tsx")));
    assert.match(read("app/admin/caja/page.tsx"), /CajaAdminPanel/);
  });

  it("2. VENDEDOR no tiene entradas admin; panel admin exige requireAdmin", () => {
    assert.ok(!VENDOR_NAV.some((i) => i.href.startsWith("/admin")));
    assert.equal(
      canAccessAdminApi({
        id: "v",
        nombre: "V",
        usuario: "v",
        rol: "VENDEDOR",
        activo: true,
      }),
      false,
    );
    assert.match(read("app/api/admin/caja/route.ts"), /requireAdmin/);
    assert.match(
      read("app/api/admin/caja/vendedores/[vendedorId]/route.ts"),
      /requireAdmin/,
    );
  });

  it("3. VENDEDOR tiene Mi Caja en /venta/caja", () => {
    assert.ok(VENDOR_NAV.some((i) => i.href === "/venta/caja"));
    assert.match(read("app/venta/caja/page.tsx"), /CajaVendorPanel/);
  });

  it("4. API venta usa sesión; no acepta vendedorId ajeno en declaración", () => {
    const venta = read("app/api/venta/caja/route.ts");
    assert.match(venta, /actor\.userId/);
    assert.match(venta, /CAJA_SOLO_VENDEDOR|rol !== "VENDEDOR"/);
    const decl = read("app/api/venta/caja/declaraciones/route.ts");
    assert.match(decl, /FORBIDDEN_FIELD|vendedorId/);
    assert.match(decl, /actorUserId: actor\.userId/);
  });

  it("5. Resumen general ADMIN expone totales de servicios Caja", () => {
    const src = read("app/api/admin/caja/route.ts");
    assert.match(src, /listResumenesVendedores/);
    assert.match(src, /agregarTotalesVendedores/);
    assert.match(src, /serializeTotales/);
    assert.match(src, /Cache-Control.*no-store|no-store/);
    const panel = read("components/caja/CajaAdminPanel.tsx");
    assert.match(panel, /CajaTotalesGrid/);
    assert.match(panel, /deudaPendienteEntregar/);
  });

  it("6. Detalle vendedor ADMIN usa getResumenVendedor + comisión", () => {
    const src = read("app/api/admin/caja/vendedores/[vendedorId]/route.ts");
    assert.match(src, /getResumenVendedor/);
    assert.match(src, /getComisionVigente/);
    assert.match(src, /listComisionHistorial/);
    assert.match(
      read("components/caja/CajaAdminVendedorDetalle.tsx"),
      /historialComision/,
    );
  });

  it("7. ADMIN puede cambiar comisión vía PATCH setComisionVendedor", () => {
    const src = read(
      "app/api/admin/caja/vendedores/[vendedorId]/comision/route.ts",
    );
    assert.match(src, /setComisionVendedor/);
    assert.match(src, /requireAdmin/);
    assert.match(src, /PATCH/);
    assert.doesNotMatch(
      read("app/api/venta/caja/route.ts"),
      /setComisionVendedor/,
    );
  });

  it("8. Historial de comisión se renderiza (anterior/nuevo/fecha/admin)", () => {
    const ui = read("components/caja/CajaAdminVendedorDetalle.tsx");
    assert.match(ui, /porcentajeAnterior/);
    assert.match(ui, /porcentajeNuevo/);
    assert.match(ui, /changedAt/);
    assert.match(ui, /changedByAdminId/);
  });

  it("9. UI aclara que % vigente no aplica a tickets históricos (snapshot)", () => {
    const ui = read("components/caja/CajaAdminVendedorDetalle.tsx");
    assert.match(ui, /tickets futuros|snapshot|históricos/i);
    assert.match(ui, /comisionPorcentaje/);
  });

  it("10–12. Declaración vendedor: endpoint + validación positiva/máximo", () => {
    const decl = read("app/api/venta/caja/declaraciones/route.ts");
    assert.match(decl, /crearDeclaracionVendedor/);
    const money = read("lib/caja/declaracion.ts");
    assert.match(money, /maxNuevaDeclaracion|pendienteDeclarar/);
    assert.throws(() => parseImporteCajaPositivo(0), /./);
    assert.throws(() => parseImporteCajaPositivo(-1), /./);
    assert.throws(() => parseImporteCajaPositivo("0.00"), /./);
  });

  it("13. VENDEDOR no puede confirmar declaraciones", () => {
    assert.ok(
      !fs.existsSync(
        path.join(ROOT, "app/api/venta/caja/declaraciones/[id]/confirmar"),
      ),
    );
    const vendorUi = read("components/caja/CajaVendorPanel.tsx");
    assert.doesNotMatch(vendorUi, /\/confirmar/);
    assert.match(
      read("app/api/admin/caja/declaraciones/[id]/confirmar/route.ts"),
      /requireAdmin/,
    );
  });

  it("14–15. Confirmación ADMIN parcial usa crearConfirmacionAdmin", () => {
    const src = read(
      "app/api/admin/caja/declaraciones/[id]/confirmar/route.ts",
    );
    assert.match(src, /crearConfirmacionAdmin/);
    assert.match(src, /serializeAplicacion/);
    const conf = read("lib/caja/confirmacion.ts");
    assert.match(conf, /pendienteConfirmar|importeDeclarado/);
  });

  it("16. Estados PENDIENTE/PARCIAL/CONFIRMADA en badge y serializers", () => {
    const badge = read("components/caja/CajaEstadoBadge.tsx");
    assert.match(badge, /PENDIENTE/);
    assert.match(badge, /PARCIAL/);
    assert.match(badge, /CONFIRMADA/);
    assert.match(read("lib/caja/serializers.ts"), /estado: d\.estado/);
  });

  it("17. Aplicaciones FIFO se muestran en detalle y tras confirmar", () => {
    assert.match(
      read("components/caja/CajaAdminVendedorDetalle.tsx"),
      /aplicaciones/,
    );
    assert.match(read("components/caja/CajaAdminPanel.tsx"), /fifoResult|FIFO/);
    assert.match(
      read("app/api/admin/caja/declaraciones/[id]/confirmar/route.ts"),
      /ticket\.createdAt|ticketCreatedAt/,
    );
  });

  it("18. Totales de resumen coinciden con calcularTotalesCaja (servicios)", () => {
    const t = calcularTotalesCaja({
      totalBruto: new Prisma.Decimal("100.00"),
      totalComision: new Prisma.Decimal("20.00"),
      totalObligado: new Prisma.Decimal("80.00"),
      totalDeclarado: new Prisma.Decimal("50.00"),
      totalConfirmado: new Prisma.Decimal("30.00"),
      totalAplicado: new Prisma.Decimal("30.00"),
    });
    assert.equal(moneyFixed2(t.deudaPendienteEntregar), "50.00");
    assert.equal(moneyFixed2(t.pendienteConfirmar), "20.00");
    assert.equal(moneyFixed2(t.pendienteDeclarar), "30.00");
    assert.equal(moneyFixed2(t.pendienteAplicar), "0.00");
    assert.equal(moneyFixed2(t.maxNuevaDeclaracion), "30.00");
    assert.equal(moneyFixed2(cajaZero()), "0.00");
  });

  it("19. Idempotencia en declaración/confirmación (reintento no duplica)", () => {
    assert.match(
      read("app/api/venta/caja/declaraciones/route.ts"),
      /idempotencyKey/,
    );
    assert.match(
      read("app/api/admin/caja/declaraciones/[id]/confirmar/route.ts"),
      /idempotencyKey/,
    );
    assert.match(
      read("components/caja/CajaVendorPanel.tsx"),
      /newCajaIdempotencyKey|busy/,
    );
    assert.match(
      read("components/caja/CajaAdminPanel.tsx"),
      /newCajaIdempotencyKey|confirmBusy/,
    );
  });

  it("20. UI no activa Caja; muestra estado inactivo informativo", () => {
    const admin = read("components/caja/CajaAdminPanel.tsx");
    assert.match(admin, /Caja inactiva/);
    assert.doesNotMatch(admin, /activarCaja\(/);
    assert.doesNotMatch(
      read("components/caja/CajaVendorPanel.tsx"),
      /activarCaja\(/,
    );
    assert.doesNotMatch(
      read("app/api/admin/caja/route.ts"),
      /activarCaja\(/,
    );
  });
});
