import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { E2eRunState } from "./harness";

export async function loginAs(
  page: Page,
  usuario: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(usuario);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

export async function loginAdmin(page: Page, state: E2eRunState): Promise<void> {
  await loginAs(page, state.adminUsuario, state.password);
  await page.waitForURL(/\/admin(\/|$)/, { timeout: 90_000 });
}

export async function loginVendor(
  page: Page,
  state: E2eRunState,
): Promise<void> {
  await loginAs(page, state.vendUsuario, state.password);
  await page.waitForURL(/\/venta(\/|$)/, { timeout: 30_000 });
}

export async function openCreditosDetalle(
  page: Page,
  vendedorId: string,
): Promise<void> {
  await page.goto(`/admin/creditos/${encodeURIComponent(vendedorId)}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Saldo disponible")).toBeVisible({
    timeout: 90_000,
  });
}

/**
 * Confirma el ConfirmDialog de producto (role=alertdialog).
 * Justificación U1: la UI ya no usa window.confirm; sin este paso
 * los flujos de créditos quedarían a la espera del diálogo.
 */
export async function confirmOpenDialog(
  page: Page,
  confirmName?: string | RegExp,
): Promise<void> {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const name =
    confirmName ??
    /^(Asignar|Retirar|Registrar corrección|Activar control|Activar|Desactivar|Confirmar)/;
  await dialog.getByRole("button", { name }).click();
}

/**
 * Compatibilidad: escucha diálogos nativos residuales.
 * Preferir `confirmOpenDialog` tras acciones que abren ConfirmDialog.
 * No sustituye la confirmación del producto (ya no hay window.confirm).
 */
export function acceptConfirms(page: Page): void {
  page.on("dialog", (d) => void d.accept());
}

export async function fillLabeled(
  page: Page,
  label: string | RegExp,
  value: string,
): Promise<void> {
  await page.getByLabel(label).fill(value);
}
