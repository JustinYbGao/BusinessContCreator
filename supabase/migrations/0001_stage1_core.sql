create extension if not exists pgcrypto;

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  positioning text not null default '',
  brand_profile jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(workspace_id, slug)
);

create table channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  kind text not null check (kind = 'xiaohongshu'),
  status text not null check (status in ('active', 'paused')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(product_id, kind)
);

create table product_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  kind text not null check (kind in ('manual', 'dormchef_local')),
  locator text not null check (locator !~ '(^/|(^|/)\.\.(/|$))'),
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table product_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  source_id uuid references product_sources(id) on delete set null,
  statement text not null,
  category text not null check (category in ('positioning', 'feature', 'constraint', 'data', 'price', 'status')),
  source_locator text not null check (source_locator !~ '(^/|(^|/)\.\.(/|$))'),
  evidence_excerpt text not null,
  status text not null check (status in ('candidate', 'verified', 'blocked', 'deprecated')),
  public_use_allowed boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'verified' or (public_use_allowed and verified_by is not null and verified_at is not null))
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete restrict,
  name text not null,
  goal text not null,
  audience text not null,
  pillar_quotas jsonb not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table topic_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  title text not null,
  angle text not null,
  pillar text not null check (pillar in ('pain_solution', 'product_proof', 'region_timing', 'founder_story')),
  fact_ids uuid[] not null,
  scores jsonb not null,
  total_score numeric not null,
  selected boolean not null default false,
  created_at timestamptz not null default now()
);

create table content_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  topic_id uuid not null references topic_candidates(id) on delete restrict,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(topic_id)
);

create table contents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  topic_id uuid not null references topic_candidates(id) on delete restrict,
  status text not null check (status in ('draft', 'review_required', 'approved', 'packaged')),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique(topic_id)
);

create table content_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  content_id uuid not null references contents(id) on delete cascade,
  topic_id uuid not null references topic_candidates(id) on delete restrict,
  brief_id uuid not null references content_briefs(id) on delete restrict,
  version integer not null,
  payload jsonb not null,
  prompt_version text not null,
  model_name text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('draft', 'review_required', 'approved')),
  edit_reason text,
  created_by text not null,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(content_id, version),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create table review_runs (
  id uuid primary key default gen_random_uuid(),
  content_version_id uuid not null references content_versions(id) on delete cascade,
  run_number integer not null,
  is_current boolean not null default true,
  result text not null check (result in ('passed', 'blocked')),
  actor_type text not null check (actor_type in ('worker', 'user')),
  actor_id text not null,
  created_at timestamptz not null default now(),
  unique(content_version_id, run_number)
);

create table review_findings (
  id uuid primary key default gen_random_uuid(),
  review_run_id uuid not null references review_runs(id) on delete cascade,
  code text not null,
  severity text not null check (severity in ('blocking', 'advisory')),
  message text not null,
  created_at timestamptz not null default now()
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  content_version_id uuid references content_versions(id) on delete cascade,
  kind text not null check (kind in ('screenshot', 'brand_asset', 'carousel_page', 'prefill_screenshot')),
  provenance text not null check (provenance in ('source', 'generated')),
  source_locator text check (source_locator is null or source_locator !~ '(^/|(^|/)\.\.(/|$))'),
  verification_status text not null check (verification_status in ('candidate', 'verified', 'blocked')),
  public_use_allowed boolean not null default false,
  verified_by text,
  verified_at timestamptz,
  object_key text not null unique,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  width integer,
  height integer,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check (verification_status <> 'verified' or (public_use_allowed and verified_by is not null and verified_at is not null))
);

create table publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete restrict,
  content_version_id uuid not null references content_versions(id) on delete restrict,
  status text not null check (status in (
    'READY_TO_PREFILL', 'PREFILLING', 'NEEDS_LOGIN', 'PREFILL_FAILED',
    'AWAITING_HUMAN_PUBLISH', 'PUBLISHED', 'MEASURING', 'RETROSPECTED'
  )),
  package jsonb not null,
  claimed_by_device_id uuid,
  claimed_at timestamptz,
  public_url text,
  published_at timestamptz,
  failure_reason text,
  prefill_screenshot_key text,
  created_at timestamptz not null default now(),
  unique(content_version_id)
);

create table metric_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  actor_id uuid not null,
  format text not null check (format in ('manual', 'csv', 'json')),
  filename_sha256 text,
  accepted_rows integer not null,
  error_summary jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references publications(id) on delete cascade,
  "window" text not null check ("window" in ('24h', '72h', '7d')),
  metrics jsonb not null,
  product_conversion jsonb,
  import_id uuid not null references metric_imports(id) on delete restrict,
  captured_at timestamptz not null default now(),
  unique(publication_id, "window")
);

create table learnings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  publication_id uuid not null references publications(id) on delete cascade,
  evidence_window text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table weekly_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  week_start date not null,
  payload jsonb not null,
  source_snapshot_ids uuid[] not null,
  created_at timestamptz not null default now(),
  unique(campaign_id, week_start)
);

create table workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  kind text not null,
  idempotency_key text not null,
  payload jsonb not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  heartbeat_at timestamptz,
  locked_by text,
  max_attempts integer not null default 3,
  rewrite_attempts integer not null default 0 check (rewrite_attempts between 0 and 2),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'worker', 'publisher', 'system')),
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table publisher_devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  token_sha256 text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table publications add constraint publications_claimed_device_fk
  foreign key (claimed_by_device_id) references publisher_devices(id) on delete set null;

create table waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'website',
  rate_limit_key text,
  created_at timestamptz not null default now()
);

create unique index waitlist_entries_email_lower_unique on waitlist_entries(lower(email));
create index idx_jobs_claim on workflow_jobs(status, available_at, created_at);
create index idx_facts_verified on product_facts(product_id, status, public_use_allowed);
create index idx_publications_status on publications(status, created_at);
create unique index review_runs_one_current on review_runs(content_version_id) where is_current;

