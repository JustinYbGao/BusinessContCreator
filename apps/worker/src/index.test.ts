import { describe, expect, it } from "vitest";
import { parseWorkerEnvironment } from "./index.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";

function environment(): NodeJS.ProcessEnv {
  return {
    SOCIAL_AGENT_SUPABASE_URL: "https://stage1.example.invalid",
    SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture",
    INTERNAL_WORKSPACE_ID: workspaceId,
    DORMCHEF_SOURCE_DIR: "/tmp/fixture-source",
    LLM_BASE_URL: "https://llm.example.invalid",
    LLM_API_KEY: "llm-fixture",
    LLM_MODEL: "fixture-model",
    WORKER_HEALTH_PORT: "3011",
  };
}

describe("worker environment", () => {
  it("parses only the SocialMediaAgent worker configuration", () => {
    expect(parseWorkerEnvironment(environment())).toEqual({
      supabaseUrl: "https://stage1.example.invalid",
      serviceRoleKey: "service-role-fixture",
      workspaceId,
      dormChefSourceDir: "/tmp/fixture-source",
      llm: {
        LLM_BASE_URL: "https://llm.example.invalid",
        LLM_API_KEY: "llm-fixture",
        LLM_MODEL: "fixture-model",
      },
      healthPort: 3011,
      workerId: undefined,
    });
  });

  it("fails closed when a required worker setting is absent", () => {
    const values = environment();
    delete values.SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY;
    expect(() => parseWorkerEnvironment(values)).toThrow("WORKER_CONFIG_MISSING");
  });
});
