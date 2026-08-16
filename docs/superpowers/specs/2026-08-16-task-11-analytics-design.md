# Task 11 Analytics, Publication Registration, and Retrospectives Design

**Date:** 2026-08-16  
**Status:** Proposed for review  
**Base:** Task 10 commit `9f52fc4` on `codex/task-11-analytics`

## Goal

Complete the Stage 1 measurement loop after a human has published a prepared
Xiaohongshu post. Task 11 will register the public URL and publication time,
accept audited 24-hour/72-hour/7-day metric snapshots, calculate evidence-safe
rates and baselines, generate confidence-qualified retrospectives, and persist
weekly reports and eligible Learnings for future topic generation.

The implementation remains server-side and Workspace-scoped. It does not
contact Xiaohongshu, infer a publication URL from an account feed, automate
publishing, or read DormChef files.

## Non-goals

- No automatic URL discovery, browser scraping, or Xiaohongshu API integration.
- No automatic final publication or comment/reply automation.
- No merging of direct, self-reported, and inferred conversion evidence.
- No dashboard-wide redesign; new screens reuse the existing console shell.
- No generic CSV library or formula evaluator; the importer is a bounded,
  RFC-4180-compatible parser for the declared row schema.
- No migration repair, database reset, or manual migration-history edits.

## Constraints and invariants

1. Every route calls `requireServerInternalAdmin()` and derives the Workspace
   from the server-side identity. Request bodies never choose a Workspace.
2. Every mutation uses the service-role repository/RPC boundary and writes an
   Audit Event in the same transaction.
3. A publication can be registered only from
   `AWAITING_HUMAN_PUBLISH` to `PUBLISHED` with a human actor and no device
   claim. The existing state-machine guard remains authoritative.
4. Accepted publication URLs use HTTPS and exactly one of:
   `www.xiaohongshu.com` or `xhslink.com`. Paths and query strings are retained
   for evidence; redirects and URL fetching are not performed.
5. A metric import is all-or-nothing after parsing and validation. Unknown
   columns, mixed Workspace/Product/Publication scope, malformed rows, limits,
   and invalid windows reject the entire import before any row is written.
6. A publication has at most one snapshot for each of `24h`, `72h`, and `7d`.
   Re-importing a valid window replaces that window through the existing
   idempotent RPC and records a new import/audit record.
7. Rates never silently substitute views for impressions. A rate is `null`
   when its required denominator is missing or non-positive.
8. Retrospectives below ten comparable published samples are
   `hypothesis`; ten or more are `directional`. No stronger confidence label
   is introduced in Stage 1.
9. A Learning stores its evidence window, confidence, source snapshot IDs, and
   explicit `keep`, `change`, and `stop` observations. It is eligible for later
   topic generation only when its supporting window is complete.

## Design decision: atomic Task 11 database boundary

The current `transition_publication` RPC updates the state and
`published_at`, but it cannot atomically persist `public_url`. Directly
transitioning and then updating the URL from a route would create a partial
publication registration path and separate the Audit Event from the URL write.

Task 11 therefore adds:

`supabase/migrations/0015_task11_analytics.sql`

The migration contains narrowly scoped, `service_role`-only functions:

### `register_publication`

```text
register_publication(
  p_workspace_id uuid,
  p_publication_id uuid,
  p_public_url text,
  p_published_at timestamptz,
  p_actor_id text,
  p_request_id text
) -> publications
```

The function validates the URL host/protocol, calls the existing guarded
transition semantics for `AWAITING_HUMAN_PUBLISH -> PUBLISHED`, sets
`public_url` in the same transaction, and appends a
`publication.registered` Audit Event containing only the URL and timestamp.
It rejects a device actor, a cross-Workspace publication, an invalid state,
or an invalid URL. It does not fetch or validate the remote URL's contents.

### `create_weekly_report`

```text
create_weekly_report(
  p_workspace_id uuid,
  p_product_id uuid,
  p_campaign_id uuid,
  p_week_start date,
  p_payload jsonb,
  p_source_snapshot_ids uuid[],
  p_actor_id text,
  p_request_id text
) -> weekly_reports
```

The function verifies the Product/Campaign/Workspace relationship, upserts the
unique `(campaign_id, week_start)` row, and appends a
`weekly_report.created` or `weekly_report.replaced` Audit Event in the same
transaction. The payload is already validated by the analytics package and is
stored as evidence, not executable instructions.

