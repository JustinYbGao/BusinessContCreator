# Authentication Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove human login and membership authorization completely so the configured single-Workspace console opens directly while existing business workflows continue to use server-only data access.

**Architecture:** Replace authenticated user identity with a server-only `InternalWorkspaceContext` containing the configured Workspace ID and a stable system actor UUID for existing audit/write contracts. Migrate console pages and business APIs to that context, then delete login, callback, account, member-management, session proxy, browser Auth, and unused member code. Publisher-device Bearer Token authentication remains because it is a separate machine boundary required by the publication workflow.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase service-role server client, Zod, Vitest, pnpm.

## Global Constraints

- Work only in `/Users/justingao/Documents/SocialMediaAgent/.worktrees/frontend-redesign` on `codex/frontend-redesign`.
- Preserve all existing frontend redesign WIP and make the smallest necessary diff in overlapping files.
- Do not use `git add .` or `git add -A`; stage only files explicitly owned by this change.
- Do not read or print environment files or secrets.
- Do not access DormChef or any Supabase project other than the existing SocialMediaAgent configuration.
- Do not run cloud writes, migrations, migration repair, database reset, local Supabase, or Docker.
- Do not automate the final Xiaohongshu publish click.
- Keep `INTERNAL_WORKSPACE_ID` as the only Workspace selector; requests cannot choose a Workspace.
- Keep service-role credentials server-only.
- Do not push or create a PR.

---

### Task 1: Introduce the unauthenticated Workspace context (TDD)

**Files:**

- Add: `apps/web/src/lib/workspace-context.ts`
- Add: `apps/web/src/lib/workspace-context.test.ts`
- Modify: `apps/web/src/lib/supabase/server.ts`
- Modify: `apps/web/src/lib/publisher-auth.ts`

**Interfaces:**

- Produces: `InternalWorkspaceContext { workspaceId: string; actorId: string }`
- Produces: `WorkspaceLookupPort.exists(workspaceId: string): Promise<boolean>`
- Produces: `requireInternalWorkspace(workspaces, env?): Promise<InternalWorkspaceContext>`
- Produces: `requireServerInternalWorkspace(): Promise<InternalWorkspaceContext>`
- Preserves: generic `HttpError(status, code)` for stable route error mapping.

- [ ] **Step 1: Write the failing Workspace-context tests**

Create tests that exercise real validation logic with a fake lookup:

```ts
const workspaceId = "00000000-0000-4000-8000-000000000001";

it("returns only the configured Workspace and stable system actor", async () => {
  await expect(requireInternalWorkspace(
    { exists: async () => true },
    { INTERNAL_WORKSPACE_ID: workspaceId },
  )).resolves.toEqual({ workspaceId, actorId: INTERNAL_SYSTEM_ACTOR_ID });
});

it("fails closed for missing, malformed, unknown, or unavailable Workspaces", async () => {
  const exists = { exists: async () => true };
  await expect(requireInternalWorkspace(exists, {}))
    .rejects.toMatchObject({ status: 500, code: "WORKSPACE_NOT_CONFIGURED" });
  await expect(requireInternalWorkspace(exists, { INTERNAL_WORKSPACE_ID: "invalid" }))
    .rejects.toMatchObject({ status: 500, code: "WORKSPACE_NOT_CONFIGURED" });
  await expect(requireInternalWorkspace(
    { exists: async () => false },
    { INTERNAL_WORKSPACE_ID: workspaceId },
  )).rejects.toMatchObject({ status: 500, code: "WORKSPACE_NOT_CONFIGURED" });
  await expect(requireInternalWorkspace(
    { exists: async () => { throw new Error("unavailable"); } },
    { INTERNAL_WORKSPACE_ID: workspaceId },
  )).rejects.toMatchObject({ status: 500, code: "WORKSPACE_UNAVAILABLE" });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
corepack pnpm --filter @social-agent/web exec vitest run src/lib/workspace-context.test.ts
```

Expected: FAIL because `workspace-context.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure context**

Implement:

```ts
export const INTERNAL_SYSTEM_ACTOR_ID = "00000000-0000-4000-8000-000000000000";

export interface InternalWorkspaceContext {
  workspaceId: string;
  actorId: string;
}

