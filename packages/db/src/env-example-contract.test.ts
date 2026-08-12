import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const envExample = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");

describe("SocialMediaAgent environment example", () => {
  it("uses only project-scoped Supabase variable names", () => {
    expect(envExample).toContain("SOCIAL_AGENT_SUPABASE_URL=");
    expect(envExample).toContain("SOCIAL_AGENT_SUPABASE_ANON_KEY=");
    expect(envExample).toContain("SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY=");
    expect(envExample).not.toMatch(/(^|\n)(NEXT_PUBLIC_)?SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY)=/);
  });
});
