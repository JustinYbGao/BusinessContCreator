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
