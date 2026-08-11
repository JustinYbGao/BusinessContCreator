import { describe, expect, it } from "vitest";
import { validateCampaignInput, validateProductInput } from "./products.js";
import { isPubliclyUsableAsset, isPubliclyUsableFact } from "./source-policy.js";

describe("product core input validation", () => {
  it("normalizes a product slug and rejects blank product names", () => {
    expect(validateProductInput({
      name: "  DormChef  ",
      slug: " DormChef-App ",
      positioning: "  meal planning  ",
      brandProfile: { tone: "practical" },
    })).toEqual({
      name: "DormChef",
      slug: "dormchef-app",
      positioning: "meal planning",
      brandProfile: { tone: "practical" },
    });

    expect(() => validateProductInput({ name: " ", slug: "valid", positioning: "", brandProfile: {} }))
      .toThrow("INVALID_PRODUCT_INPUT");
  });

  it("requires a four-week campaign with valid dates and pillar quotas", () => {
    expect(validateCampaignInput({
      productId: "00000000-0000-4000-8000-000000000001",
      channelId: "00000000-0000-4000-8000-000000000002",
      name: "DormChef cold start",
      goal: "activation",
      audience: "students",
      pillarQuotas: { pain_solution: 5, product_proof: 4, region_timing: 2, founder_story: 1 },
      startsOn: "2026-09-01",
      endsOn: "2026-09-28",
    }).endsOn).toBe("2026-09-28");

    expect(() => validateCampaignInput({
      productId: "00000000-0000-4000-8000-000000000001",
      channelId: "00000000-0000-4000-8000-000000000002",
      name: "Too short",
      goal: "activation",
      audience: "students",
      pillarQuotas: { pain_solution: 5, product_proof: 4, region_timing: 2, founder_story: 1 },
      startsOn: "2026-09-01",
      endsOn: "2026-09-07",
    })).toThrow("INVALID_CAMPAIGN_INPUT");

    expect(() => validateCampaignInput({
      productId: "00000000-0000-4000-8000-000000000001",
      channelId: "00000000-0000-4000-8000-000000000002",
      name: "Invalid calendar date",
      goal: "activation",
      audience: "students",
      pillarQuotas: { pain_solution: 5, product_proof: 4, region_timing: 2, founder_story: 1 },
      startsOn: "2026-02-30",
      endsOn: "2026-03-29",
    })).toThrow("INVALID_CAMPAIGN_INPUT");

    expect(() => validateCampaignInput({
      productId: "00000000-0000-4000-8000-000000000001",
      channelId: "00000000-0000-4000-8000-000000000002",
      name: "Wrong quota",
      goal: "activation",
      audience: "students",
      pillarQuotas: { pain_solution: 6, product_proof: 3, region_timing: 2, founder_story: 1 },
      startsOn: "2026-09-01",
      endsOn: "2026-09-28",
    })).toThrow("INVALID_CAMPAIGN_INPUT");
  });

  it("requires verification identity and timestamp before public use", () => {
    expect(isPubliclyUsableFact({ status: "verified", publicUseAllowed: true, verifiedAt: "2026-08-11T00:00:00Z" })).toBe(false);
    expect(isPubliclyUsableAsset({ verificationStatus: "verified", publicUseAllowed: true, verifiedBy: "user-1" })).toBe(false);
    expect(isPubliclyUsableFact({ status: "verified", publicUseAllowed: true, verifiedBy: "user-1", verifiedAt: "2026-08-11T00:00:00Z" })).toBe(true);
    expect(isPubliclyUsableAsset({ verificationStatus: "verified", publicUseAllowed: true, verifiedBy: "user-1", verifiedAt: "2026-08-11T00:00:00Z" })).toBe(true);
  });
});
