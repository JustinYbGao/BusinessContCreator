import type { ConversionObservation, MetricValues, MetricWindow } from "./metrics.js";

export type ComparableSnapshot = {
  id: string;
  window: MetricWindow;
  metrics: MetricValues;
  productConversion: ConversionObservation[];
  capturedAt: string;
};

export type ComparableMetricSample = {
  publicationId: string;
  productId: string;
  campaignId: string;
  status: "PUBLISHED" | "MEASURING" | "RETROSPECTED";
  publishedAt: string;
  snapshots: ComparableSnapshot[];
};

export type RollingMedian = {
  window: MetricWindow;
  sampleCount: number;
  medians: Partial<Record<keyof MetricValues, number>>;
  sourcePublicationIds: string[];
};

const METRIC_KEYS: Array<keyof MetricValues> = [
  "impressions",
  "views",
  "likes",
  "saves",
  "comments",
  "shares",
  "followersGained",
];

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function snapshotFor(sample: ComparableMetricSample, window: MetricWindow): ComparableSnapshot | null {
  return sample.snapshots.find((snapshot) => snapshot.window === window) ?? null;
}

export function buildRollingMedian(input: {
  currentPublicationId: string;
  window: MetricWindow;
  samples: ComparableMetricSample[];
}): RollingMedian {
  const current = input.samples.find((sample) => sample.publicationId === input.currentPublicationId);
  const comparable = input.samples.filter((sample) => {
    if (sample.publicationId === input.currentPublicationId) return false;
    if (!sample.publishedAt || !["PUBLISHED", "MEASURING", "RETROSPECTED"].includes(sample.status)) return false;
    if (current && (sample.productId !== current.productId || sample.campaignId !== current.campaignId)) return false;
    return snapshotFor(sample, input.window) !== null;
  });

  const snapshots = comparable.flatMap((sample) => {
    const snapshot = snapshotFor(sample, input.window);
    return snapshot ? [{ sample, snapshot }] : [];
  });
  const medians: Partial<Record<keyof MetricValues, number>> = {};
  for (const key of METRIC_KEYS) {
    const values = snapshots
      .map(({ snapshot }) => snapshot.metrics[key])
      .filter((value): value is number => value !== null && value !== undefined);
    if (values.length > 0) medians[key] = median(values);
  }

  return {
    window: input.window,
    sampleCount: snapshots.length,
    medians,
    sourcePublicationIds: snapshots.map(({ sample }) => sample.publicationId).sort(),
  };
}
