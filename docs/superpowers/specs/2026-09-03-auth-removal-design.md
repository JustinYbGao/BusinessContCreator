# Authentication Removal Design

**Date:** 2026-09-03
**Status:** Approved for implementation
**Base:** `codex/frontend-redesign` at `f581fe4`

## Goal

Turn the current pre-launch application into a single-workspace console with no
login, session, membership, role, or password-management flow. Opening the local
site should enter the console directly so the existing product, content,
review, publication-preparation, and analytics workflows can be evaluated.

Authentication will be designed again as a separate future project. This
change must not preserve a misleading partial authorization layer.

## Scope

Remove:

- the login page and Supabase Auth callback;
- account identity and password endpoints;
- member-management pages and endpoints;
- membership authorization guards and server Auth client usage;
- login redirects, first-login password prompts, member navigation, and
  authentication-specific tests;
- authentication and membership business code that has no remaining caller.

Keep:

- the existing editorial frontend redesign and all current business routes;
- the service-role server client used for workspace business data;
- server-only credentials and the browser/service-role boundary;
- one configured Workspace selected only through `INTERNAL_WORKSPACE_ID`;
- the prohibition on automatically clicking Xiaohongshu's final publish
  button;
- the existing member database migration and migration history unchanged.

## Architecture

Replace authenticated identity resolution with a narrow server-only workspace
context:

```ts
interface InternalWorkspaceContext {
  workspaceId: string;
}
```

`requireInternalWorkspace()` validates that `INTERNAL_WORKSPACE_ID` is a UUID
and that the Workspace exists. It returns only `workspaceId`; requests cannot
select another Workspace. It uses the existing service-role database client
and does not inspect cookies, sessions, users, allowlists, or memberships.

Server pages and business API routes that currently consume
`requireServerInternalAdmin()` will consume the workspace context instead.
Existing request validation, business rules, stable error responses, audit
behavior, and human publishing boundary remain unchanged unless they currently
depend only on the deleted authentication feature.

## Routing and UI

The root route redirects directly to `/app`. `/app` renders the existing
console shell without loading a user identity. The top bar uses neutral
single-workspace copy and no user avatar or email. Navigation removes member
management and password-management destinations.

The former `/login`, `/auth/callback`, `/app/settings/members`, and
`/app/settings/password` routes are deleted rather than redirected or retained
as dead screens. They may return the framework's normal 404 response.

## API behavior

Business APIs remain available without authentication and stay scoped to the
configured Workspace on the server. Request bodies and query strings cannot
override the Workspace.

Authentication-only APIs under `/api/account/*` and `/api/members/*` are
deleted. This design does not add registration, invitation, account creation,
password reset, or a replacement identity mechanism.

## Security boundary

This is intentionally an unauthenticated application and must not be deployed
to a public network in this state. The server continues binding locally for the
requested development workflow. Service-role credentials remain server-only;
no secret or privileged client is added to browser code.

The Workspace context still fails closed when the configured Workspace is
missing, malformed, unavailable, or unknown. Removing authentication does not
remove Workspace isolation.

## Testing and verification

Implementation follows TDD:

1. Add failing tests for workspace-context validation and request-independent
   Workspace selection.
2. Add a failing route/module contract test proving authentication-only routes
   and navigation are absent and the root enters `/app`.
3. Implement the workspace context and migrate existing business callers.
4. Delete authentication/member code only after references have been removed.
5. Run focused tests, full web tests, web typecheck, production build, and
   `git diff --check`.
6. Start the development server on `127.0.0.1:3100` and verify `/` reaches the
   console without visiting `/login`.

No cloud writes, migration operations, local Supabase, Docker, push, PR, or
remote repository operations are part of this work.

## Success criteria

- `http://127.0.0.1:3100/` enters the console without login or Auth cookies.
- Existing business pages and APIs use only the server-configured Workspace.
- Login, callback, account password, and member-management surfaces no longer
  exist in the application route tree.
- Production build contains no active application authentication or membership
  authorization path.
- Existing frontend redesign WIP and business behavior remain intact.
