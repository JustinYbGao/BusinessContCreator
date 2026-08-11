import { z } from "zod";

export const ProductCategorySchema = z.enum([
  "positioning",
  "feature",
  "constraint",
  "data",
  "price",
  "status",
]);

export const ProductConnectionKindSchema = z.enum(["manual", "dormchef_local"]);

export const ProductSlugSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must use lowercase kebab-case");

export const BrandProfileSchema = z.record(z.string(), z.unknown());

export const ProductCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: ProductSlugSchema,
  positioning: z.string().trim().max(2_000),
  brandProfile: BrandProfileSchema,
}).strict();

export const ProductSourceInputSchema = z.object({
  kind: ProductConnectionKindSchema,
  locator: z.string().trim().min(1).max(500),
}).strict();

export const ProductFactDecisionSchema = z.object({
  decision: z.enum(["verify", "edit-and-verify", "block"]),
  editedStatement: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export const ProductAssetDecisionSchema = z.object({
  decision: z.enum(["verify", "public-use", "block"]),
}).strict();

export const ProductFactCandidateSchema = z.object({
  statement: z.string().trim().min(1).max(2_000),
  category: ProductCategorySchema,
  sourceLocator: z.string().trim().min(1).max(500),
  evidenceExcerpt: z.string().trim().min(1).max(500),
}).strict();

export const ProductAssetCandidateSchema = z.object({
  relativeLocator: z.string().trim().min(1).max(500),
  kind: z.enum(["screenshot", "brand_asset"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const CampaignPillarQuotasSchema = z.object({
  pain_solution: z.number().int().nonnegative(),
  product_proof: z.number().int().nonnegative(),
  region_timing: z.number().int().nonnegative(),
  founder_story: z.number().int().nonnegative(),
}).strict();

export const CampaignCreateInputSchema = z.object({
  productId: z.string().uuid(),
  channelId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  goal: z.string().trim().min(1).max(1_000),
  audience: z.string().trim().min(1).max(1_000),
  pillarQuotas: CampaignPillarQuotasSchema,
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const NullableTimestampSchema = TimestampSchema.nullable();

export const ProductRecordSchema = z.object({
  id: UuidSchema,
  workspace_id: UuidSchema,
  name: z.string(),
  slug: ProductSlugSchema,
  positioning: z.string(),
  brand_profile: BrandProfileSchema,
  deleted_at: NullableTimestampSchema,
  created_at: TimestampSchema,
}).strict();

export const ChannelRecordSchema = z.object({
  id: UuidSchema,
  workspace_id: UuidSchema,
  product_id: UuidSchema,
  kind: z.literal("xiaohongshu"),
  status: z.enum(["active", "paused"]),
  settings: BrandProfileSchema,
  created_at: TimestampSchema,
}).strict();

export const ProductSourceRecordSchema = z.object({
  id: UuidSchema,
  workspace_id: UuidSchema,
  product_id: UuidSchema,
  kind: ProductConnectionKindSchema,
  locator: z.string().min(1).max(500),
  last_synced_at: NullableTimestampSchema,
  created_at: TimestampSchema,
}).strict();

export const ProductFactRecordSchema = z.object({
  id: UuidSchema,
  workspace_id: UuidSchema,
  product_id: UuidSchema,
  source_id: UuidSchema.nullable(),
  statement: z.string(),
  category: ProductCategorySchema,
  source_locator: z.string().min(1).max(500),
  evidence_excerpt: z.string(),
  status: z.enum(["candidate", "verified", "blocked", "deprecated"]),
  public_use_allowed: z.boolean(),
  verified_by: z.string().nullable(),
  verified_at: NullableTimestampSchema,
  created_at: TimestampSchema,
}).strict();

export const AssetRecordSchema = z.object({
  id: UuidSchema,
  workspace_id: UuidSchema,
  product_id: UuidSchema,
  kind: z.enum(["screenshot", "brand_asset", "carousel_page", "prefill_screenshot"]),
  provenance: z.enum(["source", "generated"]),
  source_locator: z.string().min(1).max(500).nullable(),
  verification_status: z.enum(["candidate", "verified", "blocked"]),
  public_use_allowed: z.boolean(),
  verified_by: z.string().nullable(),
  verified_at: NullableTimestampSchema,
  object_key: z.string().min(1),
  mime_type: z.string().min(1),
  byte_size: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: TimestampSchema,
}).strict();

export const CampaignRecordSchema = z.object({
  id: UuidSchema,
  workspace_id: UuidSchema,
  product_id: UuidSchema,
  channel_id: UuidSchema,
  name: z.string(),
  goal: z.string(),
  audience: z.string(),
  pillar_quotas: CampaignPillarQuotasSchema,
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  created_at: TimestampSchema,
}).strict();

export const WorkflowJobSummarySchema = z.object({
  id: UuidSchema,
  status: z.enum(["queued", "running", "completed", "failed"]),
}).strict();

export type ProductCreateInput = z.infer<typeof ProductCreateInputSchema>;
export type ProductSourceInput = z.infer<typeof ProductSourceInputSchema>;
export type ProductFactDecision = z.infer<typeof ProductFactDecisionSchema>;
export type ProductAssetDecision = z.infer<typeof ProductAssetDecisionSchema>;
export type CampaignCreateInput = z.infer<typeof CampaignCreateInputSchema>;
export type ProductRecord = z.infer<typeof ProductRecordSchema>;
export type ChannelRecord = z.infer<typeof ChannelRecordSchema>;
export type ProductSourceRecord = z.infer<typeof ProductSourceRecordSchema>;
export type ProductFactRecord = z.infer<typeof ProductFactRecordSchema>;
export type AssetRecord = z.infer<typeof AssetRecordSchema>;
export type CampaignRecord = z.infer<typeof CampaignRecordSchema>;
export type WorkflowJobSummary = z.infer<typeof WorkflowJobSummarySchema>;
