import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260828_internal_workspace_members.sql", import.meta.url),
  "utf8",
);

describe("workspace member migration contract", () => {
  it("creates the workspace_members table with the required columns and constraints", () => {
    expect(migration).toMatch(/create table public\.workspace_members \(/);
    expect(migration).toContain("id uuid primary key default gen_random_uuid()");
    expect(migration).toContain("workspace_id uuid not null references public.workspaces(id) on delete cascade");
    expect(migration).toContain("user_id uuid not null references auth.users(id) on delete restrict");
    expect(migration).toContain("email text not null");
    expect(migration).toMatch(/display_name text[\s\S]*check \(display_name is null or char_length\(display_name\) <= \d+\)/);
    expect(migration).toContain("role text not null default 'member'");
    expect(migration).toContain("check (role in ('owner', 'admin', 'member'))");
    expect(migration).toContain("status text not null default 'active'");
    expect(migration).toContain("check (status in ('active', 'revoked'))");
    expect(migration).toContain("must_change_password boolean not null default true");
    expect(migration).toContain("created_by uuid references auth.users(id) on delete set null");
    expect(migration).toContain("revoked_at timestamptz");
    expect(migration).toContain("created_at timestamptz not null default now()");
    expect(migration).toContain("updated_at timestamptz not null default now()");
    expect(migration).toContain("check (email = lower(email))");
    expect(migration).toContain(
      "check ((status = 'revoked' and revoked_at is not null) or (status = 'active' and revoked_at is null))",
    );
    expect(migration).toContain("unique(workspace_id, user_id)");
    expect(migration).toContain("unique(workspace_id, email)");
  });

  it("enables row level security and keeps the table service-role only", () => {
    expect(migration).toContain("alter table public.workspace_members enable row level security");
    expect(migration).toContain("revoke all on table public.workspace_members from anon, authenticated");
    expect(migration).toContain("grant select, insert, update, delete on table public.workspace_members to service_role");
    expect(migration).not.toMatch(/grant .*workspace_members.* to (anon|authenticated)/i);
    expect(migration).not.toMatch(/create policy .*workspace_members/i);
  });

  it("adds the required indexes without duplicating the workspace-email lookup", () => {
    expect(migration).toContain("create index if not exists idx_workspace_members_workspace_status");
    expect(migration).toContain("on public.workspace_members(workspace_id, status)");
    expect(migration).not.toContain("idx_workspace_members_workspace_email");
  });
});
