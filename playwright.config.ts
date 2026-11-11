import { defineConfig, devices } from "@playwright/test";
const E2E_ENV = {
  APP_ENV: "e2e", DATABASE_URL: "postgres://app_server:app_server_local_only@127.0.0.1:54322/madtown_e2e", AUTH_PROVIDER: "local", ALLOW_LOCAL_AUTH: "1",
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef0123456789", CRON_SECRET: "e2e-cron", QR_BASE_URL: "https://inventory.madtown.in", APP_BASE_URL: "http://localhost:3100",
  STORAGE_PROVIDER: "local", LOCAL_STORAGE_DIR: ".storage-e2e", EMAIL_PROVIDER: "outbox", EMAIL_SANDBOX_TO: "staging-inbox@madtown.in", MIRROR_PROVIDER: "csv", MIRROR_CSV_DIR: ".mirror-e2e",
};
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npx next start -p 3100", url: "http://localhost:3100/api/health", reuseExistingServer: false, timeout: 120_000, env: E2E_ENV },
  projects: [
    { name: "android", use: { ...devices["Pixel 7"] }, testMatch: /(checkout|finance|offline|scan)\.spec/ },
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium" }, testMatch: /scan\.spec/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testMatch: /(desktop|labels|audit|import|auth)\.spec/ },
  ],
});
