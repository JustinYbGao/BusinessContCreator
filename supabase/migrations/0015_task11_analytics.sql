create index if not exists idx_publications_campaign_scope
  on public.publications(workspace_id, product_id, campaign_id, created_at);

create or replace function public.register_publication(
  p_workspace_id uuid,
  p_publication_id uuid,
  p_public_url text,
  p_published_at timestamptz,
  p_actor_id text,
  p_request_id text
) returns public.publications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_publication public.publications;
begin
  if btrim(coalesce(p_actor_id, '')) = '' then
    raise exception 'ACTOR_REQUIRED';
  end if;
  if btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if p_published_at is null then
    raise exception 'PUBLISHED_AT_REQUIRED';
  end if;
  if p_public_url is null
     or p_public_url !~ '^https://(www\.xiaohongshu\.com|xhslink\.com)(/|\?|#|$)' then
    raise exception 'PUBLICATION_URL_INVALID';
  end if;
  if exists (
    select 1
    from public.publisher_devices
    where id::text = p_actor_id
      and revoked_at is null
  ) then
    raise exception 'PUBLISHER_DEVICE_ACTOR_NOT_ALLOWED';
  end if;

  select * into v_publication
  from public.publications
  where workspace_id = p_workspace_id
    and id = p_publication_id
  for update;
  if not found then
    raise exception 'PUBLICATION_NOT_FOUND';
  end if;

  if v_publication.status = 'PUBLISHED' then
    if v_publication.public_url is not distinct from p_public_url
       and v_publication.published_at is not distinct from p_published_at then
      return v_publication;
    end if;
    raise exception 'PUBLICATION_REGISTRATION_CONFLICT';
  end if;
  if v_publication.status <> 'AWAITING_HUMAN_PUBLISH' then
    raise exception 'PUBLICATION_STATE_INVALID';
  end if;
  if v_publication.claimed_by_device_id is not null then
    raise exception 'PUBLICATION_DEVICE_CLAIMED';
  end if;

  update public.publications
  set status = 'PUBLISHED',
      public_url = p_public_url,
      published_at = p_published_at
  where workspace_id = p_workspace_id
    and id = p_publication_id
    and status = 'AWAITING_HUMAN_PUBLISH'
    and claimed_by_device_id is null
  returning * into v_publication;
  if not found then
    raise exception 'PUBLICATION_REGISTRATION_CONFLICT';
  end if;

  insert into public.audit_events (
    workspace_id, product_id, actor_type, actor_id, action,
    entity_type, entity_id, request_id, payload
  ) values (
    p_workspace_id, v_publication.product_id, 'user', p_actor_id,
    'publication.registered', 'publication', v_publication.id, p_request_id,
    jsonb_build_object('public_url', p_public_url, 'published_at', p_published_at)
  );
  return v_publication;
end;
$$;

