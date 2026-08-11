import { describe, expect, it } from "vitest";
import { createSupabaseClient } from "./client.js";
import type {
  ContentVersionRepository,
  JobRepository,
  PublicationRepository,
  RepositoryContext,
} from "./index.js";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_VERSION_ID = "00000000-0000-4000-8000-000000000101";
const APPROVED_VERSION_ID = "00000000-0000-4000-8000-000000000102";

const ctx: RepositoryContext = {
  workspaceId: WORKSPACE_ID,
  actor: { type: "worker", id: "unit-worker" },
  requestId: "unit-request",
};

class InMemoryRepositoryFixture {
  private readonly jobs = new Map<string, { id: string; status: "queued" }>();
  private readonly versionStatus = new Map<string, "draft" | "approved">([
    [DRAFT_VERSION_ID, "draft"],
    [APPROVED_VERSION_ID, "approved"],
  ]);

  readonly jobsPort: Pick<JobRepository, "enqueueJob"> = {
    enqueueJob: async (_ctx, input) => {
      const existing = this.jobs.get(input.idempotencyKey);
      if (existing) return existing;
      const created = { id: crypto.randomUUID(), status: "queued" as const };
      this.jobs.set(input.idempotencyKey, created);
      return created;
    },
  };

  readonly publicationsPort: Pick<PublicationRepository, "create"> = {
    create: async (_ctx, input) => {
      if (this.versionStatus.get(input.contentVersionId) !== "approved") {
        throw new Error("CONTENT_NOT_APPROVED");
      }
      throw new Error("fixture stops after approval precondition");
    },
  };

  readonly contentVersionsPort: Pick<ContentVersionRepository, "approve"> & {
    updatePayload(id: string): Promise<void>;
  } = {
    approve: async (_ctx, id) => {
      this.versionStatus.set(id, "approved");
      throw new Error("fixture stops after approval transition");
    },
    updatePayload: async (id) => {
      if (this.versionStatus.get(id) === "approved") {
        throw new Error("CONTENT_VERSION_IMMUTABLE");
      }
    },
  };
}

describe("repository port invariants", () => {
  it("exposes the Supabase client factory", () => {
    expect(createSupabaseClient).toBeTypeOf("function");
  });

  it("returns the existing job for a duplicate idempotency key", async () => {
    const repo = new InMemoryRepositoryFixture().jobsPort;
    const input = {
      productId: "fixture-product",
      kind: "sync_product" as const,
      idempotencyKey: "sync:product-fixture",
      payload: { productId: "fixture" },
    };

    const first = await repo.enqueueJob(ctx, input);
    const second = await repo.enqueueJob(ctx, input);

    expect(second.id).toBe(first.id);
  });

  it("rejects publication creation from draft content", async () => {
    const repo = new InMemoryRepositoryFixture().publicationsPort;

    await expect(repo.create(ctx, {
      contentVersionId: DRAFT_VERSION_ID,
      idempotencyKey: "publication:draft-fixture",
    })).rejects.toThrow("CONTENT_NOT_APPROVED");
  });

  it("rejects updates to an approved content version", async () => {
    const repo = new InMemoryRepositoryFixture().contentVersionsPort;

    await expect(repo.updatePayload(APPROVED_VERSION_ID)).rejects.toThrow(
      "CONTENT_VERSION_IMMUTABLE",
    );
  });
});
