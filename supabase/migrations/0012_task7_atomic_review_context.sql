alter table public.review_runs
  add column if not exists review_context jsonb;

create or replace function public.lock_review_input_scope(p_workspace_id uuid, p_product_id uuid)
returns void language sql security definer set search_path = pg_catalog
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('social-agent-review-input-global', 0)
  );
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('social-agent-review-input:' || p_workspace_id::text || ':' || p_product_id::text, 0)
  );
$$;
revoke all on function public.lock_review_input_scope(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lock_review_input_scope(uuid, uuid) to service_role;

create or replace function public.lock_review_input_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_old_scope text;
  v_new_scope text;
begin
  if tg_op = 'DELETE' then
    perform public.lock_review_input_scope(old.workspace_id, old.product_id);
    return old;
  end if;

  if tg_op = 'UPDATE' then
    v_old_scope := old.workspace_id::text || ':' || old.product_id::text;
    v_new_scope := new.workspace_id::text || ':' || new.product_id::text;
    if v_old_scope <> v_new_scope then
      if v_old_scope < v_new_scope then
        perform public.lock_review_input_scope(old.workspace_id, old.product_id);
        perform public.lock_review_input_scope(new.workspace_id, new.product_id);
      else
        perform public.lock_review_input_scope(new.workspace_id, new.product_id);
        perform public.lock_review_input_scope(old.workspace_id, old.product_id);
      end if;
      return new;
    end if;
  end if;

  perform public.lock_review_input_scope(new.workspace_id, new.product_id);
  return new;
end;
$$;
revoke all on function public.lock_review_input_mutation() from public, anon, authenticated;
grant execute on function public.lock_review_input_mutation() to service_role;

drop trigger if exists product_facts_review_input_lock on public.product_facts;
create trigger product_facts_review_input_lock
before insert or update or delete on public.product_facts
for each row execute function public.lock_review_input_mutation();

drop trigger if exists assets_review_input_lock on public.assets;
create trigger assets_review_input_lock
before insert or update or delete on public.assets
for each row execute function public.lock_review_input_mutation();

create or replace function public.commit_sync_product_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_output jsonb,
  p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_job public.workflow_jobs;
  v_row jsonb;
  v_source_id uuid;
  v_product_id uuid;
begin
  select product_id into v_product_id
  from public.workflow_jobs
  where workspace_id = p_workspace_id and id = p_job_id;
  if not found or v_product_id is null then raise exception 'LEASE_LOST'; end if;
  perform public.lock_review_input_scope(p_workspace_id, v_product_id);

  select * into v_job
  from public.workflow_jobs
  where workspace_id = p_workspace_id and id = p_job_id
  for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'sync_product'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_output->'sources', '[]'::jsonb)) loop
    if nullif(v_row->>'id', '') is null then
      insert into public.product_sources (workspace_id, product_id, kind, locator, last_synced_at)
      values (p_workspace_id, v_job.product_id, v_row->>'kind', v_row->>'locator', clock_timestamp());
    else
      v_source_id := (v_row->>'id')::uuid;
      insert into public.product_sources (id, workspace_id, product_id, kind, locator, last_synced_at)
      values (v_source_id, p_workspace_id, v_job.product_id, v_row->>'kind', v_row->>'locator', clock_timestamp());
    end if;
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_output->'facts', '[]'::jsonb)) loop
    insert into public.product_facts (workspace_id, product_id, source_id, statement, category, source_locator,
      evidence_excerpt, status, public_use_allowed, verified_by, verified_at)
    values (p_workspace_id, v_job.product_id, nullif(v_row->>'source_id', '')::uuid,
      v_row->>'statement', v_row->>'category', v_row->>'source_locator', v_row->>'evidence_excerpt',
      coalesce(v_row->>'status', 'candidate'), coalesce((v_row->>'public_use_allowed')::boolean, false),
      nullif(v_row->>'verified_by', '')::uuid, nullif(v_row->>'verified_at', '')::timestamptz);
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_output->'assets', '[]'::jsonb)) loop
    insert into public.assets (workspace_id, product_id, content_version_id, kind, provenance, source_locator,
      verification_status, public_use_allowed, verified_by, verified_at, object_key, mime_type,
      byte_size, width, height, sha256)
    values (p_workspace_id, v_job.product_id, null, v_row->>'kind', 'source', v_row->>'source_locator',
      coalesce(v_row->>'verification_status', 'candidate'), coalesce((v_row->>'public_use_allowed')::boolean, false),
      v_row->>'verified_by', nullif(v_row->>'verified_at', '')::timestamptz, v_row->>'object_key',
      v_row->>'mime_type', (v_row->>'byte_size')::integer, nullif(v_row->>'width', '')::integer,
      nullif(v_row->>'height', '')::integer, v_row->>'sha256');
  end loop;
  if not public.finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function public.commit_sync_product_job(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_sync_product_job(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.commit_generate_topics_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_campaign_id uuid,
  p_candidates jsonb, p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_job public.workflow_jobs;
  v_product_id uuid;
begin
  select product_id into v_product_id
  from public.workflow_jobs
  where workspace_id = p_workspace_id and id = p_job_id;
  if not found or v_product_id is null then raise exception 'LEASE_LOST'; end if;
  perform public.lock_review_input_scope(p_workspace_id, v_product_id);

  select * into v_job
  from public.workflow_jobs
  where workspace_id = p_workspace_id and id = p_job_id
  for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'generate_topics'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;
  perform 1 from public.campaigns
  where workspace_id = p_workspace_id and id = p_campaign_id and product_id = v_job.product_id;
  if not found then raise exception 'CAMPAIGN_SCOPE_MISMATCH'; end if;
  perform public.insert_topics_with_audit(p_workspace_id, p_campaign_id, p_candidates, 'worker', p_worker_id,
    'job-output:' || p_job_id::text || ':topics');
  if not public.finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function public.commit_generate_topics_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_generate_topics_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.commit_generate_content_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_content_input jsonb,
  p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_job public.workflow_jobs;
  v_version public.content_versions;
  v_product_id uuid;
begin
  select product_id into v_product_id
  from public.workflow_jobs
  where workspace_id = p_workspace_id and id = p_job_id;
  if not found or v_product_id is null then raise exception 'LEASE_LOST'; end if;
  perform public.lock_review_input_scope(p_workspace_id, v_product_id);

  select * into v_job
  from public.workflow_jobs
  where workspace_id = p_workspace_id and id = p_job_id
  for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'generate_content'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;
  if v_job.product_id is distinct from nullif(p_content_input->>'product_id', '')::uuid then
    raise exception 'CONTENT_SCOPE_MISMATCH';
  end if;
  v_version := public.create_content_version(p_workspace_id, p_content_input, 'worker', p_worker_id,
    'job-output:' || p_job_id::text || ':content');
  p_result := coalesce(p_result, '{}'::jsonb) || jsonb_build_object('contentVersionId', v_version.id);
  if not public.finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function public.commit_generate_content_job(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_generate_content_job(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.commit_render_assets_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_content_version_id uuid,
  p_assets jsonb, p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_job public.workflow_jobs;
  v_version public.content_versions;
  v_row jsonb;
  v_product_id uuid;
begin
  select product_id into v_product_id
  from public.content_versions
  where workspace_id = p_workspace_id and id = p_content_version_id;
  if not found then raise exception 'CONTENT_VERSION_SCOPE_MISMATCH'; end if;
  perform public.lock_review_input_scope(p_workspace_id, v_product_id);

  select * into v_job
  from public.workflow_jobs
  where workspace_id = p_workspace_id and id = p_job_id
  for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'render_assets'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;
  select * into v_version
  from public.content_versions
  where workspace_id = p_workspace_id and id = p_content_version_id;
  if not found or v_job.product_id is distinct from v_version.product_id then
    raise exception 'CONTENT_VERSION_SCOPE_MISMATCH';
  end if;
  if jsonb_typeof(p_assets) <> 'array' or jsonb_array_length(p_assets) <> 7 or exists (
    select 1 from jsonb_array_elements(p_assets) row
    group by row->>'object_key' having count(*) <> 1
  ) then raise exception 'ASSET_SET_INVALID'; end if;
  for v_row in select value from jsonb_array_elements(p_assets) loop
    if v_row->>'object_key' not like 'staging/' || p_content_version_id::text || '/%'
      or not public.storage_object_matches_asset(v_row->>'object_key', v_row->>'mime_type',
        (v_row->>'byte_size')::integer, v_row->>'sha256') then
      raise exception 'ASSET_OBJECT_NOT_VERIFIED';
    end if;
    insert into public.assets (workspace_id, product_id, content_version_id, kind, provenance,
      verification_status, public_use_allowed, verified_by, verified_at, object_key,
      mime_type, byte_size, width, height, sha256)
    values (p_workspace_id, v_version.product_id, p_content_version_id, 'carousel_page', 'generated',
      'verified', true, p_worker_id, clock_timestamp(), v_row->>'object_key', v_row->>'mime_type',
      (v_row->>'byte_size')::integer, nullif(v_row->>'width', '')::integer,
      nullif(v_row->>'height', '')::integer, v_row->>'sha256');
  end loop;
  if not public.finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function public.commit_render_assets_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_render_assets_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.review_context_for_version(
  p_workspace_id uuid, p_content_version_id uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_context jsonb;
begin
  select jsonb_build_object(
    'contentVersionId', v.id,
    'payload', v.payload,
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'workspaceId', f.workspace_id,
        'productId', f.product_id,
        'statement', f.statement,
        'status', f.status,
        'publicUseAllowed', f.public_use_allowed
      ) order by f.id)
      from public.product_facts f
      where f.workspace_id = p_workspace_id and f.product_id = v.product_id
    ), '[]'::jsonb),
    'sourceAssets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'workspaceId', a.workspace_id,
        'productId', a.product_id,
        'contentVersionId', a.content_version_id,
        'kind', a.kind,
        'sourceLocator', a.source_locator,
        'provenance', a.provenance,
        'verificationStatus', a.verification_status,
        'publicUseAllowed', a.public_use_allowed
      ) order by a.id)
      from public.assets a
      where a.workspace_id = p_workspace_id
        and a.product_id = v.product_id
        and a.content_version_id is null
    ), '[]'::jsonb),
    'recentApprovedContents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contentId', recent.content_id,
        'contentVersionId', recent.id,
        'payload', recent.payload
      ) order by recent.created_at desc, recent.id desc)
      from (
        select cv.id, cv.content_id, cv.payload, cv.created_at
        from public.content_versions cv
        where cv.workspace_id = p_workspace_id
          and cv.product_id = v.product_id
          and cv.status = 'approved'
          and cv.id <> p_content_version_id
        order by cv.created_at desc, cv.id desc
        limit 30
      ) recent
    ), '[]'::jsonb)
  ) into v_context
  from public.content_versions v
  where v.workspace_id = p_workspace_id and v.id = p_content_version_id;

  if v_context is null then raise exception 'CONTENT_VERSION_NOT_FOUND'; end if;
  return v_context;
