import { randomUUID } from "node:crypto";
import {
  ConversionObservationSchema,
  MetricValuesSchema,
  MetricWindowSchema,
  type ComparableMetricSample,
  type ComparableSnapshot,
  type MetricWindow,
} from "@social-agent/analytics";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "./auth";

const SnapshotShape = z.object({
  id: z.string().uuid(),
  window: MetricWindowSchema,
  metrics: MetricValuesSchema,
  productConversion: z.array(ConversionObservationSchema),
  capturedAt: z.string().datetime({ offset: true }),
});

const ComparableStatusSchema = z.enum(["PUBLISHED", "MEASURING", "RETROSPECTED"]);

const WEEK_START_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function requestId(request: Request): string {
  const value = request.headers.get("x-request-id")?.trim() ?? "";
  if (value.length > 200) throw new Error("REQUEST_ID_INVALID");
  return value || randomUUID();
}

export function codeOf(error: unknown, knownCodes: readonly string[] = []): string {
  if (error instanceof HttpError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    if (knownCodes.includes(error.code)) return error.code;
  }
  if (error instanceof Error) {
    const matched = knownCodes.find((code) => error.message.includes(code));
    if (matched) return matched;
    if (/^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  }
  return "INTERNAL_ERROR";
}

export function errorResponse(error: unknown, statusOf: (code: string) => number, knownCodes: readonly string[] = []) {
  const code = codeOf(error, knownCodes);
  return NextResponse.json(
    { ok: false, error: code },
    { status: statusOf(code), headers: { "Cache-Control": "no-store" } },
  );
}

export function parseUuid(value: string, code: string): string {
  if (!z.string().uuid().safeParse(value).success) throw new Error(code);
  return value;
}

export function parseWeekStart(value: string | null): string {
  if (!value || !WEEK_START_PATTERN.test(value)) throw new Error("INVALID_WEEK_START");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("INVALID_WEEK_START");
  }
  return value;
}

export function parseMetricSnapshot(value: unknown): ComparableSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ANALYTICS_DATA_INVALID");
  const record = value as Record<string, unknown>;
  const parsed = SnapshotShape.safeParse({
    id: record.id,
    window: record.window,
    metrics: record.metrics,
    productConversion: record.productConversion ?? record.product_conversion ?? [],
    capturedAt: record.capturedAt ?? record.captured_at,
  });
  if (!parsed.success) throw new Error("ANALYTICS_DATA_INVALID");
  return parsed.data;
}

export function parseComparableSample(value: unknown): ComparableMetricSample | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ANALYTICS_DATA_INVALID");
  const record = value as Record<string, unknown>;
  const status = ComparableStatusSchema.safeParse(record.status);
  const publishedAt = typeof record.publishedAt === "string" ? record.publishedAt : null;
  if (!status.success || !publishedAt) return null;
  const publishedDate = new Date(publishedAt);
  if (Number.isNaN(publishedDate.getTime())) throw new Error("ANALYTICS_DATA_INVALID");
  if (typeof record.id !== "string" || typeof record.productId !== "string" || typeof record.campaignId !== "string") {
    throw new Error("ANALYTICS_DATA_INVALID");
  }
  if (!Array.isArray(record.snapshots)) throw new Error("ANALYTICS_DATA_INVALID");
  return {
    publicationId: record.id,
    productId: record.productId,
    campaignId: record.campaignId,
    status: status.data,
    publishedAt,
    snapshots: record.snapshots.map(parseMetricSnapshot),
  };
}

export function metricWindowDue(window: MetricWindow, publishedAt: string | null, now = new Date()): boolean {
  if (!publishedAt) return false;
  const publishedMs = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedMs)) return false;
  const durationMs = window === "24h"
    ? 24 * 60 * 60 * 1_000
    : window === "72h"
      ? 72 * 60 * 60 * 1_000
      : 7 * 24 * 60 * 60 * 1_000;
  return now.getTime() - publishedMs >= durationMs;
}

export function parseMetricWindow(value: unknown): MetricWindow {
  const parsed = MetricWindowSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_METRIC_WINDOW");
  return parsed.data;
}
