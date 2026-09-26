import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4187",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 4187",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
    env: {
      NODE_ENV: "test",
      YANTU_ORIGIN: "http://127.0.0.1:4187",
      YANTU_DATABASE_PATH: ":memory:",
      YANTU_SAMPLE_DATA: "true",
      YANTU_MODEL_ENABLED: "false",
      YANTU_SEARCH_ENABLED: "false",
      YANTU_ADMIN_CREDENTIALS: "[]",
      YANTU_AUTH_REGISTRATION_IP_LIMIT: "200",
      YANTU_AUTH_LOGIN_IP_LIMIT: "200",
      YANTU_BOOTSTRAP_ADMINS: JSON.stringify([{username: "editor_account", password: "Test-Admin-Password-2026!", roles: ["editor"]}]),
    },
    timeout: 30_000,
  },
});
