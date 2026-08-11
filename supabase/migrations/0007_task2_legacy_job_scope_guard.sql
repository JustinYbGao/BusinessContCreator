create or replace function claim_workflow_job(
  p_workspace_id uuid, p_worker_id text, p_now timestamptz, p_stale_before timestamptz
) returns setof workflow_jobs language plpgsql security definer set search_path = public
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
