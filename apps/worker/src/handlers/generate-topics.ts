import type { StructuredLlm } from "@social-agent/llm";
import {
  generateTopics,
  type TopicCandidate,
  type TopicGenerationInput,
  type TopicGenerationResult,
} from "@social-agent/topic-engine";
import type { WorkerHandler } from "../runner.js";

export type TopicInputLoader = (input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
}) => Promise<TopicGenerationInput>;

export type TopicHandlerDependencies = {
  llm: StructuredLlm;
  loadInput: TopicInputLoader;
  generate?: (input: TopicGenerationInput, llm: StructuredLlm) => Promise<TopicGenerationResult>;
};

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toCommitCandidate(candidate: TopicCandidate): Record<string, unknown> {
  return {
    title: candidate.title,
    angle: candidate.angle,
    pillar: candidate.pillar,
    fact_ids: candidate.factIds,
    scores: candidate.scores,
    total_score: candidate.totalScore,
  };
}

export function createTopicHandler(dependencies: TopicHandlerDependencies): WorkerHandler {
  return async ({ ctx, job, signal }) => {
    if (signal.aborted) throw new Error("LEASE_LOST");
    if (!job.productId) throw new Error("PRODUCT_SCOPE_REQUIRED");
    const payload = recordPayload(job.payload);
    const campaignId = payload.campaignId;
    if (typeof campaignId !== "string" || !campaignId) throw new Error("CAMPAIGN_REQUIRED");
    const input = await dependencies.loadInput({
      workspaceId: ctx.workspaceId,
      productId: job.productId,
      campaignId,
    });
    const generated = await (dependencies.generate ?? generateTopics)(input, dependencies.llm);
    if (signal.aborted) throw new Error("LEASE_LOST");
    return {
      result: {
        productId: job.productId,
        campaignId,
        candidateCount: generated.candidates.length,
        selectedCount: generated.selected.length,
        model: generated.model,
        repairAttempts: generated.repairAttempts,
      },
      commitPayload: {
        campaignId,
        candidates: generated.candidates.map(toCommitCandidate),
      },
    };
  };
}