alter table products add constraint products_workspace_id_id_unique unique (workspace_id, id);
alter table channels add constraint channels_scope_id_unique unique (workspace_id, product_id, id);
alter table product_sources add constraint sources_scope_id_unique unique (workspace_id, product_id, id);
alter table campaigns add constraint campaigns_scope_id_unique unique (workspace_id, product_id, id);
alter table topic_candidates add constraint topics_scope_id_unique unique (workspace_id, product_id, campaign_id, id);
alter table contents add constraint contents_scope_id_unique unique (workspace_id, product_id, campaign_id, id);
alter table contents add constraint contents_topic_id_unique unique (workspace_id, product_id, campaign_id, topic_id, id);
alter table content_briefs add constraint briefs_topic_id_unique unique (workspace_id, product_id, campaign_id, topic_id, id);
alter table content_versions add constraint versions_scope_id_unique unique (workspace_id, product_id, campaign_id, id);
alter table content_versions add constraint versions_product_id_unique unique (workspace_id, product_id, id);
alter table publications add constraint publications_product_id_unique unique (workspace_id, product_id, id);
alter table publisher_devices add constraint devices_workspace_id_unique unique (workspace_id, id);

alter table channels add foreign key (workspace_id, product_id) references products(workspace_id, id);
alter table product_sources add foreign key (workspace_id, product_id) references products(workspace_id, id);
alter table product_facts add foreign key (workspace_id, product_id) references products(workspace_id, id);
alter table product_facts add foreign key (workspace_id, product_id, source_id) references product_sources(workspace_id, product_id, id);
alter table campaigns add foreign key (workspace_id, product_id) references products(workspace_id, id);
alter table campaigns add foreign key (workspace_id, product_id, channel_id) references channels(workspace_id, product_id, id);
alter table topic_candidates add foreign key (workspace_id, product_id, campaign_id) references campaigns(workspace_id, product_id, id);
alter table content_briefs add foreign key (workspace_id, product_id, campaign_id, topic_id) references topic_candidates(workspace_id, product_id, campaign_id, id);
alter table contents add foreign key (workspace_id, product_id, campaign_id, topic_id) references topic_candidates(workspace_id, product_id, campaign_id, id);
alter table content_versions add foreign key (workspace_id, product_id, campaign_id, topic_id, content_id) references contents(workspace_id, product_id, campaign_id, topic_id, id);
alter table content_versions add foreign key (workspace_id, product_id, campaign_id, topic_id, brief_id) references content_briefs(workspace_id, product_id, campaign_id, topic_id, id);
alter table assets add foreign key (workspace_id, product_id) references products(workspace_id, id);
alter table assets add foreign key (workspace_id, product_id, content_version_id) references content_versions(workspace_id, product_id, id);
alter table publications add foreign key (workspace_id, product_id, channel_id) references channels(workspace_id, product_id, id);
alter table publications add foreign key (workspace_id, product_id, campaign_id, content_version_id) references content_versions(workspace_id, product_id, campaign_id, id);
alter table metric_imports add foreign key (workspace_id, product_id) references products(workspace_id, id);
alter table learnings add foreign key (workspace_id, product_id) references products(workspace_id, id);
alter table learnings add foreign key (workspace_id, product_id, publication_id) references publications(workspace_id, product_id, id);
alter table weekly_reports add foreign key (workspace_id, product_id, campaign_id) references campaigns(workspace_id, product_id, id);
alter table workflow_jobs add foreign key (workspace_id, product_id) references products(workspace_id, id);
alter table audit_events add foreign key (workspace_id, product_id) references products(workspace_id, id);
alter table publications add foreign key (workspace_id, claimed_by_device_id) references publisher_devices(workspace_id, id);

alter table workspaces enable row level security;
alter table products enable row level security;
alter table channels enable row level security;
alter table product_sources enable row level security;
alter table product_facts enable row level security;
alter table campaigns enable row level security;
alter table topic_candidates enable row level security;
alter table content_briefs enable row level security;
alter table contents enable row level security;
alter table content_versions enable row level security;
alter table review_findings enable row level security;
alter table review_runs enable row level security;
alter table assets enable row level security;
alter table publications enable row level security;
alter table metric_imports enable row level security;
alter table metric_snapshots enable row level security;
alter table learnings enable row level security;
alter table weekly_reports enable row level security;
alter table workflow_jobs enable row level security;
alter table publisher_devices enable row level security;
alter table waitlist_entries enable row level security;
alter table audit_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update on all tables in schema public to service_role;
revoke insert, update, delete on content_versions from anon, authenticated, service_role;
revoke insert, update, delete on audit_events from anon, authenticated, service_role;

create or replace function database_time() returns timestamptz
language sql security definer set search_path = public
as $$ select clock_timestamp() $$;
revoke all on function database_time() from public, anon, authenticated;
grant execute on function database_time() to service_role;

