import type { StructuredLlm } from "@social-agent/llm";
import {
  generateContent,
  type ContentGenerationInput,
  type ContentGenerationResult,
} from "@social-agent/content-engine";
import type { WorkerHandler } from "../runner.js";

export type ContentInputLoader = (input: {
  workspaceId: string;
  productId: string;
  contentInput: unknown;
}) => Promise<ContentGenerationInput>;

export type ContentHandlerDependencies = {
  llm: StructuredLlm;
  loadInput: ContentInputLoader;
  generate?: (input: ContentGenerationInput, llm: StructuredLlm) => Promise<ContentGenerationResult>;
};

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createContentHandler(dependencies: ContentHandlerDependencies): WorkerHandler {
  return async ({ ctx, job, signal }) => {
    if (signal.aborted) throw new Error("LEASE_LOST");
    if (!job.productId) throw new Error("PRODUCT_SCOPE_REQUIRED");
    const payload = recordPayload(job.payload);
    const contentInput = payload.contentInput ?? payload;
    if (!contentInput || typeof contentInput !== "object" || Array.isArray(contentInput)
      || Object.keys(contentInput).length === 0) {
      throw new Error("CONTENT_INPUT_REQUIRED");
    }
    const input = await dependencies.loadInput({
      workspaceId: ctx.workspaceId,
      productId: job.productId,
      contentInput,
    });
    const generated = await (dependencies.generate ?? generateContent)(input, dependencies.llm);
    if (signal.aborted) throw new Error("LEASE_LOST");
    return {
      result: {
        productId: job.productId,
        model: generated.model,
        promptVersion: generated.promptVersion,
        repairAttempts: generated.repairAttempts,
        contentSha256: generated.contentSha256,
      },
      commitPayload: { contentInput, generated },
    };
  };
}
