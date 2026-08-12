import { describe, expect, it } from "vitest";
import type { ContentDraft } from "@social-agent/contracts/content";
import type { StructuredLlm } from "@social-agent/llm";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";
const CONTENT_VERSION_ID = "00000000-0000-4000-8000-000000000003";
const FACT_ID = "00000000-0000-4000-8000-000000000011";
const OTHER_FACT_ID = "00000000-0000-4000-8000-000000000012";
const ASSET_ID = "00000000-0000-4000-8000-000000000021";
const OTHER_ASSET_ID = "00000000-0000-4000-8000-000000000022";

type ReviewContent = (input: unknown, llm: StructuredLlm) => Promise<{
  passed: boolean;
  findings: Array<{ code: string; severity: "blocking" | "advisory"; message: string; path?: string; field?: string }>;
}>;

async function importReview(): Promise<{ reviewContent?: ReviewContent }> {
  try {
    return await import("./review.js") as { reviewContent?: ReviewContent };
  } catch {
    return {};
  }
}

function fakeLlm(responses: string[], calls: Parameters<StructuredLlm["generateJson"]>[0][] = []): StructuredLlm {
  let index = 0;
  return {
    async generateJson(prompt) {
      calls.push(prompt);
      return { text: addDefaultCoverage(responses[index++] ?? "{}", prompt), model: "fake-review-model" };
    },
  };
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function addDefaultCoverage(response: string, prompt: Parameters<StructuredLlm["generateJson"]>[0]): string {
  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    if (!Array.isArray(parsed.claims) || "coverage" in parsed) return response;
    const user = JSON.parse(prompt.user) as {
      corpusSegments?: Array<{ path: string; text: string }>;
      claimLedger?: Array<{ text?: unknown }>;
    };
    const modelClaims = parsed.claims.flatMap((claim) => {
      if (!claim || typeof claim !== "object" || Array.isArray(claim)) return [];
      const text = (claim as Record<string, unknown>).text;
      return typeof text === "string" ? [normalized(text)] : [];
    });
    const ledgerClaims = (user.claimLedger ?? []).flatMap((claim) => typeof claim.text === "string" ? [normalized(claim.text)] : []);
    return JSON.stringify({
      ...parsed,
      coverage: (user.corpusSegments ?? []).map((segment) => {
        const text = normalized(segment.text);
        const isClaim = [...modelClaims, ...ledgerClaims].some((claim) => claim && (text.includes(claim) || claim.includes(text)));
        return { path: segment.path, text: segment.text, classification: isClaim ? "claim" : "non_claim" };
      }),
    });
  } catch {
    return response;
  }
}

function baseDraft(): ContentDraft {
  return {
    titleCandidates: [
      "宿舍晚餐别再瞎翻菜单",
      "已有食材也能更快定晚餐",
      "把现有食材变成可做菜单",
      "住校党少走弯路的晚餐方法",
      "晚餐不知道吃什么时这样试",
    ],
    recommendedTitle: "宿舍晚餐别再瞎翻菜单",
    body: "产品支持按已有食材筛选菜谱。",
    hashtags: ["#宿舍晚餐", "#学生生活", "#做饭"],
    interactionPrompt: "你最常卡在哪一步？",
    pages: Array.from({ length: 7 }, (_, index) => ({
      page: index + 1,
      purpose: `第${index + 1}页目的`,
      headline: `第${index + 1}页标题`,
      body: "产品支持按已有食材筛选菜谱。",
      sourceAssetId: index === 1 ? ASSET_ID : null,
    })),
    claims: [{ factId: FACT_ID, text: "产品支持按已有食材筛选菜谱" }],
  };
}

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    productId: PRODUCT_ID,
    contentVersionId: CONTENT_VERSION_ID,
    draft: baseDraft(),
    facts: [{
      id: FACT_ID,
      workspaceId: WORKSPACE_ID,
      productId: PRODUCT_ID,
      statement: "产品支持按已有食材筛选菜谱",
      status: "verified",
      publicUseAllowed: true,
    }],
    sourceAssets: [{
      id: ASSET_ID,
      workspaceId: WORKSPACE_ID,
      productId: PRODUCT_ID,
      contentVersionId: null,
      provenance: "source",
      verificationStatus: "verified",
      publicUseAllowed: true,
    }],
    recentApprovedContents: [] as Array<{
      id: string;
      contentVersionId: string;
      draft: ContentDraft;
    }>,
    ...overrides,
  };
}

async function runReview(input = baseInput(), responses = [JSON.stringify({
  claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
})]) {
  const { reviewContent } = await importReview();
  expect(typeof reviewContent).toBe("function");
  return reviewContent!(input, fakeLlm(responses));
}

