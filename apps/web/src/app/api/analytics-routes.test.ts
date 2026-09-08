import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../lib/workspace-context";

const state = vi.hoisted(() => ({
  context: {
    actorId: "00000000-0000-4000-8000-000000000000",
    workspaceId: "00000000-0000-4000-8000-000000000001",
  },
  workspaceError: null as Error | null,
  requireServerInternalWorkspace: vi.fn(),
  registerPublished: vi.fn(),
  getAnalytics: vi.fn(),
  transition: vi.fn(),
  listByPublication: vi.fn(),
  listForCampaign: vi.fn(),
  importSnapshots: vi.fn(),
  createLearning: vi.fn(),
  listEligible: vi.fn(),
  createOrReplace: vi.fn(),
  getByCampaignWeek: vi.fn(),
  supabase: { from: vi.fn() },
}));

vi.mock("../../lib/supabase/server", () => ({
  requireServerInternalWorkspace: state.requireServerInternalWorkspace,
  createSupabaseServiceRoleClient: vi.fn(() => state.supabase),
}));

vi.mock("@social-agent/db", () => ({
  SupabasePublicationRepository: class {
    registerPublished(...args: Parameters<typeof state.registerPublished>) { return state.registerPublished(...args); }
    getAnalytics(...args: Parameters<typeof state.getAnalytics>) { return state.getAnalytics(...args); }
    transition(...args: Parameters<typeof state.transition>) { return state.transition(...args); }
  },
  SupabaseMetricRepository: class {
    listByPublication(...args: Parameters<typeof state.listByPublication>) { return state.listByPublication(...args); }
    listForCampaign(...args: Parameters<typeof state.listForCampaign>) { return state.listForCampaign(...args); }
    importSnapshots(...args: Parameters<typeof state.importSnapshots>) { return state.importSnapshots(...args); }
  },
  SupabaseLearningRepository: class {
    create(...args: Parameters<typeof state.createLearning>) { return state.createLearning(...args); }
    listEligible(...args: Parameters<typeof state.listEligible>) { return state.listEligible(...args); }
  },
  SupabaseWeeklyReportRepository: class {
    createOrReplace(...args: Parameters<typeof state.createOrReplace>) { return state.createOrReplace(...args); }
    getByCampaignWeek(...args: Parameters<typeof state.getByCampaignWeek>) { return state.getByCampaignWeek(...args); }
  },
}));

import { POST as registerPublished } from "./publications/[publicationId]/publish/route";
import { GET as getPublicationMetrics } from "./publications/[publicationId]/metrics/route";
import { POST as createRetrospective } from "./publications/[publicationId]/retrospective/route";
import { POST as importMetrics } from "./metrics/import/route";
import { GET as getWeeklyReport, POST as createWeeklyReport } from "./reports/weekly/route";

const PUBLICATION_ID = "00000000-0000-4000-8000-000000000004";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";
const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000003";

function routeParams(publicationId = PUBLICATION_ID) {
  return { params: Promise.resolve({ publicationId }) };
}

function metricRow(productId = PRODUCT_ID) {
  return {
    workspaceId: state.context.workspaceId,
    productId,
    publicationId: PUBLICATION_ID,
    window: "24h",
    capturedAt: "2026-08-16T10:00:00.000Z",
    metrics: {
      impressions: 100,
      views: 80,
      likes: 8,
      saves: 4,
      comments: 2,
      shares: 1,
      followersGained: 3,
    },
    productConversion: [],
  };
}

function campaignSample(status: "PUBLISHED" | "MEASURING" | "RETROSPECTED" = "PUBLISHED") {
  const row = metricRow();
  return {
    id: PUBLICATION_ID,
    workspaceId: state.context.workspaceId,
    productId: PRODUCT_ID,
    campaignId: CAMPAIGN_ID,
    status,
    package: {},
    publicUrl: null,
    publishedAt: "2026-08-15T10:00:00.000Z",
    snapshots: [{
      id: "00000000-0000-4000-8000-000000000006",
      window: row.window,
      metrics: row.metrics,
      productConversion: row.productConversion,
      capturedAt: row.capturedAt,
    }],
  };
}

