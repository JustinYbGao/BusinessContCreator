# Guided Product Intake and Generation Design

## Summary

Replace the current backend-shaped first-use experience with a guided, no-login
product intake flow. A user can provide one public product page, a written
description, and up to ten product images. The system extracts a proposed
product understanding, asks the user to edit and confirm it, then creates the
existing Product/Fact/Asset/Campaign records, shows three distinct topic
choices, and generates one complete Xiaohongshu draft from the selected topic.

The flow reuses the existing fact, topic, content, review, visual, job, and
publication boundaries. It does not add registration, automate the final
Xiaohongshu publish action, start the separately planned Stage 1 Task 9, crawl
an entire website, or add image OCR/vision understanding.

## User Goal

The user should not need to understand Product, Campaign, Topic Candidate,
Content Version, or Workflow Job records. The visible mental model is:

1. Provide product material.
2. Confirm what the Agent understood.
3. Choose one of three content directions.
4. Receive a complete draft and seven-page storyboard; rendered page images
   remain behind the existing review boundary.

The application remains an unauthenticated local internal console. It must not
be exposed to the public internet in this state.

## Current-State Problems

- The selected `Stage 1 Test Workspace` contains automated test artifacts. Its
  dashboard currently reports large review and publication queues that do not
  belong to the user.
- The web UI can list Products and add facts only after a Product already
  exists. Product and Campaign creation exist as APIs but not as normal user
  flows.
- Product sources support only `manual` and `dormchef_local`; there is no
  general public-page reader or user image upload route.
- Topic generation already accepts `recentTopics` and scores `repetition`, but
  the Worker loads topics only from the current Campaign and trusts the model's
  self-reported repetition score.
- Web and Worker processes are started separately, so a running web UI can
  enqueue work that no Worker consumes.

## Scope

### Included

- A three-step guided intake at `/app/create`.
- Public single-page website extraction with server-side SSRF protections.
- Written product description input.
- PNG, JPEG, and WebP upload with preview, sanitization, and bounded storage.
- An editable product-understanding draft before any database write.
- Creation of existing Product, Channel, Product Source, Product Fact, Asset,
  Campaign, audit, and Workflow Job records without a schema migration.
- Three user-facing topic choices followed by generation of one content draft.
- A same-Product 15-day short-term topic/content memory.
- A single local development command that starts the web application and the
  existing Worker against the same environment.
- Empty-state and recovery UX suitable for a clean Workspace.

### Excluded

- Login, registration, account recovery, or member management.
- Whole-site crawling, sitemap traversal, authenticated page access, browser
  cookie import, or JavaScript application rendering.
- OCR, screenshot interpretation, or multimodal model calls. Uploaded images
  are reusable source assets, not evidence extracted by a vision model.
- Vector embeddings or a vector database.
- Automatic fact approval without an explicit user confirmation action.
- Automatic approval of generated content.
- Automatic clicking of the final Xiaohongshu publish button.
- Deleting or rewriting the existing 110 test-workspace tasks.
- Implementing the separately planned Stage 1 Task 9.
- Applying a Supabase migration or changing migration history.

## Workspace Isolation

The existing test Workspace remains untouched. Before a real end-to-end smoke
test, `INTERNAL_WORKSPACE_ID` must be changed to an existing, newly created,
empty Workspace row in `SocialMediaAgent-stage1` (`cvjrpzhvoxbmcmlqylor`). The
application continues to fail closed when the configured Workspace does not
exist.

Creating that Workspace is a one-time operational step and is not hidden in a
page load. The implementation must not auto-create a Workspace merely because
an environment variable is missing or unknown. No cloud write or smoke test is
performed without separate explicit authorization.

## User Experience

### Entry and Empty State

`/app` keeps the existing dashboard for Workspaces with real content. A clean
Workspace with no Product shows a prominent primary action, `开始创建内容`,
which opens `/app/create`. The navigation also exposes `创建内容` so a user can
add another Product later without returning to an empty state.

### Step 1: Provide Product Material

The page presents one focused form with:

