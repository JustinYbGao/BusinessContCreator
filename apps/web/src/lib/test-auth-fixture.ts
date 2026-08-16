export type TestAuthFixtureEnvironment = {
  NODE_ENV?: string;
  ALLOW_TEST_AUTH_FIXTURE?: string;
};

export function assertTestAuthFixtureEnabled(env: TestAuthFixtureEnvironment): void {
  if (env.NODE_ENV !== "test" || env.ALLOW_TEST_AUTH_FIXTURE !== "1") throw new Error("E2E_AUTH_FIXTURE_DISABLED");
}
