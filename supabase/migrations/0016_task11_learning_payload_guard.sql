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
  if jsonb_typeof(p_payload->'sampleCount') is distinct from 'number'
     or v_sample_count_text is null
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