- optional public product-page URL;
- optional written description, up to 8,000 characters;
- optional content goal, up to 1,000 characters;
- up to ten local image files.

At least one of URL or written description is required. Images alone are not
enough because v1 does not interpret image contents. Accepted image types are
PNG, JPEG, and WebP. Each image is at most 8 MiB and the total upload is at most
40 MiB.

Selected images are previewed locally with remove controls and accessible file
names. They remain in browser memory during extraction and are not uploaded or
written to the database before confirmation.

The action label is `读取并整理产品资料`, not `创建 Product`.

### Step 2: Confirm the Agent's Understanding

The extraction response is rendered as editable fields:

- product name;
- product positioning;
- target audience;
- brand voice;
- requested content direction;
- candidate facts, each with statement, category, source label, and an enabled
  checkbox;
- uploaded images and one optional representative website image, each with an
  `允许用于内容` checkbox.

Every fact remains visibly traceable to either the supplied URL or the user's
description. The user may edit, disable, or add a fact. Nothing is persisted
until the user presses `确认理解并生成选题`.

The browser retains the input and extraction draft in component state only.
Refreshing before confirmation intentionally discards the draft. This avoids a
new temporary-intake table and cleanup process in v1.

### Step 3: Choose a Topic and Generate

After confirmation, the application creates the durable product material,
creates an internal seven-day Campaign, and queues the existing topic job. The
page polls the job state and then displays only the three diverse topics chosen
by the existing deterministic selector. The other six candidates stay in the
database for auditability but are not shown as primary choices.

Each visible topic shows a human title, angle, and short evidence summary. It
must not expose raw UUIDs, contribution maps, database statuses, or internal
error codes in the primary UI.

The user selects one topic and presses `生成完整小红书图文`. The server creates
the Content/Brief through the existing scope checks and queues generation. The
page polls until a Content Version exists, then navigates to the existing
content detail page for title, body, hashtags, interaction prompt, and seven
page scripts. Human review and manual final publishing remain unchanged.

## Architecture and API Boundaries

### Client Intake State

A client component owns the uncommitted URL, description, goal, File objects,
local preview URLs, and extraction draft. File object URLs are revoked when a
file is removed or the component unmounts.

### `POST /api/intake/extract`

This JSON endpoint accepts URL, description, and content goal. It performs no
database or Storage write. It returns an `IntakeDraft` containing the editable
profile, candidate facts, source labels, and an optional representative-image
URL.

The endpoint uses the existing OpenAI-compatible LLM client with a strict
structured-output schema. Page text, metadata, and the user's description are
serialized as untrusted data. The system prompt explicitly states that source
content is evidence, never instructions. Facts must quote or narrowly
paraphrase supplied evidence; unsupported facts are rejected from the result.

### `POST /api/intake/commit`

This multipart endpoint accepts the confirmed structured draft and selected
image files. It validates all fields again on the server. It then:

1. creates a Product and active Xiaohongshu Channel;
2. stores the URL as an existing `manual` Product Source locator, avoiding a
   new enum value and database migration;
3. inserts confirmed facts and records the confirmation actor/time;
4. sanitizes and uploads selected images, then inserts verified source Asset
   records marked public-use allowed;
5. creates a seven-day Campaign using the confirmed audience and content goal;
6. appends scoped audit events;
7. enqueues `generate_topics` and returns Product, Campaign, and Job IDs.

The operation uses existing tables and RPC boundaries. Where the current
database cannot make Storage plus relational writes atomic, the route tracks
objects and rows created by the request and performs scoped compensating
cleanup on failure. Cleanup never targets a Workspace, bucket, prefix broader
than the current Product, or any pre-existing object.

### `GET /api/intake/status`

This read-only endpoint accepts the returned Product/Campaign/Job IDs and
returns a user-facing phase:

- `extracting` is client-local and never returned by this endpoint;
- `generating_topics`;
- `topics_ready` with exactly three selected topic summaries;
- `generating_content`;
- `content_ready` with the Content ID;
- `failed` with a stable safe error code and user message.

