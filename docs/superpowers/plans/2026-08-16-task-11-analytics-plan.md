
# Task 11 Analytics, Publication Registration, and Retrospectives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Complete the Stage 1 measurement loop by recording human publication results, importing audited 24h/72h/7d metrics, generating evidence-qualified retrospectives, and persisting reproducible weekly reports and eligible Learnings.

**Architecture:** Keep analytics calculations and import parsing pure in a new @social-agent/analytics package. Keep persistence behind the existing service-role repository boundary and add three narrowly scoped Postgres RPCs so publication registration, weekly-report replacement, and Learning creation each write their audit event in the same transaction. Expose the loop through Workspace-scoped Next.js routes and the existing internal console shell; no route fetches Xiaohongshu and no route controls the final publish action.

**Tech Stack:** TypeScript, pnpm workspaces, Zod, Vitest, Next.js 16 route handlers/server components, Supabase Postgres RPCs, and the existing @social-agent/db repository ports.

## Global Constraints

- Work only in /Users/justingao/Documents/SocialMediaAgent/.worktrees/task-11-analytics on codex/task-11-analytics; leave the main workspace .DS_Store, .pnpm-store/, and docs/ untouched.
- Every route calls requireServerInternalAdmin() and derives workspaceId from the server-side identity; request bodies never choose a Workspace.
- Every mutation uses a service-role repository/RPC and writes an Audit Event in the same database transaction.
- Use only Supabase project SocialMediaAgent-stage1 with ref cvjrpzhvoxbmcmlqylor; never inspect or query any other project.
- Do not access DormChef files or its Supabase, and do not run tests that traverse packages/dormchef-adapter.
- Do not run local Supabase, Docker, supabase start, supabase stop, or supabase db reset.
- Do not run migration repair, rewrite migration history, push, create a PR, print secrets, or commit any secret.
- Do not automate or expose a Xiaohongshu final-publish click; the console may record that a human published a prepared package.
- Accepted publication URLs are HTTPS URLs with exactly www.xiaohongshu.com or xhslink.com as the host; paths and query strings are retained and never fetched.
- Metric imports are all-or-nothing after parsing and validation; unknown columns, duplicate headers, malformed rows, limits, mixed scope, and invalid windows reject the entire import before one database write.
- A publication has at most one snapshot for each of 24h, 72h, and 7d; re-importing a valid window replaces it through the existing idempotent RPC.
- Rates return null when their required denominator is missing or non-positive; views never substitute for impressions.
- Retrospective confidence is hypothesis for fewer than ten comparable published samples and directional for ten or more; no stronger label is introduced.
- Direct, self-reported, and inferred conversion observations stay separate in storage, calculations, API responses, and UI.
- No raw imported file, service-role key, access token, local path, or secret appears in responses, audit payloads, or logs.
- Cloud verification occurs only after local tests pass and uses a command-level 15-second timeout for cloud latency; production behavior is unchanged.

## File Map

Create:

- packages/analytics/package.json
- packages/analytics/tsconfig.json
- packages/analytics/src/metrics.ts
- packages/analytics/src/import.ts
- packages/analytics/src/baseline.ts
- packages/analytics/src/retrospective.ts
- packages/analytics/src/weekly-report.ts
- packages/analytics/src/index.ts
- packages/analytics/src/analytics.test.ts
- packages/db/src/weekly-reports.ts
- packages/db/src/analytics-repositories.test.ts
- supabase/migrations/0015_task11_analytics.sql
- apps/web/src/app/api/publications/[publicationId]/publish/route.ts
- apps/web/src/app/api/publications/[publicationId]/metrics/route.ts
- apps/web/src/app/api/publications/[publicationId]/retrospective/route.ts
- apps/web/src/app/api/metrics/import/route.ts
- apps/web/src/app/api/reports/weekly/route.ts
- apps/web/src/app/api/analytics-routes.test.ts
- apps/web/src/app/app/publications/[publicationId]/page.tsx
- apps/web/src/app/app/analytics/page.tsx

Modify:

