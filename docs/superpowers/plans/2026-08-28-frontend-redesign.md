# SocialMediaAgent Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the SocialMediaAgent web experience around the selected warm editorial workbench direction while preserving the existing Stage 1 routes, Supabase-backed data access, human-review boundary, and manual Xiaohongshu publishing boundary.

**Architecture:** Add one global CSS token layer and a small set of presentational console primitives. Keep data fetching in the existing server pages, but move the dashboard's display mapping into a tested pure view-model module so database failures remain visible instead of being silently rendered as empty data. Reuse the app route tree and make the app layout the shared visual shell for all existing console pages.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS custom properties, Vitest, existing Supabase server client.

## Global Constraints

- Use only the existing SocialMediaAgent Supabase project; do not change schema, migrations, or migration history.
- Preserve the main worktree's untracked `.DS_Store`, `.pnpm-store/`, and `docs/` contents; all edits stay in this worktree.
- Do not print, read, or commit secrets.
- Do not automate the final Xiaohongshu publish click.
- Use real data and existing route actions for the primary console workflow.
- Keep the selected reference as the visual target: warm ivory canvas, ink typography, muted sage surfaces, vermilion action color, editorial workspace hierarchy.

## Files and Responsibilities

- Create `apps/web/src/app/globals.css`: global reset, design tokens, responsive layout utilities, focus states, and shared surface/table/form styles.
- Create `apps/web/src/components/console-ui.tsx`: small reusable `StatusPill`, `Metric`, `SectionHeading`, and `IconMark` primitives using accessible text/semantic markup.
- Create `apps/web/src/app/app/dashboard-model.ts`: typed dashboard input and pure display model mapping.
- Create `apps/web/src/app/app/dashboard-model.test.ts`: regression tests for dashboard state and error visibility.
- Modify `apps/web/src/app/layout.tsx`: load the global stylesheet and define the new font stack/metadata.
- Modify `apps/web/src/app/app/layout.tsx`: replace the plain header with the responsive editorial console shell and active navigation.
- Modify `apps/web/src/app/app/page.tsx`: render the focused weekly workbench using the existing Supabase data and the tested view model.
- Modify `apps/web/src/app/page.tsx` and `apps/web/src/app/login/page.tsx`: align public and auth surfaces to the same visual language without changing their behavior.
- Add `apps/web/src/app/app/ui-smoke.test.tsx` only if a pure interaction helper is needed; do not add a UI test dependency solely for snapshots.
- Create `design-qa.md` in this worktree root after browser comparison; it is the blocking visual QA record.

### Task 1: Establish the visual foundation

- [ ] Add the global CSS token layer and shared console primitives.
- [ ] Run `corepack pnpm --filter @social-agent/web typecheck` and the existing web tests.
- [ ] Confirm `git diff --check` is clean.

### Task 2: Make dashboard state explicit (TDD)

- [ ] Write a failing test for `buildDashboardModel` with a populated workspace and a failed data load.
- [ ] Run the focused test and confirm it fails because the module is missing.
- [ ] Implement the smallest typed `dashboard-model.ts` that produces status, counts, next action, and explicit error state.
- [ ] Run the focused test, then the full web test suite.

### Task 3: Rebuild the shared console shell and workbench

- [ ] Replace the inline app shell styles with the selected two-column editorial layout, responsive navigation, active link state, and workspace identity footer.
- [ ] Replace the dashboard's five equal cards with the primary weekly package status row, review queue, activity ledger, and safety boundary.
- [ ] Keep the existing server-side queries and all existing route URLs/actions intact.
- [ ] Run typecheck, tests, and production build.

### Task 4: Align landing and login surfaces

- [ ] Restyle the landing page and Magic Link form with the same tokens, accessible labels, focus treatment, and responsive spacing.
- [ ] Keep waitlist POST and login behavior unchanged.
- [ ] Run typecheck and web tests.

### Task 5: Browser and visual verification

- [ ] Start the existing Next development script in this worktree without starting local Supabase or Docker.
- [ ] Capture the home, login, and authenticated shell/dashboard states available in the environment.
- [ ] Compare the dashboard against the selected reference at the same desktop viewport.
- [ ] Write `design-qa.md` with `final result: passed` only after fixing P0/P1/P2 visual or interaction issues.
- [ ] Run final typecheck, tests, build, and `git diff --check`.
