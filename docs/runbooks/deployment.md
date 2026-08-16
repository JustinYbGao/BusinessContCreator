# Deployment runbook

This project deploys only to the SocialMediaAgent-stage1 Supabase project, ref `cvjrpzhvoxbmcmlqylor`. Do not connect to or deploy against DormChef or any other Supabase project.

## Environment and secrets

Keep the following variables outside git and outside logs:

- `SOCIAL_AGENT_SUPABASE_URL`
- `SOCIAL_AGENT_SUPABASE_ANON_KEY`
- `SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY`
- `INTERNAL_WORKSPACE_ID`
- `ADMIN_EMAIL_ALLOWLIST`
- `DORMCHEF_SOURCE_DIR`
- `SOCIAL_AGENT_WORKER_MODE`
- `WORKER_HEALTH_PORT`

The browser receives only the URL and anon key. The service-role key is server-side only and must never be configured as a `NEXT_PUBLIC_*` value.

For an explicitly authorized local fixture environment, the repository helper can create a mode-600 `.env.test.local` from local Supabase status:

```sh
node scripts/write-local-supabase-env.mjs
```

The helper is not a production secret-management tool. It always writes fixture mode and the repository fixture source path. Do not run it against a DormChef checkout.

## Migration release gate

Before a cloud migration release, confirm the target is `cvjrpzhvoxbmcmlqylor`, review the SQL diff, and verify that the target has the expected Task 7/Task 8 functions and policies. The current migration-history notes include:

- `task8_validated_visual_packages`
- `repair_task7_dependency_then_task8`

These entries document the existing cloud rollout. Do not run migration repair, edit migration history, or reset a database to make the history appear clean. If local files and remote history disagree, stop and obtain an explicit migration-reconciliation decision before deploying another migration.

Cloud verification must confirm that internal workflow RPCs are executable only by `service_role`; `anon` and `authenticated` must not be granted execution. Check RLS, storage object ownership, immutable asset paths, and the seven-page/PNG/1080×1440 metadata contract before release.

## CI and release sequence

CI owns its disposable local database and browser dependencies. It should install the frozen lockfile, start its isolated Supabase service, generate a temporary test environment from `supabase status --output json`, run package checks and the fixture Playwright journey, and discard the runner. No developer should copy CI secrets into the repository.

The release sequence is:

1. Run package-scoped typechecks and tests.
2. Review the generated visual-package and publication contracts.
3. Run the authorized cloud integration checks against the single SocialMediaAgent project.
4. Resolve migration-history discrepancies without `db reset` or repair shortcuts.
5. Deploy the worker and web server with server-only service credentials.
6. Run the Stage 1 smoke journey through approval and asset rendering.
7. Run the local publisher prefill, then stop for the human Xiaohongshu publish action.

Never use `supabase db reset` for cloud deployment, never push git branches from this runbook, and never automate the final Xiaohongshu publish click.

## Health, rollback, and storage cleanup

After deployment, check the web login redirect, an authenticated console request, and the worker readiness endpoint. If the worker cannot reach the database, stop claiming new jobs and roll back the worker and web application to the previous image or commit; do not delete queued jobs to hide the incident. Re-run the smoke journey after rollback.

Storage cleanup is scoped to an explicitly purged Product. Use the tested purge workflow so source objects, generated page assets, prefill screenshots, and dependent rows are removed in the audited order. Never delete the entire `social-agent-assets` bucket or another workspace's object prefix as an operational shortcut.
