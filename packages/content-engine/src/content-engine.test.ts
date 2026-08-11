import { describe, expect, it } from "vitest";
import type { StructuredLlm } from "@social-agent/llm";
import { generateContent, ContentVersionService, type ContentGenerationInput, type ContentVersion } from "./generate.js";
import { sha256, stableStringify } from "./hash.js";

const FACT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_FACT_ID = "00000000-0000-4000-8000-000000000002";
const ASSET_ID = "00000000-0000-4000-8000-000000000011";
const CONTENT_ID = "00000000-0000-4000-8000-000000000021";
const BRIEF_ID = "00000000-0000-4000-8000-000000000031";
const USER_ID = "00000000-0000-4000-8000-000000000041";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000051";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000061";
const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000071";
const TOPIC_ID = "00000000-0000-4000-8000-000000000081";

const input: ContentGenerationInput = {
  topic: { id: TOPIC_ID, title: "宿舍晚餐怎么少走弯路", angle: "从真实产品能力解释一条可执行路径", pillar: "pain_solution" },
  campaign: { id: CAMPAIGN_ID, goal: "帮助学生更快完成晚餐决策", audience: "住校学生" },
  facts: [{ id: FACT_ID, statement: "产品支持按已有食材筛选菜谱", category: "feature", status: "verified", publicUseAllowed: true }],
  assets: [{ id: ASSET_ID, kind: "screenshot", description: "真实产品截图", verificationStatus: "verified", publicUseAllowed: true }],
  learnings: [{ id: "00000000-0000-4000-8000-000000000091", summary: "先讲具体场景", samples: 12 }],
  brandProfile: { tone: "清楚、克制" },
  desiredCta: "欢迎分享你的晚餐难题",
};

function draftJson(factId = FACT_ID): string {
  return JSON.stringify({
    titleCandidates: ["标题一", "标题二", "标题三", "标题四", "标题五"],
    recommendedTitle: "标题一",
    body: "正文只描述已经确认的产品事实。",
    hashtags: ["#宿舍晚餐", "#学生生活", "#做饭"] ,
    interactionPrompt: "你最常遇到哪种晚餐难题？",
    pages: Array.from({ length: 7 }, (_, index) => ({
      page: index + 1,
      purpose: `第${index + 1}页目的`,
      headline: `第${index + 1}页标题`,
      body: `第${index + 1}页正文`,
      sourceAssetId: index === 2 ? ASSET_ID : null,
    })),
    claims: [{ factId, text: "产品支持按已有食材筛选菜谱" }],
  });
}

function fakeLlm(responses: string[], calls: Parameters<StructuredLlm["generateJson"]>[0][] = []): StructuredLlm {
  let index = 0;
  return {
    async generateJson(prompt) {
      calls.push(prompt);
      return { text: responses[index++] ?? "", model: "fake-content-model" };
    },
  };
}