- apps/web/package.json to declare @social-agent/analytics.
- pnpm-lock.yaml only as required by the new workspace package.
- packages/db/src/index.ts for Task 11 domain records and repository ports.
- packages/db/src/publications.ts for registration and analytics reads.
- packages/db/src/metrics.ts for typed campaign/publication snapshot reads.
- packages/db/src/learnings.ts to call create_learning instead of a direct insert.

Task 12 remains responsible for the broader end-to-end release surface. Task 11's analytics page is a small operational view that reuses the current console shell.

---

### Task 1: Create the pure analytics package and nullable rate calculations

Files:

- Create: packages/analytics/package.json
- Create: packages/analytics/tsconfig.json
- Create: packages/analytics/src/metrics.ts
- Create: packages/analytics/src/index.ts
- Test: packages/analytics/src/analytics.test.ts
- Modify: apps/web/package.json

Interfaces:

- Produces MetricWindow, MetricValues, ConversionObservation, MetricImportRow, DerivedRates, calculateRates(), and summarizeConversions().
- Does not import Supabase, filesystem APIs, HTTP clients, or environment variables.

- [ ] Step 1: Write failing tests

Add tests that expect:

    calculateRates({
      impressions: 200, views: 100, likes: 10, saves: 5,
      comments: 3, shares: 2, followersGained: 4,
    })

to return viewThroughRate 0.5 with denominator impressions, like/save/comment/share/follower rates 0.1/0.05/0.03/0.02/0.04 with denominator views, and engagementRate 0.2. Add a test with impressions null and views 100; viewThroughRate must be null, never views divided by views. Add a conversion test with firstOpen/direct/high count 2, activation/self_reported/medium count 5, and coreAction/inferred/low count 11; summarizeConversions must return direct 2, selfReported 5, inferred 11.

- [ ] Step 2: Run the focused test

Run:

    pnpm --dir packages/analytics test -- analytics.test.ts

Expected: FAIL because the package and exports do not exist.

- [ ] Step 3: Add package files and schemas

Create packages/analytics/package.json with type module, export src/index.ts, build/typecheck/lint scripts using tsc -p tsconfig.json, test using vitest run, and zod version ^4.0.0. Create tsconfig.json extending ../../tsconfig.base.json with rootDir src and outDir dist. Add @social-agent/analytics: workspace:* to apps/web/package.json and run pnpm install --lockfile-only.

In metrics.ts define:

    MetricWindow = "24h" | "72h" | "7d"
    MetricValues = {
      impressions: number | null; views: number | null;
      likes: number; saves: number; comments: number;
      shares: number; followersGained: number;
    }
    ConversionEvent = "firstOpen" | "activation" | "coreAction" | "retainedUser"
    Attribution = "direct" | "self_reported" | "inferred"
    ConversionObservation = {
      event: ConversionEvent; count: number; attribution: Attribution;
      confidence: "high" | "medium" | "low"; note?: string;
    }
    MetricImportRow = {
      workspaceId: string; productId: string; publicationId: string;
      window: MetricWindow; metrics: MetricValues;
      productConversion: ConversionObservation[]; capturedAt: string;
    }

Export strict Zod schemas for the nested values and row. UUID fields use z.string().uuid(), timestamps use z.string().datetime({ offset: true }), and counts are integer/non-negative.

- [ ] Step 4: Implement the minimal functions

Export:

    type DerivedRate = {
      value: number | null;
      denominator: "impressions" | "views";
    };
    type DerivedRates = Record<
      "viewThroughRate" | "likeRate" | "saveRate" | "commentRate" |
      "shareRate" | "followerRate" | "engagementRate",
      DerivedRate
    >;
    function calculateRates(metrics: MetricValues): DerivedRates;
    function summarizeConversions(observations: ConversionObservation[]): {
      direct: number; selfReported: number; inferred: number;
    };

Use six-decimal rounding after division, return null for a null/non-positive denominator, and compute engagement as (likes + saves + comments + shares) / views. Never mutate input.

- [ ] Step 5: Export and verify

Export metrics.ts values from index.ts. Run:

    pnpm --dir packages/analytics test
    pnpm --dir packages/analytics typecheck

Expected: primitive tests pass.