export async function requireInternalWorkspace(
  workspaces: WorkspaceLookupPort,
  env: WorkspaceEnvironment = runtimeEnvironment,
): Promise<InternalWorkspaceContext> {
  const workspaceId = WorkspaceIdSchema.safeParse(env.INTERNAL_WORKSPACE_ID);
  if (!workspaceId.success) throw new HttpError(500, "WORKSPACE_NOT_CONFIGURED");
  let exists: boolean;
  try {
    exists = await workspaces.exists(workspaceId.data);
  } catch {
    throw new HttpError(500, "WORKSPACE_UNAVAILABLE");
  }
  if (!exists) throw new HttpError(500, "WORKSPACE_NOT_CONFIGURED");
  return { workspaceId: workspaceId.data, actorId: INTERNAL_SYSTEM_ACTOR_ID };
}
```

- [ ] **Step 4: Simplify the server adapter**

Keep `createSupabaseServiceRoleClient()` and `createWorkspaceLookupPort()`.
Delete cookie/session/Auth client creation. Add:

```ts
export function requireServerInternalWorkspace() {
  return requireInternalWorkspace(createWorkspaceLookupPort());
}
```

Move `publisher-auth.ts` to import `HttpError` from `workspace-context.ts` without changing device-token behavior.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
corepack pnpm --filter @social-agent/web exec vitest run src/lib/workspace-context.test.ts
```

Expected: all Workspace-context tests pass.

---

### Task 2: Migrate business pages and APIs to Workspace context (TDD)

**Files:**

- Modify: `apps/web/src/app/app/analytics/page.tsx`
- Modify: `apps/web/src/app/app/campaigns/[campaignId]/page.tsx`
- Modify: `apps/web/src/app/app/campaigns/[campaignId]/topics/page.tsx`
- Modify: `apps/web/src/app/app/campaigns/page.tsx`
- Modify: `apps/web/src/app/app/contents/[contentId]/page.tsx`
- Modify: `apps/web/src/app/app/page.tsx`
- Modify: `apps/web/src/app/app/products/[productId]/assets/page.tsx`
- Modify: `apps/web/src/app/app/products/[productId]/facts/page.tsx`
- Modify: `apps/web/src/app/app/products/page.tsx`
- Modify: `apps/web/src/app/app/publications/[publicationId]/page.tsx`
- Modify: `apps/web/src/app/app/publications/page.tsx`
- Modify: `apps/web/src/app/app/review/page.tsx`
- Modify: `apps/web/src/app/app/settings/publisher-devices/page.tsx`
- Modify: `apps/web/src/app/api/campaigns/[campaignId]/route.ts`
- Modify: `apps/web/src/app/api/campaigns/route.ts`
- Modify: `apps/web/src/app/api/contents/[contentId]/approve/route.ts`
- Modify: `apps/web/src/app/api/contents/[contentId]/generate/route.ts`
- Modify: `apps/web/src/app/api/contents/[contentId]/review/route.ts`
- Modify: `apps/web/src/app/api/contents/route.ts`
- Modify: `apps/web/src/app/api/metrics/import/route.ts`
- Modify: `apps/web/src/app/api/products/[productId]/assets/route.ts`
- Modify: `apps/web/src/app/api/products/[productId]/facts/route.ts`
- Modify: `apps/web/src/app/api/products/[productId]/route.ts`
- Modify: `apps/web/src/app/api/products/[productId]/sources/route.ts`
- Modify: `apps/web/src/app/api/products/[productId]/sync/route.ts`
- Modify: `apps/web/src/app/api/products/route.ts`
- Modify: `apps/web/src/app/api/publications/[publicationId]/metrics/route.ts`
- Modify: `apps/web/src/app/api/publications/[publicationId]/publish/route.ts`
- Modify: `apps/web/src/app/api/publications/[publicationId]/retrospective/route.ts`
- Modify: `apps/web/src/app/api/publications/route.ts`
- Modify: `apps/web/src/app/api/publisher/devices/route.ts`
- Modify: `apps/web/src/app/api/reports/weekly/route.ts`
- Modify: `apps/web/src/app/api/topics/generate/route.ts`
- Modify: `apps/web/src/app/api/topics/select/route.ts`
- Modify: `apps/web/src/lib/analytics-route.ts`
- Modify: `apps/web/src/app/api/analytics-routes.test.ts`
- Modify existing affected API tests only where their mocks name the old server helper.

**Interfaces:**

- Consumes: `requireServerInternalWorkspace(): Promise<{ workspaceId: string; actorId: string }>`.
- Produces: business pages and routes with no session, member, email, or role dependency.

- [ ] **Step 1: Update the existing analytics route test mock first**

Rename its server mock and return the new context:

