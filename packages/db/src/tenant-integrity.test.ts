import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SupabaseAssetRepository,
  SupabaseAuditRepository,
  SupabaseContentVersionRepository,
  SupabaseJobRepository,
  SupabaseProductRepository,
  SupabasePublicationRepository,
  SupabaseReviewRepository,
  createSupabaseClient,
} from "./index.js";
import type { RepositoryContext } from "./index.js";
import { requireIntegrationEnvironment } from "./integration-environment.js";

const SEEDED_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";

function context(workspaceId = SEEDED_WORKSPACE_ID, actorId = "00000000-0000-4000-8000-000000000111"): RepositoryContext {
  return {
    workspaceId,
    actor: { type: "worker", id: actorId },
    requestId: crypto.randomUUID(),
  };
}

describe("Supabase tenant and durability integration", () => {
  let service: ReturnType<typeof createSupabaseClient>;
  let anon: ReturnType<typeof createClient>;

  beforeAll(async () => {
    const env = requireIntegrationEnvironment(process.env);
    service = createSupabaseClient(env.url, env.serviceRoleKey);
    anon = createClient(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await service
      .from("workspaces")
      .select("id")
      .eq("id", SEEDED_WORKSPACE_ID)
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBe(SEEDED_WORKSPACE_ID);
  });

  it("does not expose application tables to browser roles", async () => {
    const { data, error } = await anon.from("workspaces").select("id");
    expect(data ?? []).toEqual([]);
    expect(error?.code === "42501" || data?.length === 0).toBe(true);
  });

  it("scopes product reads and mutations to one workspace", async () => {
    const products = new SupabaseProductRepository(service);
    const created = await products.create(context(), {
      name: "Tenant fixture",
      slug: `tenant-${crypto.randomUUID()}`,
      positioning: "fixture",
      brandProfile: {},
    });

    await expect(products.softDelete(context(OTHER_WORKSPACE_ID), created.id, created.name))
      .rejects.toThrow("PRODUCT_NOT_FOUND");
    expect(await products.list({ workspaceId: OTHER_WORKSPACE_ID })).toEqual([]);
  });

  it("keeps duplicate enqueue idempotent and claims only inside the requested workspace", async () => {
    const workspaceId = await createWorkspace(service, "idempotency");
    const jobContext = context(workspaceId);
    const product = await createProduct(service, jobContext, "idempotency");
    const jobs = new SupabaseJobRepository(service);
    const input = {
      productId: product.id,
      kind: "sync_product" as const,
      idempotencyKey: `job:${crypto.randomUUID()}`,
      payload: { fixture: true },
    };
    const first = await jobs.enqueueJob(jobContext, input);
    const duplicate = await jobs.enqueueJob(jobContext, input);
    expect(duplicate.id).toBe(first.id);

    const claimed = await jobs.claimNext(jobContext, "worker-owner", new Date());
    expect(claimed?.workspaceId).toBe(workspaceId);
    expect(claimed?.productId).toBe(product.id);
    expect(await jobs.claimNext(context(OTHER_WORKSPACE_ID), "wrong-tenant", new Date())).toBeNull();
  });

  it("rejects unscoped or unknown workflow jobs", async () => {
    const workspaceId = await createWorkspace(service, "job-constraints");
    const jobContext = context(workspaceId);
    const product = await createProduct(service, jobContext, "job-constraints");
    const unscoped = await service.from("workflow_jobs").insert({
      workspace_id: workspaceId,
      product_id: null,
      kind: "sync_product",
      idempotency_key: `unscoped:${crypto.randomUUID()}`,
      payload: {},
      status: "queued",
    });
    const unknown = await service.from("workflow_jobs").insert({
      workspace_id: workspaceId,
      product_id: product.id,
      kind: "unknown",
      idempotency_key: `unknown:${crypto.randomUUID()}`,
      payload: {},
      status: "queued",
    });
    expect(unscoped.error?.code).toBe("23514");
    expect(unknown.error?.code).toBe("23514");
  });

  it("rejects heartbeat, completion, and failure from stale, non-owner, or cross-workspace workers", async () => {
    const workspaceId = await createWorkspace(service, "ownership");
    const jobContext = context(workspaceId);
    const product = await createProduct(service, jobContext, "ownership");
    const jobs = new SupabaseJobRepository(service);
    const queued = await jobs.enqueueJob(jobContext, {
      productId: product.id,
      kind: "sync_product",
      idempotencyKey: `ownership:${crypto.randomUUID()}`,
      payload: {},
    });
    const claimed = await jobs.claimNext(jobContext, "lease-owner", new Date());
    expect(claimed?.id).toBe(queued.id);

    await expect(jobs.heartbeat(jobContext, queued.id, "not-owner", new Date()))
      .rejects.toThrow("LEASE_LOST");
    await expect(jobs.complete(context(OTHER_WORKSPACE_ID), queued.id, "lease-owner", {}))
      .rejects.toThrow("LEASE_LOST");
    await expect(jobs.fail(jobContext, queued.id, "not-owner", "failure", null))
      .rejects.toThrow("LEASE_LOST");
  });

  it("atomically completes an owned job, writes audit, and inserts one next job", async () => {
    const workspaceId = await createWorkspace(service, "chain");
    const jobContext = context(workspaceId);
    const product = await createProduct(service, jobContext, "chain");
    const jobs = new SupabaseJobRepository(service);
    const current = await jobs.enqueueJob(jobContext, {
      productId: product.id,
      kind: "sync_product",
      idempotencyKey: `chain-current:${crypto.randomUUID()}`,
      payload: {},
    });
    const claimed = await jobs.claimNext(jobContext, "chain-owner", new Date());
    expect(claimed?.id).toBe(current.id);
    const nextKey = `chain-next:${crypto.randomUUID()}`;

    await jobs.complete(jobContext, current.id, "chain-owner", { ok: true }, {
      productId: product.id,
      kind: "generate_topics",
      idempotencyKey: nextKey,
      payload: {},
    });
    const finished = await jobs.get({ workspaceId }, current.id);
    expect(finished?.status).toBe("completed");

    const { data: nextRows } = await service
      .from("workflow_jobs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("idempotency_key", nextKey);
    expect(nextRows).toHaveLength(1);
  });

  it("commits handler domain output, audit, completion, and chaining in one RPC", async () => {
    const workspaceId = await createWorkspace(service, "handler");
    const handlerContext = context(workspaceId);
    const product = await new SupabaseProductRepository(service).create(handlerContext, {
      name: "Handler commit fixture",
      slug: `handler-${crypto.randomUUID()}`,
      positioning: "fixture",
      brandProfile: {},
    });
    const jobId = crypto.randomUUID();
    const { error: insertError } = await service.from("workflow_jobs").insert({
      id: jobId,
      workspace_id: workspaceId,
      product_id: product.id,
      kind: "sync_product",
      idempotency_key: `handler:${jobId}`,
      payload: {},
      status: "queued",
    });
    expect(insertError).toBeNull();
    const jobs = new SupabaseJobRepository(service);
    expect((await jobs.claimNext(handlerContext, "handler-worker", new Date()))?.id).toBe(jobId);
    const nextKey = `handler-next:${crypto.randomUUID()}`;
    const { data, error } = await service.rpc("commit_sync_product_job", {
      p_workspace_id: workspaceId,
      p_job_id: jobId,
      p_worker_id: "handler-worker",
      p_output: { sources: [], facts: [], assets: [] },
      p_result: { productId: product.id },
      p_audit_event: {
        actor_type: "worker",
        actor_id: "handler-worker",
        action: "sync_product.completed",
        entity_type: "workflow_job",
        entity_id: jobId,
        request_id: crypto.randomUUID(),
        payload: {},
      },
      p_next_job: {
        product_id: product.id,
        kind: "generate_topics",
        idempotency_key: nextKey,
        payload: {},
      },
    });
    expect(error).toBeNull();
    expect(data).toEqual({ productId: product.id });
    expect((await jobs.get({ workspaceId }, jobId))?.status).toBe("completed");
    const { data: next } = await service.from("workflow_jobs").select("id")
      .eq("workspace_id", workspaceId).eq("idempotency_key", nextKey);
    expect(next).toHaveLength(1);
  });

  it("rejects handler commits that target another product in the same workspace", async () => {
    const workspaceId = await createWorkspace(service, "handler-product-scope");
    const jobContext = context(workspaceId);
    const jobProduct = await new SupabaseProductRepository(service).create(jobContext, {
      name: "Job product",
      slug: `job-product-${crypto.randomUUID()}`,
      positioning: "fixture",
      brandProfile: {},
    });
    const foreign = await createContentFixture(service, "foreign-handler", jobContext);

    const topicsJobId = await claimHandlerJob(service, jobContext, jobProduct.id, "generate_topics", "topics-worker");
    const topics = await service.rpc("commit_generate_topics_job", {
      p_workspace_id: workspaceId,
      p_job_id: topicsJobId,
      p_worker_id: "topics-worker",
      p_campaign_id: foreign.campaignId,
      p_candidates: [],
      p_result: {},
      p_audit_event: jobAudit("topics-worker", topicsJobId),
      p_next_job: null,
    });
    expect(topics.error?.message).toContain("CAMPAIGN_SCOPE_MISMATCH");

    const contentJobId = await claimHandlerJob(service, jobContext, jobProduct.id, "generate_content", "content-worker");
    const content = await service.rpc("commit_generate_content_job", {
      p_workspace_id: workspaceId,
      p_job_id: contentJobId,
      p_worker_id: "content-worker",
      p_content_input: contentVersionInput(foreign),
      p_result: {},
      p_audit_event: jobAudit("content-worker", contentJobId),
      p_next_job: null,
    });
    expect(content.error?.message).toContain("CONTENT_SCOPE_MISMATCH");

    const reviewJobId = await claimHandlerJob(service, jobContext, jobProduct.id, "review_content", "review-worker");
    const review = await service.rpc("commit_review_content_job", {
      p_workspace_id: workspaceId,
      p_job_id: reviewJobId,
      p_worker_id: "review-worker",
      p_content_version_id: foreign.versionId,
      p_review_context: {},
      p_findings: [],
      p_result: {},
      p_audit_event: jobAudit("review-worker", reviewJobId),
      p_next_job: null,
    });
    expect(review.error?.message).toContain("CONTENT_VERSION_SCOPE_MISMATCH");
  }, 15_000);

  it("validates content scope before returning an existing topic result", async () => {
    const workspaceId = await createWorkspace(service, "existing-content-scope");
    const fixture = await createContentFixture(service, "existing-content", context(workspaceId));
    const result = await service.rpc("create_content_with_brief", {
      p_workspace_id: workspaceId,
      p_product_id: crypto.randomUUID(),
      p_campaign_id: crypto.randomUUID(),
      p_topic_id: fixture.topicId,
      p_brief: {},
      p_created_by: "fixture",
      p_idempotency_key: crypto.randomUUID(),
      p_actor_type: "worker",
      p_request_id: crypto.randomUUID(),
    });
    expect(result.error?.message).toContain("TOPIC_SCOPE_MISMATCH");
  });

  it("rejects topic facts that belong to another product", async () => {
    const workspaceId = await createWorkspace(service, "topic-fact-scope");
    const jobContext = context(workspaceId);
    const campaignFixture = await createContentFixture(service, "campaign-facts", jobContext);
    const foreignFixture = await createContentFixture(service, "foreign-facts", jobContext);
    const result = await service.rpc("insert_topics_with_audit", {
      p_workspace_id: workspaceId,
      p_campaign_id: campaignFixture.campaignId,
      p_rows: [{
        title: "invalid fact scope",
        angle: "fixture",
        pillar: "product_proof",
        fact_ids: [foreignFixture.factId],
        scores: {},
        total_score: 1,
      }],
      p_actor_type: "worker",
      p_actor_id: "fixture",
      p_request_id: crypto.randomUUID(),
    });
    expect(result.error?.message).toContain("FACT_SCOPE_MISMATCH");
  }, 15_000);

  it("does not make rendered assets visible before their Storage objects are verified", async () => {
    const workspaceId = await createWorkspace(service, "render-storage-verification");
    const jobContext = context(workspaceId);
    const fixture = await createContentFixture(service, "render-storage", jobContext);
    const jobId = await claimHandlerJob(service, jobContext, fixture.productId, "render_assets", "render-worker");
    const result = await service.rpc("commit_render_assets_job", {
      p_workspace_id: workspaceId,
      p_job_id: jobId,
      p_worker_id: "render-worker",
      p_content_version_id: fixture.versionId,
      p_assets: fixture.pageAssets.map((asset) => ({
        object_key: asset.objectKey,
        mime_type: "image/png",
        byte_size: 1,
        sha256: asset.sha256,
      })),
      p_result: {},
      p_audit_event: jobAudit("render-worker", jobId),
      p_next_job: null,
    });
    expect(result.error?.message).toContain("ASSET_OBJECT_NOT_VERIFIED");
    expect((await service.from("assets").select("id").eq("content_version_id", fixture.versionId)).data).toEqual([]);
  });

  it("returns different jobs to concurrent claimers in one workspace", async () => {
    const workspaceId = await createWorkspace(service, "concurrency");
    const jobContext = context(workspaceId);
    const product = await createProduct(service, jobContext, "concurrency");
    const jobs = new SupabaseJobRepository(service);
    await jobs.enqueueJob(jobContext, { productId: product.id, kind: "sync_product", idempotencyKey: `one:${crypto.randomUUID()}`, payload: {} });
    await jobs.enqueueJob(jobContext, { productId: product.id, kind: "sync_product", idempotencyKey: `two:${crypto.randomUUID()}`, payload: {} });

    const [first, second] = await Promise.all([
      jobs.claimNext(jobContext, "concurrent-one", new Date()),
      jobs.claimNext(jobContext, "concurrent-two", new Date()),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.id).not.toBe(first?.id);
  });

  it("rejects a stale worker after another worker reclaims its lease", async () => {
    const workspaceId = await createWorkspace(service, "stale");
    const jobContext = context(workspaceId);
    const product = await createProduct(service, jobContext, "stale");
    const jobs = new SupabaseJobRepository(service);
    const queued = await jobs.enqueueJob(jobContext, {
      productId: product.id, kind: "sync_product", idempotencyKey: `stale:${crypto.randomUUID()}`, payload: {},
    });
    expect((await jobs.claimNext(jobContext, "old-worker", new Date()))?.id).toBe(queued.id);
    const { error: ageError } = await service.from("workflow_jobs").update({
      heartbeat_at: "2000-01-01T00:00:00.000Z",
      locked_at: "2000-01-01T00:00:00.000Z",
    }).eq("workspace_id", workspaceId).eq("id", queued.id);
    expect(ageError).toBeNull();
    expect((await jobs.claimNext(jobContext, "new-worker", new Date()))?.id).toBe(queued.id);

    await expect(jobs.complete(jobContext, queued.id, "old-worker", {})).rejects.toThrow("LEASE_LOST");
    await expect(jobs.heartbeat(jobContext, queued.id, "old-worker", new Date())).rejects.toThrow("LEASE_LOST");
    await expect(jobs.fail(jobContext, queued.id, "old-worker", "stale", null)).rejects.toThrow("LEASE_LOST");
  });

  it("reclaims a running job with missing lease timestamps", async () => {
    const workspaceId = await createWorkspace(service, "missing-lease-timestamps");
    const jobContext = context(workspaceId);
    const product = await createProduct(service, jobContext, "missing-lease-timestamps");
    const jobId = crypto.randomUUID();
    expect((await service.from("workflow_jobs").insert({
      id: jobId,
      workspace_id: workspaceId,
      product_id: product.id,
      kind: "sync_product",
      idempotency_key: `missing-lease:${jobId}`,
      payload: {},
      status: "running",
      attempts: 1,
      locked_by: "lost-worker",
      locked_at: null,
      heartbeat_at: null,
    })).error).toBeNull();

    expect((await new SupabaseJobRepository(service).claimNext(jobContext, "reclaimer", new Date()))?.id).toBe(jobId);
  });

  it("terminalizes and audits an exhausted stale lease before claiming", async () => {
    const workspaceId = await createWorkspace(service, "exhausted");
    const jobContext = context(workspaceId);
    const product = await createProduct(service, jobContext, "exhausted");
    const jobs = new SupabaseJobRepository(service);
    const jobId = crypto.randomUUID();
    const { error: insertError } = await service.from("workflow_jobs").insert({
      id: jobId,
      workspace_id: workspaceId,
      product_id: product.id,
      kind: "sync_product",
      idempotency_key: `exhausted:${jobId}`,
      payload: {},
      status: "running",
      attempts: 3,
      max_attempts: 3,
      locked_by: "expired-worker",
      locked_at: "2000-01-01T00:00:00.000Z",
      heartbeat_at: "2000-01-01T00:00:00.000Z",
    });
    expect(insertError).toBeNull();

    expect(await jobs.claimNext(context(workspaceId), "new-worker", new Date())).toBeNull();
    expect((await jobs.get({ workspaceId }, jobId))?.status).toBe("failed");
    const { data: audit } = await service.from("audit_events").select("action")
      .eq("workspace_id", workspaceId).eq("entity_id", jobId).eq("action", "workflow_job.lease_exhausted");
    expect(audit).toHaveLength(1);
  });

  it("enforces current-review semantics", async () => {
    const fixture = await createContentFixture(service, "review");
    const reviews = new SupabaseReviewRepository(service);
    const reviewContext = await readReviewContext(service, fixture.versionId);
    const first = await reviews.replaceCurrentRun(context(), fixture.versionId, reviewContext, [{
      code: "FIRST",
      severity: "blocking",
      message: "first",
    }]);
    const second = await reviews.replaceCurrentRun(context(), fixture.versionId, reviewContext, []);

    expect(first.runNumber).toBe(1);
    expect(second.runNumber).toBe(2);
    expect((await reviews.getCurrent({ workspaceId: SEEDED_WORKSPACE_ID }, fixture.versionId))?.id)
      .toBe(second.id);
  });

  it("requires verified hash-matched generated assets before publication", async () => {
    const fixture = await createContentFixture(service, "publication");
    const versions = new SupabaseContentVersionRepository(service);
    const publications = new SupabasePublicationRepository(service);
    await new SupabaseReviewRepository(service).replaceCurrentRun(context(), fixture.versionId, await readReviewContext(service, fixture.versionId), []);
    await versions.approve(context(), fixture.versionId);

    await expect(publications.create(context(), {
      contentVersionId: fixture.versionId,
      idempotencyKey: `publication:${fixture.versionId}`,
    })).rejects.toThrow("ASSET_SET_INVALID");

    await uploadVerifiedPageAssets(service, fixture.pageAssets);
    await insertVerifiedPageAssets(service, fixture.pageAssets);
    const publication = await publications.create(context(), {
      contentVersionId: fixture.versionId,
      idempotencyKey: `publication:${fixture.versionId}`,
    });
    expect(publication.status).toBe("READY_TO_PREFILL");
    expect(publication.package.imageObjectKeys).toHaveLength(7);
  }, 15_000);

  it("rejects publication when an Asset hash does not match verified Storage metadata", async () => {
    const fixture = await createContentFixture(service, "publication-hash-mismatch");
    const versions = new SupabaseContentVersionRepository(service);
    const publications = new SupabasePublicationRepository(service);
    await new SupabaseReviewRepository(service).replaceCurrentRun(context(), fixture.versionId, await readReviewContext(service, fixture.versionId), []);
    await versions.approve(context(), fixture.versionId);

    for (const [index, asset] of fixture.pageAssets.entries()) {
      const { error } = await service.storage.from("social-agent-assets").upload(
        asset.objectKey,
        new Uint8Array([index + 1]),
        {
          contentType: "image/png",
          metadata: { sha256: index === 0 ? "f".repeat(64) : asset.sha256, verified: true },
        },
      );
      expect(error).toBeNull();
    }
    await insertVerifiedPageAssets(service, fixture.pageAssets);
    await expect(publications.create(context(), {
      contentVersionId: fixture.versionId,
      idempotencyKey: `publication:${fixture.versionId}`,
    })).rejects.toThrow("ASSET_SET_INVALID");
  }, 15_000);

  it("does not let a worker mark a publication as human-published", async () => {
    const fixture = await createContentFixture(service, "human-publication");
    const { data: publication, error } = await service.from("publications").insert({
      workspace_id: SEEDED_WORKSPACE_ID,
      product_id: fixture.productId,
      campaign_id: fixture.campaignId,
      channel_id: fixture.channelId,
      content_version_id: fixture.versionId,
      status: "AWAITING_HUMAN_PUBLISH",
      package: {},
    }).select("id").single();
    expect(error).toBeNull();

    await expect(new SupabasePublicationRepository(service).transition(
      context(), publication!.id, "AWAITING_HUMAN_PUBLISH", "PUBLISHED",
    )).rejects.toThrow("HUMAN_PUBLICATION_CONFIRMATION_REQUIRED");
  }, 15_000);

  it("separates usable source assets from generated version assets", async () => {
    const fixture = await createContentFixture(service, "asset-semantics");
    const assets = new SupabaseAssetRepository(service);
    const source = await assets.insertCandidates(context(), [{
      productId: fixture.productId,
      contentVersionId: null,
      objectKey: `source/${fixture.productId}/${crypto.randomUUID()}.png`,
      sha256: "b".repeat(64),
      verificationStatus: "verified",
      publicUseAllowed: true,
    }, {
      productId: fixture.productId,
      contentVersionId: null,
      objectKey: `source/${fixture.productId}/${crypto.randomUUID()}.png`,
      sha256: "c".repeat(64),
      verificationStatus: "candidate",
      publicUseAllowed: false,
    }, {
      productId: fixture.productId,
      contentVersionId: fixture.versionId,
      objectKey: `workspaces/${SEEDED_WORKSPACE_ID}/products/${fixture.productId}/contents/${fixture.versionId}/page-1-${"d".repeat(64)}.png`,
      sha256: "d".repeat(64),
      verificationStatus: "candidate",
      publicUseAllowed: false,
    }]);

    expect((await assets.listUsable({ workspaceId: SEEDED_WORKSPACE_ID }, fixture.productId)).map((row) => row.id))
      .toEqual([source[0].id]);
    expect((await assets.listGeneratedForVersion({ workspaceId: SEEDED_WORKSPACE_ID }, fixture.versionId)).map((row) => row.id))
      .toEqual([source[2].id]);

    await expect(assets.insertCandidates(context(), [{
      productId: fixture.productId,
      contentVersionId: null,
      objectKey: `orphan/${fixture.productId}/${crypto.randomUUID()}.png`,
      sha256: "e".repeat(64),
      verificationStatus: "candidate",
      publicUseAllowed: false,
    }])).rejects.toThrow();
  }, 15_000);

  it("purges a soft-deleted product graph only after Storage cleanup", async () => {
    const products = new SupabaseProductRepository(service);
    const assets = new SupabaseAssetRepository(service);
    const product = await products.create(context(), {
      name: "Purge fixture",
      slug: `purge-${crypto.randomUUID()}`,
      positioning: "fixture",
      brandProfile: {},
    });
    const objectKey = `source/${product.id}/asset.png`;
    const upload = await service.storage.from("social-agent-assets").upload(objectKey, new Uint8Array([1]), {
      contentType: "image/png",
      upsert: false,
    });
    expect(upload.error).toBeNull();
    await assets.insertCandidates(context(), [{
      productId: product.id,
      contentVersionId: null,
      objectKey,
      sha256: "e".repeat(64),
      verificationStatus: "verified",
      publicUseAllowed: true,
    }]);
    await products.softDelete(context(), product.id, product.name);

    const blocked = await service.rpc("purge_product", {
      p_workspace_id: SEEDED_WORKSPACE_ID,
      p_product_id: product.id,
      p_storage_clean: false,
      p_actor_type: "worker",
      p_actor_id: "purge-worker",
      p_request_id: crypto.randomUUID(),
    });
    expect(blocked.error?.message).toContain("STORAGE_CLEANUP_INCOMPLETE");
    expect((await service.storage.from("social-agent-assets").remove([objectKey])).error).toBeNull();

    const purged = await service.rpc("purge_product", {
      p_workspace_id: SEEDED_WORKSPACE_ID,
      p_product_id: product.id,
      p_storage_clean: true,
      p_actor_type: "worker",
      p_actor_id: "purge-worker",
      p_request_id: crypto.randomUUID(),
    });
    expect(purged.error).toBeNull();
    expect(purged.data).toBe(true);
    expect((await service.from("products").select("id").eq("id", product.id)).data).toEqual([]);
    expect((await service.from("assets").select("id").eq("product_id", product.id)).data).toEqual([]);
    const { data: tombstones } = await service.from("audit_events").select("action,payload")
      .eq("workspace_id", SEEDED_WORKSPACE_ID).eq("action", "product.purged")
      .contains("payload", { purged_product_id: product.id });
    expect(tombstones).toHaveLength(1);
  });

  it("refuses purge when a product-scoped staging object has no Asset row", async () => {
    const products = new SupabaseProductRepository(service);
    const product = await products.create(context(), {
      name: "Orphan storage purge fixture",
      slug: `orphan-purge-${crypto.randomUUID()}`,
      positioning: "fixture",
      brandProfile: {},
    });
    const objectKey = `source/${product.id}/uncommitted.png`;
    expect((await service.storage.from("social-agent-assets").upload(objectKey, new Uint8Array([1]), {
      contentType: "image/png",
    })).error).toBeNull();
    await products.softDelete(context(), product.id, product.name);

    const purge = await service.rpc("purge_product", {
      p_workspace_id: SEEDED_WORKSPACE_ID,
      p_product_id: product.id,
      p_storage_clean: true,
      p_actor_type: "worker",
      p_actor_id: "purge-worker",
      p_request_id: crypto.randomUUID(),
    });
    expect(purge.error?.message).toContain("STORAGE_CLEANUP_INCOMPLETE");
  });

  it("refuses purge when a publication screenshot remains in Storage", async () => {
    const fixture = await createContentFixture(service, "purge-screenshot");
    const screenshotKey = `screenshots/${crypto.randomUUID()}.png`;
    expect((await service.storage.from("social-agent-assets").upload(screenshotKey, new Uint8Array([1]), {
      contentType: "image/png",
    })).error).toBeNull();
    expect((await service.from("publications").insert({
      workspace_id: SEEDED_WORKSPACE_ID,
      product_id: fixture.productId,
      campaign_id: fixture.campaignId,
      channel_id: fixture.channelId,
      content_version_id: fixture.versionId,
      status: "PREFILLING",
      package: {},
      prefill_screenshot_key: screenshotKey,
    })).error).toBeNull();
    await new SupabaseProductRepository(service).softDelete(context(), fixture.productId, `${"purge-screenshot"} product`);

    const purge = await service.rpc("purge_product", {
      p_workspace_id: SEEDED_WORKSPACE_ID,
      p_product_id: fixture.productId,
      p_storage_clean: true,
      p_actor_type: "worker",
      p_actor_id: "purge-worker",
      p_request_id: crypto.randomUUID(),
    });
    expect(purge.error?.message).toContain("STORAGE_CLEANUP_INCOMPLETE");
  }, 15_000);

  it("denies direct service-role update/delete of immutable content versions and audit events", async () => {
    const fixture = await createContentFixture(service, "immutability");
    const audit = new SupabaseAuditRepository(service);
    const event = await audit.append(context(), {
      productId: fixture.productId,
      action: "fixture.created",
      entityType: "content_version",
      entityId: fixture.versionId,
      payload: {},
    });

    const versionUpdate = await service
      .from("content_versions")
      .update({ prompt_version: "mutated" })
      .eq("id", fixture.versionId);
    const versionDelete = await service.from("content_versions").delete().eq("id", fixture.versionId);
    const auditUpdate = await service.from("audit_events").update({ action: "mutated" }).eq("id", event.id);
    const auditDelete = await service.from("audit_events").delete().eq("id", event.id);

    expect(versionUpdate.error?.code).toBe("42501");
    expect(versionDelete.error?.code).toBe("42501");
    expect(auditUpdate.error?.code).toBe("42501");
    expect(auditDelete.error?.code).toBe("42501");
  });
});

async function createContentFixture(
  service: ReturnType<typeof createSupabaseClient>,
  label: string,
  fixtureContext: RepositoryContext = context(),
) {
  const workspaceId = fixtureContext.workspaceId;
  const suffix = crypto.randomUUID();
  const { data: product, error: productError } = await service
    .from("products")
    .insert({
      workspace_id: workspaceId,
      name: `${label} product`,
      slug: `${label}-${suffix}`,
    })
    .select("id")
    .single();
  if (productError) throw productError;
  const { data: channel, error: channelError } = await service
    .from("channels")
    .insert({
      workspace_id: workspaceId,
      product_id: product.id,
      kind: "xiaohongshu",
      status: "active",
    })
    .select("id")
    .single();
  if (channelError) throw channelError;
  const { data: campaign, error: campaignError } = await service
    .from("campaigns")
    .insert({
      workspace_id: workspaceId,
      product_id: product.id,
      channel_id: channel.id,
      name: `${label} campaign`,
      goal: "fixture",
      audience: "fixture",
      pillar_quotas: {},
      starts_on: "2026-08-10",
      ends_on: "2026-08-17",
    })
    .select("id")
    .single();
  if (campaignError) throw campaignError;
  const factId = crypto.randomUUID();
  const { error: factError } = await service.from("product_facts").insert({
    id: factId,
    workspace_id: workspaceId,
    product_id: product.id,
    statement: "Fixture claim",
    category: "feature",
    source_locator: "fixtures/source.md",
    evidence_excerpt: "Fixture claim",
    status: "verified",
    public_use_allowed: true,
    verified_by: crypto.randomUUID(),
    verified_at: new Date().toISOString(),
  });
  if (factError) throw factError;
  const { data: topic, error: topicError } = await service
    .from("topic_candidates")
    .insert({
      workspace_id: workspaceId,
      product_id: product.id,
      campaign_id: campaign.id,
      title: `${label} topic`,
      angle: "fixture",
      pillar: "product_proof",
      fact_ids: [factId],
      scores: {},
      total_score: 1,
      selected: true,
    })
    .select("id")
    .single();
  if (topicError) throw topicError;
  const { data: brief, error: briefError } = await service
    .from("content_briefs")
    .insert({
      workspace_id: workspaceId,
      product_id: product.id,
      campaign_id: campaign.id,
      topic_id: topic.id,
      payload: {},
    })
    .select("id")
    .single();
  if (briefError) throw briefError;
  const { data: content, error: contentError } = await service
    .from("contents")
    .insert({
      workspace_id: workspaceId,
      product_id: product.id,
      campaign_id: campaign.id,
      topic_id: topic.id,
      status: "draft",
      created_by: "integration",
    })
    .select("id")
    .single();
  if (contentError) throw contentError;

  const pageHashes = Array.from({ length: 7 }, (_, index) => pageSha256(index));
  const payload = {
    titleCandidates: ["one", "two", "three", "four", "five"],
    recommendedTitle: "one",
    body: "fixture body",
    hashtags: ["#one", "#two", "#three"],
    interactionPrompt: "fixture prompt",
    pages: pageHashes.map((_, index) => ({
      page: index + 1,
      purpose: `page ${index + 1}`,
      headline: `headline ${index + 1}`,
      body: `body ${index + 1}`,
      sourceAssetId: null,
    })),
    claims: [{ factId, text: "Fixture claim" }],
  };
  const versions = new SupabaseContentVersionRepository(service);
  const version = await versions.create(fixtureContext, {
    productId: product.id,
    campaignId: campaign.id,
    contentId: content.id,
    topicId: topic.id,
    briefId: brief.id,
    payload,
    promptVersion: "fixture-v1",
    modelName: "fixture-model",
    contentSha256: "a".repeat(64),
    createdBy: "integration",
  });

  return {
    productId: product.id,
    channelId: channel.id,
    campaignId: campaign.id,
    topicId: topic.id,
    briefId: brief.id,
    contentId: content.id,
    factId,
    versionId: version.id,
    pageAssets: pageHashes.map((sha256, index) => ({
      productId: product.id,
      contentVersionId: version.id,
      objectKey: `workspaces/${workspaceId}/products/${product.id}/contents/${version.id}/page-${index + 1}-${sha256}.png`,
      sha256,
      verificationStatus: "verified" as const,
      publicUseAllowed: true,
    })),
  };
}

async function readReviewContext(
  service: ReturnType<typeof createSupabaseClient>,
  contentVersionId: string,
) {
  const { data, error } = await service.rpc("review_context_for_version", {
    p_workspace_id: SEEDED_WORKSPACE_ID,
    p_content_version_id: contentVersionId,
  });
  expect(error).toBeNull();
  return data;
}

function pageSha256(index: number): string {
  return createHash("sha256").update(Buffer.from([index + 1])).digest("hex");
}

async function uploadVerifiedPageAssets(
  service: ReturnType<typeof createSupabaseClient>,
  pageAssets: { objectKey: string; sha256: string }[],
) {
  for (const [index, asset] of pageAssets.entries()) {
    const { error } = await service.storage.from("social-agent-assets").upload(
      asset.objectKey,
      new Uint8Array([index + 1]),
      {
        contentType: "image/png",
        metadata: { sha256: asset.sha256, verified: true },
      },
    );
    expect(error).toBeNull();
  }
}

async function insertVerifiedPageAssets(
  service: ReturnType<typeof createSupabaseClient>,
  pageAssets: { productId: string; contentVersionId: string; objectKey: string; sha256: string }[],
) {
  const { error } = await service.from("assets").insert(pageAssets.map((asset) => ({
    workspace_id: SEEDED_WORKSPACE_ID,
    product_id: asset.productId,
    content_version_id: asset.contentVersionId,
    kind: "carousel_page",
    provenance: "generated",
    verification_status: "verified",
    public_use_allowed: true,
    verified_by: crypto.randomUUID(),
    verified_at: new Date().toISOString(),
    object_key: asset.objectKey,
    mime_type: "image/png",
    byte_size: 1,
    width: 1080,
    height: 1440,
    sha256: asset.sha256,
  })));
  expect(error).toBeNull();
}

async function createWorkspace(
  service: ReturnType<typeof createSupabaseClient>,
  label: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await service.from("workspaces").insert({ id, name: `${label} workspace` });
  if (error) throw error;
  return id;
}

async function createProduct(
  service: ReturnType<typeof createSupabaseClient>,
  ctx: RepositoryContext,
  label: string,
) {
  return new SupabaseProductRepository(service).create(ctx, {
    name: `${label} product`,
    slug: `${label}-${crypto.randomUUID()}`,
    positioning: "fixture",
    brandProfile: {},
  });
}

function contentVersionInput(fixture: {
  productId: string;
  campaignId: string;
  contentId: string;
  topicId: string;
  briefId: string;
}) {
  return {
    product_id: fixture.productId,
    campaign_id: fixture.campaignId,
    content_id: fixture.contentId,
    topic_id: fixture.topicId,
    brief_id: fixture.briefId,
    payload: {},
    prompt_version: "fixture-v1",
    model_name: "fixture-model",
    content_sha256: "a".repeat(64),
    created_by: "fixture",
  };
}

function jobAudit(workerId: string, jobId: string) {
  return {
    actor_type: "worker",
    actor_id: workerId,
    action: "workflow_job.completed",
    entity_type: "workflow_job",
    entity_id: jobId,
    request_id: crypto.randomUUID(),
    payload: {},
  };
}

async function claimHandlerJob(
  service: ReturnType<typeof createSupabaseClient>,
  jobContext: RepositoryContext,
  productId: string,
  kind: string,
  workerId: string,
): Promise<string> {
  const jobId = crypto.randomUUID();
  const { error } = await service.from("workflow_jobs").insert({
    id: jobId,
    workspace_id: jobContext.workspaceId,
    product_id: productId,
    kind,
    idempotency_key: `${kind}:${jobId}`,
    payload: {},
    status: "queued",
  });
  expect(error).toBeNull();
  expect((await new SupabaseJobRepository(service).claimNext(jobContext, workerId, new Date()))?.id).toBe(jobId);
  return jobId;
}