- [ ] Step 6: Commit

    git add packages/analytics apps/web/package.json pnpm-lock.yaml
    git commit -m "feat: add analytics metric primitives"

---

### Task 2: Add the bounded JSON/manual/RFC-4180 import parser

Files:

- Create: packages/analytics/src/import.ts
- Modify: packages/analytics/src/index.ts
- Test: packages/analytics/src/analytics.test.ts

Interfaces:

- Produces parseMetricImport(input): ParsedMetricImport.
- ParsedMetricImport is format, filenameSha256, rows, and errors.
- A non-empty errors array is a hard stop; callers never write a partial result.

- [ ] Step 1: Write failing parser tests

Cover: one UTF-8 BOM, quoted commas, quoted newlines, unknown columns, duplicate headers, formula-like values beginning with =, +, -, or @, invalid second rows, duplicate publication/window pairs, byte limits, and row limits. Assert invalid input returns rows: [] and an error code. Use fixed UUIDs and a fixed now value.

Example CSV header must be exactly:

    workspaceId,productId,publicationId,window,capturedAt,impressions,views,likes,saves,comments,shares,followersGained,productConversion

A quoted productConversion cell must parse to an observation whose note preserves both the comma and embedded newline.

- [ ] Step 2: Run tests

Run pnpm --dir packages/analytics test -- analytics.test.ts. Expected: FAIL because parseMetricImport is absent.

- [ ] Step 3: Implement the parser contract

Define:

    IMPORT_LIMITS = { maxBytes: 1_000_000, maxRows: 1_000 }

    type ImportError = {
      code: "IMPORT_TOO_LARGE" | "ROW_LIMIT_EXCEEDED" | "INVALID_JSON" |
        "INVALID_CSV" | "UNKNOWN_COLUMN" | "DUPLICATE_HEADER" |
        "FORMULA_LIKE_VALUE" | "INVALID_ROW" | "INVALID_UUID" |
        "INVALID_WINDOW" | "INVALID_TIMESTAMP" | "INVALID_METRIC" |
        "INVALID_CONVERSION" | "DUPLICATE_WINDOW";
      row: number; column: string | null; message: string;
    }

    type ParsedMetricImport = {
      format: "manual" | "json" | "csv";
      filenameSha256: string | null;
      rows: MetricImportRow[];
      errors: ImportError[];
    }

    function parseMetricImport(input: {
      format: "manual" | "json" | "csv";
      body: unknown; now?: Date;
    }): ParsedMetricImport

Measure UTF-8 bytes before parsing and return IMPORT_TOO_LARGE with no rows over the limit. Reject over 1,000 data rows. JSON/manual input accepts an array or { rows: unknown[] }. Strip exactly one BOM. Hash textual input bytes; programmatic manual rows return filenameSha256 null.

Implement the CSV scanner character-by-character. Preserve commas/newlines inside quotes, decode doubled quotes, allow only comma/CRLF/LF/end after a closing quote, and reject unterminated quotes. The only allowed headers are the 13 names above. Reject duplicate/unknown headers before row conversion. Reject formula-like trimmed cells without evaluating them. Parse productConversion JSON, normalize timestamps with toISOString(), use now only when capturedAt is absent, validate all rows, detect duplicate publication/window pairs, and return no rows if any error exists.

- [ ] Step 4: Export and verify

Run:

    pnpm --dir packages/analytics test
    pnpm --dir packages/analytics typecheck

Expected: parser boundary tests pass.

- [ ] Step 5: Commit

    git add packages/analytics/src/import.ts packages/analytics/src/index.ts packages/analytics/src/analytics.test.ts
    git commit -m "feat: add bounded metric import parser"

---

### Task 3: Add rolling baselines, retrospectives, and weekly report builders

Files:

- Create: packages/analytics/src/baseline.ts
- Create: packages/analytics/src/retrospective.ts
- Create: packages/analytics/src/weekly-report.ts
- Modify: packages/analytics/src/index.ts
- Modify: packages/analytics/src/analytics.test.ts

Interfaces:

- Produces deterministic baseline, retrospective, due-window, and weekly-report payloads.
- Outputs are JSON-safe and sort IDs for reproducibility.

- [ ] Step 1: Write failing tests

