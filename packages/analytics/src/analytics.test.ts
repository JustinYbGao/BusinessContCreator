import { describe, expect, it } from "vitest";
import { calculateRates, summarizeConversions } from "./index.js";

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