create or replace function claim_workflow_job(
  p_workspace_id uuid, p_worker_id text, p_now timestamptz, p_stale_before timestamptz
) returns setof workflow_jobs
language plpgsql security definer set search_path = public
as $$
begin
  with exhausted as (
    update workflow_jobs
    set status = 'failed', error = 'LEASE_EXHAUSTED', updated_at = p_now
    where workspace_id = p_workspace_id and attempts >= max_attempts and (
      (status = 'running' and coalesce(heartbeat_at, locked_at, '-infinity'::timestamptz) < p_stale_before)
      or (status = 'queued' and available_at <= p_now)
    ) returning id, workspace_id, product_id, attempts
  )
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  select workspace_id, product_id, 'system', 'job-reaper', 'workflow_job.lease_exhausted',
    'workflow_job', id, 'job-reaper:' || id::text || ':' || attempts::text, jsonb_build_object('attempts', attempts)
  from exhausted;

  return query
  with candidate as (
    select id from workflow_jobs where workspace_id = p_workspace_id
    and product_id is not null
    and kind in ('sync_product', 'purge_product', 'generate_topics', 'generate_content', 'review_content', 'render_assets')
    and (
      (status = 'queued' and available_at <= p_now and attempts < max_attempts)
        or (status = 'running' and coalesce(heartbeat_at, locked_at, '-infinity'::timestamptz) < p_stale_before and attempts < max_attempts)
    ) order by available_at, created_at for update skip locked limit 1
  ), claimed as (
    update workflow_jobs as jobs set status = 'running', locked_at = p_now, heartbeat_at = p_now,
      locked_by = p_worker_id, attempts = jobs.attempts + 1, updated_at = p_now
    from candidate where jobs.id = candidate.id returning jobs.*
  ), audited as (
    insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
    select workspace_id, product_id, 'worker', p_worker_id, 'workflow_job.claimed', 'workflow_job', id,
      'job-claim:' || id::text || ':' || attempts::text, jsonb_build_object('attempts', attempts)
    from claimed returning id
  )
  select claimed.* from claimed;
end;
$$;
revoke all on function claim_workflow_job(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function claim_workflow_job(uuid, text, timestamptz, timestamptz) to service_role;

create or replace function heartbeat_workflow_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_now timestamptz
) returns boolean language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update workflow_jobs set heartbeat_at = p_now
  where workspace_id = p_workspace_id and id = p_job_id and status = 'running' and locked_by = p_worker_id;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;
revoke all on function heartbeat_workflow_job(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function heartbeat_workflow_job(uuid, uuid, text, timestamptz) to service_role;

create or replace function finish_workflow_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_result jsonb,
  p_audit_event jsonb, p_next_job jsonb default null
) returns boolean language plpgsql security definer set search_path = public
as $$
declare v_job workflow_jobs; v_count integer;
begin
  update workflow_jobs set status = 'completed', result = p_result, error = null,
    locked_at = null, heartbeat_at = null, locked_by = null, updated_at = clock_timestamp()
  where workspace_id = p_workspace_id and id = p_job_id and status = 'running' and locked_by = p_worker_id
  returning * into v_job;
  get diagnostics v_count = row_count;
  if v_count <> 1 then return false; end if;
  if p_next_job is not null and nullif(p_next_job->>'product_id', '')::uuid is distinct from v_job.product_id then
    raise exception 'NEXT_JOB_SCOPE_MISMATCH';
  end if;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_job.product_id, p_audit_event->>'actor_type', p_audit_event->>'actor_id',
    p_audit_event->>'action', p_audit_event->>'entity_type', nullif(p_audit_event->>'entity_id','')::uuid,
    p_audit_event->>'request_id', coalesce(p_audit_event->'payload','{}'::jsonb));
  if p_next_job is not null then
    insert into workflow_jobs (workspace_id, product_id, kind, idempotency_key, payload, status)
    values (p_workspace_id, nullif(p_next_job->>'product_id','')::uuid, p_next_job->>'kind',
      p_next_job->>'idempotency_key', coalesce(p_next_job->'payload','{}'::jsonb), 'queued')
    on conflict (workspace_id, idempotency_key) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function finish_workflow_job(uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function finish_workflow_job(uuid, uuid, text, jsonb, jsonb, jsonb) to service_role;

create or replace function fail_workflow_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_error text,
  p_retry_at timestamptz, p_audit_event jsonb
) returns boolean language plpgsql security definer set search_path = public
as $$
declare v_job workflow_jobs; v_count integer; v_terminal boolean;
begin
  select * into v_job from workflow_jobs where workspace_id = p_workspace_id and id = p_job_id
    and status = 'running' and locked_by = p_worker_id for update;
  if not found then return false; end if;
  v_terminal := v_job.attempts >= v_job.max_attempts;
  update workflow_jobs set status = case when v_terminal then 'failed' else 'queued' end,
    available_at = case when v_terminal then available_at else coalesce(p_retry_at, clock_timestamp() + make_interval(secs => power(2, attempts)::integer)) end,
    error = p_error, locked_at = null, heartbeat_at = null, locked_by = null, updated_at = clock_timestamp()
  where id = p_job_id;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_job.product_id, p_audit_event->>'actor_type', p_audit_event->>'actor_id',
    case when v_terminal then 'workflow_job.failed' else 'workflow_job.requeued' end,
    'workflow_job', p_job_id, p_audit_event->>'request_id',
    coalesce(p_audit_event->'payload','{}'::jsonb) || jsonb_build_object('terminal', v_terminal));
  return true;
end;
$$;
revoke all on function fail_workflow_job(uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function fail_workflow_job(uuid, uuid, text, text, timestamptz, jsonb) to service_role;

insert into storage.buckets (id, name, public)
values ('social-agent-assets', 'social-agent-assets', false)
on conflict (id) do nothing;

create or replace function append_audit_event(p_workspace_id uuid, p_event jsonb)
returns audit_events language plpgsql security definer set search_path = public
as $$
declare v_event audit_events;
begin
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, nullif(p_event->>'product_id','')::uuid, p_event->>'actor_type', p_event->>'actor_id',
    p_event->>'action', p_event->>'entity_type', nullif(p_event->>'entity_id','')::uuid,
    p_event->>'request_id', coalesce(p_event->'payload','{}'::jsonb))
  returning * into v_event;
  return v_event;
end;
$$;
revoke all on function append_audit_event(uuid, jsonb) from public, anon, authenticated;
grant execute on function append_audit_event(uuid, jsonb) to service_role;

