import { z } from "zod";

export const MetricWindowSchema = z.enum(["24h", "72h", "7d"]);
export type MetricWindow = z.infer<typeof MetricWindowSchema>;

export const MetricValuesSchema = z.object({
  impressions: z.number().int().nonnegative().nullable(),
  views: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  followersGained: z.number().int().nonnegative(),
}).strict();
export type MetricValues = z.infer<typeof MetricValuesSchema>;

export const ConversionEventSchema = z.enum([
  "firstOpen",
  "activation",
  "coreAction",
  "retainedUser",
]);
export type ConversionEvent = z.infer<typeof ConversionEventSchema>;

export const AttributionSchema = z.enum(["direct", "self_reported", "inferred"]);
export type Attribution = z.infer<typeof AttributionSchema>;

export const ConversionObservationSchema = z.object({
  event: ConversionEventSchema,
  count: z.number().int().nonnegative(),
  attribution: AttributionSchema,
  confidence: z.enum(["high", "medium", "low"]),
  note: z.string().trim().max(500).optional(),
}).strict();
export type ConversionObservation = z.infer<typeof ConversionObservationSchema>;

export const MetricImportRowSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  publicationId: z.string().uuid(),
  window: MetricWindowSchema,
  metrics: MetricValuesSchema,
  productConversion: z.array(ConversionObservationSchema),
  capturedAt: z.string().datetime({ offset: true }),
}).strict();
export type MetricImportRow = z.infer<typeof MetricImportRowSchema>;

export type RateName =
  | "viewThroughRate"
  | "likeRate"
  | "saveRate"
  | "commentRate"
  | "shareRate"
  | "followerRate"
  | "engagementRate";

export type DerivedRate = {
  value: number | null;
  denominator: "impressions" | "views";
};

export type DerivedRates = Record<RateName, DerivedRate>;

function rate(numerator: number, denominator: number | null, denominatorName: DerivedRate["denominator"]): DerivedRate {
  if (denominator === null || denominator <= 0) {
    return { value: null, denominator: denominatorName };
  }
  return {
    value: Math.round((numerator / denominator) * 1_000_000) / 1_000_000,
    denominator: denominatorName,
  };
}

export function calculateRates(metrics: MetricValues): DerivedRates {
  const engagement = metrics.likes + metrics.saves + metrics.comments + metrics.shares;
  return {
    viewThroughRate: rate(metrics.views ?? 0, metrics.impressions, "impressions"),
    likeRate: rate(metrics.likes, metrics.views, "views"),
    saveRate: rate(metrics.saves, metrics.views, "views"),
    commentRate: rate(metrics.comments, metrics.views, "views"),
    shareRate: rate(metrics.shares, metrics.views, "views"),
    followerRate: rate(metrics.followersGained, metrics.views, "views"),
    engagementRate: rate(engagement, metrics.views, "views"),
  };
}

export function summarizeConversions(observations: ConversionObservation[]): {
  direct: number;
  selfReported: number;
  inferred: number;
} {
  const totals = { direct: 0, selfReported: 0, inferred: 0 };
  for (const observation of observations) {
    if (observation.attribution === "direct") totals.direct += observation.count;
    if (observation.attribution === "self_reported") totals.selfReported += observation.count;
    if (observation.attribution === "inferred") totals.inferred += observation.count;
  }
  return totals;
}
