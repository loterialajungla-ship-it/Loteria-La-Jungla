/**
 * E2E «Creado por» — solo TEST (webServer = run-e2e-webserver → prepareTestDevEnv).
 * Crea tickets vía API autenticada; verifica UI ADMIN + privacidad.
 */
import { expect, test, type Page } from "@playwright/test";
import { readE2eState, type E2eRunState } from "./harness";
import { loginAdmin, loginAs, loginVendor } from "./helpers";

test.describe.configure({ mode: "serial" });

type CreatedTicket = {
  id: string;
  numeroVisible: string;
  codigoPublico: string;
  fechaJuego: string;
};

let state: E2eRunState;
let ticketA: CreatedTicket;
let ticketB: CreatedTicket;
let fechaJuego: string;

test.beforeAll(() => {
  state = readE2eState();
  expect(state.endpointId).toBe("ep-muddy-fire-b44816w0");
});

async function loginVendorUsuario(page: Page, usuario: string): Promise<void> {
  await loginAs(page, usuario, state.password);
  await page.waitForURL(/\/venta(\/|$)/, { timeout: 60_000 });
}

async function createTicketAsLoggedVendor(page: Page): Promise<{
  id: string;
  numeroVisible: string;
  codigoPublico: string;
  fechaJuego: string;
}> {
  const result = await page.evaluate(async () => {
    // Fecha de hoy Caracas (misma lógica aproximada del servidor).
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Caracas",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value ?? "2026";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    const fechaJuego = `${y}-${m}-${d}`;

    const body = {
      fechaJuego,
      idempotencyKey: crypto.randomUUID(),
      lineas: [{ hora: 19, numeroAnimal: "0", importe: "1.00" }],
    };
    const res = await fetch("/api/venta/tickets", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      ticket?: {
        id: string;
        numeroVisible: string;
        codigoPublico: string;
        fechaJuego: string;
      };
      error?: { code?: string; message?: string };
    };
    return { status: res.status, json, fechaJuego };
  });

  expect(
    result.status,
    `create ticket failed: ${JSON.stringify(result.json)}`,
  ).toBeLessThan(300);
  expect(result.json.ok).toBe(true);
  expect(result.json.ticket?.id).toBeTruthy();
  return {
    id: result.json.ticket!.id,
    numeroVisible: result.json.ticket!.numeroVisible,
    codigoPublico: result.json.ticket!.codigoPublico,
    fechaJuego: result.fechaJuego,
  };
}

test("vendedor A crea ticket en TEST", async ({ page }) => {
  await loginVendorUsuario(page, state.vendUsuario);
  ticketA = await createTicketAsLoggedVendor(page);
  fechaJuego = ticketA.fechaJuego;
  expect(ticketA.numeroVisible.length).toBeGreaterThan(3);
});

test("vendedor B crea ticket en TEST", async ({ page }) => {
  await loginVendorUsuario(page, state.vend2Usuario);
  ticketB = await createTicketAsLoggedVendor(page);
  expect(ticketB.id).not.toEqual(ticketA.id);
});

test("ADMIN listado muestra Creado por correcto (escritorio)", async ({
  page,
}) => {
  await loginAdmin(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `/admin/tickets?fecha=${encodeURIComponent(fechaJuego)}&numero=`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator("main h1")).toHaveText(/Tickets/i, {
    timeout: 60_000,
  });

  // Cabecera Creado por (th estático; no siempre expone role=columnheader en a11y)
  await expect(
    page.locator("thead th", { hasText: "Creado por" }),
  ).toBeVisible({ timeout: 60_000 });

  const rowA = page.locator("tbody tr", { hasText: ticketA.numeroVisible });
  const rowB = page.locator("tbody tr", { hasText: ticketB.numeroVisible });
  await expect(rowA).toBeVisible({ timeout: 60_000 });
  await expect(rowB).toBeVisible();
  await expect(rowA.getByText("F53 E2E Vend", { exact: true })).toBeVisible();
  await expect(rowB.getByText("F53 E2E Vend2", { exact: true })).toBeVisible();
  await expect(rowA.getByText("F53 E2E Vend2", { exact: true })).toHaveCount(0);

  await page.screenshot({
    path: "test-results/e2e-creado-por-desktop-list.png",
    fullPage: true,
  });
});

test("ADMIN detalle muestra nombre, usuario y fecha/hora", async ({ page }) => {
  await loginAdmin(page, state);

  await page.goto(`/admin/tickets/${ticketA.id}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Creado por")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("F53 E2E Vend", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Nombre del creador")).toBeVisible();
  await expect(page.getByText("Usuario de acceso")).toBeVisible();
  await expect(page.getByText(state.vendUsuario, { exact: true })).toBeVisible();
  await expect(page.getByText("Creación")).toBeVisible();
  await page.screenshot({
    path: "test-results/e2e-creado-por-detail-A.png",
    fullPage: true,
  });

  await page.goto(`/admin/tickets/${ticketB.id}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("F53 E2E Vend2", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(state.vend2Usuario, { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/e2e-creado-por-detail-B.png",
    fullPage: true,
  });
});

test("móvil: creador visible en card del listado", async ({ page }) => {
  await loginAdmin(page, state);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/tickets?fecha=${encodeURIComponent(fechaJuego)}`, {
    waitUntil: "domcontentloaded",
  });
  const cardA = page.locator("li", { hasText: ticketA.numeroVisible });
  await expect(cardA.getByText("Creado por")).toBeVisible({ timeout: 60_000 });
  await expect(cardA.getByText("F53 E2E Vend", { exact: true })).toBeVisible();
  const cardB = page.locator("li", { hasText: ticketB.numeroVisible });
  await expect(cardB.getByText("F53 E2E Vend2", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/e2e-creado-por-mobile-list.png",
    fullPage: true,
  });
});

test("vendedor no accede a info privada ADMIN de tickets ajenos", async ({
  page,
}) => {
  await loginVendor(page, state); // vend A
  const res = await page.evaluate(async (alienId) => {
    const r = await fetch(`/api/admin/tickets/${alienId}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const text = await r.text();
    return { status: r.status, text };
  }, ticketB.id);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.text.toLowerCase()).not.toContain("creadopor");
  expect(res.text).not.toContain(state.vend2Usuario);

  await page.goto(`/admin/tickets/${ticketB.id}`);
  await page.waitForURL(/\/venta|\/login|\/admin/, { timeout: 30_000 });
  await expect(page).not.toHaveURL(new RegExp(`/admin/tickets/${ticketB.id}$`));
});

test("consulta pública no revela el creador", async ({ page }) => {
  await page.goto(`/ticket/${ticketA.codigoPublico}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText(ticketA.numeroVisible)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Creado por")).toHaveCount(0);
  await expect(page.getByText(state.vendUsuario)).toHaveCount(0);
  await expect(page.getByText("F53 E2E Vend", { exact: true })).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain(state.vendUsuario);
  expect(html).not.toContain("creadoPor");
  await page.screenshot({
    path: "test-results/e2e-creado-por-public.png",
    fullPage: true,
  });
});