### `create_learning`

```text
create_learning(
  p_workspace_id uuid,
  p_product_id uuid,
  p_publication_id uuid,
  p_evidence_window text,
  p_payload jsonb,
  p_actor_id text,
  p_request_id text
) -> learnings
```

The function verifies the publication scope and persists an evidence-qualified
Learning plus a `learning.created` Audit Event. It does not allow a caller to
mark a hypothesis as directional; the confidence is derived from the sample
count by the analytics service and rechecked by the route.

All three functions revoke execution from `public`, `anon`, and
`authenticated`, and grant it only to `service_role` at the application role
boundary. The migration does not repair or rewrite existing migration history.

## Components

### `packages/analytics`

The package contains pure functions and bounded parsers. It has no Supabase
client, filesystem access, HTTP client, browser page, or secret dependency.

#### `metrics.ts`

Defines the canonical snapshot and conversion types and computes nullable
derived rates:

- view-through rate: `views / impressions`;
- like, save, comment, share, and follower rates: each numerator divided by
  `views`;
- engagement rate: `(likes + saves + comments + shares) / views`.

Each result carries the denominator used and a `null` value when the required
denominator is unavailable. The function never changes the raw imported
values.

#### `import.ts`

Exposes a single parser for manual JSON, JSON file, and RFC-4180 CSV inputs.
The parser:

- strips one UTF-8 BOM;
- supports quoted commas, quotes, and newlines;
- rejects unknown columns and duplicate headers;
- rejects formula-like cell prefixes as plain data (`=`, `+`, `-`, `@`)
  rather than evaluating or normalizing them;
- enforces bounded byte and row limits;
- validates every row before returning any write payload;
- normalizes `window`, UUIDs, timestamps, non-negative integer metrics, and
  nullable denominators;
- preserves explicit attribution confidence for each conversion observation.

The output includes `format`, `filenameSha256`, canonical rows, and a complete
error list. A caller must not call the database repository when errors exist.

#### `baseline.ts`

Builds a rolling median for comparable published samples. Matching uses the
same Product/Campaign and metric window, excludes the current publication, and
uses only non-null values. Missing snapshots are not treated as zero. The
result includes sample count, median values, and the source publication IDs.

#### `retrospective.ts`

Produces separated conversion totals, confidence, and `keep`/`change`/`stop`
observations. Each observation has a stable code, human-readable text, and an
evidence reference to a metric, snapshot, or explicit qualitative input.
Confidence is `hypothesis` for fewer than ten comparable published samples and
`directional` otherwise. The function rejects an attempt to produce an
evidence-qualified Learning without a complete supporting window.

#### `weekly-report.ts`

Groups published Posts by Product and Campaign, calculates due/missing metric
windows based on `published_at`, attaches rolling medians and separated
conversion totals, and returns eligible Learning IDs. A window is due only
after its elapsed duration; a not-yet-due window is not reported as missing.

### `packages/db`

Extend the repository ports without exposing the Supabase client to analytics:

- `SupabasePublicationRepository.registerPublished()` calls
  `register_publication`.
- `SupabaseMetricRepository.listForCampaign()` returns Workspace-scoped
  publications and snapshots needed by the report builder. Existing
  `importSnapshots()` remains the only metric-write entry point.
- `SupabaseLearningRepository.create()` uses `create_learning` rather than a
  direct table insert.
- Add `SupabaseWeeklyReportRepository` with `createOrReplace()` calling
  `create_weekly_report` and `getByCampaignWeek()` for idempotent reads.

Repository mapping returns domain objects and never returns service-role
credentials, storage object keys that are not needed by the console, or local
paths.

### Web API

#### `POST /api/publications/[publicationId]/publish`

Strict body:

```json
{
  "publicUrl": "https://www.xiaohongshu.com/explore/...",
  "publishedAt": "2026-08-16T10:00:00.000Z"
}
```

The route validates identity, Workspace scope, URL, timestamp, and optional
idempotency header, then calls `registerPublished()`. A repeated request with
the same URL/time returns the stored PUBLISHED publication; a conflicting
request returns a state/conflict error. No network request is made to the URL.

#### `GET /api/publications/[publicationId]/metrics`

Returns the scoped publication, its three snapshots, due/missing window state,
and derived rates. It never returns other Products' snapshots.