Test that a current publication is excluded from the median, null metrics are skipped rather than treated as zero, fewer than ten comparable samples yield hypothesis, ten yield directional, absent requested snapshot throws EVIDENCE_WINDOW_INCOMPLETE, and due/missing/not-yet-due windows remain distinct.

Use the exact boundary:

    elapsed >= 24 hours for 24h
    elapsed >= 72 hours for 72h
    elapsed >= 7 days for 7d

- [ ] Step 2: Run tests

Run pnpm --dir packages/analytics test -- analytics.test.ts. Expected: FAIL because the builders are absent.

- [ ] Step 3: Implement baseline types and builder

Define ComparableMetricSample with publicationId, productId, campaignId, status in PUBLISHED/MEASURING/RETROSPECTED, publishedAt, and snapshots containing id, window, metrics, productConversion, capturedAt.

Define RollingMedian as window, sampleCount, medians partial by MetricValues key, and sourcePublicationIds.

Implement buildRollingMedian({ currentPublicationId, window, samples }). Filter to the same Product/Campaign, published statuses, non-current IDs, and samples containing the requested window. For each metric discard nulls, sort, and return the middle or two-value average. Missing snapshots never become zero.

- [ ] Step 4: Implement retrospective rules

Define RetrospectiveObservation with code, text, and evidence { kind: metric | snapshot | qualitative; key; value }. Define Retrospective with evidenceWindow, confidence, sampleCount, currentMetrics, currentRates, baseline, separated conversions, sourceSnapshotIds, observations { keep, change, stop }, and eligibleForLearning.

Implement buildRetrospective({ currentPublication, currentSnapshot, comparableSamples, qualitativeObservations }). Throw EVIDENCE_WINDOW_INCOMPLETE when currentSnapshot is null. Use hypothesis below ten baseline samples and directional at ten or more. Emit keep when current is at least 20% above a non-null median and change when at most 20% below. Never create automatic stop from missing data; only explicit qualitative stop observations go into stop. Set eligibleForLearning only when the requested snapshot exists and every observation has evidence.

- [ ] Step 5: Implement weekly report rules

Define WindowState { publicationId, window } and WeeklyReport with weekStart, postsPublished, dueWindows, missingWindows, notYetDueWindows, sourceSnapshotIds, separated conversions, and eligibleLearningIds.

Implement buildWeeklyReport({ weekStart, now, publications, eligibleLearningIds }). Use the exact elapsed durations above, classify missing only when due and absent, sort source snapshot and Learning IDs, sum conversion observations without combining attribution, and throw INVALID_WEEK_START for an invalid calendar date.

- [ ] Step 6: Export, verify, and commit

Export all builders/types from index.ts. Run:

    pnpm --dir packages/analytics test
    pnpm --dir packages/analytics typecheck

Then commit:

    git add packages/analytics/src/baseline.ts packages/analytics/src/retrospective.ts packages/analytics/src/weekly-report.ts packages/analytics/src/index.ts packages/analytics/src/analytics.test.ts
    git commit -m "feat: add analytics baselines and retrospectives"

---

### Task 4: Add the atomic database boundary and typed repositories

Files:

- Create: supabase/migrations/0015_task11_analytics.sql
- Create: packages/db/src/weekly-reports.ts
- Create: packages/db/src/analytics-repositories.test.ts
- Modify: packages/db/src/index.ts
- Modify: packages/db/src/publications.ts
- Modify: packages/db/src/metrics.ts
- Modify: packages/db/src/learnings.ts

Interfaces:

- Produces registerPublished, getAnalytics, listForCampaign, create_learning, createOrReplace, and getByCampaignWeek.
- SQL functions are service_role-only and enforce Workspace/Product/Campaign/Publication scope.
- The analytics package remains independent of Supabase.

- [ ] Step 1: Write failing repository mapping tests

Use a fake db.rpc/db.from and assert registerPublished calls register_publication with p_workspace_id, p_publication_id, p_public_url, p_published_at, p_actor_id, and p_request_id. Assert Learning create calls create_learning and report create calls create_weekly_report. Assert campaign/publication reads include Workspace and Product/Campaign filters.