create or replace function soft_delete_product(
  p_workspace_id uuid, p_product_id uuid, p_exact_name text, p_audit_event jsonb
) returns products language plpgsql security definer set search_path = public
as $$
declare v_product products;
begin
  update products set deleted_at = clock_timestamp()
  where workspace_id = p_workspace_id and id = p_product_id and name = p_exact_name and deleted_at is null
  returning * into v_product;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  perform append_audit_event(p_workspace_id, p_audit_event);
  return v_product;
end;
$$;
revoke all on function soft_delete_product(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function soft_delete_product(uuid, uuid, text, jsonb) to service_role;

create or replace function create_content_version(
  p_workspace_id uuid, p_input jsonb, p_actor_type text, p_actor_id text, p_request_id text
) returns content_versions language plpgsql security definer set search_path = public
as $$
declare v_version content_versions; v_number integer;
begin
  perform 1 from contents where workspace_id = p_workspace_id
    and product_id = (p_input->>'product_id')::uuid and campaign_id = (p_input->>'campaign_id')::uuid
    and id = (p_input->>'content_id')::uuid and topic_id = (p_input->>'topic_id')::uuid for update;
  if not found then raise exception 'CONTENT_SCOPE_MISMATCH'; end if;
  select coalesce(max(version), 0) + 1 into v_number from content_versions
    where workspace_id = p_workspace_id and content_id = (p_input->>'content_id')::uuid;
  insert into content_versions (workspace_id, product_id, campaign_id, content_id, topic_id, brief_id,
    version, payload, prompt_version, model_name, content_sha256, status, created_by)
  values (p_workspace_id, (p_input->>'product_id')::uuid, (p_input->>'campaign_id')::uuid,
    (p_input->>'content_id')::uuid, (p_input->>'topic_id')::uuid, (p_input->>'brief_id')::uuid,
    v_number, p_input->'payload', p_input->>'prompt_version', p_input->>'model_name',
    p_input->>'content_sha256', 'draft', p_input->>'created_by')
  returning * into v_version;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_version.product_id, p_actor_type, p_actor_id, 'content_version.created',
    'content_version', v_version.id, p_request_id, jsonb_build_object('version', v_number));
  return v_version;
end;
$$;
revoke all on function create_content_version(uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function create_content_version(uuid, jsonb, text, text, text) to service_role;

create or replace function replace_current_review_run(
  p_workspace_id uuid, p_content_version_id uuid, p_findings jsonb,
  p_actor_type text, p_actor_id text, p_request_id text
) returns review_runs language plpgsql security definer set search_path = public
as $$
declare v_version content_versions; v_run review_runs; v_number integer; v_finding jsonb; v_result text;
begin
  select * into v_version from content_versions where workspace_id = p_workspace_id and id = p_content_version_id for update;
  if not found then raise exception 'CONTENT_VERSION_NOT_FOUND'; end if;
  if v_version.status = 'approved' then raise exception 'CONTENT_VERSION_IMMUTABLE'; end if;
  update review_runs set is_current = false where content_version_id = p_content_version_id and is_current;
  select coalesce(max(run_number), 0) + 1 into v_number from review_runs where content_version_id = p_content_version_id;
  v_result := case when exists (
    select 1 from jsonb_array_elements(p_findings) value where value->>'severity' = 'blocking'
  ) then 'blocked' else 'passed' end;
  insert into review_runs (content_version_id, run_number, result, actor_type, actor_id)
  values (p_content_version_id, v_number, v_result, p_actor_type, p_actor_id) returning * into v_run;
  for v_finding in select value from jsonb_array_elements(p_findings) loop
    insert into review_findings (review_run_id, code, severity, message)
    values (v_run.id, v_finding->>'code', v_finding->>'severity', v_finding->>'message');
  end loop;
  update content_versions set status = 'review_required' where id = p_content_version_id;
  update contents set status = 'review_required' where id = v_version.content_id;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_version.product_id, p_actor_type, p_actor_id, 'review.completed',
    'content_version', p_content_version_id, p_request_id,
    jsonb_build_object('run_id', v_run.id, 'run_number', v_number, 'result', v_result));
  return v_run;
end;
$$;
revoke all on function replace_current_review_run(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function replace_current_review_run(uuid, uuid, jsonb, text, text, text) to service_role;

create or replace function approve_content_version(
  p_workspace_id uuid, p_content_version_id uuid, p_expected_payload jsonb,
  p_expected_sha256 text, p_approved_by uuid, p_actor_type text, p_request_id text
) returns content_versions language plpgsql security definer set search_path = public
as $$
declare v_version content_versions;
begin
  select * into v_version from content_versions where workspace_id = p_workspace_id and id = p_content_version_id for update;
  if not found then raise exception 'CONTENT_VERSION_NOT_FOUND'; end if;
  if v_version.status = 'approved' then return v_version; end if;
  if v_version.payload <> p_expected_payload or v_version.content_sha256 <> p_expected_sha256 then
    raise exception 'CONTENT_VERSION_CHANGED';
  end if;
  perform 1 from review_runs where content_version_id = p_content_version_id and is_current and result = 'passed';
  if not found then raise exception 'CURRENT_REVIEW_NOT_PASSED'; end if;
  update content_versions set status = 'approved', approved_by = p_approved_by, approved_at = clock_timestamp()
    where id = p_content_version_id returning * into v_version;
  update contents set status = 'approved' where id = v_version.content_id;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_version.product_id, p_actor_type, p_approved_by::text, 'content_version.approved',
    'content_version', p_content_version_id, p_request_id,
    jsonb_build_object('content_sha256', v_version.content_sha256));
  return v_version;
end;
$$;
revoke all on function approve_content_version(uuid, uuid, jsonb, text, uuid, text, text) from public, anon, authenticated;
grant execute on function approve_content_version(uuid, uuid, jsonb, text, uuid, text, text) to service_role;

