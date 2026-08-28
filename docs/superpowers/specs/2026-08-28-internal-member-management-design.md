# Internal Member Management and One-Click Onboarding Design

**Date:** 2026-08-28
**Status:** Proposed for review
**Base:** `codex/frontend-redesign` at `ec04559`

## Goal

Make Stage 1 internal onboarding feel like a product workflow rather than a
developer setup task. An authorized administrator should be able to open the
existing SocialMediaAgent console, enter a teammate's email and a temporary
initial password, and create an application account without editing an
environment variable or opening the Supabase dashboard for every new member.

The first implementation is a small member-management area inside the
existing console. It is not a separate operations portal or a full identity
platform.

## Current problem

The login page currently calls `signInWithOtp` with `shouldCreateUser: false`,
so it supports Magic Link only. Application authorization is then checked by
the server against `ADMIN_EMAIL_ALLOWLIST` and `INTERNAL_WORKSPACE_ID` in
`apps/web/src/lib/auth.ts`. Creating a Supabase Auth user therefore does not
grant application access, and adding every new email requires developer-level
configuration work.

Authentication and application authorization are separate concerns:

- Supabase Auth proves the user's identity.
- A SocialMediaAgent membership grants access to a specific Workspace.
- A membership role controls whether the user may manage other members.

## Product decisions

### Recommended approach

Use a database-backed membership model and expose it through
`/app/settings/members` in the existing console. Keep the current environment
allowlist only as a temporary bootstrap path for the first owner during the
rollout; it must not be the normal way to onboard additional users.

This is preferable to retaining the allowlist because it removes per-user
deployment configuration. A separate admin application is unnecessary for the
Stage 1 dogfood group and would duplicate authentication and visual shell
work.

### Account creation experience

An owner or admin selects **添加成员**, enters:

- email address;
- optional display name;
- temporary initial password;
- role: `member` or `admin`.

The server normalizes the email, creates or reuses the Supabase Auth user,
creates the Workspace membership, and returns a success summary without
returning a password or service credential. The initial password is never
stored by the application, written to an Audit Event, or printed in logs.
The member signs in with email and password and is required to change the
temporary password on first login.

Magic Link remains available as a fallback for existing users, but it does not
auto-create unknown users. Public self-signup is out of scope.

### Member lifecycle

The first version supports:

- list members with email, display name, role, status, and last sign-in time;
- create a member;
- change `member`/`admin` role;
- revoke and restore application access;
- issue a password-reset flow without exposing an existing password.

The owner cannot be removed by an admin. A revoked membership must prevent new
console requests even if the Auth user still exists. Revocation should also
invalidate active sessions through the supported Supabase Admin Auth operation
when the implementation is added.

## Data model

Add a migration for a `public.workspace_members` table with:

- `id uuid primary key`;
- `workspace_id uuid not null references public.workspaces(id)`;
- `user_id uuid not null references auth.users(id)`;
- normalized `email text not null` for display and lookup;
- optional `display_name text`;
- `role text not null` constrained to `owner`, `admin`, or `member`;
- `status text not null` constrained to `active` or `revoked`;
- `must_change_password boolean not null default false`;
- `created_at`, `updated_at`, and nullable `revoked_at` timestamps.

Enforce uniqueness for `(workspace_id, user_id)` and for the normalized email
within a Workspace. `user_id` is authoritative for authorization; the email
column is not used as an identity claim after the Auth user is resolved.

Enable RLS on the table and do not expose it to browser clients in Stage 1.
All reads and writes go through server-side code using the service-role client
after the current request has been authenticated and authorized. The service
role key remains server-only.

## Authorization flow

1. Read the current Supabase Auth user from the server session.
2. Resolve the user's active membership for the configured Workspace.
3. Return `401` when no session exists and `403` when no active membership
   exists.
4. Allow member-level console pages for `owner`, `admin`, and `member`.
5. Allow member-management routes only for `owner` and `admin`.
6. Derive Workspace scope from the server identity; request bodies cannot
   select a different Workspace.

