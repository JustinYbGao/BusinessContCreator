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
    version, payload, prompt_version, model_name, content_sha256, status, edit_reason, created_by)
  values (p_workspace_id, (p_input->>'product_id')::uuid, (p_input->>'campaign_id')::uuid,
    (p_input->>'content_id')::uuid, (p_input->>'topic_id')::uuid, (p_input->>'brief_id')::uuid,
    v_number, p_input->'payload', p_input->>'prompt_version', p_input->>'model_name',
    p_input->>'content_sha256', 'draft', nullif(p_input->>'edit_reason', ''), p_input->>'created_by')
  returning * into v_version;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, v_version.product_id, p_actor_type, p_actor_id, 'content_version.created',
    'content_version', v_version.id, p_request_id,
    jsonb_build_object('version', v_number, 'edit_reason', v_version.edit_reason));
  return v_version;
end;
$$;
revoke all on function create_content_version(uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function create_content_version(uuid, jsonb, text, text, text) to service_role;
