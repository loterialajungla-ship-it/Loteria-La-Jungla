import { test, expect } from "@playwright/test";
import {
  countMovimientosFor,
  readE2eState,
  readSaldo,
  type E2eRunState,
} from "./harness";
import {
  confirmOpenDialog,
  loginAdmin,
  loginVendor,
  openCreditosDetalle,
} from "./helpers";

test.describe.configure({ mode: "serial" });

let state: E2eRunState;

test.beforeAll(() => {
  state = readE2eState();
});

test("ADMIN accede a /admin/creditos", async ({ page }) => {
  await loginAdmin(page, state);
  await page.goto("/admin/creditos", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main h1")).toHaveText(/Créditos de vendedores/i, {
    timeout: 90_000,
  });
  // Listado paginado: con residuales fase5_/fase53_ el vendedor puede no estar
  // en página 1. La identidad se valida en el detalle aislado.
  await openCreditosDetalle(page, state.vendId);
  await expect(page.getByText(state.vendUsuario, { exact: true }).first()).toBeVisible();
});

test("VENDEDOR no puede acceder a administración de créditos", async ({
  page,
}) => {
  await loginVendor(page, state);
  await page.goto("/admin/creditos");
  // Layout admin redirige VENDEDOR a /venta
  await page.waitForURL(/\/venta/, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/admin\/creditos/);
});

test("asignación actualiza saldo e historial", async ({ page }) => {
  await loginAdmin(page, state);
  await openCreditosDetalle(page, state.vendId);

  const asignar = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Asignar créditos" }),
  });
  await asignar.getByLabel("Importe").fill("25.00");
  await asignar.getByLabel("Motivo (opcional)").fill("e2e asignar");
  await asignar.getByRole("button", { name: "Asignar" }).click();
  await confirmOpenDialog(page, "Asignar");

  // Éxito persistido: saldo en cabecera + historial de tabla (no <option> ocultas).
  await expect(
    page.locator("p").filter({ hasText: "Saldo disponible" }).locator("..").getByText("25.00"),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("table").getByText("Asignación").first(),
  ).toBeVisible({ timeout: 30_000 });

  const saldo = await readSaldo(state.vendId);
  expect(saldo).toBe("25.00");
  expect(await countMovimientosFor(state.vendId)).toBeGreaterThanOrEqual(1);
});

test("retirada válida disminuye el saldo", async ({ page }) => {
  await loginAdmin(page, state);
  await openCreditosDetalle(page, state.vendId);

  const before = await readSaldo(state.vendId);
  expect(before).toBeTruthy();

  const retirar = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Retirar créditos" }),
  });
  await retirar.getByLabel("Importe").fill("5.00");
  await retirar.getByRole("button", { name: "Retirar" }).click();
  await confirmOpenDialog(page, "Retirar");

  await expect(
    page.locator("p").filter({ hasText: "Saldo disponible" }).locator("..").getByText("20.00"),
  ).toBeVisible({ timeout: 60_000 });
  expect(await readSaldo(state.vendId)).toBe("20.00");
});

test("retirada superior al saldo: error y saldo intacto", async ({ page }) => {
  await loginAdmin(page, state);
  await openCreditosDetalle(page, state.vendId);
  const before = await readSaldo(state.vendId);
  const movBefore = await countMovimientosFor(state.vendId);

  const retirar = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Retirar créditos" }),
  });
  await retirar.getByLabel("Importe").fill("999.00");
  await retirar.getByRole("button", { name: "Retirar" }).click();
  await confirmOpenDialog(page, "Retirar");

  await expect(
    retirar.getByRole("alert").filter({ hasText: /insuficiente/i }),
  ).toBeVisible({ timeout: 45_000 });
  expect(await readSaldo(state.vendId)).toBe(before);
  expect(await countMovimientosFor(state.vendId)).toBe(movBefore);
});

test("corrección se refleja en saldo e historial", async ({ page }) => {
  await loginAdmin(page, state);
  await openCreditosDetalle(page, state.vendId);
  const before = await readSaldo(state.vendId);
  expect(before).toBeTruthy();

  const corregir = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Corrección compensatoria" }),
  });
  await corregir.getByLabel("Movimiento de origen").selectOption({ index: 1 });
  await corregir.getByLabel("Importe del ajuste").fill("1.00");
  await corregir.getByLabel("Efecto").selectOption("AUMENTAR");
  await corregir.getByRole("button", { name: "Registrar corrección" }).click();
  await confirmOpenDialog(page, "Registrar corrección");

  const expected = (Number(before) + 1).toFixed(2);
  await expect(
    page.locator("p").filter({ hasText: "Saldo disponible" }).locator("..").getByText(expected),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("table").getByText("Corrección").first(),
  ).toBeVisible({ timeout: 30_000 });
  expect(await readSaldo(state.vendId)).toBe(expected);
});

