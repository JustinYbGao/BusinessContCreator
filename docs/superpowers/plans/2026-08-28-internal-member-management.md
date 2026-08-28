# Internal Member Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Magic-Link-only internal access flow with a database-backed workspace member flow: an owner/admin can create an internal member with an email and temporary password, members can sign in with that password, and authorized operators can manage roles, status, and password resets from the existing console.

**Architecture:** Keep one console and one workspace. `public.workspace_members` is the source of authorization after authentication; the existing email allowlist remains a temporary bootstrap path for the first owner. Browser code can use the anonymous Supabase client only for the user’s own authentication. Server routes use the service-role client for Auth Admin operations, member rows, and audit events. The UI is added under `/app/settings/members`; no separate admin portal is introduced.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth/SSR/Postgres, Supabase service-role server adapter, Zod, Vitest, existing console CSS/components.

## Global Constraints

- Work only in `/Users/justingao/Documents/SocialMediaAgent/.worktrees/frontend-redesign` on `codex/frontend-redesign`.
- Preserve all existing frontend redesign changes and the main-workspace untracked items. Never stage with `git add .` or `git add -A`.
- Only use Supabase project `SocialMediaAgent-stage1` (`cvjrpzhvoxbmcmlqylor`). Never inspect or connect to DormChef or any other Supabase project.
- Do not read, print, copy, persist, or commit secret values. Passwords may exist only in the request-to-Auth-Admin path and must never be logged, stored in `public`, returned in JSON, or included in audit payloads.
- Do not run local Supabase, Docker, `supabase start`, `supabase stop`, or `supabase db reset`.
- Do not repair or edit migration history. Do not apply the new migration to the cloud until a separate explicit authorization is received.
- Do not run cloud write tests in this implementation phase without explicit authorization. Unit tests use fakes; migration verification is static SQL-contract testing.
- Do not push, create a PR, modify a remote repository, or automate the final Xiaohongshu publish click.
- Keep service-role credentials server-only; browser bundles must contain neither the service-role key nor server-only member operations.
- Existing product/content routes should continue to work for active internal members. This slice does not introduce full multi-workspace switching, self-signup, invitation emails, SSO, or a separate super-admin product.

---

## Task 1: Define the member authorization contract first (TDD)

**Files:**

- Modify: `apps/web/src/lib/auth.ts`
- Modify: `apps/web/src/lib/auth.test.ts`
- Modify: `apps/web/src/lib/supabase/server.ts`
- Add: `apps/web/src/lib/supabase/members.ts`

### Steps

- [ ] Add failing tests in `apps/web/src/lib/auth.test.ts` for `requireInternalMember` and `requireInternalMemberAdmin` using fake auth, workspace, and member lookup ports:
  - a matching active row returns `{ userId, email, workspaceId, role, status, mustChangePassword }`;
  - a revoked row fails closed with `MEMBER_REVOKED` and 403;
  - an authenticated user without a row is rejected with `MEMBER_REQUIRED` unless their normalized email is in `ADMIN_EMAIL_ALLOWLIST`;
  - an allowlisted user without a row receives synthetic `owner` bootstrap identity;
  - a member cannot pass the admin guard, while `admin` and bootstrap `owner` can;
  - unavailable member lookup returns a 500 `MEMBERS_UNAVAILABLE` error.
- [ ] Preserve the existing `requireInternalAdmin` contract and its current tests for compatibility, but introduce separate `InternalMemberIdentity`, `MemberLookupPort`, and member guard functions rather than adding role fields to the old return object.
- [ ] Implement member authorization in `auth.ts` with the existing normalized email/workspace checks. Lookup order is: authenticated user, configured workspace, member row, then allowlist bootstrap fallback. A database row always wins over the allowlist, so a revoked allowlisted row cannot bypass revocation.
- [ ] Add `createServerMemberLookupPort()` in `apps/web/src/lib/supabase/members.ts`. It must query only `public.workspace_members` with the service-role client, map snake_case database columns to the member contract, and throw on query failure so the auth guard can fail closed.
- [ ] Update `requireServerInternalAdmin()` in `apps/web/src/lib/supabase/server.ts` to use the member guard while retaining its existing exported name for current routes. Add `requireServerMemberAdmin()` for member-management routes.
- [ ] Run the focused auth tests and confirm the new tests fail before implementation and pass after implementation.

