alter table assets
  add constraint assets_object_key_namespace
  check (
    (provenance = 'source' and object_key like 'source/' || product_id::text || '/%')
    or (provenance = 'generated' and content_version_id is not null and object_key like 'staging/' || content_version_id::text || '/%')
  ) not valid;
