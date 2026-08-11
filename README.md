# SocialMediaAgent

SocialMediaAgent is an independent project with its own Supabase backend. It must remain completely separate from DormChef.

## Non-negotiable data boundary

- Never read, modify, or execute code from `/Users/justingao/Documents/dormchef`.
- Never connect to, migrate, reset, inspect, or otherwise modify the DormChef Supabase project or database. This includes local Supabase, Docker, `supabase start`, `supabase stop`, and `supabase db reset` when they could target DormChef.
- Database integration tests use only the SocialMediaAgent variables `SOCIAL_AGENT_SUPABASE_URL`, `SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY`, and `SOCIAL_AGENT_SUPABASE_ANON_KEY`. Keep their values in a secure local environment; never print or commit them.
- The browser must never receive the service-role key or direct business-data access.
- SocialMediaAgent must never automate the final Xiaohongshu publish-button click; final publishing remains a human action.

## Verification

Run the database integration tests only after injecting the SocialMediaAgent variables into the same process:

```sh
set -a
source /path/to/secure/social-media-agent-cloud.env
set +a
pnpm --dir packages/db test
```

Do not replace the `SOCIAL_AGENT_*` variables with DormChef credentials or run tests against a local/DormChef database.