beforeEach(() => {
  state.workspaceError = null;
  state.requireServerInternalWorkspace.mockReset();
  state.requireServerInternalWorkspace.mockImplementation(async () => {
    if (state.workspaceError) throw state.workspaceError;
    return state.context;
  });
  for (const mock of [
    state.registerPublished,
    state.getAnalytics,
    state.transition,
    state.listByPublication,
    state.listForCampaign,
    state.importSnapshots,
    state.createLearning,
    state.listEligible,
    state.createOrReplace,
    state.getByCampaignWeek,
  ]) mock.mockReset();
  state.supabase.from.mockReset();
  state.registerPublished.mockResolvedValue({
    id: PUBLICATION_ID,
    workspaceId: state.context.workspaceId,
    productId: PRODUCT_ID,
    campaignId: CAMPAIGN_ID,
    status: "PUBLISHED",
    package: { body: "never returned" },
    publicUrl: "https://xhslink.com/abc",
    publishedAt: "2026-08-16T10:00:00.000Z",
  });
  state.getAnalytics.mockResolvedValue(null);
  state.transition.mockResolvedValue(undefined);
  state.listByPublication.mockResolvedValue([]);
  state.listForCampaign.mockResolvedValue([]);
  state.importSnapshots.mockResolvedValue({ importId: "import-1", acceptedRows: 1 });
  state.createLearning.mockResolvedValue({ id: "learning-1" });
  state.listEligible.mockResolvedValue([]);
  state.createOrReplace.mockResolvedValue({ id: "report-1" });
  state.getByCampaignWeek.mockResolvedValue(null);
});