describe("content generation", () => {
  it("retries invalid model JSON once", async () => {
    const calls: Parameters<StructuredLlm["generateJson"]>[0][] = [];
    const result = await generateContent(input, fakeLlm(["not-json", draftJson()], calls));

    expect(result.repairAttempts).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.system).toContain("Only supplied Fact IDs");
    expect(calls[0]?.system).toContain("seven image pages");
    expect(calls[0]?.user).toContain(`"id":"${FACT_ID}"`);
    expect(calls[1]?.user).toContain("invalid JSON");
  });

  it("rejects claims outside the supplied usable Fact set", async () => {
    await expect(generateContent(input, fakeLlm([draftJson(OTHER_FACT_ID)])))
      .rejects.toThrow("CONTENT_FACT_SCOPE_MISMATCH");
  });

  it("rejects assets that are not verified and public-use allowed", async () => {
    const unsafeInput = {
      ...input,
      assets: [{ id: ASSET_ID, kind: "screenshot", description: "未验证截图", verificationStatus: "candidate", publicUseAllowed: false }],
    } as unknown as ContentGenerationInput;
    await expect(generateContent(unsafeInput, fakeLlm([draftJson()])))
      .rejects.toThrow("USABLE_ASSET_INVALID");
  });

  it("rejects drafts that do not contain exactly seven ordered pages", async () => {
    const draft = JSON.parse(draftJson()) as Record<string, unknown>;
    draft.pages = (draft.pages as Array<Record<string, unknown>>).map((page, index) => index === 6 ? { ...page, page: 6 } : page);
    await expect(generateContent(input, fakeLlm([JSON.stringify(draft)])))
      .rejects.toThrow("CONTENT_PAGES_INVALID");
  });

  it("keeps stable hashes independent of object key order", () => {
    expect(stableStringify({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(sha256({ z: 1, a: { y: 2, x: 3 } })).toBe(sha256({ a: { x: 3, y: 2 }, z: 1 }));
  });
});

describe("immutable content versions", () => {
  it("never mutates an existing content version", async () => {
    const versions: ContentVersion[] = [];
    let nextId = 1;
    const repo = {
      async create(_ctx: unknown, value: Omit<ContentVersion, "id" | "version" | "contentSha256" | "status"> & { contentSha256: string }) {
        const version: ContentVersion = {
          ...value,
          id: `version-${nextId++}`,
          version: versions.length + 1,
          status: "draft",
        };
        versions.push(version);
        return version;
      },
      async get(_ctx: unknown, id: string) {
        return versions.find((version) => version.id === id) ?? null;
      },
    };
    const service = new ContentVersionService(repo, { facts: input.facts, assets: input.assets });
    const basePayload = JSON.parse(draftJson()) as ContentVersion["payload"];
    const v1 = await service.createVersion({ workspaceId: WORKSPACE_ID, actorId: USER_ID }, {
      productId: PRODUCT_ID,
      campaignId: CAMPAIGN_ID,
      contentId: CONTENT_ID,
      topicId: TOPIC_ID,
      briefId: BRIEF_ID,
      payload: basePayload,
      promptVersion: "content-v1",
      modelName: "fake-content-model",
      createdBy: USER_ID,
      editReason: null,
    });
    const v2 = await service.editAsNewVersion({ workspaceId: WORKSPACE_ID, actorId: USER_ID }, v1.id, {
      body: "人工修改后的正文",
      editReason: "补充人工确认的场景表达",
    });

    expect(v2.version).toBe(v1.version + 1);
    expect(v1.payload.body).not.toBe(v2.payload.body);
    expect((await repo.get({ workspaceId: WORKSPACE_ID }, v1.id))?.payload.body).toBe(basePayload.body);
    expect(v2.editReason).toBe("补充人工确认的场景表达");

    await expect(service.createVersion({ workspaceId: WORKSPACE_ID, actorId: USER_ID }, {
      productId: PRODUCT_ID,
      campaignId: CAMPAIGN_ID,
      contentId: CONTENT_ID,
      topicId: TOPIC_ID,
      briefId: BRIEF_ID,
      payload: { ...basePayload, claims: [{ factId: OTHER_FACT_ID, text: "未提供的 Fact" }] },
      promptVersion: "content-v1",
      modelName: "fake-content-model",
      createdBy: USER_ID,
      editReason: null,
    })).rejects.toThrow("CONTENT_FACT_SCOPE_MISMATCH");

    await expect(new ContentVersionService(repo).createVersion({ workspaceId: WORKSPACE_ID, actorId: USER_ID }, {
      productId: PRODUCT_ID,
      campaignId: CAMPAIGN_ID,
      contentId: CONTENT_ID,
      topicId: TOPIC_ID,
      briefId: BRIEF_ID,
      payload: basePayload,
      promptVersion: "content-v1",
      modelName: "fake-content-model",
      createdBy: USER_ID,
      editReason: null,
    })).rejects.toThrow("CONTENT_SCOPE_REQUIRED");
  });
});