create or replace function insert_topics_with_audit(
  p_workspace_id uuid, p_campaign_id uuid, p_rows jsonb,
  p_actor_type text, p_actor_id text, p_request_id text
) returns void language plpgsql security definer set search_path = public
as $$
declare v_row jsonb; v_campaign campaigns;
begin
  if exists (select 1 from audit_events where workspace_id = p_workspace_id and request_id = p_request_id and action = 'topics.inserted') then return; end if;
  select * into v_campaign from campaigns where workspace_id = p_workspace_id and id = p_campaign_id;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) row
    cross join lateral jsonb_array_elements_text(coalesce(row->'fact_ids', '[]'::jsonb)) fact(id)
    left join product_facts f on f.id = fact.id::uuid and f.workspace_id = p_workspace_id
      and f.product_id = v_campaign.product_id and f.status = 'verified' and f.public_use_allowed
    where f.id is null
  ) then raise exception 'FACT_SCOPE_MISMATCH'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    insert into topic_candidates (workspace_id, product_id, campaign_id, title, angle, pillar, fact_ids, scores, total_score)
    values (p_workspace_id, v_campaign.product_id, p_campaign_id, v_row->>'title', v_row->>'angle', v_row->>'pillar',
      array(select jsonb_array_elements_text(coalesce(v_row->'fact_ids','[]'::jsonb))::uuid),
      coalesce(v_row->'scores','{}'::jsonb), coalesce((v_row->>'total_score')::numeric, 0));
  end loop;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_campaign.product_id, p_actor_type, p_actor_id, 'topics.inserted',
    'campaign', p_campaign_id, p_request_id, jsonb_build_object('count', jsonb_array_length(p_rows)));
end;
$$;
revoke all on function insert_topics_with_audit(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function insert_topics_with_audit(uuid, uuid, jsonb, text, text, text) to service_role;

create or replace function select_weekly_topics(
  p_workspace_id uuid, p_campaign_id uuid, p_topic_ids uuid[],
  p_actor_type text, p_actor_id text, p_request_id text
) returns void language plpgsql security definer set search_path = public
as $$
declare v_product_id uuid; v_count integer;
begin
  select product_id into v_product_id from campaigns where workspace_id = p_workspace_id and id = p_campaign_id;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  if exists (select 1 from unnest(p_topic_ids) id left join topic_candidates t on t.id = id
    where t.id is null or t.workspace_id <> p_workspace_id or t.campaign_id <> p_campaign_id) then
    raise exception 'TOPIC_SCOPE_MISMATCH';
  end if;
  update topic_candidates set selected = id = any(p_topic_ids)
    where workspace_id = p_workspace_id and campaign_id = p_campaign_id;
  get diagnostics v_count = row_count;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_product_id, p_actor_type, p_actor_id, 'topics.selected', 'campaign',
    p_campaign_id, p_request_id, jsonb_build_object('topic_ids', to_jsonb(p_topic_ids), 'candidate_count', v_count));
end;
$$;
revoke all on function select_weekly_topics(uuid, uuid, uuid[], text, text, text) from public, anon, authenticated;
grant execute on function select_weekly_topics(uuid, uuid, uuid[], text, text, text) to service_role;

create or replace function create_content_with_brief(
  p_workspace_id uuid, p_product_id uuid, p_campaign_id uuid, p_topic_id uuid,
  p_brief jsonb, p_created_by text, p_idempotency_key text, p_actor_type text, p_request_id text
) returns contents language plpgsql security definer set search_path = public
as $$
declare v_content contents;
begin
  perform 1 from topic_candidates where workspace_id = p_workspace_id and product_id = p_product_id
    and campaign_id = p_campaign_id and id = p_topic_id for update;
  if not found then raise exception 'TOPIC_SCOPE_MISMATCH'; end if;
  select * into v_content from contents where workspace_id = p_workspace_id and topic_id = p_topic_id;
  if found then return v_content; end if;
  insert into content_briefs (workspace_id, product_id, campaign_id, topic_id, payload)
  values (p_workspace_id, p_product_id, p_campaign_id, p_topic_id, p_brief);
  insert into contents (workspace_id, product_id, campaign_id, topic_id, status, created_by)
  values (p_workspace_id, p_product_id, p_campaign_id, p_topic_id, 'draft', p_created_by)
  returning * into v_content;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, p_product_id, p_actor_type, p_created_by, 'content.created', 'content',
    v_content.id, p_request_id, jsonb_build_object('idempotency_key', p_idempotency_key));
  return v_content;
