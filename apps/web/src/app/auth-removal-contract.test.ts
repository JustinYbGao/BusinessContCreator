import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import HomePage from "./page";

const webRoot = resolve(import.meta.dirname, "../..");

const authenticationFiles = [
  "src/proxy.ts",
  "src/app/login/page.tsx",
  "src/app/login/login-model.ts",
  "src/app/auth/callback/route.ts",
  "src/app/api/account/me/route.ts",
  "src/app/api/account/password/route.ts",
  "src/app/api/members/route.ts",
  "src/app/app/settings/members/page.tsx",
  "src/app/app/settings/password/page.tsx",
  "src/lib/auth.ts",
  "src/lib/member-inputs.ts",
  "src/lib/members.ts",
  "src/lib/supabase/client.ts",
  "src/lib/supabase/members.ts",
] as const;

describe("human authentication removal contract", () => {
  beforeEach(() => redirect.mockReset());

  it("sends the root directly to the console", () => {
    HomePage();
    expect(redirect).toHaveBeenCalledWith("/app");
  });

  it("has no human authentication or member-management routes", () => {
    for (const path of authenticationFiles) {
      expect(existsSync(resolve(webRoot, path)), path).toBe(false);
    }
  });

  it("keeps Supabase credentials server-only and removes member navigation", () => {
    const packageJson = readFileSync(resolve(webRoot, "package.json"), "utf8");
    const nextConfig = readFileSync(resolve(webRoot, "next.config.ts"), "utf8");
    const navigation = readFileSync(resolve(webRoot, "src/components/console-nav.tsx"), "utf8");

    expect(packageJson).not.toContain("@supabase/ssr");
    expect(nextConfig).not.toContain("NEXT_PUBLIC_SOCIAL_AGENT_SUPABASE");
    expect(nextConfig).toContain("agentRules: false");
    expect(navigation).not.toContain("/app/settings/members");
  });
});