**Verification:** `corepack pnpm --filter @social-agent/web exec vitest run src/lib/auth.test.ts`

## Task 2: Add the workspace member schema and static security contract (TDD)

**Files:**

- Add: `supabase/migrations/20260828_internal_workspace_members.sql`
- Add: `packages/db/src/member-migration-contract.test.ts`

### Steps

- [ ] Write the migration contract test before the SQL implementation. It must read only `supabase/migrations/20260828_internal_workspace_members.sql` and assert the table, constraints, RLS, grants, and indexes listed below.
- [ ] Create `public.workspace_members` with:
  - `id uuid primary key default gen_random_uuid()`;
  - `workspace_id uuid not null references public.workspaces(id) on delete cascade`;
  - `user_id uuid not null references auth.users(id) on delete restrict`;
  - normalized lowercase `email text not null`;
  - nullable `display_name text` with a bounded length;
  - `role text not null default 'member'` constrained to `owner`, `admin`, or `member`;
  - `status text not null default 'active'` constrained to `active` or `revoked`;
  - `must_change_password boolean not null default true`;
  - nullable `created_by uuid references auth.users(id) on delete set null`;
  - `revoked_at timestamptz`, `created_at timestamptz not null default now()`, and `updated_at timestamptz not null default now()`;
  - a check that email is already lowercase and a check keeping `revoked_at` consistent with `status`;
  - unique `(workspace_id, user_id)` and `(workspace_id, email)` constraints.
- [ ] Enable RLS and explicitly revoke table privileges from `anon` and `authenticated`; grant the table only to `service_role`, matching the project’s server-only data access boundary. Do not add browser policies.
- [ ] Add indexes for `(workspace_id, status)` and `(workspace_id, email)` if the unique constraint does not already cover the needed lookup.
- [ ] Do not add Auth users, workspace rows, membership rows, migration-history edits, or cloud-side data changes in this task.
- [ ] Run the contract test without starting local Supabase.

**Verification:** `corepack pnpm --filter @social-agent/db exec vitest run src/member-migration-contract.test.ts`

## Task 3: Build the server-side member service with fake-backed tests (TDD)

**Files:**

- Add: `apps/web/src/lib/member-inputs.ts`
- Add: `apps/web/src/lib/member-inputs.test.ts`
- Add: `apps/web/src/lib/members.ts`
- Add: `apps/web/src/lib/members.test.ts`
- Modify: `apps/web/src/lib/supabase/members.ts`

### Steps

- [ ] Define strict input schemas in `member-inputs.ts`:
  - normalized email;
  - display name trimmed to the UI/database limit;
  - role limited to `admin` or `member` for creation and role changes (the API never accepts `owner`);
  - status limited to `active` or `revoked`;
  - temporary/new password with a documented minimum length of 12 characters, confirmation handled at the browser boundary, and no password included in error text.
- [ ] Write fake-backed tests for a `MemberService` before implementation. Cover:
  - new Auth user creation with `email_confirm: true` and `must_change_password: true` membership insertion;
  - existing Auth user reuse with the explicitly supplied initial password reset, without logging or persisting that password;
  - duplicate active membership rejection;
  - revoked membership rejection from create, requiring the restore action;
  - cleanup of a newly created Auth user if membership insertion fails;
  - owner/admin permission boundaries for creating admins, changing roles, revoking/restoring, and protecting the owner;
  - password reset setting `must_change_password` and emitting an audit event with no password field;
  - role/status mutations emitting only safe audit metadata.
- [ ] Define narrow ports in `members.ts` so the business logic is testable without Supabase:
  - `MemberStore` for list/find/insert/update-role/update-status/mark-password-changed;
  - `AuthAdminPort` for find/create/update-password/delete-user;
  - `AuditPort` for append-only safe event payloads.
- [ ] Implement `MemberService` with normalized email and actor context. Rules are explicit: owner may manage admins and members; admin may manage members only; neither may create/promote another owner; an owner cannot be role-changed or revoked. A create request for an already existing Auth user intentionally resets that user to the supplied temporary password, because the form labels it as the initial/reset password action.
- [ ] Ensure the service never includes password values in thrown errors, returned records, audit payloads, or structured logs. If a newly created Auth user cannot be paired with a membership row, call `deleteUser` for that newly created user and return a generic `MEMBER_CREATE_FAILED` error.
- [ ] Implement Supabase adapters in `apps/web/src/lib/supabase/members.ts` using the server-only service-role client and Auth Admin API. Map database errors to stable service errors; do not expose raw Postgres or Auth responses to the browser.
- [ ] Run the focused input/service tests.

