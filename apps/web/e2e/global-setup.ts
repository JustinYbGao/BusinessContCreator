import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { FullConfig } from "@playwright/test";
import { assertTestAuthFixtureEnabled } from "../src/lib/test-auth-fixture";
import {
  E2E_STORAGE_STATE,
  assertE2eEnvironment,
  loadE2eEnvironment,
  requiredE2eEnvironment,
  testEmail,
} from "./env";

export default async function globalSetup(config: FullConfig): Promise<void> {
  loadE2eEnvironment();
  assertE2eEnvironment();
  assertTestAuthFixtureEnabled(process.env);

  const baseURL = String(config.projects[0]?.use.baseURL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000");
  const email = testEmail();
  const supabase = createClient(
    requiredE2eEnvironment("SOCIAL_AGENT_SUPABASE_URL"),
    requiredE2eEnvironment("SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (users.error) throw new Error("E2E_AUTH_SETUP_FAILED");
  let user = users.data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    const created = await supabase.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("E2E_AUTH_SETUP_FAILED");
    user = created.data.user;
  }
  if (!user.email) throw new Error("E2E_AUTH_SETUP_FAILED");

  const link = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
    options: { redirectTo: new URL("/auth/callback", baseURL).toString() },
  });
  const actionLink = link.data.properties?.action_link;
  if (link.error || !actionLink) throw new Error("E2E_AUTH_SETUP_FAILED");

  await mkdir(dirname(E2E_STORAGE_STATE), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(actionLink, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname.startsWith("/app"), { timeout: 30_000 });
    await context.storageState({ path: E2E_STORAGE_STATE });
  } finally {
    await context.close();
    await browser.close();
  }
}
