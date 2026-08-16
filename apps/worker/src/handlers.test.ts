import type { ProductAdapter } from "@social-agent/contracts";
import type { RepositoryContext, WorkflowJob } from "@social-agent/db";
import type { StructuredLlm } from "@social-agent/llm";
import { describe, expect, it } from "vitest";
import { createContentHandler } from "./handlers/generate-content.js";
import { createTopicHandler } from "./handlers/generate-topics.js";
import { createPurgeProductHandler } from "./handlers/purge-product.js";
import { createRenderAssetsHandler } from "./handlers/render-assets.js";
import { createReviewHandler } from "./handlers/review-content.js";
import { createSyncProductHandler } from "./handlers/sync-product.js";

const ctx: RepositoryContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  actor: { type: "worker", id: "worker-test" },
  requestId: "request-test",
};
const productId = "00000000-0000-4000-8000-000000000002";
const signal = new AbortController().signal;

function workerJob(kind: WorkflowJob["kind"], payload: unknown = {}): WorkflowJob {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    workspaceId: ctx.workspaceId,
    productId,
    kind,
    payload,
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    lockedBy: "worker-test",
  };
}

describe("Task 9 job handlers", () => {
  it("requires the soft-delete confirmation before purging a product", async () => {
    const calls: unknown[] = [];
    const handler = createPurgeProductHandler({
      async purge(input) {
        calls.push(input);
        return { rowsDeleted: 4, objectsDeleted: 2 };
      },
    });

    const execution = await handler({
      ctx,
      job: workerJob("purge_product", { confirmationAuditId: "audit-1" }),
      workerId: "worker-test",
      signal,
    });

    expect(calls).toEqual([expect.objectContaining({
      workspaceId: ctx.workspaceId,
      productId,
      confirmationAuditId: "audit-1",
    })]);
    expect(execution.result).toEqual({ productId, purgeAuditId: "audit-1", rowsDeleted: 4, objectsDeleted: 2 });
  });

  it("converts local adapter candidates to the commit RPC payload", async () => {
    const adapter: ProductAdapter = {
      kind: "manual",
      async discoverSources() {
        return [{ id: "source-1", kind: "manual", relativeLocator: "README.md" }];
      },
      async extractFacts() {
        return [{
          statement: "Fixture fact",
          category: "feature",
          sourceLocator: "README.md",
          evidenceExcerpt: "Fixture fact",
        }];
      },
      async collectAssets() {
        return [];
      },
    };
    const handler = createSyncProductHandler(adapter);

    const execution = await handler({
      ctx,
      job: workerJob("sync_product", { connectionId: productId, connectionKind: "manual" }),
      workerId: "worker-test",
      signal,
    });

    expect(execution.commitPayload).toEqual({
      sources: [{ id: "source-1", kind: "manual", locator: "README.md" }],
      facts: [{
        source_id: "source-1",
        statement: "Fixture fact",
        category: "feature",
        source_locator: "README.md",
        evidence_excerpt: "Fixture fact",
        status: "candidate",
        public_use_allowed: false,
      }],
      assets: [],
    });
  });

  it("keeps deterministic topic candidates in the commit payload", async () => {
    const candidate = {
      id: "candidate-1",
      title: "Fixture topic",
      angle: "Fixture angle",
      pillar: "product_proof" as const,
      factIds: ["00000000-0000-4000-8000-000000000004"],
      learningIds: [],
      risks: [],
      scores: { pain: 3, productFit: 4, evidence: 5, visualFeasibility: 4, timeliness: 3, repetition: 1, risk: 1 },
      contributions: {
        pain: 0,
        productFit: 0,
        evidence: 0,
        visualFeasibility: 0,
        timeliness: 0,
        repetition: 0,
        risk: 0,
      },
      totalScore: 2.5,
    };
    const handler = createTopicHandler({
      llm: {} as StructuredLlm,
      async loadInput() {
        return {} as never;
      },
      async generate() {
        return { candidates: [candidate], selected: [candidate], model: "fixture", repairAttempts: 0 };
      },
    });

    const execution = await handler({
      ctx,
      job: workerJob("generate_topics", { campaignId: "00000000-0000-4000-8000-000000000005" }),
      workerId: "worker-test",
      signal,
    });

    expect(execution.commitPayload).toEqual({
      campaignId: "00000000-0000-4000-8000-000000000005",
      candidates: [{
        title: "Fixture topic",
        angle: "Fixture angle",
        pillar: "product_proof",
        fact_ids: ["00000000-0000-4000-8000-000000000004"],
        scores: candidate.scores,
        total_score: 2.5,
      }],
    });
  });

  it("passes generated content to the atomic content commit boundary", async () => {
    const generated = {
      draft: { titleCandidates: [], recommendedTitle: "title", body: "body" },
      model: "fixture-model",
      repairAttempts: 1,
      promptVersion: "content-v1",
      contentSha256: "a".repeat(64),
    };
    const handler = createContentHandler({
      llm: {} as StructuredLlm,
      async loadInput() {
        return {} as never;
      },
      async generate() {
        return generated as never;
      },
    });

    const execution = await handler({
      ctx,
      job: workerJob("generate_content", {
        contentInput: { product_id: productId, campaign_id: "campaign-1" },
      }),
      workerId: "worker-test",
      signal,
    });

    expect(execution.commitPayload).toEqual({
      contentInput: { product_id: productId, campaign_id: "campaign-1" },
      generated,
    });
  });

  it("keeps render metadata inside the generated commit payload", async () => {
    const brandProfile = { mark: "fixture", background: "#FFFFFF", foreground: "#111111", accent: "#FF2442" };
    const generated = {
      draft: {
        pages: Array.from({ length: 7 }, (_, index) => ({
          page: index + 1,
          purpose: "fixture",
          headline: `page-${index + 1}`,
          body: "fixture body",
          sourceAssetId: null,
        })),
      },
      model: "fixture-model",
      repairAttempts: 0,
      promptVersion: "content-v1",
      contentSha256: "b".repeat(64),
    };
    const handler = createContentHandler({
      llm: {} as StructuredLlm,
      async loadInput() {
        return { brandProfile } as never;
      },
      async generate() {
        return generated as never;
      },
    });

    const execution = await handler({
      ctx,
      job: workerJob("generate_content", { contentInput: { product_id: productId, campaign_id: "campaign-1" } }),
      workerId: "worker-test",
      signal,
    });

    expect(execution.commitPayload).toEqual({
      contentInput: { product_id: productId, campaign_id: "campaign-1" },
      generated: {
        ...generated,
        renderInput: {
          pages: generated.draft.pages,
          brand: brandProfile,
        },
      },
    });
  });

  it("accepts the durable queue payload shape used by the web enqueue API", async () => {
    const generated = {
      draft: { titleCandidates: [], recommendedTitle: "title", body: "body" },
      model: "fixture-model",
      repairAttempts: 0,
      promptVersion: "content-v1",
      contentSha256: "a".repeat(64),
    };
    const loaded: unknown[] = [];
    const handler = createContentHandler({
      llm: {} as StructuredLlm,
      async loadInput(input) {
        loaded.push(input.contentInput);
        return {} as never;
      },
      async generate() {
        return generated as never;
      },
    });

    await handler({
      ctx,
      job: workerJob("generate_content", {
        contentId: "content-1",
        campaignId: "campaign-1",
        topicId: "topic-1",
        briefId: "brief-1",
      }),
      workerId: "worker-test",
      signal,
    });

    expect(loaded).toEqual([{
      contentId: "content-1",
      campaignId: "campaign-1",
      topicId: "topic-1",
      briefId: "brief-1",
    }]);
  });

  it("attaches a bounded render input to generated content commits", async () => {
    const pages = Array.from({ length: 7 }, (_, index) => ({
      page: index + 1,
      purpose: "fixture",
      headline: `page ${index + 1}`,
      body: "fixture body",
      sourceAssetId: null,
    }));
    const generated = {
      draft: {
        titleCandidates: ["one", "two", "three", "four", "five"],
        recommendedTitle: "one",
        body: "fixture body",
        hashtags: ["#one", "#two", "#three"],
        interactionPrompt: "fixture prompt",
        pages,
        claims: [{ factId: productId, text: "fixture fact" }],
      },
      model: "fixture-model",
      repairAttempts: 0,
      promptVersion: "content-v1",
      contentSha256: "a".repeat(64),
    };
    const handler = createContentHandler({
      llm: {} as StructuredLlm,
      async loadInput() {
        return {
          topic: { id: "topic-1", title: "Fixture topic", angle: "Fixture angle", pillar: "product_proof" },
          campaign: { id: "campaign-1", goal: "fixture", audience: "fixture" },
          facts: [{ id: productId, statement: "fixture fact", category: "feature", status: "verified", publicUseAllowed: true }],
          assets: [],
          learnings: [],
          brandProfile: { mark: "Fixture", background: "#fffaf0", foreground: "#17211b", accent: "#e5ecdf" },
          desiredCta: "fixture prompt",
        } as never;
      },
      async generate() {
        return generated as never;
      },
    });

    const execution = await handler({
      ctx,
      job: workerJob("generate_content", { contentInput: { contentId: "content-1", campaignId: "campaign-1", topicId: "topic-1", briefId: "brief-1" } }),
      workerId: "worker-test",
      signal,
    });

    expect(execution.commitPayload).toMatchObject({
      generated: {
        renderInput: {
          pages,
          brand: { mark: "Fixture", background: "#fffaf0", foreground: "#17211b", accent: "#e5ecdf" },
        },
      },
    });
  });

  it("preserves the exact review context for the atomic review commit", async () => {
    const reviewContext = {
      contentVersionId: "00000000-0000-4000-8000-000000000006",
      payload: {},
      facts: [],
      sourceAssets: [],
      recentApprovedContents: [],
    };
    const handler = createReviewHandler({
      llm: {} as StructuredLlm,
      async loadContext() {
        return reviewContext;
      },
      async review() {
        return {
          passed: false,
          findings: [{ code: "BLOCKED", severity: "blocking" as const, message: "fixture" }],
          claimExtractionModel: "fixture-model",
          repairAttempts: 0,
        };
      },
    });

    const execution = await handler({
      ctx,
      job: workerJob("review_content", { contentVersionId: reviewContext.contentVersionId }),
      workerId: "worker-test",
      signal,
    });

    expect(execution.commitPayload).toEqual({
      contentVersionId: reviewContext.contentVersionId,
      reviewContext,
      findings: [{ code: "BLOCKED", severity: "blocking", message: "fixture" }],
    });
  });

  it("chains a passed review to the deterministic render job", async () => {
    const contentVersionId = "00000000-0000-4000-8000-000000000006";
    const handler = createReviewHandler({
      llm: {} as StructuredLlm,
      async loadContext() {
        return {
          contentVersionId,
          payload: {},
          facts: [],
          sourceAssets: [],
          recentApprovedContents: [],
        };
      },
      async review() {
        return {
          passed: true,
          findings: [],
          claimExtractionModel: "fixture-model",
          repairAttempts: 0,
        };
      },
    });

    const execution = await handler({
      ctx,
      job: workerJob("review_content", { contentVersionId }),
      workerId: "worker-test",
      signal,
    });

    expect(execution.nextJob).toEqual({
      productId,
      kind: "render_assets",
      idempotencyKey: `content:${contentVersionId}:render:v1`,
      payload: { contentVersionId },
    });
  });

  it("uploads seven validated pages under immutable final object keys", async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const pages = Array.from({ length: 7 }, (_, index) => ({
      page: index + 1,
      buffer: bytes,
      width: 1080,
      height: 1440,
      mimeType: "image/png" as const,
      sha256: "a".repeat(64),
      byteSize: bytes.byteLength,
    }));
    const uploads: Array<{ objectKey: string; bytes: Buffer; metadata: unknown }> = [];
    const removed: string[][] = [];
    const renderContentVersionId = "00000000-0000-4000-8000-000000000006";
    const handler = createRenderAssetsHandler({
      async loadInput() {
        return {
          workspaceId: ctx.workspaceId,
          productId,
          contentVersionId: renderContentVersionId,
          pages: [],
          sourceAssetResolver: {} as never,
          brand: {} as never,
        };
      },
      async render() {
        return pages;
      },
      storage: {
        async upload(objectKey, uploadedBytes, metadata) {
          uploads.push({ objectKey, bytes: uploadedBytes, metadata });
        },
        async removeOwned(objectKeys) {
          removed.push(objectKeys);
        },
      },
      validate: async (input) => input,
    });

    const execution = await handler({
      ctx,
      job: workerJob("render_assets", { contentVersionId: renderContentVersionId }),
      workerId: "worker-test",
      signal,
    });

    expect(uploads).toHaveLength(7);
    expect(uploads[0]?.objectKey).toBe(
      `workspaces/${ctx.workspaceId}/products/${productId}/contents/${renderContentVersionId}/page-1-${"a".repeat(64)}.png`,
    );
    expect(execution.commitPayload).toMatchObject({
      contentVersionId: renderContentVersionId,
      assets: expect.arrayContaining([expect.objectContaining({ width: 1080, height: 1440, mimeType: "image/png" })]),
    });
    expect(removed).toEqual([]);
  });
});
