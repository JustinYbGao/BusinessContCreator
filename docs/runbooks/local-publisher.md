# Local publisher runbook

This runbook covers the local publisher handoff for SocialMediaAgent. It prepares a Xiaohongshu draft and stops before the final publish action. A human must inspect the draft and click the final publish button.

## Fixture mode

Fixture mode is safe for local checks because it uses only repository fixtures:

- editor: `packages/test-support/fixtures/xhs-editor.html`
- claim: a sanitized JSON claim produced by the Stage 1 journey
- image: a local PNG fixture or a generated test asset

Run it from the repository root with:

```sh
pnpm exec tsx apps/local-publisher/src/index.ts fixture \
  packages/test-support/fixtures/xhs-editor.html \
  /private/tmp/social-agent-fixture-claim.json \
  packages/test-support/fixtures/product-screen.png
```

The command must report `AWAITING_HUMAN_PUBLISH`. The fixture page exposes a publish-click counter; the publisher fails if that counter is non-zero. Do not replace the fixture with a page that automatically submits a post.

## Production handoff

Production mode requires a dedicated Chrome Profile, a publisher device token, API URL, storage origin, and a logged-in Xiaohongshu creator session. Create the profile outside the repository and log in manually. Keep the device token and profile path in a local secret manager or a mode-600 environment file. Never put them in source control, screenshots, claims, or issue comments.

Start the publisher only after the worker has produced an approved publication with seven verified assets:

```sh
pnpm --dir apps/local-publisher start
```

The publisher claims one scoped publication, downloads its verified assets, prefills the creator page, saves a prefill screenshot, and reports `AWAITING_HUMAN_PUBLISH`. It must not click the final publish control. Record the human-published URL and timestamp in the internal console after the human action completes.

If prefill fails, leave the publication in its reported failure state and inspect the screenshot before retrying. Do not manually edit the claim payload or bypass the device-token check.

Rotate a device token by revoking the old device in the internal console, creating a replacement device, updating the local secret store, and running one fixture prefill. Do not copy browser cookies or tokens between profiles. If the creator session reaches login, CAPTCHA, or platform risk control, stop and handle that screen manually; the publisher must report `NEEDS_LOGIN` or `PREFILL_FAILED` rather than attempting to bypass it.

## Safety checks

- Use only `SOCIAL_AGENT_*` variables for this project; do not substitute generic or DormChef Supabase credentials.
- Use the repository fixture path for fixture mode; never read `/Users/justingao/Documents/dormchef`.
- Treat device tokens and browser profiles as secrets.
- A successful prefill is not a successful publication. The human publish step remains explicit and auditable.