During rollout, the existing allowlisted owner may access the console long
enough to create the first `owner` membership. After that record is verified,
normal authorization uses the membership table. Removing the bootstrap
allowlist is a separate deployment decision and must not involve migration
repair or history edits.

## Server boundaries

Add server-only member operations with narrow responsibilities:

- `listMembers()` returns safe display fields only;
- `createMember()` validates email, temporary password, role, and idempotency;
- `updateMemberRole()` prevents unauthorized owner changes;
- `revokeMember()` changes membership status and handles session invalidation;
- `requestPasswordReset()` delegates to the supported Supabase Auth flow.

The browser calls application routes or Server Actions. It never calls
Supabase Admin Auth directly and never receives the service-role key. Auth user
creation and membership creation require compensating cleanup if one side
succeeds and the other fails; duplicate requests must resolve to one member,
not create duplicate Auth users or memberships.

## Login changes

Replace the single Magic Link form with two explicit options:

- primary: email + password via `signInWithPassword`;
- secondary: Magic Link for an already-created account with
  `shouldCreateUser: false`.

After a successful password login, route users with
`must_change_password = true` to a password-change screen before allowing
normal console work. The password-change operation updates Supabase Auth and
clears only the membership flag; it does not write the password anywhere in
the SocialMediaAgent database.

## Console UI

Add **设置 → 成员管理** to the existing navigation. The page contains:

- a prominent **添加成员** action;
- a compact form with email, display name, role, and temporary password;
- a table of active and revoked members;
- clear status labels and destructive-action confirmation;
- no Supabase project identifiers, credentials, or raw Auth responses.

The page follows the existing warm editorial console design and remains
responsive at the current mobile breakpoint. It does not expose a final
Xiaohongshu publish action.

## Audit and error behavior

Record `member.created`, `member.role_changed`, `member.revoked`, and
`member.restored` events with Workspace, actor, target member ID, and safe
metadata. Never include passwords, reset tokens, service credentials, or raw
Auth responses.

Use stable errors:

- `400` for invalid email, password, role, or request shape;
- `401` for missing authentication;
- `403` for non-admin membership or revoked access;
- `404` for an unknown member within the current Workspace;
- `409` for duplicate or conflicting member creation;
- `502`/`500` for an Auth or database dependency failure without leaking
  provider details.

## Security and rollout constraints

- Use only the SocialMediaAgent-stage1 Supabase project
  (`cvjrpzhvoxbmcmlqylor`).
- Do not use `user_metadata` for authorization.
- Do not expose or print any secret, service-role key, password, or token.
- Do not add public self-registration.
- Do not repair migration history, reset the database, or change unrelated
  migrations.
- Apply a future membership migration only after reviewing its SQL and getting
  explicit deployment authorization.
- Keep the manual human Xiaohongshu publish boundary unchanged.

## Alternatives considered

1. **Keep the environment allowlist.** Minimal code, but every new user still
   requires developer configuration and a process restart/deployment.
2. **Build a separate admin portal.** Strong separation, but unnecessary
   duplication for a single-workspace Stage 1 dogfood product.
3. **Add member management inside the current console.** Recommended: one
   product surface, database-backed authorization, and a direct onboarding
   workflow with limited scope.

## Implementation and verification plan

After this design is approved, implementation should proceed in this order:

1. Add failing unit tests for membership authorization, email normalization,
   duplicate creation, revoked access, and temporary-password handling.
2. Add the membership migration and server repository/auth boundary.
3. Add admin-only member routes and the console page.
4. Add password login and first-login password change while preserving Magic
   Link fallback.
5. Run web typecheck, tests, production build, and focused database checks
   against only the authorized project.
6. Use a real internal account to verify create → login → change password →
   revoke, then document the result before any cloud rollout.

## Success criteria

The design is successful when an active owner can create a new internal member
from the console using only the member's email and a temporary password, with
no manual environment-variable edit or Supabase Dashboard step. The new
member can sign in, change the temporary password, access only the configured
Workspace, and lose access after revocation. Existing data workflows,
workspace scoping, migration-history safeguards, and the human publishing
boundary remain intact.
