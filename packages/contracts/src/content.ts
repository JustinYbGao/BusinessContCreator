import { z } from "zod";

export const ClaimSchema = z.object({
  factId: z.string().uuid(),
  text: z.string().min(1),
});

export const ImagePageSchema = z.object({
  page: z.number().int().min(1).max(7),
  purpose: z.string().min(1),
  headline: z.string().min(1),
  body: z.string().min(1),
  sourceAssetId: z.string().uuid().nullable(),
});

export const ContentDraftSchema = z.object({
  titleCandidates: z.array(z.string().min(1)).length(5),
  recommendedTitle: z.string().min(1),
  body: z.string().min(1),
  hashtags: z.array(z.string().regex(/^#/)).min(3).max(8),
  interactionPrompt: z.string().min(1),
  pages: z.array(ImagePageSchema).length(7),
  claims: z.array(ClaimSchema).min(1),
});

export const PublicationPackageSchema = z.object({
  publicationId: z.string().uuid(),
  contentVersionId: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().min(1),
  imageObjectKeys: z.array(z.string().min(1)).length(7),
  imageSha256: z.array(z.string().regex(/^[a-f0-9]{64}$/)).length(7),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const PublisherClaimResponseSchema = PublicationPackageSchema
  .omit({ imageObjectKeys: true })
  .extend({
    imageDownloadUrls: z.array(z.string().url()).length(7),
    expiresAt: z.string().datetime(),
  });

export const MetricSnapshotInputSchema = z.object({
  window: z.enum(["24h", "72h", "7d"]),
  impressions: z.number().int().nonnegative().nullable(),
  views: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  followersGained: z.number().int().nonnegative(),
});

export type ContentDraft = z.infer<typeof ContentDraftSchema>;
export type PublicationPackage = z.infer<typeof PublicationPackageSchema>;
export type PublisherClaimResponse = z.infer<typeof PublisherClaimResponseSchema>;
export type MetricSnapshotInput = z.infer<typeof MetricSnapshotInputSchema>;
