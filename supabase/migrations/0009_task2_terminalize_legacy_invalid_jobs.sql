alter table workflow_jobs drop constraint workflow_jobs_kind_allowed;
alter table workflow_jobs drop constraint workflow_jobs_product_required;

with invalid_jobs as (
  update workflow_jobs
  set status = 'failed', error = 'INVALID_JOB_SCOPE', locked_at = null, heartbeat_at = null, locked_by = null, updated_at = clock_timestamp()
  where status in ('queued', 'running')
    and (product_id is null or kind not in ('sync_product', 'purge_product', 'generate_topics', 'generate_content', 'review_content', 'render_assets'))
  returning id, workspace_id
)
insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
select workspace_id, null, 'system', 'migration', 'workflow_job.invalid_scope', 'workflow_job', id,
  'migration:invalid-job-scope:' || id::text, jsonb_build_object('terminal', true)
from invalid_jobs;

alter table workflow_jobs
  add constraint workflow_jobs_kind_allowed
  check (status = 'failed' or kind in ('sync_product', 'purge_product', 'generate_topics', 'generate_content', 'review_content', 'render_assets')) not valid;

alter table workflow_jobs
  add constraint workflow_jobs_product_required
  check (status = 'failed' or product_id is not null) not valid;
