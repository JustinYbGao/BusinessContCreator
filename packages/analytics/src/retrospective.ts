import {
  calculateRates,
  summarizeConversions,
  type DerivedRates,
  type MetricValues,
  type MetricWindow,
} from "./metrics.js";
import {
  buildRollingMedian,
  snapshotFor,
  type ComparableMetricSample,
  type ComparableSnapshot,
  type RollingMedian,
} from "./baseline.js";

export type RetrospectiveObservation = {
  code: string;
  text: string;
  evidence: {
    kind: "metric" | "snapshot" | "qualitative";
    key: string;
    value: unknown;
  };
};

export type Retrospective = {
  evidenceWindow: MetricWindow;
  confidence: "hypothesis" | "directional";
  sampleCount: number;
  currentMetrics: MetricValues;
  currentRates: DerivedRates;
  baseline: RollingMedian;
  conversions: { direct: number; selfReported: number; inferred: number };
  sourceSnapshotIds: string[];
  observations: {
    keep: RetrospectiveObservation[];
    change: RetrospectiveObservation[];
    stop: RetrospectiveObservation[];
  };
  eligibleForLearning: boolean;
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

function categorizeQualitative(observation: RetrospectiveObservation): "keep" | "change" | "stop" {
  if (observation.code.startsWith("stop.")) return "stop";
  if (observation.code.startsWith("change.")) return "change";
  return "keep";
}

function observationHasEvidence(observation: RetrospectiveObservation): boolean {
  return observation.evidence.key.length > 0 && observation.evidence.value !== undefined;
}

export function buildRetrospective(input: {
  currentPublication: ComparableMetricSample;
  currentSnapshot: ComparableSnapshot | null;
  comparableSamples: ComparableMetricSample[];
  qualitativeObservations?: RetrospectiveObservation[];
}): Retrospective {
  if (!input.currentSnapshot) throw new Error("EVIDENCE_WINDOW_INCOMPLETE");
  const window = input.currentSnapshot.window;
  const baseline = buildRollingMedian({
    currentPublicationId: input.currentPublication.publicationId,
    window,
    samples: [input.currentPublication, ...input.comparableSamples],
  });
  const currentMetrics = input.currentSnapshot.metrics;
  const observations: Retrospective["observations"] = { keep: [], change: [], stop: [] };

  for (const key of METRIC_KEYS) {
    const current = currentMetrics[key];
    const median = baseline.medians[key];
    if (current === null || current === undefined || median === undefined || median <= 0) continue;
    if (current >= median * 1.2) {
      observations.keep.push({
        code: `metric.${String(key)}.above_median`,
        text: `${String(key)} is at least 20% above the rolling median`,
        evidence: { kind: "metric", key: String(key), value: { current, median } },
      });
    } else if (current <= median * 0.8) {
      observations.change.push({
        code: `metric.${String(key)}.below_median`,
        text: `${String(key)} is at least 20% below the rolling median`,
        evidence: { kind: "metric", key: String(key), value: { current, median } },
      });
    }
  }

  for (const qualitative of input.qualitativeObservations ?? []) {
    observations[categorizeQualitative(qualitative)].push(qualitative);
  }

  const allObservations = [
    ...observations.keep,
    ...observations.change,
    ...observations.stop,
  ];
  const sourceSnapshotIds = [
    input.currentSnapshot.id,
    ...input.comparableSamples.flatMap((sample) => {
      const snapshot = snapshotFor(sample, window);
      return snapshot ? [snapshot.id] : [];
    }),
  ].sort();

  return {
    evidenceWindow: window,
    confidence: baseline.sampleCount >= 10 ? "directional" : "hypothesis",
    sampleCount: baseline.sampleCount,
    currentMetrics,
    currentRates: calculateRates(currentMetrics),
    baseline,
    conversions: summarizeConversions(input.currentSnapshot.productConversion),
    sourceSnapshotIds,
    observations,
    eligibleForLearning: allObservations.every(observationHasEvidence),
  };
}
