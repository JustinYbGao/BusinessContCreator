import { describe, expect, it, vi } from "vitest";

import { SupabaseLearningRepository } from "./learnings.js";
import { SupabaseMetricRepository } from "./metrics.js";
import { SupabasePublicationRepository } from "./publications.js";
import { SupabaseWeeklyReportRepository } from "./weekly-reports.js";
import type { RepositoryContext } from "./index.js";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";
const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000003";
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000004";
const REPORT_ID = "00000000-0000-4000-8000-000000000005";

const ctx: RepositoryContext = {
  workspaceId: WORKSPACE_ID,
  actor: { type: "user", id: "actor-user" },
  requestId: "analytics-request",
};

describe("Task 11 repository boundaries", () => {
  it("registers a publication through the atomic RPC", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: {
            id: PUBLICATION_ID,
            workspace_id: WORKSPACE_ID,
            product_id: PRODUCT_ID,
            campaign_id: CAMPAIGN_ID,
            status: "PUBLISHED",
            package: {},
            public_url: "https://xhslink.com/abc",
            published_at: "2026-08-16T10:00:00.000Z",
          },
          error: null,
        };
      },
    };

    const result = await new SupabasePublicationRepository(db as never).registerPublished(ctx, PUBLICATION_ID, {
      publicUrl: "https://xhslink.com/abc",
      publishedAt: "2026-08-16T10:00:00.000Z",
    });

    expect(result.publicUrl).toBe("https://xhslink.com/abc");
    expect(calls).toEqual([{
      name: "register_publication",
      args: {
        p_workspace_id: WORKSPACE_ID,
        p_publication_id: PUBLICATION_ID,
        p_public_url: "https://xhslink.com/abc",
        p_published_at: "2026-08-16T10:00:00.000Z",
        p_actor_id: "actor-user",
        p_request_id: "analytics-request",
      },
    }]);
  });

  it("uses RPCs for Learning and weekly report writes", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: {
            id: name === "create_learning" ? "learning-id" : REPORT_ID,
            workspace_id: WORKSPACE_ID,
            product_id: PRODUCT_ID,
            publication_id: PUBLICATION_ID,
            campaign_id: CAMPAIGN_ID,
            evidence_window: "24h",
            week_start: "2026-08-10",
            payload: { confidence: "hypothesis", sampleCount: 1 },
            source_snapshot_ids: [],
          },
          error: null,
        };
      },
    };

    await new SupabaseLearningRepository(db as never).create(ctx, {
      productId: PRODUCT_ID,
      publicationId: PUBLICATION_ID,
      evidenceWindow: "24h",
      payload: { confidence: "hypothesis", sampleCount: 1 },
    });
    await new SupabaseWeeklyReportRepository(db as never).createOrReplace(ctx, {
      productId: PRODUCT_ID,
      campaignId: CAMPAIGN_ID,
      weekStart: "2026-08-10",
      payload: {},
      sourceSnapshotIds: [],
    });

    expect(calls.map((call) => call.name)).toEqual([
      "create_learning",
      "create_weekly_report",
    ]);
    expect(calls[0]?.args).toEqual(expect.objectContaining({
      p_workspace_id: WORKSPACE_ID,
      p_product_id: PRODUCT_ID,
      p_publication_id: PUBLICATION_ID,
      p_evidence_window: "24h",
      p_actor_id: "actor-user",
      p_request_id: "analytics-request",
    }));
  });

  it("filters campaign publication reads by Workspace, Product, and Campaign", async () => {
    const calls: Array<[string, unknown]> = [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        calls.push([column, value]);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        calls.push([column, values]);
        return query;
      },
      order: async () => ({
        data: [{
          id: PUBLICATION_ID,
          workspace_id: WORKSPACE_ID,
          product_id: PRODUCT_ID,
          campaign_id: CAMPAIGN_ID,
          status: "PUBLISHED",
          package: {},
          public_url: null,
          published_at: "2026-08-16T10:00:00.000Z",
        }],
        error: null,
      }),
    };
    const db = {
      from: (table: string) => {
        calls.push(["table", table]);
        return query;
      },
    };

    await new SupabaseMetricRepository(db as never).listForCampaign(
      { workspaceId: WORKSPACE_ID },
      PRODUCT_ID,
      CAMPAIGN_ID,
    );

    expect(calls).toEqual(expect.arrayContaining([
      ["table", "publications"],
      ["workspace_id", WORKSPACE_ID],
      ["product_id", PRODUCT_ID],
      ["campaign_id", CAMPAIGN_ID],
    ]));
  });
});
