import { resolve } from "node:path";

export type E2eEnvironmentValues = {
  supabaseUrl?: string;
  baseUrl?: string;
  sourceDir: string;
  fixtureSourceDir: string;
  workerMode: string;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function assertLoopbackUrl(value: string | undefined, code: string): void {
  if (!value) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(code);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(hostname)) throw new Error(code);
}

export function validateE2eEnvironment(values: E2eEnvironmentValues): void {
  assertLoopbackUrl(values.supabaseUrl, "E2E_SUPABASE_URL_NOT_LOOPBACK");
  assertLoopbackUrl(values.baseUrl, "E2E_BASE_URL_NOT_LOOPBACK");
  if (resolve(values.sourceDir) !== resolve(values.fixtureSourceDir)) throw new Error("E2E_SOURCE_ROOT_INVALID");
  if (values.workerMode !== "fixture") throw new Error("E2E_WORKER_MODE_INVALID");
}
