import { type Attribution, type ConversionObservation, type MetricWindow } from "./metrics.js";
import type { ComparableMetricSample } from "./baseline.js";

export type WindowState = { publicationId: string; window: MetricWindow };

export type WeeklyReport = {
  weekStart: string;
  postsPublished: number;
  dueWindows: WindowState[];
  missingWindows: WindowState[];
  notYetDueWindows: WindowState[];
  sourceSnapshotIds: string[];
  conversions: { direct: number; selfReported: number; inferred: number };
  eligibleLearningIds: string[];
};

const WINDOWS: Array<{ window: MetricWindow; durationMs: number }> = [
  { window: "24h", durationMs: 24 * 60 * 60 * 1_000 },
  { window: "72h", durationMs: 72 * 60 * 60 * 1_000 },
  { window: "7d", durationMs: 7 * 24 * 60 * 60 * 1_000 },
];

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function withinWeek(publishedAt: string, weekStart: string): boolean {
  const value = new Date(publishedAt).getTime();
  const start = new Date(`${weekStart}T00:00:00.000Z`).getTime();
  const end = new Date(`${addDays(weekStart, 7)}T00:00:00.000Z`).getTime();
  return value >= start && value < end;
}

function sumObservations(observations: ConversionObservation[]): Record<Attribution, number> {
  const result: Record<Attribution, number> = { direct: 0, self_reported: 0, inferred: 0 };
  for (const observation of observations) result[observation.attribution] += observation.count;
  return result;
}

export function buildWeeklyReport(input: {
  weekStart: string;
  now: Date;
  publications: ComparableMetricSample[];
  eligibleLearningIds: string[];
}): WeeklyReport {
  if (!validDateOnly(input.weekStart)) throw new Error("INVALID_WEEK_START");
  const publications = [...input.publications].sort((left, right) => left.publicationId.localeCompare(right.publicationId));
  const dueWindows: WindowState[] = [];
  const missingWindows: WindowState[] = [];
  const notYetDueWindows: WindowState[] = [];
  const sourceSnapshotIds: string[] = [];
  const observations: ConversionObservation[] = [];
  const nowMs = input.now.getTime();

  for (const publication of publications) {
    const publishedMs = new Date(publication.publishedAt).getTime();
    if (!Number.isNaN(publishedMs)) {
      for (const window of WINDOWS) {
        const state = { publicationId: publication.publicationId, window: window.window };
        const snapshot = publication.snapshots.find((candidate) => candidate.window === window.window);
        if (snapshot) {
          dueWindows.push(state);
          sourceSnapshotIds.push(snapshot.id);
        } else if (nowMs - publishedMs >= window.durationMs) {
          dueWindows.push(state);
          missingWindows.push(state);
        } else {
          notYetDueWindows.push(state);
        }
      }
    }
    observations.push(...publication.snapshots.flatMap((snapshot) => snapshot.productConversion));
  }

  const totals = sumObservations(observations);
  return {
    weekStart: input.weekStart,
    postsPublished: publications.filter((publication) => withinWeek(publication.publishedAt, input.weekStart)).length,
    dueWindows,
    missingWindows,
    notYetDueWindows,
    sourceSnapshotIds: [...new Set(sourceSnapshotIds)].sort(),
    conversions: {
      direct: totals.direct,
      selfReported: totals.self_reported,
      inferred: totals.inferred,
    },
    eligibleLearningIds: [...input.eligibleLearningIds].sort(),
  };
}