end;
$$;
revoke all on function public.review_context_for_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.review_context_for_version(uuid, uuid) to service_role;

create or replace function public.replace_current_review_run_impl(
  p_workspace_id uuid, p_content_version_id uuid, p_findings jsonb,
  p_review_context jsonb, p_actor_type text, p_actor_id text, p_request_id text
) returns public.review_runs language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_product_id uuid;
  v_version public.content_versions;
  v_run public.review_runs;
  v_number integer;
  v_finding jsonb;
  v_result text;
begin
  select product_id into v_product_id
  from public.content_versions
  where workspace_id = p_workspace_id and id = p_content_version_id;
  if not found then raise exception 'CONTENT_VERSION_NOT_FOUND'; end if;
  perform public.lock_review_input_scope(p_workspace_id, v_product_id);
  select * into v_version
  from public.content_versions
  where workspace_id = p_workspace_id and id = p_content_version_id
  for update;
  if not found then raise exception 'CONTENT_VERSION_NOT_FOUND'; end if;
  if v_version.status = 'approved' then raise exception 'CONTENT_VERSION_IMMUTABLE'; end if;

  if p_review_context is null or p_review_context <> public.review_context_for_version(p_workspace_id, p_content_version_id) then
    raise exception 'REVIEW_CONTEXT_CHANGED';
  end if;

  update public.review_runs set is_current = false
  where content_version_id = p_content_version_id and is_current;
  select coalesce(max(run_number), 0) + 1 into v_number
  from public.review_runs where content_version_id = p_content_version_id;
  v_result := case when exists (
    select 1 from jsonb_array_elements(p_findings) value where value->>'severity' = 'blocking'
  ) then 'blocked' else 'passed' end;
  insert into public.review_runs (content_version_id, run_number, result, actor_type, actor_id, review_context)
  values (p_content_version_id, v_number, v_result, p_actor_type, p_actor_id, p_review_context)
  returning * into v_run;
  for v_finding in select value from jsonb_array_elements(p_findings) loop
    insert into public.review_findings (review_run_id, code, severity, message)
    values (v_run.id, v_finding->>'code', v_finding->>'severity', v_finding->>'message');
  end loop;
  update public.content_versions set status = 'review_required' where id = p_content_version_id;
  update public.contents set status = 'review_required' where id = v_version.content_id;
  insert into public.audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_version.product_id, p_actor_type, p_actor_id, 'review.completed',
    'content_version', p_content_version_id, p_request_id,
    jsonb_build_object('run_id', v_run.id, 'run_number', v_number, 'result', v_result));
  return v_run;
