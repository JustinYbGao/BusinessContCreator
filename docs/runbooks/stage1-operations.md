# Stage 1 operations runbook

Stage 1 is an internal dogfood workflow. The operating boundary is a single workspace and a single SocialMediaAgent Supabase project.

## Standard journey

On Monday, review the prior week's report and eligible Learnings before selecting the next three topics. During the week, approve content only after blocking findings are corrected and record the human publish handoff. Enter the 24-hour, 72-hour, and 7-day windows as they become due; on the weekly review day, generate the retrospective and carry forward only evidence-qualified Learnings.

1. Open the internal console and select a campaign.
2. Sync the approved fixture/source product and inspect its extracted facts.
3. Generate candidate topics and select exactly three for the weekly package.
4. Generate one content draft per selected topic.
5. Review every draft against the exact product/workspace review context.
6. Correct blocking findings, rerun review, and render the seven-page visual package.
7. Approve only versions with no blocking findings and seven verified PNG assets at 1080×1440.
8. Create a publication, claim it with the authorized publisher device, and prefill Xiaohongshu.
9. Confirm the publisher is waiting for a human. A human publishes and records the URL and timestamp.
10. Import 24-hour, 72-hour, and 7-day metrics, then write a retrospective with direct, self-reported, inferred, and hypothesis-labelled conversions kept separate.

The console pages are:

- `/app/campaigns` for campaign selection and weekly topic selection;
- `/app/campaigns/:campaignId` for the three selected content packages;
- `/app/review` for blocking findings and corrections;
- `/app/publications` for human-publish handoff;
- `/app/analytics` for metric snapshots and retrospectives.

## Fixture mode

Fixture mode uses only `packages/test-support/fixtures/dormchef-source` and the local XHS editor fixture. It provides deterministic topics, content, claims, review extraction, and worker health checks without an external LLM. The fixture is for development and CI; production must use an explicitly configured LLM and approved source directory.

The worker readiness endpoint is:

```text
http://127.0.0.1:${WORKER_HEALTH_PORT:-3001}/health/ready
```

Readiness is not a substitute for database authorization. The worker still uses the service-role server boundary, and all job handlers remain workspace-scoped.

The Playwright journey is test-only and requires `NODE_ENV=test` plus `ALLOW_TEST_AUTH_FIXTURE=1`. It loads `.env.test.local`; it must never be pointed at a remote Supabase project or a real DormChef path.

## Review and publishing controls

- A correction creates a new content version; it does not mutate an approved immutable version.
- A review is invalid if its context does not match the content version's product, workspace, facts, or brand context.
- Render assets are usable only after their metadata and storage object are verified.
- The publisher may prefill and capture evidence, but may never click the final publish button.
- A publication URL and human timestamp are required before treating a handoff as published.
- Metrics must retain their provenance. Never merge inferred conversions into direct or self-reported conversions.

## Incident handling

If a job fails, retain the job and its audit trail, inspect the scoped error and evidence, and retry only through the supported idempotency path. Do not bypass RLS, call internal RPCs with browser credentials, edit migration history, or reset the database.

If the migration history does not match the expected cloud notes, stop deployment and escalate for reconciliation. Do not repair it ad hoc.

If a secret appears in terminal output, a screenshot, or a fixture claim, stop, redact the artifact, and rotate the affected credential through the approved secret store. Never commit the artifact.
