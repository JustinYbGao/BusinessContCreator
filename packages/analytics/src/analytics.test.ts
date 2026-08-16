import { describe, expect, it } from "vitest";
import {
  calculateRates,
  parseMetricImport,
  summarizeConversions,
  type MetricImportRow,
} from "./index.js";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000003";

const validRow: MetricImportRow = {
  workspaceId: WORKSPACE_ID,
  productId: PRODUCT_ID,
  publicationId: PUBLICATION_ID,
  window: "24h",
  metrics: {
    impressions: 200,
    views: 100,
    likes: 10,
    saves: 5,
    comments: 3,
    shares: 2,
    followersGained: 4,
  },
  productConversion: [],
  capturedAt: "2026-08-16T10:00:00.000Z",
};

const csvHeader = "workspaceId,productId,publicationId,window,capturedAt,impressions,views,likes,saves,comments,shares,followersGained,productConversion";

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function csvRow(impressions = "200", conversion = "[]"): string {
  return [
    WORKSPACE_ID,
    PRODUCT_ID,
    PUBLICATION_ID,
    "24h",
    "2026-08-16T10:00:00.000Z",
    impressions,
    "100",
    "10",
    "5",
    "3",
    "2",
    "4",
    csvCell(conversion),
  ].join(",");
}

describe("Task 11 analytics primitives", () => {
  it("uses impressions only for view-through and views for engagement rates", () => {
    expect(calculateRates({
      impressions: 200,
      views: 100,
      likes: 10,
      saves: 5,
      comments: 3,
      shares: 2,
      followersGained: 4,
    })).toEqual({
      viewThroughRate: { value: 0.5, denominator: "impressions" },
      likeRate: { value: 0.1, denominator: "views" },
      saveRate: { value: 0.05, denominator: "views" },
      commentRate: { value: 0.03, denominator: "views" },
      shareRate: { value: 0.02, denominator: "views" },
      followerRate: { value: 0.04, denominator: "views" },
      engagementRate: { value: 0.2, denominator: "views" },
    });
  });

  it("returns null instead of substituting views for missing impressions", () => {
    expect(calculateRates({
      impressions: null,
      views: 100,
      likes: 1,
      saves: 0,
      comments: 0,
      shares: 0,
      followersGained: 0,
    }).viewThroughRate).toEqual({ value: null, denominator: "impressions" });

    expect(calculateRates({
      impressions: 0,
      views: 0,
      likes: 0,
      saves: 0,
      comments: 0,
      shares: 0,
      followersGained: 0,
    }).engagementRate).toEqual({ value: null, denominator: "views" });
  });

  it("keeps direct, self-reported, and inferred conversions separate", () => {
    expect(summarizeConversions([
      { event: "firstOpen", count: 2, attribution: "direct", confidence: "high" },
      { event: "activation", count: 5, attribution: "self_reported", confidence: "medium" },
      { event: "coreAction", count: 11, attribution: "inferred", confidence: "low" },
    ])).toEqual({ direct: 2, selfReported: 5, inferred: 11 });
  });
});

describe("bounded metric imports", () => {
  it("strips a UTF-8 BOM and preserves quoted commas and newlines", () => {
    const conversion = JSON.stringify([{
      event: "activation",
      count: 5,
      attribution: "self_reported",
      confidence: "medium",
      note: "quoted,\nline",
    }]);
    const parsed = parseMetricImport({
      format: "csv",
      body: `\ufeff${csvHeader}\n${csvRow("200", conversion)}`,
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.productConversion[0]?.note).toBe("quoted,\nline");
  });

  it("rejects unknown and duplicate headers before producing rows", () => {
    const parsed = parseMetricImport({
      format: "csv",
      body: "workspaceId,workspaceId,unknown\nvalue,value,value",
    });

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["DUPLICATE_HEADER", "UNKNOWN_COLUMN"]),
    );
  });

  it("rejects formula-like cells as invalid data and never evaluates them", () => {
    const parsed = parseMetricImport({
      format: "csv",
      body: `${csvHeader}\n${csvRow("=1")}`,
    });

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]?.code).toBe("FORMULA_LIKE_VALUE");
  });

  it("validates every row before a partially valid file can be returned", () => {
    const parsed = parseMetricImport({
      format: "json",
      body: {
        rows: [validRow, { ...validRow, window: "invalid" as never }],
      },
    });

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]?.row).toBe(3);
  });

  it("rejects duplicate publication windows and enforces byte limits", () => {
    const duplicate = parseMetricImport({
      format: "manual",
      body: [validRow, validRow],
    });
    expect(duplicate.errors.map((error) => error.code)).toContain("DUPLICATE_WINDOW");

    const tooLarge = parseMetricImport({
      format: "json",
      body: "x".repeat(1_000_001),
    });
    expect(tooLarge.errors[0]?.code).toBe("IMPORT_TOO_LARGE");
  });

  it("normalizes empty impression and view cells to nullable denominators", () => {
    const parsed = parseMetricImport({
      format: "csv",
      body: `${csvHeader}\n${csvRow("").replace(",100,10,", ",,10,")}`,
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.metrics.impressions).toBeNull();
    expect(parsed.rows[0]?.metrics.views).toBeNull();
  });
});