```ts
requireServerInternalWorkspace: vi.fn(async () => ({
  workspaceId: WORKSPACE_ID,
  actorId: "00000000-0000-4000-8000-000000000000",
})),
```

Keep assertions that request fields cannot override Workspace scope.

- [ ] **Step 2: Run the affected route tests and verify RED**

```bash
corepack pnpm --filter @social-agent/web exec vitest run src/app/api/analytics-routes.test.ts src/app/api/core-crud.test.ts
```

Expected: FAIL because production routes still import/call `requireServerInternalAdmin`.

- [ ] **Step 3: Migrate every business caller**

For each page/route:

```ts
import {
  createSupabaseServiceRoleClient,
  requireServerInternalWorkspace,
} from ".../lib/supabase/server";

const context = await requireServerInternalWorkspace();
```

Replace `identity.workspaceId` with `context.workspaceId` and
`identity.userId` with `context.actorId`. Preserve every query, RPC, status
transition, validation rule, error code, and final-publish boundary.

Change generic error imports from `lib/auth` to `lib/workspace-context`.
Do not alter `requirePublisherDevice()` or publisher device-token scoping.

- [ ] **Step 4: Verify no business caller references the old guard**

```bash
rg -n "requireServerInternalAdmin|requireServerMemberAdmin|identity\.(email|role|mustChangePassword)" apps/web/src/app apps/web/src/lib
```

Expected: matches only in authentication/member files scheduled for deletion,
or no matches after Task 3.

- [ ] **Step 5: Run route tests and typecheck**

```bash
corepack pnpm --filter @social-agent/web exec vitest run src/app/api/analytics-routes.test.ts src/app/api/core-crud.test.ts
corepack pnpm --filter @social-agent/web typecheck
```

Expected: tests and typecheck pass for migrated callers.

---

### Task 3: Remove authentication/member surfaces and open the console (TDD)

**Files:**

- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/app/layout.tsx`
- Modify: `apps/web/src/components/console-nav.tsx`
- Modify: `apps/web/src/app/api/route-exports.test.ts`
- Add: `apps/web/src/app/auth-removal-contract.test.ts`
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/playwright.config.ts`
- Modify: `apps/web/e2e/env.ts`
- Delete: `apps/web/src/proxy.ts`
- Delete: `apps/web/src/app/login/**`
- Delete: `apps/web/src/app/auth/callback/route.ts`
- Delete: `apps/web/src/app/api/account/**`
- Delete: `apps/web/src/app/api/members/**`
- Delete: `apps/web/src/app/app/settings/members/**`
- Delete: `apps/web/src/app/app/settings/password/**`
- Delete: `apps/web/src/lib/auth.ts`
- Delete: `apps/web/src/lib/auth.test.ts`
- Delete: `apps/web/src/lib/member-inputs.ts`
- Delete: `apps/web/src/lib/member-inputs.test.ts`
- Delete: `apps/web/src/lib/members.ts`
- Delete: `apps/web/src/lib/members.test.ts`
- Delete: `apps/web/src/lib/supabase/client.ts`
- Delete: `apps/web/src/lib/supabase/members.ts`
- Delete: `apps/web/src/lib/supabase/members.test.ts`
- Delete: `apps/web/src/lib/test-auth-fixture.ts`
- Delete: `apps/web/src/lib/test-auth-fixture.test.ts`
- Delete: `apps/web/e2e/global-setup.ts`

**Interfaces:**

- Consumes: no human authentication interface.
- Produces: `/` redirects to `/app`; the console shell needs only Workspace ID.

- [ ] **Step 1: Write the failing removal contract test**

Test the route behavior and absence contract:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

const webRoot = resolve(import.meta.dirname, "../..");
const AUTH_PATHS = [
  "src/proxy.ts",
  "src/app/login/page.tsx",
  "src/app/auth/callback/route.ts",
  "src/app/api/account/me/route.ts",
  "src/app/api/account/password/route.ts",
  "src/app/api/members/route.ts",
  "src/app/app/settings/members/page.tsx",
  "src/app/app/settings/password/page.tsx",
  "src/lib/auth.ts",
  "src/lib/members.ts",
  "src/lib/supabase/client.ts",
  "src/lib/supabase/members.ts",
];

beforeEach(() => redirect.mockReset());

it("sends the root directly to the console", () => {
  HomePage();
  expect(redirect).toHaveBeenCalledWith("/app");
});

