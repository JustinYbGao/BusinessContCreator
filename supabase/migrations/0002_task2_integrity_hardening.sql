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
