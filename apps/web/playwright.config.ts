import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
  E2E_ROOT,
  E2E_STORAGE_STATE,
  assertE2eEnvironment,
  loadE2eEnvironment,
  testEmail,
} from "./e2e/env";

loadE2eEnvironment();
assertE2eEnvironment();

const baseURL = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000";
const base = new URL(baseURL);
const webPort = Number(base.port || 3000);
const workerPort = Number(process.env.WORKER_HEALTH_PORT?.trim() || 3001);
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65_535) throw new Error("E2E_WEB_PORT_INVALID");
if (!Number.isInteger(workerPort) || workerPort < 1 || workerPort > 65_535) throw new Error("E2E_WORKER_PORT_INVALID");

const environment = {
  ...(process.env.SOCIAL_AGENT_SUPABASE_URL ? { SOCIAL_AGENT_SUPABASE_URL: process.env.SOCIAL_AGENT_SUPABASE_URL } : {}),
  ...(process.env.SOCIAL_AGENT_SUPABASE_ANON_KEY ? { SOCIAL_AGENT_SUPABASE_ANON_KEY: process.env.SOCIAL_AGENT_SUPABASE_ANON_KEY } : {}),
  ...(process.env.SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY ? { SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY: process.env.SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY } : {}),
  INTERNAL_WORKSPACE_ID: process.env.INTERNAL_WORKSPACE_ID || "00000000-0000-4000-8000-000000000001",
  ADMIN_EMAIL_ALLOWLIST: process.env.ADMIN_EMAIL_ALLOWLIST || testEmail(),
  DORMCHEF_SOURCE_DIR: process.env.DORMCHEF_SOURCE_DIR || resolve(E2E_ROOT, "packages/test-support/fixtures/dormchef-source"),
  SOCIAL_AGENT_WORKER_MODE: "fixture",
  WORKER_HEALTH_PORT: String(workerPort),
} satisfies NodeJS.ProcessEnv;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: resolve(E2E_ROOT, "apps/web/e2e/global-setup.ts"),
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    storageState: E2E_STORAGE_STATE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `pnpm --dir apps/web dev --webpack -p ${webPort}`,
      url: `${base.origin}/login`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: environment,
    },
    {
      command: `pnpm --dir apps/worker start -- --mode fixture --health-port ${workerPort}`,
      url: `http://127.0.0.1:${workerPort}/health/ready`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: environment,
    },
  ],
});