end;
$$;
revoke all on function create_content_with_brief(uuid, uuid, uuid, uuid, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function create_content_with_brief(uuid, uuid, uuid, uuid, jsonb, text, text, text, text) to service_role;

create or replace function storage_object_matches_asset(
  p_object_key text, p_mime_type text, p_byte_size integer, p_sha256 text
) returns boolean language sql security definer set search_path = public
as $$
  select exists (
    select 1 from storage.objects o
    where o.bucket_id = 'social-agent-assets' and o.name = p_object_key
      and coalesce(o.user_metadata->>'sha256', o.metadata->>'sha256') = p_sha256
      and coalesce(o.user_metadata->>'verified', 'false') = 'true'
      and coalesce(o.metadata->>'mimetype', '') = p_mime_type
      and coalesce((o.metadata->>'size')::integer, -1) = p_byte_size
  )
$$;
revoke all on function storage_object_matches_asset(text, text, integer, text) from public, anon, authenticated;

create or replace function create_publication(
  p_workspace_id uuid, p_content_version_id uuid, p_idempotency_key text,
  p_actor_type text, p_actor_id text, p_request_id text
) returns publications language plpgsql security definer set search_path = public
as $$
declare v_version content_versions; v_content contents; v_campaign campaigns; v_publication publications;
  v_assets jsonb; v_keys jsonb; v_hashes jsonb; v_publication_id uuid := gen_random_uuid();
begin
  select * into v_publication from publications where workspace_id = p_workspace_id and content_version_id = p_content_version_id;
  if found then return v_publication; end if;
  select * into v_version from content_versions where workspace_id = p_workspace_id and id = p_content_version_id for update;
  if not found or v_version.status <> 'approved' then raise exception 'CONTENT_NOT_APPROVED'; end if;
  perform 1 from review_runs where content_version_id = p_content_version_id and is_current and result = 'passed';
  if not found then raise exception 'CURRENT_REVIEW_NOT_PASSED'; end if;
  select jsonb_agg(to_jsonb(a) order by a.object_key), jsonb_agg(a.object_key order by a.object_key), jsonb_agg(a.sha256 order by a.object_key)
    into v_assets, v_keys, v_hashes from assets a
    where a.workspace_id = p_workspace_id and a.content_version_id = p_content_version_id
      and a.provenance = 'generated' and a.kind = 'carousel_page'
      and a.verification_status = 'verified' and a.public_use_allowed
      and storage_object_matches_asset(a.object_key, a.mime_type, a.byte_size, a.sha256);
  if jsonb_array_length(coalesce(v_assets, '[]'::jsonb)) <> 7 then raise exception 'ASSET_SET_INVALID'; end if;
  select * into v_content from contents where workspace_id = p_workspace_id and id = v_version.content_id;
  select * into v_campaign from campaigns where workspace_id = p_workspace_id and id = v_version.campaign_id;
  insert into publications (id, workspace_id, product_id, campaign_id, channel_id, content_version_id, status, package)
  values (v_publication_id, p_workspace_id, v_version.product_id, v_version.campaign_id, v_campaign.channel_id,
    p_content_version_id, 'READY_TO_PREFILL', jsonb_build_object(
      'publicationId', v_publication_id, 'contentVersionId', p_content_version_id,
      'title', v_version.payload->>'recommendedTitle', 'body', v_version.payload->>'body',
      'imageObjectKeys', v_keys, 'imageSha256', v_hashes, 'contentSha256', v_version.content_sha256
    )) returning * into v_publication;
  update contents set status = 'packaged' where id = v_version.content_id;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_version.product_id, p_actor_type, p_actor_id, 'publication.created', 'publication',
    v_publication.id, p_request_id, jsonb_build_object('idempotency_key', p_idempotency_key, 'content_version_id', p_content_version_id));
  return v_publication;
end;
$$;
revoke all on function create_publication(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function create_publication(uuid, uuid, text, text, text, text) to service_role;

create or replace function valid_publication_transition(p_expected text, p_next text)
returns boolean language sql immutable set search_path = public
as $$ select case p_expected
  when 'READY_TO_PREFILL' then p_next = 'PREFILLING'
  when 'PREFILLING' then p_next in ('NEEDS_LOGIN','PREFILL_FAILED','AWAITING_HUMAN_PUBLISH')
  when 'NEEDS_LOGIN' then p_next = 'READY_TO_PREFILL'
  when 'PREFILL_FAILED' then p_next = 'READY_TO_PREFILL'
  when 'AWAITING_HUMAN_PUBLISH' then p_next = 'PUBLISHED'
  when 'PUBLISHED' then p_next = 'MEASURING'
  when 'MEASURING' then p_next = 'RETROSPECTED'
  else false end $$;

create or replace function transition_publication(
  p_workspace_id uuid, p_publication_id uuid, p_device_id uuid, p_expected text, p_next text,
  p_actor_type text, p_actor_id text, p_request_id text
) returns publications language plpgsql security definer set search_path = public
as $$
declare v_publication publications;
begin
  if not valid_publication_transition(p_expected, p_next) then raise exception 'INVALID_PUBLICATION_TRANSITION'; end if;
  if p_expected = 'AWAITING_HUMAN_PUBLISH' and p_next = 'PUBLISHED'
    and (p_actor_type <> 'user' or p_device_id is not null) then
    raise exception 'HUMAN_PUBLICATION_CONFIRMATION_REQUIRED';
  end if;
  update publications set status = p_next,
    published_at = case when p_next = 'PUBLISHED' then clock_timestamp() else published_at end
  where workspace_id = p_workspace_id and id = p_publication_id and status = p_expected
    and (p_device_id is null or claimed_by_device_id = p_device_id)
  returning * into v_publication;
  if not found then raise exception 'PUBLICATION_TRANSITION_CONFLICT'; end if;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_publication.product_id, p_actor_type, p_actor_id, 'publication.transitioned',
    'publication', p_publication_id, p_request_id, jsonb_build_object('from', p_expected, 'to', p_next));
  return v_publication;
end;
$$;
revoke all on function transition_publication(uuid, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function transition_publication(uuid, uuid, uuid, text, text, text, text, text) to service_role;

create or replace function claim_publication_for_device(
  p_workspace_id uuid, p_device_id uuid, p_actor_id text, p_request_id text
) returns publications language plpgsql security definer set search_path = public
as $$
declare v_publication publications;
begin
  perform 1 from publisher_devices where workspace_id = p_workspace_id and id = p_device_id and revoked_at is null;
  if not found then raise exception 'DEVICE_NOT_FOUND'; end if;
  with candidate as (
    select id from publications where workspace_id = p_workspace_id and status = 'READY_TO_PREFILL'
      and claimed_by_device_id is null order by created_at for update skip locked limit 1
  )
  update publications p set claimed_by_device_id = p_device_id, claimed_at = clock_timestamp()
  from candidate where p.id = candidate.id returning p.* into v_publication;
  if not found then return null; end if;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_publication.product_id, 'publisher', p_actor_id, 'publication.claimed',
    'publication', v_publication.id, p_request_id, jsonb_build_object('device_id', p_device_id));
  return v_publication;
