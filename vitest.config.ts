import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: "postgres://app_server:app_server_local_only@127.0.0.1:54322/madtown_test",
      MIGRATION_DATABASE_URL: "postgres://postgres@127.0.0.1:54322/madtown_test",
      SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789",
      CRON_SECRET: "test-cron",
      AUTH_PROVIDER: "local",
      ALLOW_LOCAL_AUTH: "1",
      APP_ENV: "test",
      STORAGE_PROVIDER: "local",
      LOCAL_STORAGE_DIR: ".storage-test",
      EMAIL_PROVIDER: "outbox",
      EMAIL_SANDBOX_TO: "staging-inbox@madtown.in",
      MIRROR_PROVIDER: "csv",
      MIRROR_CSV_DIR: ".mirror-test",
    },
  },
  resolve: { alias: { "@": resolve(__dirname, "src"), "server-only": resolve(__dirname, "tests/helpers/empty.ts") } },
});
