import { ContentDraftSchema, type ContentDraft } from "@social-agent/contracts/content";
import { parseStructured, type StructuredLlm } from "@social-agent/llm";
import { buildContentPrompt, CONTENT_PROMPT_VERSION, type ContentAsset, type ContentFact, type ContentGenerationInput } from "./prompt.js";
import { sha256 } from "./hash.js";

export type { ContentGenerationInput } from "./prompt.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUsableFact(value: unknown): value is ContentFact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fact = value as Record<string, unknown>;
  return typeof fact.id === "string" && UUID_PATTERN.test(fact.id)
    && typeof fact.statement === "string" && fact.statement.trim().length > 0
    && typeof fact.category === "string" && fact.category.trim().length > 0
    && fact.status === "verified" && fact.publicUseAllowed === true;
}

function isUsableAsset(value: unknown): value is ContentAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const asset = value as Record<string, unknown>;
  return typeof asset.id === "string" && UUID_PATTERN.test(asset.id)
    && typeof asset.kind === "string" && asset.kind.trim().length > 0
    && typeof asset.description === "string" && asset.description.trim().length > 0
    && asset.verificationStatus === "verified" && asset.publicUseAllowed === true;
}

function validateInput(input: ContentGenerationInput): void {
  if (input.facts.length === 0 || input.facts.some((fact) => !isUsableFact(fact))) {
    throw new Error("VERIFIED_FACT_REQUIRED");
  }
  if (input.assets.some((asset) => !isUsableAsset(asset))) {
    throw new Error("USABLE_ASSET_INVALID");
  }
}

function validateScope(draft: ContentDraft, input: ContentGenerationInput): void {
  if (draft.pages.length !== 7) throw new Error("CONTENT_PAGES_INVALID");
  const factIds = new Set(input.facts.map((fact) => fact.id));
  const assetIds = new Set(input.assets.map((asset) => asset.id));
  if (draft.claims.some((claim) => !factIds.has(claim.factId))) {
    throw new Error("CONTENT_FACT_SCOPE_MISMATCH");
  }
  if (draft.pages.some((page) => page.sourceAssetId !== null && !assetIds.has(page.sourceAssetId))) {
    throw new Error("CONTENT_ASSET_SCOPE_MISMATCH");
  }
  if (draft.pages.some((page, index) => page.page !== index + 1)) {
    throw new Error("CONTENT_PAGES_INVALID");
  }
}

export type ContentGenerationResult = {
  draft: ContentDraft;
  model: string;
  repairAttempts: number;
  promptVersion: string;
  contentSha256: string;
};

export async function generateContent(
  input: ContentGenerationInput,
  llm: StructuredLlm,
): Promise<ContentGenerationResult> {
  validateInput(input);
  const parsed = await parseStructured(llm, ContentDraftSchema, buildContentPrompt(input));
  validateScope(parsed.value, input);
  return {
    draft: parsed.value,
    model: parsed.model,
    repairAttempts: parsed.repairAttempts,
    promptVersion: CONTENT_PROMPT_VERSION,
    contentSha256: sha256(parsed.value),
  };
}

export type ContentVersion = {
  id: string;
  workspaceId: string;
  productId: string;
  campaignId: string;
  contentId: string;
  topicId: string;
  briefId: string;
  version: number;
  payload: ContentDraft;
  promptVersion: string;
  modelName: string;
  contentSha256: string;
  status: "draft" | "review_required" | "approved";
  editReason: string | null;
  createdBy: string;
};

export type NewContentVersion = Omit<ContentVersion, "id" | "version" | "status">;

export type ContentVersionContext = {
  workspaceId: string;
  actorId: string;
};

export type ContentVersionScope = {
  facts: readonly ContentFact[];
  assets: readonly ContentAsset[];
};

function validateVersionScope(payload: ContentDraft, scope: ContentVersionScope): void {
  if (payload.pages.length !== 7 || payload.pages.some((page, index) => page.page !== index + 1)) {
    throw new Error("CONTENT_PAGES_INVALID");
  }
  if (scope.facts.length === 0 || scope.facts.some((fact) => !isUsableFact(fact))) throw new Error("VERIFIED_FACT_REQUIRED");
  if (scope.assets.some((asset) => !isUsableAsset(asset))) throw new Error("USABLE_ASSET_INVALID");
  const factIds = new Set(scope.facts.map((fact) => fact.id));
  const assetIds = new Set(scope.assets.map((asset) => asset.id));
  if (payload.claims.some((claim) => !factIds.has(claim.factId))) throw new Error("CONTENT_FACT_SCOPE_MISMATCH");
  if (payload.pages.some((page) => page.sourceAssetId !== null && !assetIds.has(page.sourceAssetId))) {
    throw new Error("CONTENT_ASSET_SCOPE_MISMATCH");
  }
}

export interface ContentVersionStore {
  create(ctx: ContentVersionContext, input: NewContentVersion): Promise<ContentVersion>;
  get(ctx: Pick<ContentVersionContext, "workspaceId">, id: string): Promise<ContentVersion | null>;
}

export class ContentVersionService {
  constructor(private readonly repo: ContentVersionStore, private readonly scope?: ContentVersionScope) {}

  private requiredScope(): ContentVersionScope {
    if (!this.scope) throw new Error("CONTENT_SCOPE_REQUIRED");
    return this.scope;
  }

  async createVersion(
    ctx: ContentVersionContext,
    input: Omit<NewContentVersion, "workspaceId" | "contentSha256">,
  ): Promise<ContentVersion> {
    const payload = ContentDraftSchema.parse(input.payload);
    validateVersionScope(payload, this.requiredScope());
    return this.repo.create(ctx, {
      ...input,
      workspaceId: ctx.workspaceId,
      payload,
      contentSha256: sha256(payload),
    });
  }

  async editAsNewVersion(
    ctx: ContentVersionContext,
    id: string,
    changes: Partial<ContentDraft> & { editReason: string },
  ): Promise<ContentVersion> {
    const existing = await this.repo.get({ workspaceId: ctx.workspaceId }, id);
    if (!existing) throw new Error("CONTENT_VERSION_NOT_FOUND");
    const { editReason, ...payloadChanges } = changes;
    if (!editReason.trim()) throw new Error("EDIT_REASON_REQUIRED");
    const payload = ContentDraftSchema.parse({ ...existing.payload, ...payloadChanges });
    validateVersionScope(payload, this.requiredScope());
    return this.repo.create(ctx, {
      workspaceId: ctx.workspaceId,
      productId: existing.productId,
      campaignId: existing.campaignId,
      contentId: existing.contentId,
      topicId: existing.topicId,
      briefId: existing.briefId,
      payload,
      promptVersion: existing.promptVersion,
      modelName: existing.modelName,
      contentSha256: sha256(payload),
      editReason,
      createdBy: ctx.actorId,
    });
  }
}