revoke all on function public.register_publication(uuid, uuid, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.register_publication(uuid, uuid, text, timestamptz, text, text)
  to service_role;

create or replace function public.create_weekly_report(
  p_workspace_id uuid,
  p_product_id uuid,
  p_campaign_id uuid,
  p_week_start date,
  p_payload jsonb,
  p_source_snapshot_ids uuid[],
  p_actor_id text,
  p_request_id text
) returns public.weekly_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.weekly_reports;
  v_source_snapshot_ids uuid[];
  v_action text;
begin
  if btrim(coalesce(p_actor_id, '')) = '' then
    raise exception 'ACTOR_REQUIRED';
  end if;
  if btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if p_week_start is null then
    raise exception 'WEEK_START_REQUIRED';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'WEEKLY_REPORT_PAYLOAD_INVALID';
  end if;

  perform 1
  from public.products p
  join public.campaigns c
    on c.workspace_id = p.workspace_id
   and c.product_id = p.id
   and c.id = p_campaign_id
  where p.workspace_id = p_workspace_id
    and p.id = p_product_id
    and p.deleted_at is null;
  if not found then
    raise exception 'CAMPAIGN_SCOPE_MISMATCH';
  end if;

  v_source_snapshot_ids := coalesce(
    (
      select array_agg(snapshot_id order by snapshot_id)
      from unnest(coalesce(p_source_snapshot_ids, '{}'::uuid[])) as source(snapshot_id)
    ),
    '{}'::uuid[]
  );
  if exists (
    select 1
    from unnest(v_source_snapshot_ids) as source(snapshot_id)
    left join public.metric_snapshots ms on ms.id = source.snapshot_id
    left join public.publications pub on pub.id = ms.publication_id
    where ms.id is null
       or pub.workspace_id is distinct from p_workspace_id
       or pub.product_id is distinct from p_product_id
       or pub.campaign_id is distinct from p_campaign_id
  ) then
    raise exception 'SNAPSHOT_SCOPE_MISMATCH';
  end if;

  insert into public.weekly_reports (
    workspace_id, product_id, campaign_id, week_start, payload, source_snapshot_ids
  ) values (
    p_workspace_id, p_product_id, p_campaign_id, p_week_start,
    p_payload, v_source_snapshot_ids
  )
  on conflict (campaign_id, week_start) do nothing
  returning * into v_report;

  if found then
    v_action := 'weekly_report.created';
  else
    select * into v_report
    from public.weekly_reports
    where campaign_id = p_campaign_id
      and week_start = p_week_start
    for update;
    if not found then
      raise exception 'WEEKLY_REPORT_CONFLICT';
    end if;
    if v_report.payload is not distinct from p_payload
       and v_report.source_snapshot_ids is not distinct from v_source_snapshot_ids then
      return v_report;
    end if;
    update public.weekly_reports
    set payload = p_payload,
        source_snapshot_ids = v_source_snapshot_ids
    where id = v_report.id
    returning * into v_report;
    v_action := 'weekly_report.replaced';
  end if;

  insert into public.audit_events (
    workspace_id, product_id, actor_type, actor_id, action,
    entity_type, entity_id, request_id, payload
  ) values (
    p_workspace_id, p_product_id, 'user', p_actor_id, v_action,
    'weekly_report', v_report.id, p_request_id,
    jsonb_build_object(
      'week_start', p_week_start,
      'source_snapshot_count', cardinality(v_source_snapshot_ids),
      'source_snapshot_ids', to_jsonb(v_source_snapshot_ids)
    )
  );
  return v_report;
end;
$$;

revoke all on function public.create_weekly_report(uuid, uuid, uuid, date, jsonb, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.create_weekly_report(uuid, uuid, uuid, date, jsonb, uuid[], text, text)
  to service_role;

create or replace function public.create_learning(
  p_workspace_id uuid,
  p_product_id uuid,
  p_publication_id uuid,
  p_evidence_window text,
  p_payload jsonb,
  p_actor_id text,
  p_request_id text
) returns public.learnings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_publication public.publications;
  v_learning public.learnings;
  v_existing_learning_id uuid;
  v_sample_count integer;
  v_sample_count_text text;
  v_confidence text;
begin
  if btrim(coalesce(p_actor_id, '')) = '' then
    raise exception 'ACTOR_REQUIRED';
  end if;
  if btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if coalesce(p_evidence_window, '') not in ('24h', '72h', '7d') then
    raise exception 'EVIDENCE_WINDOW_INVALID';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'LEARNING_PAYLOAD_INVALID';
  end if;

  v_sample_count_text := p_payload->>'sampleCount';
  if jsonb_typeof(p_payload->'sampleCount') <> 'number'
     or v_sample_count_text !~ '^[0-9]+$'
     or length(v_sample_count_text) > 10
     or (length(v_sample_count_text) = 10 and v_sample_count_text > '2147483647') then
    raise exception 'LEARNING_SAMPLE_COUNT_INVALID';
  end if;
  v_sample_count := v_sample_count_text::integer;
  v_confidence := p_payload->>'confidence';
  if coalesce(v_confidence, '') not in ('hypothesis', 'directional') then
    raise exception 'LEARNING_CONFIDENCE_INVALID';
  end if;
  if (v_confidence = 'directional' and v_sample_count < 10)
     or (v_confidence = 'hypothesis' and v_sample_count >= 10) then
    raise exception 'LEARNING_CONFIDENCE_MISMATCH';
  end if;

  select pub.* into v_publication
  from public.publications pub
  where pub.workspace_id = p_workspace_id
    and pub.product_id = p_product_id
    and pub.id = p_publication_id
  for update;
  if not found then
    raise exception 'PUBLICATION_SCOPE_MISMATCH';
  end if;
  perform 1
  from public.metric_snapshots ms
  where ms.publication_id = p_publication_id
    and ms."window" = p_evidence_window;
  if not found then
    raise exception 'EVIDENCE_WINDOW_INCOMPLETE';
  end if;

  select ae.entity_id into v_existing_learning_id
  from public.audit_events ae
  where ae.workspace_id = p_workspace_id
    and ae.request_id = p_request_id
    and ae.action = 'learning.created'
    and ae.entity_type = 'learning'
    and ae.entity_id is not null
  order by ae.created_at desc
  limit 1;
  if found then
    select * into v_learning
    from public.learnings
    where workspace_id = p_workspace_id
      and id = v_existing_learning_id;
    if found then
      return v_learning;
    end if;
  end if;

  insert into public.learnings (
    workspace_id, product_id, publication_id, evidence_window, payload
  ) values (
    p_workspace_id, p_product_id, p_publication_id, p_evidence_window, p_payload
  ) returning * into v_learning;

  insert into public.audit_events (
    workspace_id, product_id, actor_type, actor_id, action,
    entity_type, entity_id, request_id, payload
  ) values (
    p_workspace_id, p_product_id, 'user', p_actor_id, 'learning.created',
    'learning', v_learning.id, p_request_id,
    jsonb_build_object(
      'evidence_window', p_evidence_window,
      'sample_count', v_sample_count,
      'confidence', v_confidence
    )
  );
  return v_learning;
end;
$$;

revoke all on function public.create_learning(uuid, uuid, uuid, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.create_learning(uuid, uuid, uuid, text, jsonb, text, text)
  to service_role;