All lookups require the configured Workspace and verify Product/Campaign/Job
scope. Polling occurs every two seconds and stops after two minutes. Timeout is
not treated as job failure; the page offers `继续等待` and the durable job can
be resumed after reload.

### `POST /api/intake/generate`

This JSON endpoint accepts Campaign ID and one of the three selected Topic IDs.
It rejects an unselected or cross-scope Topic. It creates the existing Content
and Brief idempotently, enqueues `generate_content`, and returns Content and Job
IDs. It does not approve, package, publish, or render a final platform action.

Shared domain functions should be extracted from existing route modules rather
than calling one Next.js route from another. Next route files continue to
export only framework-safe HTTP handlers.

## Website Retrieval Safety

The public-page reader applies these fixed limits:

- only `http:` and `https:` URLs;
- exactly one submitted page, with at most three redirects;
- ten-second total fetch timeout;
- two MiB maximum response body;
- `text/html` response type only;
- at most 50,000 characters of normalized visible text passed to extraction;
- no scripts, forms, cookies, credentials, browser session, sitemap, linked-page
  crawl, or JavaScript rendering.

Before every request and redirect, the server resolves the host and rejects
loopback, private, link-local, multicast, reserved, and metadata-service IPv4
and IPv6 ranges. Redirect targets receive the same validation. A hostname that
resolves to any forbidden address is rejected. Requests do not forward user
headers or Supabase/LLM credentials.

The representative image is limited to an absolute public HTTP(S) URL found in
standard page metadata. It is not downloaded during extraction. If the user
selects it during confirmation, the commit endpoint re-runs address and
redirect validation, enforces the image limits, decodes it as an allowed image
type, sanitizes it, and only then uploads it.

## Image Processing and Storage

Every selected image is decoded rather than trusted by extension or declared
MIME type. Metadata is stripped during re-encoding. Invalid, animated,
unsupported, oversized, or undecodable files are rejected with a per-file
message. A failed file does not silently disappear or cause other files to be
treated as confirmed.

Content-addressed object keys use the current Product scope and SHA-256 digest,
for example `source/{productId}/{sha256}.png`. The server never accepts an
object key from the browser. Duplicate bytes within the same Product reuse the
same object rather than creating additional copies.

Uploaded images are `source` Assets. They become `verified` and
`public_use_allowed` only because the human explicitly selected them on the
confirmation screen. V1 does not derive facts from their pixels.

## Fifteen-Day Short-Term Memory

The memory is Product-scoped and uses existing records:

- up to 50 Topic titles and angles created during the previous 15 days across
  all Campaigns for the Product;
- up to 20 recent generated Content Version title/body summaries during the
  same period;
- eligible performance Learnings continue through the existing separate
  mechanism.

The Worker passes this history to topic generation as untrusted context and
instructs the model not to repeat a recent subject, angle, hook, or structure.
The existing `repetition` score remains an explainable ranking penalty but is
not the only guard.

After model output, a deterministic guard normalizes case, punctuation, and
whitespace and compares Chinese/Latin character bigrams for the combined title
and angle. It rejects:

- an exact normalized title match;
- a candidate with Dice similarity of 0.72 or higher to recent history;
- a candidate with Dice similarity of 0.72 or higher to an earlier candidate
  in the same new batch.

If fewer than three candidates survive, generation retries once and includes
the rejected normalized title/angle pairs as negative examples. If fewer than
three survive again, no rejected candidate is committed and the job fails with
`RECENT_TOPIC_DIVERSITY_UNAVAILABLE`. The UI translates this to: `最近 15 天的
内容方向已经比较集中，请调整本次内容目标后重试。`

Content older than 15 days is not blocked and may be revisited with a new
angle. No embedding model, vector index, or new persistence table is added.

## Local Runtime

The repository adds one local development command that starts the web server on
`127.0.0.1:3100` and the existing Worker using the same
`apps/web/.env.local`. The launcher does not print environment values and
forwards termination signals to both children.

