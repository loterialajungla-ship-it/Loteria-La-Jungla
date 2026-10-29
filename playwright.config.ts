import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT?.trim() || "3100";
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Configuración E2E aislada (no forma parte de `npm test` / integration).
 * El webServer reutiliza guards de `prepareTestDevEnv` vía scripts/run-e2e-webserver.ts.
 */
export default defineConfig({
  testDir: "./e2e/creditos",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 45_000 },
  reporter: [["list"]],
  globalSetup: require.resolve("./e2e/creditos/global-setup.ts"),
  globalTeardown: require.resolve("./e2e/creditos/global-teardown.ts"),
  use: {
    baseURL: BASE,
    navigationTimeout: 120_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx tsx scripts/run-e2e-webserver.ts`,
    url: `${BASE}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
