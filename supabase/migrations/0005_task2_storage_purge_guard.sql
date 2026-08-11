create or replace function purge_product(
  p_workspace_id uuid, p_product_id uuid, p_storage_clean boolean,
  p_actor_type text, p_actor_id text, p_request_id text
) returns boolean language plpgsql security definer set search_path = public
as $$
declare v_deleted_at timestamptz;
begin
  select deleted_at into v_deleted_at from products where workspace_id = p_workspace_id and id = p_product_id for update;
  if not found then return true; end if;
  if v_deleted_at is null then raise exception 'PRODUCT_NOT_SOFT_DELETED'; end if;
  if not p_storage_clean or exists (
    select 1 from storage.objects o
    where o.bucket_id = 'social-agent-assets' and (
      o.name in (select object_key from assets where workspace_id = p_workspace_id and product_id = p_product_id)
      or o.name in (select prefill_screenshot_key from publications where workspace_id = p_workspace_id and product_id = p_product_id)
      or o.name like 'source/' || p_product_id::text || '/%'
      or exists (
        select 1 from content_versions cv
        where cv.workspace_id = p_workspace_id and cv.product_id = p_product_id
          and o.name like 'staging/' || cv.id::text || '/%'
      )
    )
  ) then raise exception 'STORAGE_CLEANUP_INCOMPLETE'; end if;

  update audit_events set product_id = null, entity_id = null,
    payload = jsonb_build_object('tombstone', true, 'purged_product_id', p_product_id)
    where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from learnings where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from weekly_reports where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from metric_snapshots where publication_id in (select id from publications where workspace_id = p_workspace_id and product_id = p_product_id);
  delete from metric_imports where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from publications where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from assets where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from review_findings where review_run_id in (
    select rr.id from review_runs rr join content_versions cv on cv.id = rr.content_version_id
    where cv.workspace_id = p_workspace_id and cv.product_id = p_product_id
  );
  delete from review_runs where content_version_id in (
    select id from content_versions where workspace_id = p_workspace_id and product_id = p_product_id
  );
  delete from content_versions where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from contents where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from content_briefs where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from topic_candidates where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from campaigns where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from product_facts where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from product_sources where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from channels where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from workflow_jobs where workspace_id = p_workspace_id and product_id = p_product_id;
  delete from products where workspace_id = p_workspace_id and id = p_product_id;
  insert into audit_events (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, request_id, payload)
  values (p_workspace_id, null, p_actor_type, p_actor_id, 'product.purged', 'product', null,
    p_request_id, jsonb_build_object('tombstone', true, 'purged_product_id', p_product_id));
  return true;
end;
$$;
revoke all on function purge_product(uuid, uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function purge_product(uuid, uuid, boolean, text, text, text) to service_role;