- [ ] Step 2: Run tests

Run pnpm --dir packages/db test -- analytics-repositories.test.ts. Expected: FAIL at missing methods/interfaces.

- [ ] Step 3: Add exact repository records and ports

Add to packages/db/src/index.ts:

    PublicationAnalyticsRecord extends Publication {
      campaignId: string;
      publicUrl: string | null;
      publishedAt: string | null;
    }

    MetricSnapshotRecord {
      id: string; publicationId: string;
      window: "24h" | "72h" | "7d";
      metrics: unknown; productConversion: unknown;
      importId: string; capturedAt: string;
    }

    CampaignPublicationMetrics extends PublicationAnalyticsRecord {
      snapshots: MetricSnapshotRecord[];
    }

    WeeklyReportRecord {
      id: string; workspaceId: string; productId: string;
      campaignId: string; weekStart: string;
      payload: unknown; sourceSnapshotIds: string[];
    }

Add registerPublished(ctx, id, { publicUrl, publishedAt }) and getAnalytics(ctx, id) to PublicationRepository; add listForCampaign(ctx, productId, campaignId) to MetricRepository; add WeeklyReportRepository.createOrReplace() and getByCampaignWeek(). Keep the old Publication contract unchanged.

- [ ] Step 4: Implement the additive migration

Create 0015_task11_analytics.sql with security definer, set search_path = public, explicit revoke from public/anon/authenticated, and grant only to service_role.

register_publication(uuid, uuid, text, timestamptz, text, text) locks by Workspace and publication ID, rejects missing rows, accepts only the exact HTTPS host allowlist, rejects blank time, rejects blank actors and non-revoked publisher-device IDs, returns an identical already-PUBLISHED row without a new audit event, rejects a conflicting retry, otherwise requires AWAITING_HUMAN_PUBLISH with no device claim, updates status/public_url/published_at, and inserts publication.registered containing only URL and timestamp.

create_weekly_report(uuid, uuid, uuid, date, jsonb, uuid[], text, text) verifies Product/Campaign/Workspace relationships and every source snapshot's scope, upserts the existing unique campaign/week row, and audits weekly_report.created or weekly_report.replaced with counts and IDs only.

create_learning(uuid, uuid, uuid, text, jsonb, text, text) verifies Product/Publication scope and an existing snapshot for the evidence window, parses payload sampleCount, rejects directional below ten and hypothesis at ten or more, inserts Learning plus learning.created in one transaction, and returns an existing row for an identical request ID.

The migration must not modify migration history, call repair/reset, or alter existing migrations.

- [ ] Step 5: Implement repository mappings

In publications.ts map campaign_id/public_url/published_at, implement registerPublished with the RPC args, and implement getAnalytics with a Workspace-filtered query.

In metrics.ts select scoped publications first, then snapshots by resulting IDs; return an empty list without an unscoped query when none match. Map metrics/product_conversion JSON into MetricSnapshotRecord.

In learnings.ts replace the direct table insert with create_learning and preserve listEligible filters. In weekly-reports.ts implement the RPC writer and scoped campaign/week reader; export it from db index.ts.

- [ ] Step 6: Run checks and commit

Run:

    pnpm --dir packages/db test -- analytics-repositories.test.ts
    pnpm --dir packages/db typecheck

Do not run local Supabase or DormChef tests. Then commit:

    git add supabase/migrations/0015_task11_analytics.sql packages/db/src/index.ts packages/db/src/publications.ts packages/db/src/metrics.ts packages/db/src/learnings.ts packages/db/src/weekly-reports.ts packages/db/src/analytics-repositories.test.ts
    git commit -m "feat: add audited analytics persistence boundary"

---

### Task 5: Add workspace-scoped analytics APIs

Files:

- Create: apps/web/src/app/api/publications/[publicationId]/publish/route.ts
- Create: apps/web/src/app/api/publications/[publicationId]/metrics/route.ts
- Create: apps/web/src/app/api/publications/[publicationId]/retrospective/route.ts
- Create: apps/web/src/app/api/metrics/import/route.ts
- Create: apps/web/src/app/api/reports/weekly/route.ts
- Create: apps/web/src/app/api/analytics-routes.test.ts

