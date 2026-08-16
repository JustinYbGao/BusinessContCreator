import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultWorkspaceId = "00000000-0000-4000-8000-000000000001";
const defaultTestEmail = "stage1-e2e@example.com";

const ENV_KEYS = [
  "SOCIAL_AGENT_SUPABASE_URL",
  "SOCIAL_AGENT_SUPABASE_ANON_KEY",
  "SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY",
  "INTERNAL_WORKSPACE_ID",
  "ADMIN_EMAIL_ALLOWLIST",
  "DORMCHEF_SOURCE_DIR",
  "SOCIAL_AGENT_WORKER_MODE",
  "WORKER_HEALTH_PORT",
  "ALLOW_TEST_AUTH_FIXTURE",
  "E2E_TEST_EMAIL",
  "SOCIAL_AGENT_XHS_FIXTURE_PATH",
];

function normalizeKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findStatusValue(value, aliases) {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStatusValue(entry, aliases);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (aliases.has(normalizeKey(key)) && typeof entry === "string" && entry.trim()) return entry.trim();
  }
  for (const entry of Object.values(value)) {
    const found = findStatusValue(entry, aliases);
    if (found !== undefined) return found;
  }
  return undefined;
}

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    const candidates = [
      objectStart >= 0 && objectEnd > objectStart ? [objectStart, objectEnd] : undefined,
      arrayStart >= 0 && arrayEnd > arrayStart ? [arrayStart, arrayEnd] : undefined,
    ].filter(Boolean).sort((left, right) => left[0] - right[0]);
    const candidate = candidates[0];
    if (!candidate) throw new Error("SUPABASE_STATUS_NOT_JSON");
    return JSON.parse(trimmed.slice(candidate[0], candidate[1] + 1));
  }
}

export function parseSupabaseStatus(text) {
  const status = extractJson(text);
  const url = findStatusValue(status, new Set(["apiurl", "supabaseurl"]));
  const anonKey = findStatusValue(status, new Set(["anonkey", "anonpublickey"]));
  const serviceRoleKey = findStatusValue(status, new Set(["servicerolekey", "servicekey"]));
  if (!url || !anonKey || !serviceRoleKey) throw new Error("SUPABASE_STATUS_MISSING_REQUIRED_VALUES");
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("SUPABASE_STATUS_URL_INVALID");
  }
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "");
  if (parsedUrl.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
    throw new Error("SUPABASE_STATUS_NON_LOOPBACK_URL");
  }
  return { url, anonKey, serviceRoleKey };
}

function requiredUuid(value, name) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

function requiredPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("WORKER_HEALTH_PORT_INVALID");
  return String(port);
}

function envValue(value) {
  return JSON.stringify(value);
}

function outputPathFromArgs(args) {
  if (args.length > 0) throw new Error("ENV_OUTPUT_FIXED");
  return resolve(repositoryRoot, ".env.test.local");
}

async function readLocalStatus() {
  try {
    const result = await execFileAsync("pnpm", ["exec", "supabase", "status", "--output", "json"], {
      cwd: repositoryRoot,
      maxBuffer: 1024 * 1024,
    });
    return parseSupabaseStatus(result.stdout);
  } catch {
    throw new Error("SUPABASE_STATUS_FAILED");
  }
}

async function writeEnvFile(outputPath, values) {
  const outputDirectory = dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(resolve(outputDirectory, ".social-agent-env-"));
  const temporaryPath = resolve(temporaryDirectory, "env");
  try {
    const body = `${ENV_KEYS.map((key) => `${key}=${envValue(values[key])}`).join("\n")}\n`;
    await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function buildValues(status) {
  const testEmail = process.env.E2E_TEST_EMAIL?.trim() || defaultTestEmail;
  const workspaceId = requiredUuid(process.env.INTERNAL_WORKSPACE_ID?.trim() || defaultWorkspaceId, "INTERNAL_WORKSPACE_ID");
  const fixtureSourcePath = resolve(repositoryRoot, "packages/test-support/fixtures/dormchef-source");
  const xhsFixturePath = resolve(repositoryRoot, "packages/test-support/fixtures/xhs-editor.html");
  return {
    SOCIAL_AGENT_SUPABASE_URL: status.url,
    SOCIAL_AGENT_SUPABASE_ANON_KEY: status.anonKey,
    SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    INTERNAL_WORKSPACE_ID: workspaceId,
    ADMIN_EMAIL_ALLOWLIST: process.env.ADMIN_EMAIL_ALLOWLIST?.trim() || testEmail,
    DORMCHEF_SOURCE_DIR: fixtureSourcePath,
    SOCIAL_AGENT_WORKER_MODE: "fixture",
    WORKER_HEALTH_PORT: requiredPort(process.env.WORKER_HEALTH_PORT?.trim() || "3001"),
    ALLOW_TEST_AUTH_FIXTURE: "1",
    E2E_TEST_EMAIL: testEmail,
    SOCIAL_AGENT_XHS_FIXTURE_PATH: xhsFixturePath,
  };
}

function printHelp() {
  console.log("Usage: node scripts/write-local-supabase-env.mjs");
  console.log("Reads local Supabase status without printing credentials and writes a mode-600 env file.");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    printHelp();
    return;
  }
  const outputPath = outputPathFromArgs(args);
  const values = buildValues(await readLocalStatus());
  await writeEnvFile(outputPath, values);
  console.log(`Wrote ${relative(repositoryRoot, outputPath) || "."} with ${ENV_KEYS.length} allowlisted variables.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "ENV_WRITE_FAILED";
    console.error(message);
    process.exitCode = 1;
  });
}
