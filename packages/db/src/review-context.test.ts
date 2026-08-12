import { describe, expect, it } from "vitest";
import { SupabaseReviewRepository } from "./reviews.js";
import type { RepositoryContext } from "./index.js";

const context: RepositoryContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  actor: { type: "worker", id: "review-worker" },
  requestId: "review-request",
};

describe("SupabaseReviewRepository review context boundary", () => {
  it("persists the context captured before findings were generated", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: {
            id: "00000000-0000-4000-8000-000000000002",
            content_version_id: "00000000-0000-4000-8000-000000000003",
            run_number: 1,
            is_current: true,
            result: "passed",
          },
          error: null,
        };
      },
    };
    const reviewContext = { contentVersionId: "00000000-0000-4000-8000-000000000003", facts: [] };

    await new SupabaseReviewRepository(db as never).replaceCurrentRun(
      context,
      "00000000-0000-4000-8000-000000000003",
      reviewContext,
      [],
    );

    expect(calls).toEqual([{
      name: "replace_current_review_run_with_context",
      args: expect.objectContaining({
        p_review_context: reviewContext,
      }),
    }]);
  });
});