**Verification:** `corepack pnpm --filter @social-agent/web exec vitest run src/lib/member-inputs.test.ts src/lib/members.test.ts`

## Task 4: Add member and account API boundaries (TDD)

**Files:**

- Add: `apps/web/src/app/api/members/route.ts`
- Add: `apps/web/src/app/api/members/[memberId]/route.ts`
- Add: `apps/web/src/app/api/members/[memberId]/password/route.ts`
- Add: `apps/web/src/app/api/account/me/route.ts`
- Add: `apps/web/src/app/api/account/password/route.ts`
- Add: `apps/web/src/app/api/members-routes.test.ts`
- Add: `apps/web/src/app/api/account-routes.test.ts`

### Steps

- [ ] Write route-boundary tests around injected guards/service fakes or exported pure handlers. Verify that request `workspaceId`, actor email, and actor role are never trusted; all three come from the authenticated server identity.
- [ ] Implement `GET /api/members` with `requireServerMemberAdmin()`, workspace-scoped listing, safe fields only, and `Cache-Control: no-store`.
- [ ] Implement `POST /api/members` with `{ email, displayName?, role, temporaryPassword }`. Validate the body with `member-inputs.ts`, pass the authenticated identity as actor context, and return a safe member record. Use stable error codes for validation, duplicate, permission, and unavailable cases.
- [ ] Implement `PATCH /api/members/[memberId]` with either `{ role }` or `{ status }`, never both. Route to the service permission checks. Protect owner rows and do not permit an `owner` role in request bodies.
- [ ] Implement `POST /api/members/[memberId]/password` with `{ temporaryPassword }` for explicit resets. It must never echo the password and must set `must_change_password`.
- [ ] Implement `GET /api/account/me` with the current member identity and `mustChangePassword` flag so the login UI can route a first login to the password page.
- [ ] Implement `POST /api/account/password` for the current session only. Validate matching new/confirmation passwords, call the SSR client’s authenticated `auth.updateUser`, then clear `must_change_password` for the current workspace/user through the service-role member store. Never accept a target user ID.
- [ ] Preserve the existing error mapping style (`HttpError`, stable `code`, generic user-facing response) and never return service-role/Auth raw errors.
- [ ] Run API boundary tests without cloud writes.

**Verification:** `corepack pnpm --filter @social-agent/web exec vitest run src/app/api/members-routes.test.ts src/app/api/account-routes.test.ts`

## Task 5: Make password login primary while retaining Magic Link fallback (TDD)

**Files:**

- Modify: `apps/web/src/app/login/page.tsx`
- Add: `apps/web/src/app/app/settings/password/page.tsx`
- Add: `apps/web/src/app/app/settings/password/password-form.tsx`
- Modify: `apps/web/src/app/app/layout.tsx`
- Add or extend: `apps/web/src/app/login/login-model.test.ts`

### Steps

- [ ] Add model tests for the login result/error mapping before changing the component: password sign-in success, invalid credentials, Magic Link fallback, and account-status lookup failure.
- [ ] Update the login form to make email/password sign-in the primary action using `signInWithPassword`. Keep a clearly secondary “发送 Magic Link” action using `signInWithOtp({ shouldCreateUser: false })`; do not add self-signup.
- [ ] After password sign-in, request `/api/account/me` with no-store caching and route to `/app/settings/password` when `mustChangePassword` is true, otherwise `/app`. If the status request is unavailable, route to `/app` and let the authenticated layout show the required-password banner.
- [ ] Add the password-change page and form. Require new password plus confirmation, call `POST /api/account/password`, show generic errors, and route back to `/app` on success. Never display or store a password outside the password input state and request body.
- [ ] Update the authenticated layout to show a persistent, non-blocking first-login banner with a link to `/app/settings/password` while `mustChangePassword` is true. Keep the page available to all active members; do not introduce pathname-dependent middleware logic in this slice.
- [ ] Preserve the current internal-access copy, visual language, callback route, and no-final-publish boundary. Add no browser-side service-role code.
- [ ] Run login model tests, then the full web test suite.