end;
$$;
revoke all on function claim_publication_for_device(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function claim_publication_for_device(uuid, uuid, text, text) to service_role;

create or replace function import_metric_snapshots(
  p_workspace_id uuid, p_product_id uuid, p_actor_id uuid, p_format text,
  p_rows jsonb, p_filename_sha256 text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_import metric_imports; v_row jsonb; v_accepted integer := 0;
begin
  perform 1 from products where workspace_id = p_workspace_id and id = p_product_id and deleted_at is null;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  insert into metric_imports (workspace_id, product_id, actor_id, format, filename_sha256, accepted_rows)
  values (p_workspace_id, p_product_id, p_actor_id, p_format, p_filename_sha256, 0) returning * into v_import;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    perform 1 from publications where workspace_id = p_workspace_id and product_id = p_product_id
      and id = (v_row->>'publicationId')::uuid;
    if not found then raise exception 'PUBLICATION_SCOPE_MISMATCH'; end if;
    insert into metric_snapshots (publication_id, "window", metrics, product_conversion, import_id, captured_at)
    values ((v_row->>'publicationId')::uuid, v_row->>'window', v_row->'metrics',
      v_row->'productConversion', v_import.id, coalesce((v_row->>'capturedAt')::timestamptz, clock_timestamp()))
    on conflict (publication_id, "window") do update set metrics = excluded.metrics,
      product_conversion = excluded.product_conversion, import_id = excluded.import_id, captured_at = excluded.captured_at;
    v_accepted := v_accepted + 1;
  end loop;
  update metric_imports set accepted_rows = v_accepted where id = v_import.id;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, p_product_id, 'user', p_actor_id::text, 'metrics.imported',
    'metric_import', v_import.id, p_request_id, jsonb_build_object('accepted_rows', v_accepted));
  return jsonb_build_object('import_id', v_import.id, 'accepted_rows', v_accepted);
end;
$$;
revoke all on function import_metric_snapshots(uuid, uuid, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function import_metric_snapshots(uuid, uuid, uuid, text, jsonb, text, text) to service_role;

create or replace function upsert_waitlist_entry(p_email text, p_source text, p_rate_limit_key text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into waitlist_entries (email, source, rate_limit_key)
  values (lower(trim(p_email)), p_source, p_rate_limit_key)
  on conflict (lower(email)) do update set source = excluded.source, rate_limit_key = excluded.rate_limit_key;
end;
$$;
revoke all on function upsert_waitlist_entry(text, text, text) from public;
grant execute on function upsert_waitlist_entry(text, text, text) to anon, authenticated, service_role;

create or replace function purge_product(
  p_workspace_id uuid, p_product_id uuid, p_storage_clean boolean,
  p_actor_type text, p_actor_id text, p_request_id text
) returns boolean language plpgsql security definer set search_path = public
as $$
declare v_deleted_at timestamptz;
begin
  select deleted_at into v_deleted_at from products where workspace_id = p_workspace_id and id = p_product_id for update;
  if not found then return true; end if;
  if v_deleted_at is null then raise exception 'PRODUCT_NOT_SOFT_DELETED'; end if;
  if not p_storage_clean or exists (
    select 1 from storage.objects o
    where o.bucket_id = 'social-agent-assets' and (
      o.name in (select object_key from assets where workspace_id = p_workspace_id and product_id = p_product_id)
      or o.name in (select prefill_screenshot_key from publications where workspace_id = p_workspace_id and product_id = p_product_id)
      or o.name like 'source/' || p_product_id::text || '/%'
      or exists (
        select 1 from content_versions cv
        where cv.workspace_id = p_workspace_id and cv.product_id = p_product_id
          and o.name like 'staging/' || cv.id::text || '/%'
      )
    )
  ) then raise exception 'STORAGE_CLEANUP_INCOMPLETE'; end if;

  update audit_events set product_id = null, entity_id = null,
    payload = jsonb_build_object('tombstone', true, 'purged_product_id', p_product_id)
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from learnings where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from weekly_reports where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from metric_snapshots where publication_id in (select id from publications where workspace_id = p_workspace_id and product_id = p_product_id);
  delete from metric_imports where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from publications where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from assets where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from review_findings where review_run_id in (
    select rr.id from review_runs rr join content_versions cv on cv.id = rr.content_version_id
    where cv.workspace_id = p_workspace_id and cv.product_id = p_product_id
  );
  delete from review_runs where content_version_id in (
    select id from content_versions where workspace_id = p_workspace_id and product_id = p_product_id
  );
  delete from content_versions where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from contents where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from content_briefs where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from topic_candidates where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from campaigns where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from product_facts where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from product_sources where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from channels where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from workflow_jobs where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from products where workspace_id = p_workspace_id and id = p_product_id;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, null, p_actor_type, p_actor_id, 'product.purged', 'product', null,
    p_request_id, jsonb_build_object('tombstone', true, 'purged_product_id', p_product_id));
  return true;
end;
$$;
revoke all on function purge_product(uuid, uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function purge_product(uuid, uuid, boolean, text, text, text) to service_role;

create or replace function commit_sync_product_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_output jsonb,
  p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_job workflow_jobs; v_row jsonb; v_source_id uuid;
begin
  select * into v_job from workflow_jobs where workspace_id = p_workspace_id and id = p_job_id for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'sync_product'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;
  for v_row in select value from jsonb_array_elements(coalesce(p_output->'sources','[]'::jsonb)) loop
    v_source_id := coalesce(nullif(v_row->>'id','')::uuid, gen_random_uuid());
    insert into product_sources (id, workspace_id, product_id, kind, locator, last_synced_at)
    values (v_source_id, p_workspace_id, v_job.product_id, v_row->>'kind', v_row->>'locator', clock_timestamp());
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_output->'facts','[]'::jsonb)) loop
    insert into product_facts (workspace_id, product_id, source_id, statement, category, source_locator,
      evidence_excerpt, status, public_use_allowed, verified_by, verified_at)
    values (p_workspace_id, v_job.product_id, nullif(v_row->>'source_id','')::uuid,
      v_row->>'statement', v_row->>'category', v_row->>'source_locator', v_row->>'evidence_excerpt',
      coalesce(v_row->>'status','candidate'), coalesce((v_row->>'public_use_allowed')::boolean,false),
      nullif(v_row->>'verified_by','')::uuid, nullif(v_row->>'verified_at','')::timestamptz);
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_output->'assets','[]'::jsonb)) loop
    insert into assets (workspace_id, product_id, content_version_id, kind, provenance, source_locator,
      verification_status, public_use_allowed, verified_by, verified_at, object_key, mime_type,
      byte_size, width, height, sha256)
    values (p_workspace_id, v_job.product_id, null, v_row->>'kind', 'source', v_row->>'source_locator',
      coalesce(v_row->>'verification_status','candidate'), coalesce((v_row->>'public_use_allowed')::boolean,false),
      v_row->>'verified_by', nullif(v_row->>'verified_at','')::timestamptz, v_row->>'object_key',
      v_row->>'mime_type', (v_row->>'byte_size')::integer, nullif(v_row->>'width','')::integer,
      nullif(v_row->>'height','')::integer, v_row->>'sha256');
  end loop;
  if not finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function commit_sync_product_job(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function commit_sync_product_job(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function commit_generate_topics_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_campaign_id uuid,
  p_candidates jsonb, p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_job workflow_jobs;
begin
  select * into v_job from workflow_jobs where workspace_id = p_workspace_id and id = p_job_id for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'generate_topics'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;
  perform 1 from campaigns where workspace_id = p_workspace_id and id = p_campaign_id and product_id = v_job.product_id;
  if not found then raise exception 'CAMPAIGN_SCOPE_MISMATCH'; end if;
  perform insert_topics_with_audit(p_workspace_id, p_campaign_id, p_candidates, 'worker', p_worker_id,
    'job-output:' || p_job_id::text || ':topics');
  if not finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function commit_generate_topics_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function commit_generate_topics_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function commit_generate_content_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_content_input jsonb,
  p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_job workflow_jobs; v_version content_versions;
begin
  select * into v_job from workflow_jobs where workspace_id = p_workspace_id and id = p_job_id for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'generate_content'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;
  if v_job.product_id is distinct from nullif(p_content_input->>'product_id', '')::uuid then
    raise exception 'CONTENT_SCOPE_MISMATCH';
  end if;
  v_version := create_content_version(p_workspace_id, p_content_input, 'worker', p_worker_id,
    'job-output:' || p_job_id::text || ':content');
  p_result := coalesce(p_result, '{}'::jsonb) || jsonb_build_object('contentVersionId', v_version.id);
  if not finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function commit_generate_content_job(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function commit_generate_content_job(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function commit_review_content_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_content_version_id uuid,
  p_findings jsonb, p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_job workflow_jobs; v_run review_runs;
begin
  select * into v_job from workflow_jobs where workspace_id = p_workspace_id and id = p_job_id for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'review_content'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;
  perform 1 from content_versions where workspace_id = p_workspace_id and id = p_content_version_id
    and product_id = v_job.product_id;
  if not found then raise exception 'CONTENT_VERSION_SCOPE_MISMATCH'; end if;
  v_run := replace_current_review_run(p_workspace_id, p_content_version_id, p_findings,
    'worker', p_worker_id, 'job-output:' || p_job_id::text || ':review');
  p_result := coalesce(p_result, '{}'::jsonb) || jsonb_build_object('reviewRunId', v_run.id);
  if not finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function commit_review_content_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function commit_review_content_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function commit_render_assets_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_content_version_id uuid,
  p_assets jsonb, p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_job workflow_jobs; v_version content_versions; v_row jsonb;
begin
  select * into v_job from workflow_jobs where workspace_id = p_workspace_id and id = p_job_id for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'render_assets'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;
  select * into v_version from content_versions where workspace_id = p_workspace_id and id = p_content_version_id;
  if not found or v_job.product_id is distinct from v_version.product_id then raise exception 'CONTENT_VERSION_SCOPE_MISMATCH'; end if;
  if jsonb_typeof(p_assets) <> 'array' or jsonb_array_length(p_assets) <> 7 or exists (
    select 1 from jsonb_array_elements(p_assets) row group by row->>'object_key' having count(*) <> 1
  ) then raise exception 'ASSET_SET_INVALID'; end if;
  for v_row in select value from jsonb_array_elements(p_assets) loop
    if v_row->>'object_key' not like 'staging/' || p_content_version_id::text || '/%'
      or not storage_object_matches_asset(v_row->>'object_key', v_row->>'mime_type',
        (v_row->>'byte_size')::integer, v_row->>'sha256') then
      raise exception 'ASSET_OBJECT_NOT_VERIFIED';
    end if;
    insert into assets (workspace_id, product_id, content_version_id, kind, provenance,
      verification_status, public_use_allowed, verified_by, verified_at, object_key,
      mime_type, byte_size, width, height, sha256)
    values (p_workspace_id, v_version.product_id, p_content_version_id, 'carousel_page', 'generated',
      'verified', true, p_worker_id, clock_timestamp(),
      v_row->>'object_key', v_row->>'mime_type', (v_row->>'byte_size')::integer,
      nullif(v_row->>'width','')::integer, nullif(v_row->>'height','')::integer, v_row->>'sha256');
  end loop;
  if not finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function commit_render_assets_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function commit_render_assets_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
