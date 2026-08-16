import { describe, expect, it } from "vitest";
import { assertTestAuthFixtureEnabled } from "./test-auth-fixture";

describe("test auth fixture guard", () => {
  it("allows the fixture only in an explicit test environment", () => {
    expect(() => assertTestAuthFixtureEnabled({ NODE_ENV: "test", ALLOW_TEST_AUTH_FIXTURE: "1" })).not.toThrow();
  });

  it("rejects production or opt-out environments", () => {
    expect(() => assertTestAuthFixtureEnabled({ NODE_ENV: "production", ALLOW_TEST_AUTH_FIXTURE: "1" }))
      .toThrow("E2E_AUTH_FIXTURE_DISABLED");
    expect(() => assertTestAuthFixtureEnabled({ NODE_ENV: "test", ALLOW_TEST_AUTH_FIXTURE: "0" }))
      .toThrow("E2E_AUTH_FIXTURE_DISABLED");
  });
});