**Verification:** `corepack pnpm --filter @social-agent/web test`

## Task 6: Add the in-console member management UI

**Files:**

- Add: `apps/web/src/app/app/settings/members/page.tsx`
- Add: `apps/web/src/app/app/settings/members/member-manager.tsx`
- Modify: `apps/web/src/components/console-nav.tsx`
- Modify: `apps/web/src/app/globals.css`

### Steps

- [ ] Build the server page using `requireServerMemberAdmin()` and the server member store. Render the current workspace’s safe member records; include a synthetic bootstrap owner row when the allowlisted owner has not yet been persisted.
- [ ] Build the client manager with:
  - a compact add-member form for email, optional display name, role, and temporary password plus confirmation;
  - a member table/list showing email, name, role, status, created time, and password-change-required state;
  - role change, revoke, restore, and reset-password actions with busy/error/success state;
  - explicit copy that the temporary password is handed to the member once and is never shown again by the console;
  - owner protection and capability-aware controls so an admin cannot manage admins or the owner.
- [ ] Add `/app/settings/members` to the secondary console navigation without changing existing navigation targets.
- [ ] Add only scoped member/password/settings styles to the existing `globals.css`; preserve the user’s current frontend redesign styles and avoid unrelated formatting changes.
- [ ] Verify keyboard labels, focusable controls, `role="alert"`/`role="status"`, disabled states, and responsive behavior at the existing console breakpoints.
- [ ] Run the web typecheck and build. Remove only generated framework files if the build creates untracked metadata; do not remove user-owned files.

**Verification:** `corepack pnpm --filter @social-agent/web typecheck && corepack pnpm --filter @social-agent/web build`

## Task 7: Full local verification and handoff checkpoint

**Files:**

- Modify only if needed to correct tests/types: files from Tasks 1–6
- Do not modify migration history or unrelated user files.

### Steps

- [ ] Run the focused tests again after integration:
  - `corepack pnpm --filter @social-agent/web exec vitest run src/lib/auth.test.ts src/lib/member-inputs.test.ts src/lib/members.test.ts src/app/api/members-routes.test.ts src/app/api/account-routes.test.ts src/app/login/login-model.test.ts`
  - `corepack pnpm --filter @social-agent/db exec vitest run src/member-migration-contract.test.ts`
- [ ] Run the full local gates: `corepack pnpm --filter @social-agent/web test`, `corepack pnpm --filter @social-agent/db test`, `corepack pnpm --filter @social-agent/web typecheck`, and `corepack pnpm --filter @social-agent/web build`.
- [ ] If a dev server is needed for a read-only smoke check, use the existing feature-worktree command on `127.0.0.1:3100`; do not run cloud write tests, local Supabase, or Docker. Confirm `/login` renders and no service-role key appears in the client bundle or rendered page.
- [ ] Run `git diff --check`, inspect the complete diff, and verify that existing frontend edits remain unstaged unless explicitly selected for this feature.
- [ ] Record that the new migration has only passed static contract tests and has not been applied to `SocialMediaAgent-stage1`. Stop before cloud apply and request separate authorization.
- [ ] Only after all verification passes, prepare a concise handoff stating the local feature status, the migration apply decision still pending, and the exact files/commit boundaries.

## Cloud rollout is a separate, explicitly authorized step

The implementation stops before cloud mutation. If and only if the user later explicitly authorizes applying this new migration to `SocialMediaAgent-stage1` (`cvjrpzhvoxbmcmlqylor`), first re-read the current Supabase skill guidance, verify the project ref, inspect the migration SQL and local contract results, and apply only `20260828_internal_workspace_members.sql`. Then run narrowly scoped cloud read/write verification only for this feature, report the results, and leave migration history untouched except for the normal apply record. Never run repair, reset, or any command against another project.

## Commit boundaries

- Plan commit: `docs: plan internal member management` (this file only).
- Task 1–2 commit: `feat: add workspace member authorization schema`.
- Task 3–4 commit: `feat: add internal member management service`.
- Task 5–6 commit: `feat: add password login and member console`.
- Verification fixes, if any, must be isolated and named after the tested behavior. Do not include the existing unrelated frontend redesign changes, generated files, `.DS_Store`, `.pnpm-store/`, or `docs/` from the main worktree.