describe("Task 11 analytics routes", () => {
  it("records a human publication result without fetching the public URL", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      const response = await registerPublished(new Request("http://localhost/api/publications/test/publish", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "publish-request" },
        body: JSON.stringify({
          publicUrl: "https://xhslink.com/abc",
          publishedAt: "2026-08-16T10:00:00.000Z",
        }),
      }), routeParams());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        publicationId: PUBLICATION_ID,
        status: "PUBLISHED",
        publicUrl: "https://xhslink.com/abc",
        publishedAt: "2026-08-16T10:00:00.000Z",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(state.registerPublished).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: state.context.workspaceId, requestId: "publish-request" }),
        PUBLICATION_ID,
        { publicUrl: "https://xhslink.com/abc", publishedAt: "2026-08-16T10:00:00.000Z" },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns the scoped metric windows", async () => {
    state.getAnalytics.mockResolvedValue({
      id: PUBLICATION_ID,
      workspaceId: state.context.workspaceId,
      productId: PRODUCT_ID,
      campaignId: CAMPAIGN_ID,
      status: "PUBLISHED",
      package: {},
      publicUrl: "https://xhslink.com/abc",
      publishedAt: "2026-08-15T10:00:00.000Z",
    });
    state.listByPublication.mockResolvedValue([{
      ...metricRow(),
      id: "00000000-0000-4000-8000-000000000006",
      metrics: metricRow().metrics,
    }]);

    const response = await getPublicationMetrics(new Request("http://localhost"), routeParams());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.publication).toEqual(expect.objectContaining({ id: PUBLICATION_ID, publicUrl: "https://xhslink.com/abc" }));
    expect(body.windows).toHaveLength(3);
    expect(body.windows.find((window: { window: string }) => window.window === "24h")).toEqual(expect.objectContaining({ state: "captured" }));
    expect(state.getAnalytics).toHaveBeenCalledWith({ workspaceId: state.context.workspaceId }, PUBLICATION_ID);
  });

  it("rejects a mixed-product import before calling the metric write boundary", async () => {
    const response = await importMetrics(new Request(`http://localhost/api/metrics/import?productId=${PRODUCT_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId: PRODUCT_ID, rows: [metricRow(), { ...metricRow("00000000-0000-4000-8000-000000000099"), window: "72h" }] }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "IMPORT_SCOPE_MISMATCH" });
    expect(state.importSnapshots).not.toHaveBeenCalled();
  });

  it("validates scoped publications and calls the metric write boundary once", async () => {
    state.supabase.from.mockImplementation((table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        maybeSingle: async () => table === "products"
          ? { data: { id: PRODUCT_ID }, error: null }
          : { data: null, error: null },
        in: async () => ({ data: [{ id: PUBLICATION_ID }], error: null }),
      };
      return query;
    });

    const response = await importMetrics(new Request("http://localhost/api/metrics/import", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "import-request" },
      body: JSON.stringify({ productId: PRODUCT_ID, rows: [metricRow()] }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ importId: "import-1", acceptedRows: 1, format: "json" });
    expect(state.importSnapshots).toHaveBeenCalledTimes(1);
    expect(state.importSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: state.context.workspaceId, requestId: "import-request" }),
      expect.objectContaining({
        productId: PRODUCT_ID,
        format: "json",
        rows: [{
          publicationId: PUBLICATION_ID,
          window: "24h",
          metrics: metricRow().metrics,
          productConversion: [],
          capturedAt: "2026-08-16T10:00:00.000Z",
        }],
      }),
    );
  });

  it("does not write a Learning when the requested evidence window is incomplete", async () => {
    state.getAnalytics.mockResolvedValue({
      id: PUBLICATION_ID,
      workspaceId: state.context.workspaceId,
      productId: PRODUCT_ID,
      campaignId: CAMPAIGN_ID,
      status: "PUBLISHED",
      package: {},
      publicUrl: null,
      publishedAt: "2026-08-15T10:00:00.000Z",
    });
    state.listForCampaign.mockResolvedValue([{
      id: PUBLICATION_ID,
      workspaceId: state.context.workspaceId,
      productId: PRODUCT_ID,
      campaignId: CAMPAIGN_ID,
      status: "PUBLISHED",
      package: {},
      publicUrl: null,
      publishedAt: "2026-08-15T10:00:00.000Z",
      snapshots: [],
    }]);

    const response = await createRetrospective(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ window: "24h" }),
    }), routeParams());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "EVIDENCE_WINDOW_INCOMPLETE" });
    expect(state.createLearning).not.toHaveBeenCalled();
    expect(state.transition).not.toHaveBeenCalled();
  });

  it("persists an evidence-qualified retrospective and closes the publication state", async () => {
    const sample = campaignSample();
    state.getAnalytics.mockResolvedValue({
      id: PUBLICATION_ID,
      workspaceId: state.context.workspaceId,
      productId: PRODUCT_ID,
      campaignId: CAMPAIGN_ID,
      status: "PUBLISHED",
      package: {},
      publicUrl: null,
      publishedAt: sample.publishedAt,
    });
    state.listForCampaign.mockResolvedValue([sample]);
    state.createLearning.mockResolvedValue({ id: "learning-1" });

    const response = await createRetrospective(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "retro-request" },
      body: JSON.stringify({ window: "24h" }),
    }), routeParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ learningId: "learning-1" }));
    expect(state.transition).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ requestId: "retro-request" }),
      PUBLICATION_ID,
      "PUBLISHED",
      "MEASURING",
    );
    expect(state.createLearning).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "retro-request" }),
      expect.objectContaining({ evidenceWindow: "24h", publicationId: PUBLICATION_ID }),
    );
    expect(state.transition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestId: "retro-request" }),
      PUBLICATION_ID,
      "MEASURING",
      "RETROSPECTED",
    );
  });

  it("fails closed for Workspace lookup and never accepts a request-selected Workspace", async () => {
    state.workspaceError = new HttpError(500, "WORKSPACE_UNAVAILABLE");
    const response = await getWeeklyReport(new Request(
      `http://localhost/api/reports/weekly?workspaceId=00000000-0000-4000-8000-000000000099&productId=${PRODUCT_ID}&campaignId=${CAMPAIGN_ID}&weekStart=2026-08-10`,
    ));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "WORKSPACE_UNAVAILABLE" });

    state.workspaceError = null;
    const scopedResponse = await getWeeklyReport(new Request(
      `http://localhost/api/reports/weekly?workspaceId=00000000-0000-4000-8000-000000000099&productId=${PRODUCT_ID}&campaignId=${CAMPAIGN_ID}&weekStart=2026-08-10`,
    ));
    expect(scopedResponse.status).toBe(404);
    expect(state.getByCampaignWeek).toHaveBeenCalledWith(
      { workspaceId: state.context.workspaceId }, PRODUCT_ID, CAMPAIGN_ID, "2026-08-10",
    );
  });

  it("builds and stores a weekly report with only scoped records", async () => {
    state.listForCampaign.mockResolvedValue([campaignSample()]);
    state.listEligible.mockResolvedValue([{ id: "00000000-0000-4000-8000-000000000007" }]);
    state.createOrReplace.mockResolvedValue({ id: "report-1", payload: {}, sourceSnapshotIds: [] });

    const response = await createWeeklyReport(new Request("http://localhost/api/reports/weekly", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "report-request" },
      body: JSON.stringify({ productId: PRODUCT_ID, campaignId: CAMPAIGN_ID, weekStart: "2026-08-10" }),
    }));

    expect(response.status).toBe(200);
    expect(state.createOrReplace).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: state.context.workspaceId, requestId: "report-request" }),
      expect.objectContaining({ productId: PRODUCT_ID, campaignId: CAMPAIGN_ID, weekStart: "2026-08-10" }),
    );
  });
});