Interfaces:

- Consumes @social-agent/analytics and @social-agent/db.
- Produces stable JSON responses with Cache-Control: no-store and stable error codes.

- [ ] Step 1: Write failing route contract tests

Test operator-entered URL/time registration with global fetch untouched, no importSnapshots call for mixed Product rows, EVIDENCE_WINDOW_INCOMPLETE with no Learning write, 401/403 auth behavior, and no cross-Workspace weekly report.

- [ ] Step 2: Run tests

Run pnpm --dir apps/web test -- analytics-routes.test.ts. Expected: FAIL because the handlers/helpers are absent.

- [ ] Step 3: Implement publication registration

POST /api/publications/[publicationId]/publish parses only strict publicUrl/publishedAt, calls requireServerInternalAdmin(), derives requestId from x-request-id or a fresh UUID, constructs a user RepositoryContext, and calls SupabasePublicationRepository.registerPublished(). Map input errors to 400, not-found/cross-Workspace to 404, state/conflict/device errors to 409, and unexpected database errors to 500. Return only scoped ID/status/public URL/published time. Never call fetch or an account feed.

- [ ] Step 4: Implement metric read/import routes

GET /api/publications/[publicationId]/metrics calls getAnalytics and listByPublication for the authenticated Workspace, validates raw JSON with analytics schemas, calculates rates, and returns 24h/72h/7d cards with captured/due/missing/not_yet_due state.

POST /api/metrics/import supports JSON strict { productId, rows }, text/csv with productId query parameter, and multipart form with productId plus file. Bound bytes before parsing, call parseMetricImport, reject parser errors with 400, verify every row's Workspace/Product and every publication's scope, then call importSnapshots exactly once with nested RPC rows. Return only importId, acceptedRows, and format.

- [ ] Step 5: Implement retrospective/report routes

POST /api/publications/[publicationId]/retrospective accepts window plus optional qualitative observations, loads scoped campaign samples, calls buildRetrospective, and does not write for incomplete evidence. For eligible output call LearningRepository.create with the exact evidence window and JSON-safe payload, then return retrospective and Learning ID. Transition PUBLISHED to MEASURING before the first retrospective and to RETROSPECTED only after Learning succeeds; retries remain safe.

GET /api/reports/weekly requires productId/campaignId/weekStart query parameters and calls getByCampaignWeek with all scope keys. POST accepts the same values, loads listForCampaign and eligible Learnings, builds the report, and calls createOrReplace once. An unchanged source snapshot set returns the stored report; a changed set replaces it through the RPC.

- [ ] Step 6: Verify and commit

Run:

    pnpm --dir apps/web test -- analytics-routes.test.ts
    pnpm --dir apps/web typecheck

Then commit:

    git add apps/web/src/app/api/publications apps/web/src/app/api/metrics apps/web/src/app/api/reports apps/web/src/app/api/analytics-routes.test.ts
    git commit -m "feat: expose scoped analytics APIs"

---

### Task 6: Add the publication and analytics console views

Files:

- Create: apps/web/src/app/app/publications/[publicationId]/page.tsx
- Create: apps/web/src/app/app/analytics/page.tsx

Interfaces:

- Uses only server-side reads and Task 11 APIs; no service-role client or secret reaches the browser.
- Provides human publication registration, metric-window review, and evidence-separated reports.

- [ ] Step 1: Define acceptance checks

The publication page must show scoped publication ID/status, stored URL/time, a human-result form, all three windows, due/missing/not-yet-due state, nullable rates, separated conversions, and the latest retrospective. The form must not contain a Xiaohongshu publish control.

The analytics page must show Product/Campaign weekly reports, missing windows, medians/sample counts, import status, and eligible Learning IDs. Direct/self-reported/inferred totals must have separate labels and empty/error states must hide raw database errors.

- [ ] Step 2: Implement the publication page

Create a dynamic server component using requireServerInternalAdmin(), querying publications by Workspace plus route ID, snapshots by the same scope, and the latest Learning by Workspace/Product/Publication. Reuse current console card/input styles. Post the publicUrl and operator-entered datetime-local value to the registration route. Show the message: “最终发布仍由人工完成；此处只记录发布结果。” Never render a publish button, browser automation action, object key, cookie, or secret.