#### `POST /api/metrics/import`

Accepts a bounded JSON body or a bounded CSV/JSON upload. It parses by content
type, validates all rows, verifies every Publication belongs to the selected
Product and Workspace, then calls `importSnapshots()` once. The response
contains import ID, accepted row count, and a stable summary; it does not echo
raw files or secrets.

#### `POST /api/publications/[publicationId]/retrospective`

Loads the publication's Product/Campaign snapshots and comparable historical
data, builds the retrospective, persists a Learning through the RPC, and
returns the evidence-qualified result. It refuses to create a Learning when
the requested window is incomplete.

#### `GET|POST /api/reports/weekly`

`GET` reads a saved report by Workspace/Product/Campaign/week. `POST` builds a
report from current data and persists it through `create_weekly_report`.
Duplicate `(campaign_id, week_start)` requests are idempotent and return the
stored report when the source snapshot set is unchanged.

### Console pages

`/app/publications/[publicationId]` shows the human-entered URL, publication
time, status, three metric-window cards, missing/due windows, conversion
confidence separation, and the latest retrospective. It exposes no service
credentials and no publish control.

`/app/analytics` shows Product/Campaign weekly reports, import status, missing
windows, medians, and eligible Learning IDs. Direct, self-reported, and
inferred conversion values remain visually and structurally separate.

The pages reuse existing server-side Supabase access and the current console
navigation style; no visual companion is needed for this task.

## Error handling and security

- Invalid body, URL, timestamp, CSV, JSON, header, row count, or byte limit:
  HTTP 400 with stable error code.
- Missing identity or disallowed identity: HTTP 401/403 using existing auth
  helpers.
- Wrong Workspace/Product/Publication scope: HTTP 404/409 without revealing
  whether another Workspace owns the record.
- Wrong publication state or conflicting idempotency: HTTP 409.
- Database/RPC failure: HTTP 500 with a generic code and structured server log
  containing request/Workspace/Product IDs only.
- No raw imported file, access token, local path, or service-role key appears
  in responses or logs.
- All URL allowlists are implemented in both Zod/API code and the registration
  RPC so the database boundary remains fail-closed.

## Verification strategy

### Unit tests

`packages/analytics/src/analytics.test.ts` covers:

- nullable denominator rate calculations and no views-for-impressions fallback;
- BOM, quoted CSV fields, multiline cells, unknown columns, formula-like text,
  row/byte limits, duplicate windows, and all-row validation;
- publication URL allowlist and timestamp normalization;
- rolling medians with nulls and sample exclusion;
- direct/self-reported/inferred conversion separation;
- `hypothesis` below ten samples and `directional` at ten or more;
- due versus not-yet-due versus missing windows;
- reproducible weekly report and Learning payloads.

### Route and repository tests

Add focused tests for auth, Workspace scoping, URL registration state guards,
idempotency, import atomicity, CSV/JSON content types, invalid mixed-scope
rows, missing windows, and no-URL-fetch behavior. Repository tests cover RPC
mapping and conflict errors.

### Authorized cloud verification

After local tests pass, use only Supabase project
`SocialMediaAgent-stage1` (`cvjrpzhvoxbmcmlqylor`) to:

1. Apply `0015_task11_analytics.sql` through the Supabase plugin.
2. Verify migration history contains the new migration without repair/reset.
3. Verify all Task 11 RPCs are denied to `anon`/`authenticated` and granted to
   `service_role` at the application role boundary.
4. Run the existing cloud tenant/integrity suite with the documented elevated
   timeout for Cloud latency and run focused Task 11 integration checks.

No local Supabase, Docker, DormChef Supabase, other Supabase project, push, PR,
or automatic Xiaohongshu publish action is allowed.

## Rollout and rollback

The migration is additive and all new RPCs are service-role-only. Deploy the
Web code only after the migration is applied and permissions are verified. A
code rollback leaves the additive tables/columns and functions in place; a
database rollback is not automatic and must not use migration repair. Any
follow-up rollback requires an explicit reviewed migration.

## Open review points

1. Confirm the three new RPC names/signatures remain acceptable.
2. Confirm `publishedAt` is operator-entered and not inferred from URL metadata.
3. Confirm the 15-second Cloud integration test timeout is a command/CI
   setting rather than a production behavior change.

