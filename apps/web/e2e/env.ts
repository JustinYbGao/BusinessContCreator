import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const E2E_ROOT = resolve(__dirname, "../../..");
export const E2E_ENV_FILE = resolve(E2E_ROOT, ".env.test.local");
export const E2E_STORAGE_STATE = resolve(E2E_ROOT, "test-results/stage1-storage-state.json");

const ENV_KEYS = new Set([
  "SOCIAL_AGENT_SUPABASE_URL",
  "SOCIAL_AGENT_SUPABASE_ANON_KEY",
  "SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY",
  "INTERNAL_WORKSPACE_ID",
  "ADMIN_EMAIL_ALLOWLIST",
  "DORMCHEF_SOURCE_DIR",
  "SOCIAL_AGENT_WORKER_MODE",
  "WORKER_HEALTH_PORT",
  "E2E_BASE_URL",
  "E2E_TEST_EMAIL",
  "ALLOW_TEST_AUTH_FIXTURE",
]);

function parseValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadE2eEnvironment(path = process.env.SOCIAL_AGENT_TEST_ENV_FILE || E2E_ENV_FILE): void {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match || !ENV_KEYS.has(match[1]!)) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) process.env[key] = parseValue(rawValue ?? "");
  }
}

export function requiredE2eEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`E2E_ENV_${name}_NOT_CONFIGURED`);
  return value;
}

export function testEmail(): string {
  const explicit = process.env.E2E_TEST_EMAIL?.trim();
  if (explicit) return explicit;
  const firstAllowed = process.env.ADMIN_EMAIL_ALLOWLIST?.split(",").map((value) => value.trim()).find(Boolean);
  return firstAllowed || "stage1-e2e@example.com";
}