describe("review content", () => {
  it("blocks invalid claim ledger scope, page order, and source asset scope", async () => {
    const draft = baseDraft();
    draft.pages[6] = { ...draft.pages[6]!, page: 6 };
    draft.pages[1] = { ...draft.pages[1]!, sourceAssetId: OTHER_ASSET_ID };
    draft.claims = [{ factId: OTHER_FACT_ID, text: "产品支持按已有食材筛选菜谱" }];

    const result = await runReview(baseInput({ draft }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: OTHER_FACT_ID }],
    })]);

    expect(result.passed).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "PAGE_SEQUENCE_INVALID",
      "UNKNOWN_PRODUCT_FACT",
      "SOURCE_ASSET_SCOPE_MISMATCH",
    ]);
  });

  it("fails closed when claim extraction still cannot be repaired", async () => {
    const result = await runReview(baseInput(), ["not json", "still not json"]);

    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "CLAIM_EXTRACTION_UNAVAILABLE",
      severity: "blocking",
    }));
  });

  it("fails closed when the model returns no claims after repair", async () => {
    const result = await runReview(baseInput(), [JSON.stringify({ claims: [] }), JSON.stringify({ claims: [] })]);

    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "CLAIM_EXTRACTION_UNAVAILABLE",
      severity: "blocking",
    }));
  });

  it("does not treat a normal numbered step as an exaggerated first claim", async () => {
    const draft = baseDraft();
    draft.body = "第一步先选择已有食材，第二步再查看菜谱。";
    const result = await runReview(baseInput({ draft }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.findings).not.toContainEqual(expect.objectContaining({ code: "COMPLIANCE_EXAGGERATED_FIRST" }));
  });

  it("does not treat ordinary first-time wording as a superlative", async () => {
    const draft = baseDraft();
    draft.body = "第一次使用时先选择已有食材，再查看菜谱。";
    const result = await runReview(baseInput({ draft }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.findings).not.toContainEqual(expect.objectContaining({ code: "COMPLIANCE_EXAGGERATED_FIRST" }));
  });

  it("blocks formatted phone numbers with punctuation separators", async () => {
    const draft = baseDraft();
    draft.body = "联系电话 138.0013.8000。";
    const result = await runReview(baseInput({ draft }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "COMPLIANCE_PHONE_NUMBER",
      severity: "blocking",
    }));
  });

  it("blocks unmapped product capability claims", async () => {
    const draft = baseDraft();
    draft.body = "产品支持按已有食材筛选菜谱，还能一键生成整周采购清单。";

    const result = await runReview(baseInput({ draft }), [JSON.stringify({
      claims: [
        { text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID },
        { text: "还能一键生成整周采购清单", kind: "capability", factId: null },
      ],
    })]);

    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "UNMAPPED_PRODUCT_CLAIM",
      severity: "blocking",
    }));
  });

  it("blocks an omitted claim beside a mapped claim in one corpus segment", async () => {
    const draft = baseDraft();
    draft.body = "产品支持按已有食材筛选菜谱还能一键生成采购清单。";
    const result = await runReview(baseInput({ draft }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "UNMAPPED_PRODUCT_CLAIM",
      severity: "blocking",
    }));
  });

  it("blocks a model claim that is mapped to an unrelated ledger statement", async () => {
    const result = await runReview(baseInput(), [JSON.stringify({
      claims: [{ text: "产品自动生成整周采购清单", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "UNMAPPED_PRODUCT_CLAIM",
      severity: "blocking",
    }));
  });

  it("blocks when the model omits a Claim Ledger entry", async () => {
    const secondFactId = "00000000-0000-4000-8000-000000000013";
    const draft = {
      ...baseDraft(),
      claims: [
        ...baseDraft().claims,
        { factId: secondFactId, text: "产品支持按已有食材筛选菜谱" },
      ],
    };
    const result = await runReview(baseInput({
      draft,
      facts: [
        ...baseInput().facts,
        {
          id: secondFactId,
          workspaceId: WORKSPACE_ID,
          productId: PRODUCT_ID,
          statement: "产品支持按已有食材筛选菜谱",
          status: "verified",
          publicUseAllowed: true,
        },
      ],
    }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "UNMAPPED_PRODUCT_CLAIM",
      severity: "blocking",
    }));
  });

  it("fails closed when the model omits corpus coverage", async () => {
    const result = await runReview(baseInput(), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
      coverage: [{ path: "body", text: "产品支持按已有食材筛选菜谱", classification: "claim" }],
    })]);

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "CLAIM_EXTRACTION_INCOMPLETE",
      severity: "blocking",
    }));
  });

  it("applies configurable blocking compliance rules", async () => {
    const draft = baseDraft();
    draft.body = "加我微信 abc123，私信领取模板，扫码微信小程序，现在就看，全国第一，电话 13800138000。";

    const result = await runReview(baseInput({ draft }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.findings.map((finding) => finding.code)).toEqual([
      "COMPLIANCE_WECHAT_CONTACT",
      "COMPLIANCE_PHONE_NUMBER",
      "COMPLIANCE_PRIVATE_MESSAGE",
      "COMPLIANCE_WECHAT_MINIPROGRAM_QR",
      "COMPLIANCE_EXAGGERATED_FIRST",
    ]);
  });

  it("blocks email, broad QR, diversion, and absolute claims across the corpus", async () => {
    const draft = baseDraft();
    draft.titleCandidates[0] = "加我看主页领取，顶级晚餐工具";
    draft.body = "联系我 test@example.com，扫码领取，百分百最好。产品支持按已有食材筛选菜谱。";

    const result = await runReview(baseInput({ draft }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "COMPLIANCE_EMAIL_ADDRESS",
      "COMPLIANCE_PRIVATE_MESSAGE",
      "COMPLIANCE_WECHAT_MINIPROGRAM_QR",
      "COMPLIANCE_EXAGGERATED_FIRST",
    ]));
  });

  it("marks near-duplicate approved content as advisory at lower similarity", async () => {
    const result = await runReview(baseInput({
      recentApprovedContents: [{
        id: "approved-1",
        contentVersionId: "00000000-0000-4000-8000-000000000031",
        draft: {
          ...baseDraft(),
          body: "students decide dinner faster using available ingredients and simpler menu choices every evening",
          pages: baseDraft().pages.map((page) => ({ ...page, headline: "不同页面标题", body: "这是不同的页面文案。" })),
        },
      }],
      draft: {
        ...baseDraft(),
        body: "students decide dinner faster using available ingredients and simpler menu choices every night",
      },
    }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "REPETITION_NEAR_DUPLICATE",
      severity: "advisory",
    }));
  });

  it("blocks high-similarity approved content and keeps stage order stable", async () => {
    const draft = {
      ...baseDraft(),
      body: "加我微信领取，产品支持按已有食材筛选菜谱。",
      claims: [{ factId: OTHER_FACT_ID, text: "产品支持按已有食材筛选菜谱" }],
    };
    const result = await runReview(baseInput({
      draft,
      recentApprovedContents: [{
        id: "approved-2",
        contentVersionId: "00000000-0000-4000-8000-000000000032",
        draft,
      }],
    }), [JSON.stringify({
      claims: [
        { text: "加我微信领取", kind: "blocking", factId: null },
        { text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: OTHER_FACT_ID },
      ],
    })]);

    expect(result.findings.map((finding) => finding.code)).toEqual([
      "UNMAPPED_PRODUCT_CLAIM",
      "UNKNOWN_PRODUCT_FACT",
      "COMPLIANCE_WECHAT_CONTACT",
      "COMPLIANCE_PRIVATE_MESSAGE",
      "REPETITION_NEAR_DUPLICATE",
    ]);
    expect(result.findings.map((finding) => finding.severity)).toEqual([
      "blocking",
      "blocking",
      "blocking",
      "blocking",
      "blocking",
    ]);
    expect(result.passed).toBe(false);
  });

  it("advises on repeated titles even when bodies differ", async () => {
    const draft = baseDraft();
    const result = await runReview(baseInput({
      draft,
      recentApprovedContents: [{
        id: "approved-title",
        contentVersionId: "00000000-0000-4000-8000-000000000033",
        draft: {
          ...baseDraft(),
          titleCandidates: [draft.titleCandidates[0], "另一个标题", "第三个标题", "第四个标题", "第五个标题"],
          recommendedTitle: draft.titleCandidates[0],
          body: "这是完全不同的正文，避免与当前正文形成大段重复。",
          pages: baseDraft().pages.map((page) => ({ ...page, headline: "不同页面标题", body: "这是不同的页面文案。" })),
        },
      }],
    }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "REPETITION_NEAR_DUPLICATE",
      severity: "advisory",
      field: "titleCandidates",
    }));
  });

  it("blocks repeated page copy even when body and titles differ", async () => {
    const draft = baseDraft();
    const result = await runReview(baseInput({
      draft,
      recentApprovedContents: [{
        id: "approved-pages",
        contentVersionId: "00000000-0000-4000-8000-000000000034",
        draft: {
          ...baseDraft(),
          titleCandidates: ["完全不同的标题一", "完全不同的标题二", "完全不同的标题三", "完全不同的标题四", "完全不同的标题五"],
          recommendedTitle: "完全不同的推荐标题",
          body: "这是完全不同的正文。",
          pages: draft.pages,
        },
      }],
    }), [JSON.stringify({
      claims: [{ text: "产品支持按已有食材筛选菜谱", kind: "capability", factId: FACT_ID }],
    })]);

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "REPETITION_NEAR_DUPLICATE",
      severity: "blocking",
      field: "pages",
    }));
  });

  it("fails closed without throwing when the draft shape is invalid", async () => {
    const result = await runReview(baseInput({ draft: { body: "malformed" } }), [JSON.stringify({ claims: [] }), JSON.stringify({ claims: [] })]);

    expect(result.passed).toBe(false);
    expect(result.findings.some((finding) => finding.severity === "blocking")).toBe(true);
    expect(result.findings).not.toContainEqual(expect.objectContaining({ code: "INTERNAL_ERROR" }));
  });

  it("fails closed when review context arrays are missing", async () => {
    const result = await runReview(baseInput({ facts: undefined, sourceAssets: undefined, recentApprovedContents: undefined }));

    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "UNKNOWN_PRODUCT_FACT",
      severity: "blocking",
    }));
  });
});
