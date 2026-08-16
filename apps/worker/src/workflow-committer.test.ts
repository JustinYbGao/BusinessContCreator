import type { DatabaseClient, RepositoryContext, WorkflowJob } from "@social-agent/db";
import { describe, expect, it } from "vitest";
import { createSupabaseWorkflowCommitter } from "./workflow-committer.js";

const ctx: RepositoryContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  actor: { type: "worker", id: "worker-1" },
  requestId: "request-1",
};

function job(kind: WorkflowJob["kind"], payload: unknown = {}): WorkflowJob {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    workspaceId: ctx.workspaceId,
    productId: "00000000-0000-4000-8000-000000000003",
    kind,
    payload,
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    lockedBy: "worker-1",
  };
}

function fakeDatabase(calls: Array<{ name: string; args: unknown }>): DatabaseClient {
  return {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: {}, error: null };
    },
  } as unknown as DatabaseClient;
}

describe("Supabase workflow committer", () => {
  it("uses the nine-argument review commit with the exact review context", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const reviewContext = { contentVersionId: "00000000-0000-4000-8000-000000000004", facts: [] };
    const committer = createSupabaseWorkflowCommitter(fakeDatabase(calls));

    await committer.commit({
      ctx,
      workerId: "worker-1",
      job: job("review_content", { contentVersionId: reviewContext.contentVersionId }),
      execution: {
        result: { passed: true },
        commitPayload: {
          contentVersionId: reviewContext.contentVersionId,
          reviewContext,
          findings: [],
        },
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      name: "commit_review_content_job",
      args: expect.objectContaining({
        p_content_version_id: reviewContext.contentVersionId,
        p_review_context: reviewContext,
        p_findings: [],
      }),
    });
  });

  it("converts final asset metadata to the Task 8 RPC shape and preserves chaining", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const committer = createSupabaseWorkflowCommitter(fakeDatabase(calls));
    const contentVersionId = "00000000-0000-4000-8000-000000000004";
    const nextJob = {
      productId: job("render_assets").productId,
      kind: "review_content" as const,
      idempotencyKey: "content:version:review:v1",
      payload: { contentVersionId },
    };

    await committer.commit({
      ctx,
      workerId: "worker-1",
      job: job("render_assets", { contentVersionId }),
      execution: {
        result: { assetCount: 7 },
        nextJob,
        commitPayload: {
          contentVersionId,
          uploadAttemptId: "upload-1",
          assets: [{
            objectKey: `workspaces/${ctx.workspaceId}/products/${job("render_assets").productId}/contents/${contentVersionId}/page-1-${"a".repeat(64)}.png`,
            mimeType: "image/png",
            byteSize: 12,
            width: 1080,
            height: 1440,
            sha256: "a".repeat(64),
          }],
        },
      },
    });

    expect(calls[0]).toEqual({
      name: "commit_render_assets_job",
      args: expect.objectContaining({
        p_content_version_id: contentVersionId,
        p_assets: [{
          object_key: expect.stringContaining("/page-1-"),
          mime_type: "image/png",
          byte_size: 12,
          width: 1080,
          height: 1440,
          sha256: "a".repeat(64),
        }],
        p_next_job: {
          product_id: nextJob.productId,
          kind: nextJob.kind,
          idempotency_key: nextJob.idempotencyKey,
          payload: nextJob.payload,
        },
      }),
    });
  });

  it("uses the generic finish RPC for purge jobs after the purge port succeeds", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const committer = createSupabaseWorkflowCommitter(fakeDatabase(calls));

    await committer.commit({
      ctx,
      workerId: "worker-1",
      job: job("purge_product"),
      execution: { result: { rowsDeleted: 1 } },
    });

    expect(calls[0]?.name).toBe("finish_workflow_job");
  });

  it("converts the web content enqueue payload into create_content_version input", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const committer = createSupabaseWorkflowCommitter(fakeDatabase(calls));
    const contentJob = job("generate_content", {
      contentId: "00000000-0000-4000-8000-000000000004",
      campaignId: "00000000-0000-4000-8000-000000000005",
      topicId: "00000000-0000-4000-8000-000000000006",
      briefId: "00000000-0000-4000-8000-000000000007",
    });
    const renderInput = {
      pages: Array.from({ length: 7 }, (_, index) => ({
        pageNumber: index + 1,
        title: `page-${index + 1}`,
        body: "fixture",
      })),
      brand: {
        mark: "fixture",
        background: "#FFFFFF",
        foreground: "#111111",
        accent: "#FF2442",
      },
    };
    const generated = {
      draft: { recommendedTitle: "title" },
      renderInput,
      model: "fixture-model",
      promptVersion: "content-v1",
      contentSha256: "a".repeat(64),
    };

    await committer.commit({
      ctx,
      workerId: "worker-1",
      job: contentJob,
      execution: { result: {}, commitPayload: { contentInput: contentJob.payload, generated } },
    });

    expect(calls[0]).toEqual({
      name: "commit_generate_content_job",
      args: expect.objectContaining({
        p_content_input: {
          product_id: contentJob.productId,
          campaign_id: "00000000-0000-4000-8000-000000000005",
          content_id: "00000000-0000-4000-8000-000000000004",
          topic_id: "00000000-0000-4000-8000-000000000006",
          brief_id: "00000000-0000-4000-8000-000000000007",
          payload: { ...generated.draft, renderInput },
          model_name: "fixture-model",
          prompt_version: "content-v1",
          content_sha256: "a".repeat(64),
          created_by: "worker-1",
        },
      }),
    });
  });
});
