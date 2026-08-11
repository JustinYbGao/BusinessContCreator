alter table workflow_jobs
  add constraint workflow_jobs_kind_allowed
  check (status = 'failed' or kind in ('sync_product', 'purge_product', 'generate_topics', 'generate_content', 'review_content', 'render_assets')) not valid;

alter table workflow_jobs
  add constraint workflow_jobs_product_required
  check (status = 'failed' or product_id is not null) not valid;
