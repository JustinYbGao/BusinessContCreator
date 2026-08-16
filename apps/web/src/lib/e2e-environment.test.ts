import { describe, expect, it } from "vitest";
import { validateE2eEnvironment } from "./e2e-environment";

const valid = {
  supabaseUrl: "http://127.0.0.1:54321",
  baseUrl: "http://127.0.0.1:3000",
  sourceDir: "/workspace/packages/test-support/fixtures/dormchef-source",
  fixtureSourceDir: "/workspace/packages/test-support/fixtures/dormchef-source",
  workerMode: "fixture",
};

describe("E2E environment boundary", () => {
  it("accepts only loopback services and the repository fixture source", () => {
    expect(() => validateE2eEnvironment(valid)).not.toThrow();
  });

  it("rejects a remote Supabase URL", () => {
    expect(() => validateE2eEnvironment({ ...valid, supabaseUrl: "https://example.supabase.co" }))
      .toThrow("E2E_SUPABASE_URL_NOT_LOOPBACK");
  });

  it("rejects an external source directory", () => {
    expect(() => validateE2eEnvironment({ ...valid, sourceDir: "/Users/justingao/Documents/dormchef" }))
      .toThrow("E2E_SOURCE_ROOT_INVALID");
  });

  it("rejects a non-fixture worker or remote browser base URL", () => {
    expect(() => validateE2eEnvironment({ ...valid, workerMode: "production" }))
      .toThrow("E2E_WORKER_MODE_INVALID");
    expect(() => validateE2eEnvironment({ ...valid, baseUrl: "https://example.test" }))
      .toThrow("E2E_BASE_URL_NOT_LOOPBACK");
  });
});
