import type { StructuredLlm } from "@social-agent/llm";
import type { ContentDraft } from "@social-agent/contracts";
import {
  reviewContent,
  type ReviewContext,
  type ReviewResult,
} from "@social-agent/review-engine";
import type { WorkerHandler } from "../runner.js";

export type ReviewContextLoader = (input: {
  workspaceId: string;
  contentVersionId: string;
}) => Promise<ReviewContext>;

export type ReviewHandlerDependencies = {
  llm: StructuredLlm;
  loadContext: ReviewContextLoader;
  review?: (input: Parameters<typeof reviewContent>[0], llm: StructuredLlm) => Promise<ReviewResult>;
};

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createReviewHandler(dependencies: ReviewHandlerDependencies): WorkerHandler {
  return async ({ ctx, job, signal }) => {
    if (signal.aborted) throw new Error("LEASE_LOST");
    if (!job.productId) throw new Error("PRODUCT_SCOPE_REQUIRED");
    const payload = recordPayload(job.payload);
    const contentVersionId = payload.contentVersionId;
    if (typeof contentVersionId !== "string" || !contentVersionId) {
      throw new Error("CONTENT_VERSION_REQUIRED");
    }
    const context = await dependencies.loadContext({
      workspaceId: ctx.workspaceId,
      contentVersionId,
    });
    if (context.contentVersionId !== contentVersionId) throw new Error("REVIEW_CONTEXT_SCOPE_MISMATCH");
    const reviewInput: Parameters<typeof reviewContent>[0] = {
      workspaceId: ctx.workspaceId,
      productId: job.productId,
      contentVersionId,
      draft: context.payload,
      facts: context.facts,
      sourceAssets: context.sourceAssets,
      recentApprovedContents: context.recentApprovedContents.map((content) => ({
        id: content.contentId,
        contentVersionId: content.contentVersionId,
        draft: content.payload as ContentDraft,
      })),
    };
    const result = await (dependencies.review ?? reviewContent)(reviewInput, dependencies.llm);
    if (signal.aborted) throw new Error("LEASE_LOST");
    const nextJob = result.passed
      ? {
          productId: job.productId,
          kind: "render_assets" as const,
          idempotencyKey: `content:${contentVersionId}:render:v1`,
          payload: { contentVersionId },
        }
      : undefined;
    return {
      result: {
        productId: job.productId,
        contentVersionId,
        passed: result.passed,
        claimExtractionModel: result.claimExtractionModel,
        repairAttempts: result.repairAttempts,
      },
      commitPayload: {
        contentVersionId,
        reviewContext: context,
        findings: result.findings,
      },
      ...(nextJob ? { nextJob } : {}),
    };
  };
}