- [ ] Step 3: Implement the analytics page

Create a dynamic component under the existing /app layout. Load only the authenticated Workspace's active Products, Campaigns, recent weekly_reports, and metric_imports summaries. Use safe filters/query parameters and render safe empty states such as “暂无报告” and “暂无指标导入”.

- [ ] Step 4: Verify and commit

Run:

    pnpm --dir apps/web typecheck
    pnpm --dir apps/web build

Expected: both pages compile, no automatic publish action exists, and no client bundle imports service-role code. Commit:

    git add apps/web/src/app/app/publications apps/web/src/app/app/analytics
    git commit -m "feat: add analytics console views"

---

### Task 7: Run the complete verification loop and close Task 11

- [ ] Step 1: Run focused local verification

Run:

    pnpm --dir packages/analytics test
    pnpm --dir packages/analytics typecheck
    pnpm --dir packages/db test -- analytics-repositories.test.ts
    pnpm --dir packages/db typecheck
    pnpm --dir apps/web test -- analytics-routes.test.ts
    pnpm --dir apps/web typecheck
    git diff --check

Do not run local Supabase, Docker, or DormChef adapter tests.

- [ ] Step 2: Apply the authorized cloud migration and verify permissions

After local verification passes, use the Supabase plugin with project ref cvjrpzhvoxbmcmlqylor only to apply 0015_task11_analytics.sql. Verify the three functions through information_schema.routines and verify information_schema.routine_privileges shows EXECUTE only for service_role, with no anon/authenticated execution. List migration history only to confirm the new migration is present; never repair the pre-existing special history.

- [ ] Step 3: Run cloud integration with a command-level timeout

Use /private/tmp/social-media-agent-cloud.env without printing it. Load it through a shell mechanism that does not echo values, target only the authorized project, and run the existing packages/db cloud suite with a 15-second command timeout. The timeout is a test/CI setting only; do not change production behavior when cloud latency exceeds it. Do not run DormChef adapter tests.

- [ ] Step 4: Perform final safety review

Run:

    git status --short
    git diff --check
    git log -5 --oneline
    rg -n "fetch\(|playwright|publish.*click|SUPABASE_SERVICE_ROLE_KEY|DORMCHEF" apps/web/src/app/api apps/web/src/app/app/publications packages/analytics packages/db/src supabase/migrations/0015_task11_analytics.sql

Manually confirm no URL fetch, browser publish click, secret value, DormChef path, other-project ref, migration repair, or migration reset was added. Preserve unrelated untracked files in the main workspace.

- [ ] Step 5: Commit only verified Task 11 changes

    git status --short
    git add packages/analytics packages/db/src supabase/migrations/0015_task11_analytics.sql apps/web/src/app/api apps/web/src/app/app/publications apps/web/src/app/app/analytics apps/web/package.json pnpm-lock.yaml
    git commit -m "feat: complete task 11 analytics loop"

Do not stage .DS_Store, .pnpm-store/, docs/, any secret file, or unrelated worktree changes.

## Self-Review Checklist

- Spec coverage: URL registration, operator-supplied time, HTTPS host allowlist, no URL fetch, audited metric import, all-row validation, BOM/quoted CSV/formula-like values, nullable rates, one snapshot per window, rolling medians, separated attribution, due/missing windows, confidence threshold, evidence-qualified Learning, weekly report persistence, route auth/scope, console views, cloud permission checks, and migration-history preservation each have an explicit task.
- Placeholder scan: no placeholder markers or unbounded handling instructions are used; every implementation boundary has a signature, validation rule, or exact command.
- Type consistency: MetricImportRow is parser output; repository import maps it to the existing RPC row fields; ComparableMetricSample consumes typed repository records; Retrospective and WeeklyReport are JSON-safe RPC payloads; route fields use the same names throughout.
- Scope review: all cloud actions are limited to cvjrpzhvoxbmcmlqylor; no local Supabase, DormChef, push, PR, secrets, or final publish automation is part of execution.
