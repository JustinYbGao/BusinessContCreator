alter table public.assets
  drop constraint if exists assets_object_key_namespace;

alter table public.assets
  add constraint assets_object_key_namespace
  check (
    (provenance = 'source' and object_key like 'source/' || product_id::text || '/%')
    or (
      provenance = 'generated'
      and content_version_id is not null
      and object_key ~ (
        '^workspaces/' || workspace_id::text
        || '/products/' || product_id::text
        || '/contents/' || content_version_id::text
        || '/page-[1-7]-[a-f0-9]{64}[.]png$'
      )
    )
  ) not valid;

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
  v_prefix text;
  v_page integer;
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

  v_prefix := 'workspaces/' || p_workspace_id::text
    || '/products/' || v_version.product_id::text
    || '/contents/' || p_content_version_id::text || '/';
  if jsonb_typeof(p_assets) is distinct from 'array' then
    raise exception 'ASSET_SET_INVALID';
  end if;
  if jsonb_array_length(p_assets) <> 7 or exists (
    select 1 from jsonb_array_elements(p_assets) row
    group by row->>'object_key' having count(*) <> 1
  ) then raise exception 'ASSET_SET_INVALID'; end if;

  for v_row in select value from jsonb_array_elements(p_assets) loop
    if jsonb_typeof(v_row) is distinct from 'object'
      or jsonb_typeof(v_row->'width') is distinct from 'number'
      or jsonb_typeof(v_row->'height') is distinct from 'number'
      or jsonb_typeof(v_row->'byte_size') is distinct from 'number'
      or jsonb_typeof(v_row->'mime_type') is distinct from 'string'
      or jsonb_typeof(v_row->'sha256') is distinct from 'string'
      or jsonb_typeof(v_row->'object_key') is distinct from 'string'
      or v_row->>'width' !~ '^[0-9]+$'
      or v_row->>'height' !~ '^[0-9]+$'
      or v_row->>'byte_size' !~ '^[0-9]+$' then
      raise exception 'ASSET_OBJECT_NOT_VERIFIED';
    end if;
    if v_row->>'mime_type' <> 'image/png'
      or (v_row->>'width')::numeric <> 1080
      or (v_row->>'height')::numeric <> 1440
      or (v_row->>'byte_size')::numeric <= 0
      or (v_row->>'byte_size')::numeric > 2147483647
      or v_row->>'sha256' !~ '^[a-f0-9]{64}$'
      or v_row->>'object_key' !~ (
        '^' || v_prefix || 'page-[1-7]-[a-f0-9]{64}[.]png$'
      )
      or v_row->>'object_key' not like '%-' || (v_row->>'sha256') || '.png'
      or not public.storage_object_matches_asset(
        v_row->>'object_key', 'image/png', (v_row->>'byte_size')::integer, v_row->>'sha256'
      ) then
      raise exception 'ASSET_OBJECT_NOT_VERIFIED';
    end if;
  end loop;

  for v_page in 1..7 loop
    if not exists (
      select 1 from jsonb_array_elements(p_assets) row
      where row->>'object_key' like v_prefix || 'page-' || v_page::text || '-%'
    ) then raise exception 'ASSET_SET_INVALID'; end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_assets) loop
    insert into public.assets (
      workspace_id, product_id, content_version_id, kind, provenance,
      verification_status, public_use_allowed, verified_by, verified_at, object_key,
      mime_type, byte_size, width, height, sha256
    ) values (
      p_workspace_id, v_version.product_id, p_content_version_id, 'carousel_page', 'generated',
      'verified', true, p_worker_id, clock_timestamp(), v_row->>'object_key',
      'image/png', (v_row->>'byte_size')::integer, 1080, 1440, v_row->>'sha256'
    );
  end loop;

  if not public.finish_workflow_job(
    p_workspace_id, p_job_id, p_worker_id, p_result, p_audit_event, p_next_job
  ) then raise exception 'LEASE_LOST'; end if;
  return p_result;
end;
$$;
revoke all on function public.commit_render_assets_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_render_assets_job(uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb)
  to service_role;

create or replace function public.create_publication(
  p_workspace_id uuid, p_content_version_id uuid, p_idempotency_key text,
  p_actor_type text, p_actor_id text, p_request_id text
) returns public.publications language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_version public.content_versions;
  v_content public.contents;
  v_campaign public.campaigns;
  v_publication public.publications;
  v_keys jsonb;
  v_hashes jsonb;
  v_asset_count integer;
  v_valid_asset_count integer;
  v_page_count integer;
  v_prefix text;
  v_existing_idempotency_key text;
  v_publication_id uuid := gen_random_uuid();