User intake does not enqueue `sync_product`, so local startup must not require
or access a DormChef source directory. If an unsupported legacy sync job is
encountered without its separately authorized adapter configuration, it fails
closed with a configuration error. This change does not read DormChef or start
the separately planned Stage 1 Task 9.

Real extraction and generation require:

- `LLM_BASE_URL`;
- `LLM_API_KEY`;
- `LLM_MODEL`.

Fixture LLM output is allowed only in automated tests and explicit fixture
mode. The normal local user flow must never present fixture text as real Agent
output.

## Error and Recovery UX

- Website fetch failure with a non-empty description: retain all input, show
  the fetch issue, and allow description-only extraction.
- Website fetch failure without a description: keep the form and request a
  reachable URL or description.
- LLM timeout/unavailability: keep URL, text, files, and previews; offer retry.
- Validation failure: attach a Chinese message to the exact field or file.
- Commit failure: show that nothing was finalized after scoped compensation;
  preserve client input so the user can retry.
- Topic/content job failure: show a human message and stable retry action;
  technical codes may appear only in a collapsed diagnostic detail.
- Poll timeout: allow continued polling or returning later; do not enqueue a
  duplicate job.
- Page reload after durable commit: recover through Product/Campaign/Job IDs in
  the URL and scoped status endpoint.

## UI and Accessibility

The implementation uses the current warm editorial design tokens and console
components. It does not add a second component framework or generic shadcn
theme. The desktop flow uses one centered working surface; mobile stacks inputs,
previews, facts, and topic cards in reading order.

Requirements include semantic labels, keyboard-operable remove/selection
controls, visible focus, `aria-live` progress/error announcements, text labels
in addition to color, and descriptive image alt text based on the original file
name until the user edits it.

## Testing Strategy

All behavior is implemented test-first.

### Unit Tests

- URL protocol, DNS/address classification, redirect revalidation, timeout,
  content type, body limit, and visible-text truncation.
- Intake input and structured extraction result validation.
- Image count, individual/total size, MIME/decode checks, normalization, digest,
  and object-key construction.
- Fifteen-day cutoff, Product scoping, history caps, exact-title rejection,
  bigram similarity threshold, within-batch duplicates, single retry, and
  diversity failure.
- Local launcher environment forwarding without value logging and clean child
  termination.

### Route and Component Tests

- Extraction performs no database or Storage write.
- Commit creates only confirmed facts/assets and compensates scoped partial
  writes on failure.
- Intake status rejects cross-scope identifiers and returns only three selected
  topics.
- Generate accepts one selected Topic and is idempotent.
- Input combinations: URL only, description only, and URL plus description and
  images.
- Client state preservation after errors, accessible progress, image removal,
  fact editing/selection, topic selection, and empty Workspace CTA.
- Next route export safety after adding intake handlers.

### Verification

- Run focused Vitest tests during each red/green cycle.
- Run the complete web, Worker, topic-engine, content-engine, and relevant
  package tests.
- Run package typechecks and the web production build.
- Run `git diff --check` and inspect the final diff for unrelated WIP.
- Perform no cloud write smoke test until separately authorized. After
  authorization, use only `SocialMediaAgent-stage1`
  (`cvjrpzhvoxbmcmlqylor`) with a clean Workspace and never run migrations,
  migration repair, database reset, local Supabase, or Docker.

## Acceptance Criteria

- A clean Workspace opens with a clear `开始创建内容` action rather than an
  empty backend dashboard.
- URL-only, description-only, and combined input reach an editable extraction
  draft without a database write.
- Up to ten valid images preview locally and only confirmed images are stored.
- Confirmation creates the durable product material and queues topic
  generation without exposing backend entities to the user.
- Exactly three distinct topic choices are displayed; choosing one produces one
  durable generated draft that opens in the content detail UI.
- Topics that duplicate the same Product's previous 15-day history are rejected
  deterministically, with one bounded retry.
- Existing test records are neither deleted nor shown after the application is
  pointed at the new clean Workspace.
- One documented local command starts both required processes without printing
  secrets.
- No login/registration, image understanding, whole-site crawl, schema
  migration, Stage 1 Task 9 implementation, or final publish click is added.
