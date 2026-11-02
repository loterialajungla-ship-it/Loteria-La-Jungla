/**
 * E2E read-only: saldo visible en POS (U2.1).
 * No confirma ventas ni muta créditos.
 */
import { expect, test } from "@playwright/test";
import { readE2eState, type E2eRunState } from "./harness";
import { loginVendor } from "./helpers";

test.describe("U2.1 POS saldo (read-only)", () => {
  let state: E2eRunState;

  test.beforeAll(() => {
    state = readE2eState();
  });

  test("vendedor ve badge de saldo de su sesión; query vendedorId no altera identidad", async ({
    page,
  }) => {
    await loginVendor(page, state);

    const badge = page.getByTestId("pos-saldo-badge");
    await expect(badge).toBeVisible({ timeout: 60_000 });
    await expect(badge).not.toHaveAttribute("data-pos-saldo-kind", "loading");

    // Compara misma sesión con/sin vendedorId ajeno (no basta con HTTP 200).
    const api = await page.evaluate(async (alienId) => {
      const opts: RequestInit = {
        cache: "no-store",
        credentials: "same-origin",
      };
      const base = await fetch(`/api/creditos/mi-cuenta?page=1&pageSize=1`, opts);
      const baseJson = (await base.json()) as {
        ok?: boolean;
        cuenta?: {
          saldoDisponible?: string;
          tieneCuenta?: boolean;
          saldoBajo?: boolean;
        };
        config?: { configPersisted?: boolean; controlActivo?: boolean };
      };
      const alien = await fetch(
        `/api/creditos/mi-cuenta?page=1&pageSize=1&vendedorId=${encodeURIComponent(alienId)}`,
        opts,
      );
      const alienJson = (await alien.json()) as typeof baseJson;
      return {
        baseStatus: base.status,
        alienStatus: alien.status,
        baseJson,
        alienJson,
      };
    }, "vendedor-ajeno-no-existe");

    expect(api.baseStatus).toBe(200);
    expect(api.alienStatus).toBe(200);
    expect(api.baseJson.ok).toBe(true);
    expect(api.alienJson.ok).toBe(true);
    expect(api.alienJson.cuenta?.tieneCuenta).toBe(api.baseJson.cuenta?.tieneCuenta);
    expect(api.alienJson.cuenta?.saldoDisponible).toBe(
      api.baseJson.cuenta?.saldoDisponible,
    );
    expect(api.alienJson.cuenta?.saldoBajo).toBe(api.baseJson.cuenta?.saldoBajo);
    expect(api.baseJson.config).toBeTruthy();
    expect(typeof api.baseJson.config?.configPersisted).toBe("boolean");
    expect(typeof api.baseJson.cuenta?.saldoDisponible).toBe("string");

    // POS sigue operable (botón crear / grid presente).
    await expect(
      page.getByRole("heading", { name: "Punto de venta" }),
    ).toBeVisible();
  });

  test("fallo de consulta de saldo no bloquea el POS", async ({ page }) => {
    await page.route("**/api/creditos/mi-cuenta**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: { code: "TEMP", message: "Simulated outage" },
        }),
      });
    });

    await loginVendor(page, state);

    const badge = page.getByTestId("pos-saldo-badge");
    await expect(badge).toBeVisible({ timeout: 60_000 });
    await expect(badge).toHaveAttribute("data-pos-saldo-kind", "error");
    await expect(badge.getByRole("button", { name: "Reintentar" })).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Punto de venta" }),
    ).toBeVisible();
    // No hay bloqueo: tabs/horas o mensaje de horas siguen en la página.
    await expect(page.locator("#pos-animal-panel")).toBeVisible();
  });
});