end;
$$;
revoke all on function public.replace_current_review_run_impl(uuid, uuid, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.replace_current_review_run_impl(uuid, uuid, jsonb, jsonb, text, text, text) to service_role;

create or replace function public.replace_current_review_run(
  p_workspace_id uuid, p_content_version_id uuid, p_findings jsonb,
  p_actor_type text, p_actor_id text, p_request_id text
) returns public.review_runs language plpgsql security definer set search_path = pg_catalog
as $$
begin
  raise exception 'REVIEW_CONTEXT_REQUIRED';
end;
$$;
revoke all on function public.replace_current_review_run(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.replace_current_review_run(uuid, uuid, jsonb, text, text, text) to service_role;

create or replace function public.replace_current_review_run_with_context(
  p_workspace_id uuid, p_content_version_id uuid, p_findings jsonb,
  p_review_context jsonb, p_actor_type text, p_actor_id text, p_request_id text
) returns public.review_runs language plpgsql security definer set search_path = pg_catalog
as $$
begin
  return public.replace_current_review_run_impl(
    p_workspace_id, p_content_version_id, p_findings, p_review_context,
    p_actor_type, p_actor_id, p_request_id
  );
end;
$$;
revoke all on function public.replace_current_review_run_with_context(uuid, uuid, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.replace_current_review_run_with_context(uuid, uuid, jsonb, jsonb, text, text, text) to service_role;

create or replace function public.commit_review_content_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_content_version_id uuid,
  p_findings jsonb, p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
begin
  raise exception 'REVIEW_CONTEXT_REQUIRED';
end;
$$;
revoke all on function public.commit_review_content_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_review_content_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.commit_review_content_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_content_version_id uuid,
  p_review_context jsonb, p_findings jsonb, p_result jsonb, p_audit_event jsonb, p_next_job jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_job public.workflow_jobs;
  v_run public.review_runs;
  v_product_id uuid;
begin
  select product_id into v_product_id
  from public.content_versions
  where workspace_id = p_workspace_id and id = p_content_version_id;
  if not found then raise exception 'CONTENT_VERSION_SCOPE_MISMATCH'; end if;
  perform public.lock_review_input_scope(p_workspace_id, v_product_id);

  select * into v_job
  from public.workflow_jobs
  where workspace_id = p_workspace_id and id = p_job_id
  for update;
  if not found then raise exception 'LEASE_LOST'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.locked_by <> p_worker_id or v_job.kind <> 'review_content'
    or v_job.product_id is null then raise exception 'LEASE_LOST'; end if;
  perform 1 from public.content_versions
  where workspace_id = p_workspace_id and id = p_content_version_id
    and product_id = v_job.product_id;
  if not found then raise exception 'CONTENT_VERSION_SCOPE_MISMATCH'; end if;
  v_run := public.replace_current_review_run_with_context(
    p_workspace_id, p_content_version_id, p_findings, p_review_context,
    'worker', p_worker_id, 'job-output:' || p_job_id::text || ':review'
  );
  p_result := coalesce(p_result, '{}'::jsonb) || jsonb_build_object('reviewRunId', v_run.id);
  if not public.finish_workflow_job(p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job) then
    raise exception 'LEASE_LOST';
  end if;
  return p_result;
end;
$$;
revoke all on function public.commit_review_content_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_review_content_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.purge_product(
  p_workspace_id uuid, p_product_id uuid, p_storage_clean boolean,
  p_actor_type text, p_actor_id text, p_request_id text
) returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_deleted_at timestamptz;
begin
  perform public.lock_review_input_scope(p_workspace_id, p_product_id);
  select deleted_at into v_deleted_at
  from public.products
  where workspace_id = p_workspace_id and id = p_product_id
  for update;
  if not found then return true; end if;
  if v_deleted_at is null then raise exception 'PRODUCT_NOT_SOFT_DELETED'; end if;
  if not p_storage_clean or exists (
    select 1 from storage.objects o where o.bucket_id = 'social-agent-assets' and (
      o.name in (select object_key from public.assets where workspace_id = p_workspace_id and product_id = p_product_id)
      or o.name in (select prefill_screenshot_key from public.publications where workspace_id = p_workspace_id and product_id = p_product_id)
      or o.name like 'source/' || p_product_id::text || '/%'
      or exists (
        select 1 from public.content_versions cv
        where cv.workspace_id = p_workspace_id and cv.product_id = p_product_id
          and o.name like 'staging/' || cv.id::text || '/%'
      )
    )
  ) then raise exception 'STORAGE_CLEANUP_INCOMPLETE'; end if;

  update public.audit_events set product_id = null, entity_id = null,
    payload = jsonb_build_object('tombstone', true, 'purged_product_id', p_product_id)
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.learnings where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.weekly_reports where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.metric_snapshots where publication_id in (select id from public.publications where workspace_id = p_workspace_id and product_id = p_product_id);
  delete from public.metric_imports where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.publications where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.assets where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.review_findings where review_run_id in (
    select rr.id from public.review_runs rr join public.content_versions cv on cv.id = rr.content_version_id
    where cv.workspace_id = p_workspace_id and cv.product_id = p_product_id
  );
  delete from public.review_runs where content_version_id in (
    select id from public.content_versions where workspace_id = p_workspace_id and product_id = p_product_id
  );
  delete from public.content_versions where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.contents where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.content_briefs where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.topic_candidates where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.campaigns where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.product_facts where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.product_sources where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.channels where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.workflow_jobs where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.products where workspace_id = p_workspace_id and id = p_product_id;
  insert into public.audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, null, p_actor_type, p_actor_id, 'product.purged', 'product', null,
    p_request_id, jsonb_build_object('tombstone', true, 'purged_product_id', p_product_id));
  return true;
end;
$$;
revoke all on function public.purge_product(uuid, uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.purge_product(uuid, uuid, boolean, text, text, text) to service_role;

create or replace function public.approve_content_version(
  p_workspace_id uuid, p_content_version_id uuid, p_expected_payload jsonb,
  p_expected_sha256 text, p_approved_by uuid, p_actor_type text, p_request_id text
) returns public.content_versions language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_product_id uuid;
  v_version public.content_versions;
  v_review_context jsonb;
begin
  select product_id into v_product_id
  from public.content_versions
  where workspace_id = p_workspace_id and id = p_content_version_id;
  if not found then raise exception 'CONTENT_VERSION_NOT_FOUND'; end if;
  perform public.lock_review_input_scope(p_workspace_id, v_product_id);
  select * into v_version
  from public.content_versions
  where workspace_id = p_workspace_id and id = p_content_version_id
  for update;
  if not found then raise exception 'CONTENT_VERSION_NOT_FOUND'; end if;
  if v_version.status = 'approved' then return v_version; end if;
  if v_version.payload <> p_expected_payload or v_version.content_sha256 <> p_expected_sha256 then
    raise exception 'CONTENT_VERSION_CHANGED';
  end if;

  select rr.review_context into v_review_context
  from public.review_runs rr
  where rr.content_version_id = p_content_version_id and rr.is_current and rr.result = 'passed'
  for update;
  if not found or v_review_context is null then raise exception 'CURRENT_REVIEW_NOT_PASSED'; end if;
  if v_review_context <> public.review_context_for_version(p_workspace_id, p_content_version_id) then
    raise exception 'REVIEW_CONTEXT_CHANGED';
  end if;

  update public.content_versions set status = 'approved', approved_by = p_approved_by, approved_at = clock_timestamp()
  where id = p_content_version_id returning * into v_version;
  update public.contents set status = 'approved' where id = v_version.content_id;
  insert into public.audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_version.product_id, p_actor_type, p_approved_by::text, 'content_version.approved',
    'content_version', p_content_version_id, p_request_id,
    jsonb_build_object('content_sha256', v_version.content_sha256));
  return v_version;
end;
$$;
revoke all on function public.approve_content_version(uuid, uuid, jsonb, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.approve_content_version(uuid, uuid, jsonb, text, uuid, text, text) to service_role;