begin
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 200 then
    raise exception 'IDEMPOTENCY_KEY_INVALID';
  end if;
  select * into v_version
  from public.content_versions
  where workspace_id = p_workspace_id and id = p_content_version_id
  for update;
  if not found or v_version.status <> 'approved' then raise exception 'CONTENT_NOT_APPROVED'; end if;

  select * into v_publication
  from public.publications
  where workspace_id = p_workspace_id and content_version_id = p_content_version_id;
  if found then
    select ae.payload->>'idempotency_key' into v_existing_idempotency_key
    from public.audit_events ae
    where ae.workspace_id = p_workspace_id
      and ae.entity_type = 'publication'
      and ae.entity_id = v_publication.id
      and ae.action = 'publication.created'
    order by ae.created_at
    limit 1;
    if not found then raise exception 'PUBLICATION_IDEMPOTENCY_LOOKUP_FAILED'; end if;
    if v_existing_idempotency_key is distinct from p_idempotency_key then
      raise exception 'PUBLICATION_ALREADY_PACKAGED';
    end if;
    return v_publication;
  end if;

  perform 1 from public.review_runs
  where content_version_id = p_content_version_id and is_current and result = 'passed';
  if not found then raise exception 'CURRENT_REVIEW_NOT_PASSED'; end if;

  v_prefix := 'workspaces/' || p_workspace_id::text
    || '/products/' || v_version.product_id::text
    || '/contents/' || p_content_version_id::text || '/';
  select
    count(*),
    count(*) filter (where
      a.mime_type = 'image/png'
      and a.width = 1080
      and a.height = 1440
      and a.sha256 ~ '^[a-f0-9]{64}$'
      and a.object_key ~ ('^' || v_prefix || 'page-[1-7]-[a-f0-9]{64}[.]png$')
      and a.object_key like '%-' || a.sha256 || '.png'
      and public.storage_object_matches_asset(a.object_key, 'image/png', a.byte_size, a.sha256)
    ),
    count(distinct substring(a.object_key from '/page-([1-7])-')::integer)
  into v_asset_count, v_valid_asset_count, v_page_count
  from public.assets a
  where a.workspace_id = p_workspace_id
    and a.product_id = v_version.product_id
    and a.content_version_id = p_content_version_id
    and a.provenance = 'generated'
    and a.kind = 'carousel_page'
    and a.verification_status = 'verified'
    and a.public_use_allowed;
  if v_asset_count <> 7 or v_valid_asset_count <> 7 or v_page_count <> 7 then
    raise exception 'ASSET_SET_INVALID';
  end if;

  select
    jsonb_agg(a.object_key order by substring(a.object_key from '/page-([1-7])-')::integer),
    jsonb_agg(a.sha256 order by substring(a.object_key from '/page-([1-7])-')::integer)
  into v_keys, v_hashes
  from public.assets a
  where a.workspace_id = p_workspace_id
    and a.product_id = v_version.product_id
    and a.content_version_id = p_content_version_id
    and a.provenance = 'generated'
    and a.kind = 'carousel_page'
    and a.verification_status = 'verified'
    and a.public_use_allowed;

  select * into v_content
  from public.contents
  where workspace_id = p_workspace_id and id = v_version.content_id;
  if not found then raise exception 'CONTENT_SCOPE_MISMATCH'; end if;
  select * into v_campaign
  from public.campaigns
  where workspace_id = p_workspace_id and id = v_version.campaign_id;
  if not found then raise exception 'CAMPAIGN_SCOPE_MISMATCH'; end if;

  insert into public.publications (
    id, workspace_id, product_id, campaign_id, channel_id, content_version_id, status, package
  ) values (
    v_publication_id, p_workspace_id, v_version.product_id, v_version.campaign_id,
    v_campaign.channel_id, p_content_version_id, 'READY_TO_PREFILL', jsonb_build_object(
      'publicationId', v_publication_id,
      'contentVersionId', p_content_version_id,
      'title', v_version.payload->>'recommendedTitle',
      'body', v_version.payload->>'body',
      'imageObjectKeys', v_keys,
      'imageSha256', v_hashes,
      'contentSha256', v_version.content_sha256
    )
  ) returning * into v_publication;

  update public.contents
  set status = 'packaged'
  where workspace_id = p_workspace_id and id = v_version.content_id;
  insert into public.audit_events (
    workspace_id, product_id, actor_type, actor_id, action, entity_type,
    entity_id, request_id, payload
  ) values (
    p_workspace_id, v_version.product_id, p_actor_type, p_actor_id,
    'publication.created', 'publication', v_publication.id, p_request_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'content_version_id', p_content_version_id
    )
  );
  return v_publication;
end;
$$;
revoke all on function public.create_publication(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_publication(uuid, uuid, text, text, text, text)
  to service_role;

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
      o.name in (
        select object_key from public.assets
        where workspace_id = p_workspace_id and product_id = p_product_id
      )
      or o.name in (
        select prefill_screenshot_key from public.publications
        where workspace_id = p_workspace_id and product_id = p_product_id
      )
      or o.name like 'source/' || p_product_id::text || '/%'
      or o.name like 'workspaces/' || p_workspace_id::text
        || '/products/' || p_product_id::text || '/%'
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
  delete from public.learnings
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.weekly_reports
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.metric_snapshots where publication_id in (
    select id from public.publications
    where workspace_id = p_workspace_id and product_id = p_product_id
  );
  delete from public.metric_imports
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.publications
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.assets
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.review_findings where review_run_id in (
    select rr.id from public.review_runs rr
    join public.content_versions cv on cv.id = rr.content_version_id
    where cv.workspace_id = p_workspace_id and cv.product_id = p_product_id
  );
  delete from public.review_runs where content_version_id in (
    select id from public.content_versions
    where workspace_id = p_workspace_id and product_id = p_product_id
  );
  delete from public.content_versions
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.contents
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.content_briefs
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.topic_candidates
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.campaigns
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.product_facts
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.product_sources
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.channels
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.workflow_jobs
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from public.products
    where workspace_id = p_workspace_id and id = p_product_id;
  insert into public.audit_events (
    workspace_id, product_id, actor_type, actor_id, action, entity_type,
    entity_id, request_id, payload
  ) values (
    p_workspace_id, null, p_actor_type, p_actor_id, 'product.purged',
    'product', null, p_request_id,
    jsonb_build_object('tombstone', true, 'purged_product_id', p_product_id)
  );
  return true;
end;
$$;
revoke all on function public.purge_product(uuid, uuid, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.purge_product(uuid, uuid, boolean, text, text, text)
  to service_role;
