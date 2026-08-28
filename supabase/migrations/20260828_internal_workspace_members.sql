create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  email text not null,
  display_name text
    check (display_name is null or char_length(display_name) <= 120),
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member')),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  must_change_password boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, user_id),
  unique(workspace_id, email),
  check (email = lower(email)),
  check ((status = 'revoked' and revoked_at is not null) or (status = 'active' and revoked_at is null))
);

alter table public.workspace_members enable row level security;

revoke all on table public.workspace_members from anon, authenticated;
grant select, insert, update, delete on table public.workspace_members to service_role;

create index if not exists idx_workspace_members_workspace_status
  on public.workspace_members(workspace_id, status);