test("filtros en listado de créditos", async ({ page }) => {
  await loginAdmin(page, state);
  await page.goto("/admin/creditos", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main h1")).toHaveText(/Créditos de vendedores/i, {
    timeout: 60_000,
  });

  const form = page.locator("form").filter({
    has: page.getByLabel("Estado cuenta"),
  });
  await form.getByLabel("Estado cuenta").selectOption("activos");
  await form.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/activo=activos/);
  await expect(page.getByText(/Página \d+ de/i).first()).toBeVisible({
    timeout: 60_000,
  });
});

test("doble envío de asignación no duplica movimientos", async ({ page }) => {
  await loginAdmin(page, state);
  await openCreditosDetalle(page, state.vendId);
  const movBefore = await countMovimientosFor(state.vendId);

  const asignPosts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/asignar(?:\?|$)/.test(req.url())) {
      asignPosts.push(req.url());
    }
  });

  const asignar = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Asignar créditos" }),
  });
  await asignar.getByLabel("Importe").fill("2.00");

  // Abrir ConfirmDialog: un solo clic realista. No debe haber POST ni movimiento.
  await asignar.getByRole("button", { name: "Asignar" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  expect(asignPosts).toHaveLength(0);
  expect(await countMovimientosFor(state.vendId)).toBe(movBefore);

  // Cancelar tampoco crea movimiento ni petición financiera.
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
  expect(asignPosts).toHaveLength(0);
  expect(await countMovimientosFor(state.vendId)).toBe(movBefore);
  await expect(asignar.getByLabel("Importe")).toHaveValue("2.00");

  // Reabrir y confirmar. Doble disparo síncrono del botón de confirmar
  // (capa UI real) + intento extra en loading; a lo sumo 1 POST / 1 movimiento.
  await asignar.getByRole("button", { name: "Asignar" }).click();
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  await page.route("**/api/admin/creditos/*/asignar", async (route) => {
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
  });

  const confirmBtn = dialog.getByRole("button", { name: /^Asignar$/ });
  await confirmBtn.evaluate((el) => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  const loadingBtn = dialog.getByRole("button", { name: /Procesando/ });
  await expect(loadingBtn).toBeVisible({ timeout: 10_000 });
  await expect(loadingBtn).toBeDisabled();
  await loadingBtn.click({ force: true }).catch(() => undefined);

  await expect
    .poll(async () => countMovimientosFor(state.vendId), {
      timeout: 60_000,
      intervals: [500, 1000, 2000],
    })
    .toBe(movBefore + 1);

  expect(asignPosts).toHaveLength(1);
  await expect(dialog).toHaveCount(0);
});

test("sesión inválida: no conserva datos sensibles en detalle", async ({
  page,
  context,
}) => {
  await loginAdmin(page, state);
  await openCreditosDetalle(page, state.vendId);
  await expect(page.getByText("Saldo disponible")).toBeVisible();

  // Invalida sesión borrando cookies
  await context.clearCookies();

  const asignar = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Asignar créditos" }),
  });
  await asignar.getByLabel("Importe").fill("3.00");
  await asignar.getByRole("button", { name: "Asignar" }).click();
  await confirmOpenDialog(page, "Asignar");

  // onSessionExpired limpia data → ErrorState / mensaje sesión
  await expect(
    page.getByText(/Sesión expirada|sin permiso|No se pudo cargar/i).first(),
  ).toBeVisible({ timeout: 30_000 });
  // Saldo del vendedor no debe seguir mostrado como panel cargado
  await expect(page.getByText("Saldo disponible")).toHaveCount(0);
});

test("validación de importe inválido sin confirmar operación", async ({
  page,
}) => {
  let nativeConfirmSeen = false;
  page.on("dialog", async (d) => {
    nativeConfirmSeen = true;
    await d.dismiss();
  });

  await loginAdmin(page, state);
  await openCreditosDetalle(page, state.vendId);
  const movBefore = await countMovimientosFor(state.vendId);

  const asignar = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Asignar créditos" }),
  });
  await asignar.getByLabel("Importe").fill("abc");
  await asignar.getByRole("button", { name: "Asignar" }).click();

  await expect(
    asignar.getByRole("alert").filter({ hasText: /Importe inválido/i }),
  ).toBeVisible({ timeout: 30_000 });
  expect(nativeConfirmSeen).toBe(false);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await countMovimientosFor(state.vendId)).toBe(movBefore);
});
