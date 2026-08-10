import { describe, expect, it } from "vitest";
import {
  ContentDraftSchema,
  PublicationTransitionMap,
  PublicationPackageSchema,
  PublicationStatusSchema,
  PublisherClaimResponseSchema,
  WorkflowStatusSchema,
  projectWorkflowStatus,
} from "./index.js";
import type {
  ApprovedContent,
  ChannelAdapter,
  ContentVersion,
  MetricSnapshotInput,
  ProductAdapter,
  ProductConnection,
  ProductSourceDescriptor,
  Publication,
} from "./index.js";

describe("shared contracts", () => {
  it("rejects a content draft without seven image pages", () => {
    const result = ContentDraftSchema.safeParse({
      titleCandidates: ["a", "b", "c", "d", "e"],
      recommendedTitle: "a",
      body: "正文",
      hashtags: ["#留学生做饭", "#一周备菜", "#宿舍做饭"],
      interactionPrompt: "你最难的是哪一步？",
      pages: [],
      claims: [{ factId: crypto.randomUUID(), text: "按预算生成菜单" }],
    });
    expect(result.success).toBe(false);
  });

  it("does not define an automatic published transition", () => {
    expect(WorkflowStatusSchema.options).toContain("AWAITING_HUMAN_PUBLISH");
    expect(WorkflowStatusSchema.options).not.toContain("AUTO_PUBLISHED");
  });

  it("requires immutable content hashes in publication packages", () => {
    const result = PublicationPackageSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("uses the same ready status and never exposes object keys to a device", () => {
    expect(PublicationStatusSchema.options).toContain("READY_TO_PREFILL");
    expect(PublisherClaimResponseSchema.keyof().options).not.toContain("imageObjectKeys");
  });

  it("allows only deterministic publication transitions", () => {
    expect(PublicationTransitionMap).toEqual({
      READY_TO_PREFILL: ["PREFILLING"],
      PREFILLING: ["NEEDS_LOGIN", "PREFILL_FAILED", "AWAITING_HUMAN_PUBLISH"],
      NEEDS_LOGIN: ["READY_TO_PREFILL"],
      PREFILL_FAILED: ["READY_TO_PREFILL"],
      AWAITING_HUMAN_PUBLISH: ["PUBLISHED"],
      PUBLISHED: ["MEASURING"],
      MEASURING: ["RETROSPECTED"],
      RETROSPECTED: [],
    });
  });

  it("projects bounded content and publication statuses for dashboards", () => {
    expect(projectWorkflowStatus("approved")).toBe("APPROVED");
    expect(projectWorkflowStatus("packaged", "READY_TO_PREFILL")).toBe("READY_TO_PREFILL");
  });
});

const productAdapterFixture: ProductAdapter = {
  kind: "fixture",
  async discoverSources(input: ProductConnection): Promise<ProductSourceDescriptor[]> {
    return [{ id: input.id, kind: input.kind, relativeLocator: "source" }];
  },
  async extractFacts() {
    return [];
  },
  async collectAssets() {
    return [];
  },
};

const channelAdapterFixture: ChannelAdapter = {
  channel: "xiaohongshu",
  async validate(_content: ContentVersion) {
    return [];
  },
  async preparePublication(_input: ApprovedContent) {
    throw new Error("fixture only");
  },
  async collectMetrics(publication: Publication, input: MetricSnapshotInput) {
    return { ...input, publicationId: publication.id, capturedAt: "2026-08-10T00:00:00.000Z" };
  },
};

void productAdapterFixture;
void channelAdapterFixture;
