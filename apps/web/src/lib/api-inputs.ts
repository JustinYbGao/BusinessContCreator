import { z } from "zod";
import {
  CampaignCreateInputSchema,
  ProductAssetDecisionSchema,
  ProductCreateInputSchema,
  ProductFactDecisionSchema,
  ProductSourceInputSchema,
} from "@social-agent/contracts/product";
import { ContentDraftSchema, type ContentDraft } from "@social-agent/contracts/content";

function normalizeProductRequest(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return { ...record, slug: typeof record.slug === "string" ? record.slug.trim().toLowerCase() : record.slug };
}

export function parseProductRequest(input: unknown) {
  const parsed = ProductCreateInputSchema.safeParse(normalizeProductRequest(input));
  if (!parsed.success) throw new Error("INVALID_PRODUCT_INPUT");
  return parsed.data;
}

function normalizeProductSourceLocator(input: unknown): string {
  if (typeof input !== "string" || !input || input.includes("\0")) throw new Error("SOURCE_LOCATOR_INVALID");
  const normalized = input.replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) throw new Error("SOURCE_LOCATOR_INVALID");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment === ".git" || segment.startsWith(".env"))) {
    throw new Error("SOURCE_LOCATOR_INVALID");
  }
  return segments.join("/");
}

function isAllowedDormChefLocator(locator: string): boolean {
  if (locator === "README.md" || locator === "docs/DormChef-Demo到Agent-Beta-业务说明.md" || locator === "apps/miniprogram/app.json") return true;
  if (locator.startsWith("apps/miniprogram/pages/") && locator.endsWith(".wxml")) return true;
  return locator.startsWith("apps/miniprogram/assets/mascot/") && /\.(?:png|jpe?g|webp)$/i.test(locator);
}

export function parseProductSourceRequest(input: unknown) {
  const parsed = ProductSourceInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_SOURCE_INPUT");
  const locator = normalizeProductSourceLocator(parsed.data.locator);
  if (parsed.data.kind === "dormchef_local" && !isAllowedDormChefLocator(locator)) throw new Error("SOURCE_LOCATOR_INVALID");
  return { ...parsed.data, locator };
}

const SyncRequestSchema = z.object({ sourceIds: z.array(z.string().uuid()).max(100).default([]) }).strict();

export function parseSyncRequest(input: unknown) {
  const parsed = SyncRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_SYNC_INPUT");
  return parsed.data;
}

const FactActionSchema = z.object({ factId: z.string().uuid(), ...ProductFactDecisionSchema.shape }).strict();

export function parseFactAction(input: unknown) {
  const parsed = FactActionSchema.safeParse(input);
  if (!parsed.success || (parsed.data.decision === "edit-and-verify" && !parsed.data.editedStatement)) throw new Error("INVALID_FACT_ACTION");
  return parsed.data;
}

const AssetActionSchema = z.object({ assetId: z.string().uuid(), ...ProductAssetDecisionSchema.shape }).strict();

export function parseAssetAction(input: unknown) {
  const parsed = AssetActionSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_ASSET_ACTION");
  return parsed.data;
}

function validateCampaignInput(input: unknown) {
  const parsed = CampaignCreateInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_CAMPAIGN_INPUT");
  const parseDate = (value: string) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date.getTime();
  };
  const startsAt = parseDate(parsed.data.startsOn);
  const endsAt = parseDate(parsed.data.endsOn);
  const { pain_solution, product_proof, region_timing, founder_story } = parsed.data.pillarQuotas;
  if (startsAt === null || endsAt === null || (endsAt - startsAt) / (24 * 60 * 60 * 1_000) !== 27
    || pain_solution !== 5 || product_proof !== 4 || region_timing !== 2 || founder_story !== 1) {
    throw new Error("INVALID_CAMPAIGN_INPUT");
  }
  return parsed.data;
}

export function parseCampaignRequest(input: unknown) {
  return validateCampaignInput(input);
}

const GenerateTopicsRequestSchema = z.object({
  campaignId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

export function parseGenerateTopicsRequest(input: unknown) {
  const parsed = GenerateTopicsRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_TOPIC_GENERATION_INPUT");
  return parsed.data;
}

export function scopeTopicGenerationIdempotencyKey(campaignId: string, idempotencyKey: string): string {
  return `generate_topics:${campaignId}:${idempotencyKey}`;
}

const CreateContentRequestSchema = z.object({
  campaignId: z.string().uuid(),
  topicId: z.string().uuid(),
  desiredCta: z.string().trim().min(1).max(500).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

export function parseCreateContentRequest(input: unknown) {
  const parsed = CreateContentRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_CONTENT_INPUT");
  return parsed.data;
}

export function scopeContentIdempotencyKey(contentId: string, idempotencyKey: string): string {
  return `generate_content:${contentId}:${idempotencyKey}`;
}

const GenerateContentRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

const ContentEditRequestSchema = z.object({
  action: z.literal("edit"),
  editReason: z.string().trim().min(1).max(1_000),
  payload: ContentDraftSchema,
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

export function parseGenerateContentRequest(input: unknown) {
  const parsed = GenerateContentRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_CONTENT_GENERATION_INPUT");
  return parsed.data;
}

export function parseContentEditRequest(input: unknown) {
  const parsed = ContentEditRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_CONTENT_EDIT_INPUT");
  return parsed.data;
}

export function scopeContentGenerationIdempotencyKey(contentId: string, idempotencyKey: string): string {
  return `generate_content:${contentId}:${idempotencyKey}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(input: Record<string, unknown>, name: string, fallback: string): string {
  const value = input[name];
  return typeof value === "string" ? value : fallback;
}

function parseFormHashtags(input: Record<string, unknown>, fallback: string[]): string[] {
  const value = input.hashtags;
  if (typeof value !== "string") return fallback;
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

export function parseContentEditForm(input: unknown, current: ContentDraft) {
  const record = asRecord(input);
  const payload = {
    ...current,
    titleCandidates: Array.from({ length: 5 }, (_, index) => stringField(record, `titleCandidate${index + 1}`, current.titleCandidates[index] ?? "")),
    recommendedTitle: stringField(record, "recommendedTitle", current.recommendedTitle),
    body: stringField(record, "body", current.body),
    hashtags: parseFormHashtags(record, current.hashtags),
    interactionPrompt: stringField(record, "interactionPrompt", current.interactionPrompt),
    pages: current.pages.map((page) => ({
      ...page,
      headline: stringField(record, `page${page.page}Headline`, page.headline),
      body: stringField(record, `page${page.page}Body`, page.body),
    })),
  };
  const parsed = ContentDraftSchema.safeParse(payload);
  const editReason = record.editReason;
  const idempotencyKey = record.idempotencyKey;
  if (!parsed.success || typeof editReason !== "string" || !editReason.trim() || editReason.length > 1_000
    || (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 200))) {
    throw new Error("INVALID_CONTENT_EDIT_INPUT");
  }
  return {
    action: "edit" as const,
    editReason: editReason.trim(),
    payload: parsed.data,
    ...(typeof idempotencyKey === "string" ? { idempotencyKey: idempotencyKey.trim() } : {}),
  };
}

const ReviewContentRequestSchema = z.object({
  contentVersionId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

export function parseReviewContentRequest(input: unknown) {
  const parsed = ReviewContentRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_REVIEW_INPUT");
  return parsed.data;
}

const ApproveContentRequestSchema = z.object({
  contentVersionId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

export function parseApproveContentRequest(input: unknown) {
  const parsed = ApproveContentRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_APPROVE_INPUT");
  return parsed.data;
}
