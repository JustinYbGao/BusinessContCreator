import { describe, expect, it } from "vitest";
import { parseProductRequest } from "./products/route.js";
import { parseProductSourceRequest } from "./products/[productId]/sources/route.js";
import { parseSyncRequest } from "./products/[productId]/sync/route.js";
import { parseFactAction } from "./products/[productId]/facts/route.js";
import { parseAssetAction } from "./products/[productId]/assets/route.js";
import { parseCampaignRequest } from "./campaigns/route.js";
import { parseGenerateTopicsRequest, scopeTopicGenerationIdempotencyKey } from "./topics/generate/route.js";

const productIds = {
  productId: "00000000-0000-4000-8000-000000000001",
  channelId: "00000000-0000-4000-8000-000000000002",
};

describe("Task 4 CRUD request boundaries", () => {
  it("normalizes product input and rejects non-object bodies", () => {
    expect(parseProductRequest({
      name: " DormChef ",
      slug: " DormChef-App ",
      positioning: " meals ",
      brandProfile: {},
    }).slug).toBe("dormchef-app");
    expect(() => parseProductRequest(null)).toThrow("INVALID_PRODUCT_INPUT");
  });

  it("accepts only relative source locators", () => {
    expect(parseProductSourceRequest({ kind: "manual", locator: "operator note" }).locator).toBe("operator note");
    expect(() => parseProductSourceRequest({ kind: "dormchef_local", locator: "/Users/secret" }))
      .toThrow("SOURCE_LOCATOR_INVALID");
    expect(() => parseProductSourceRequest({ kind: "dormchef_local", locator: "../../secret" }))
      .toThrow("SOURCE_LOCATOR_INVALID");
    expect(() => parseProductSourceRequest({ kind: "dormchef_local", locator: "logs/server.log" }))
      .toThrow("SOURCE_LOCATOR_INVALID");
    expect(parseProductSourceRequest({ kind: "dormchef_local", locator: "apps/miniprogram/pages/home/index.wxml" }).locator)
      .toBe("apps/miniprogram/pages/home/index.wxml");
  });

  it("does not accept a local root in a cloud sync request", () => {
    expect(parseSyncRequest({ sourceIds: [productIds.productId] })).toEqual({ sourceIds: [productIds.productId] });
    expect(() => parseSyncRequest({ sourceRoot: "/Users/secret" })).toThrow("INVALID_SYNC_INPUT");
  });

  it("requires a verified decision payload for fact and asset actions", () => {
    expect(parseFactAction({ factId: productIds.productId, decision: "verify" }).decision).toBe("verify");
    expect(parseFactAction({ factId: productIds.productId, decision: "edit-and-verify", editedStatement: "edited" }).decision)
      .toBe("edit-and-verify");
    expect(() => parseFactAction({ factId: productIds.productId, decision: "edit-and-verify" }))
      .toThrow("INVALID_FACT_ACTION");
    expect(parseAssetAction({ assetId: productIds.productId, decision: "public-use" }).decision).toBe("public-use");
  });

  it("validates a four-week campaign before persistence", () => {
    expect(parseCampaignRequest({
      ...productIds,
      name: "September",
      goal: "activation",
      audience: "students",
      pillarQuotas: { pain_solution: 5, product_proof: 4, region_timing: 2, founder_story: 1 },
      startsOn: "2026-09-01",
      endsOn: "2026-09-28",
    }).endsOn).toBe("2026-09-28");
    expect(() => parseCampaignRequest({
      ...productIds,
      name: "invalid",
      goal: "activation",
      audience: "students",
      pillarQuotas: { pain_solution: 1, product_proof: 1, region_timing: 1, founder_story: 1 },
      startsOn: "2026-09-01",
      endsOn: "2026-09-07",
    })).toThrow("INVALID_CAMPAIGN_INPUT");

    expect(() => parseCampaignRequest({
      ...productIds,
      name: "Invalid calendar date",
      goal: "activation",
      audience: "students",
      pillarQuotas: { pain_solution: 1, product_proof: 1, region_timing: 1, founder_story: 1 },
      startsOn: "2026-02-30",
      endsOn: "2026-03-29",
    })).toThrow("INVALID_CAMPAIGN_INPUT");

    expect(() => parseCampaignRequest({
      ...productIds,
      name: "Wrong quota",
      goal: "activation",
      audience: "students",
      pillarQuotas: { pain_solution: 6, product_proof: 3, region_timing: 2, founder_story: 1 },
      startsOn: "2026-09-01",
      endsOn: "2026-09-28",
    })).toThrow("INVALID_CAMPAIGN_INPUT");
  });

  it("accepts only a scoped campaign id for topic generation", () => {
    expect(parseGenerateTopicsRequest({ campaignId: productIds.productId })).toEqual({ campaignId: productIds.productId });
    expect(() => parseGenerateTopicsRequest({ campaignId: productIds.productId, sourceRoot: "/Users/secret" }))
      .toThrow("INVALID_TOPIC_GENERATION_INPUT");
    expect(() => parseGenerateTopicsRequest({ campaignId: "not-a-uuid" }))
      .toThrow("INVALID_TOPIC_GENERATION_INPUT");
  });

  it("scopes topic generation idempotency keys to the campaign", () => {
    expect(scopeTopicGenerationIdempotencyKey(productIds.productId, "request-1"))
      .toBe(`generate_topics:${productIds.productId}:request-1`);
    expect(scopeTopicGenerationIdempotencyKey(productIds.productId, "request-1"))
      .not.toBe(scopeTopicGenerationIdempotencyKey(productIds.channelId, "request-1"));
  });
});