it("has no human authentication routes or proxy", () => {
  for (const path of AUTH_PATHS) {
    expect(existsSync(resolve(webRoot, path)), path).toBe(false);
  }
  expect(readFileSync(resolve(webRoot, "package.json"), "utf8")).not.toContain("@supabase/ssr");
  expect(readFileSync(resolve(webRoot, "next.config.ts"), "utf8")).not.toContain("NEXT_PUBLIC_SOCIAL_AGENT_SUPABASE");
  expect(readFileSync(resolve(webRoot, "src/components/console-nav.tsx"), "utf8")).not.toContain("/app/settings/members");
});
```

Also assert `package.json` does not contain `@supabase/ssr`, `next.config.ts`
does not expose anonymous Supabase credentials, and console navigation does not
contain `/app/settings/members`.

- [ ] **Step 2: Run the contract test and verify RED**

```bash
corepack pnpm --filter @social-agent/web exec vitest run src/app/auth-removal-contract.test.ts
```

Expected: FAIL because the login/member files still exist and `/` is still the
public landing page.

- [ ] **Step 3: Open the root and simplify the shell**

Replace the root page with:

```ts
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/app");
}
```

In the app layout, call `requireServerInternalWorkspace()`, pass only
`workspaceId` to `ConsoleNav`, remove login redirects, email/avatar display,
and the first-login password banner. Render neutral `单工作区控制台` top-bar
copy.

- [ ] **Step 4: Remove authentication-only navigation, routes, code, and E2E setup**

Delete only the files listed in this task. Update `route-exports.test.ts` so it
continues checking representative remaining business route modules rather than
importing deleted account/member routes. Remove Auth global setup and storage
state from Playwright; point readiness at `/`.

- [ ] **Step 5: Remove browser Auth configuration and dependency**

Delete the `env` block exposing `NEXT_PUBLIC_SOCIAL_AGENT_SUPABASE_*` from
`next.config.ts`. Remove only `@supabase/ssr` from `apps/web/package.json` and
the corresponding lockfile entries, preserving the existing Phosphor-icons
WIP dependency.

- [ ] **Step 6: Verify GREEN and scan for residue**

```bash
corepack pnpm --filter @social-agent/web exec vitest run src/app/auth-removal-contract.test.ts src/app/api/route-exports.test.ts
rg -n "ADMIN_EMAIL_ALLOWLIST|signInWith|createSupabaseServerClient|createSupabaseBrowserClient|requireServerInternalAdmin|requireServerMemberAdmin|mustChangePassword|/login|/api/account|/api/members" apps/web/src apps/web/package.json apps/web/next.config.ts
```

Expected: tests pass and the residue scan prints no active human-auth code.

---

### Task 4: Full local verification and running handoff

**Files:**

- Modify only files from Tasks 1–3 if verification reveals a directly related defect.
- Do not modify migrations, cloud state, or unrelated WIP.

- [ ] **Step 1: Run focused and full test gates**

```bash
corepack pnpm --filter @social-agent/web exec vitest run src/lib/workspace-context.test.ts src/app/auth-removal-contract.test.ts src/app/api/route-exports.test.ts src/app/api/analytics-routes.test.ts src/app/api/core-crud.test.ts
corepack pnpm --filter @social-agent/web test
```

- [ ] **Step 2: Run compiler and production build gates**

```bash
corepack pnpm --filter @social-agent/web typecheck
corepack pnpm --filter @social-agent/web build
git diff --check
```

- [ ] **Step 3: Inspect the complete scoped diff and residual references**

Confirm that no unrelated WIP is staged or reverted, no secret is present, and
the existing frontend redesign remains intact.

- [ ] **Step 4: Start and retain the requested development server**

```bash
corepack pnpm --filter @social-agent/web dev --hostname 127.0.0.1 --port 3100
```

Verify with local HTTP requests that `/` redirects to `/app`, `/app` does not
redirect to `/login`, and `/login` returns 404. Leave the dev process running
for the user. Remove only newly generated framework metadata that was absent
from the baseline status, without touching user-owned WIP.

- [ ] **Step 5: Report exact results**

Report modified/deleted files, behavior, actual commands and outputs, unresolved
risks (especially public deployment without auth), the running server URL, and
all remaining staged/unstaged/untracked content.

## Commit boundaries

- Plan only: `docs: plan authentication removal`
- Workspace context and caller migration: `refactor: replace auth with workspace context`
- Route/UI/dependency removal: `refactor: remove console authentication`
- Do not include unrelated frontend redesign WIP in any commit.
