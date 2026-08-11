import { describe, expect, it } from "vitest";
import { requireIntegrationEnvironment } from "./integration-environment.js";

describe("integration environment", () => {
  it("rejects missing explicit cloud credentials instead of falling back to a local stack", () => {
    expect(() => requireIntegrationEnvironment({})).toThrow("SOCIAL_AGENT_SUPABASE_URL");
  });

  it("returns explicitly supplied cloud API credentials", () => {
    expect(requireIntegrationEnvironment({
      SOCIAL_AGENT_SUPABASE_URL: "https://example.supabase.co",
      SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY: "service-key",
      SOCIAL_AGENT_SUPABASE_ANON_KEY: "anon-key",
    })).toEqual({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-key",
      anonKey: "anon-key",
    });
  });

  it("rejects a localhost URL even when credentials are supplied", () => {
    expect(() => requireIntegrationEnvironment({
      SOCIAL_AGENT_SUPABASE_URL: "http://127.0.0.1:54321",
      SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY: "service-key",
      SOCIAL_AGENT_SUPABASE_ANON_KEY: "anon-key",
    })).toThrow("must be an HTTPS Supabase Cloud URL");
  });
});
