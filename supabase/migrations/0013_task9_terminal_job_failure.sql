create or replace function public.terminalize_workflow_job(
  p_workspace_id uuid, p_job_id uuid, p_worker_id text, p_error text,
  p_audit_event jsonb
) returns boolean language plpgsql security definer set search_path = public
as $$
declare
  v_job public.workflow_jobs;
begin
  select * into v_job
  from public.workflow_jobs
  where workspace_id = p_workspace_id
    and id = p_job_id
    and status = 'running'
    and locked_by = p_worker_id
  for update;
  if not found then return false; end if;

  update public.workflow_jobs
  set status = 'failed', error = p_error, locked_at = null,
      heartbeat_at = null, locked_by = null, updated_at = clock_timestamp()
  where workspace_id = p_workspace_id and id = p_job_id;

  insert into public.audit_events (
    workspace_id, product_id, actor_type, actor_id, action,
    entity_type, entity_id, request_id, payload
  ) values (
    p_workspace_id, v_job.product_id, p_audit_event->>'actor_type',
    p_audit_event->>'actor_id', 'workflow_job.failed', 'workflow_job',
    p_job_id, p_audit_event->>'request_id',
    coalesce(p_audit_event->'payload', '{}'::jsonb)
      || jsonb_build_object('terminal', true)
  );
  return true;
end;
$$;

revoke all on function public.terminalize_workflow_job(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.terminalize_workflow_job(uuid, uuid, text, text, jsonb)
  to service_role;
