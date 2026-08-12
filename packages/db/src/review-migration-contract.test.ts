import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/0012_task7_atomic_review_context.sql", import.meta.url),
  "utf8",
);

describe("atomic review context migration contract", () => {
  it("requires explicit context for every background review commit", () => {
    expect(migration).toContain("REVIEW_CONTEXT_REQUIRED");
    expect(migration).toMatch(/create or replace function public\.commit_review_content_job\([\s\S]*?p_review_context jsonb/);
    expect(migration).toContain("replace_current_review_run_with_context");
    expect(migration).toMatch(/create or replace function public\.commit_review_content_job\([\s\S]*?p_findings jsonb[\s\S]*?raise exception 'REVIEW_CONTEXT_REQUIRED'/);
    expect(migration).toContain("create or replace function public.commit_review_content_job(");
    expect(migration).not.toContain("content_versions_review_input_lock");
  });

  it("uses the locked review scope before every competing row lock", () => {
    const functions = [
      "public.commit_sync_product_job(",
      "public.commit_generate_topics_job(",
      "public.commit_generate_content_job(",
      "public.commit_render_assets_job(",
      "public.commit_review_content_job(\n  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_content_version_id uuid,\n  p_review_context jsonb",
      "public.replace_current_review_run_impl(",
      "public.purge_product(",
      "public.approve_content_version(",
    ];

    for (const functionStart of functions) {
      const start = migration.indexOf(`create or replace function ${functionStart}`);
      expect(start, functionStart).toBeGreaterThanOrEqual(0);
      const body = migration.slice(start);
      const scopeLock = body.indexOf("lock_review_input_scope");
      const rowLock = body.indexOf("for update");
      expect(scopeLock, functionStart).toBeGreaterThanOrEqual(0);
      expect(rowLock, functionStart).toBeGreaterThanOrEqual(0);
      expect(scopeLock, functionStart).toBeLessThan(rowLock);
    }
  });

  it("serializes all review-input mutations before taking per-scope locks", () => {
    expect(migration).toContain("social-agent-review-input-global");
    expect(migration).toMatch(
      /hashtextextended\('social-agent-review-input-global'[\s\S]*?hashtextextended\('social-agent-review-input:'/,
    );
  });

  it("does not put public ahead of pg_catalog in new security-definer search paths", () => {
    expect(migration).not.toContain("set search_path = public, pg_catalog");
    expect(migration).toContain("set search_path = pg_catalog");
    expect(migration).not.toMatch(/security definer(?! set search_path = pg_catalog)/);
    expect(migration).not.toContain("gen_random_uuid");
  });
});
