import {
  buildWeeklyReport,
} from "@social-agent/analytics";
import {
  SupabaseLearningRepository,
  SupabaseMetricRepository,
  SupabaseWeeklyReportRepository,
} from "@social-agent/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  errorResponse,
  parseComparableSample,
  parseUuid,
  parseWeekStart,
  requestId,
} from "../../../../lib/analytics-route";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../lib/supabase/server";

const ReportParamsSchema = z.object({
  productId: z.string().uuid(),
  campaignId: z.string().uuid(),
  weekStart: z.string(),
}).strict();

const ReportBodySchema = z.object({
  productId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  weekStart: z.string().optional(),
}).strict();

const KNOWN_CODES = [
  "AUTH_REQUIRED",
  "ADMIN_REQUIRED",
  "INVALID_REPORT_INPUT",
  "INVALID_WEEK_START",
  "WEEKLY_REPORT_NOT_FOUND",
  "ANALYTICS_DATA_INVALID",
  "REQUEST_ID_INVALID",
];

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "WEEKLY_REPORT_NOT_FOUND") return 404;
  if (code === "INVALID_REPORT_INPUT" || code === "INVALID_WEEK_START" || code === "REQUEST_ID_INVALID") return 400;
  return 500;
}

function queryParams(request: Request): Record<string, string | null> {
  const search = new URL(request.url).searchParams;
  return {
    productId: search.get("productId"),
    campaignId: search.get("campaignId"),
    weekStart: search.get("weekStart"),
  };
}

async function parseParams(request: Request, allowBody: boolean) {
  const fromQuery = queryParams(request);
  let body: unknown = {};
  if (allowBody && (request.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_REPORT_INPUT");
    }
  }
  const parsedBody = ReportBodySchema.safeParse(body);
  if (!parsedBody.success) throw new Error("INVALID_REPORT_INPUT");
  const bodyRecord = parsedBody.data;
  for (const field of ["productId", "campaignId", "weekStart"] as const) {
    const queryValue = fromQuery[field];
    const bodyValue = bodyRecord[field];
    if (queryValue && bodyValue !== undefined && bodyValue !== queryValue) throw new Error("INVALID_REPORT_INPUT");
  }
  const parsed = ReportParamsSchema.safeParse({
    productId: fromQuery.productId ?? bodyRecord.productId,
    campaignId: fromQuery.campaignId ?? bodyRecord.campaignId,
    weekStart: fromQuery.weekStart ?? bodyRecord.weekStart,
  });
  if (!parsed.success) throw new Error("INVALID_REPORT_INPUT");
  return {
    productId: parseUuid(parsed.data.productId, "INVALID_REPORT_INPUT"),
    campaignId: parseUuid(parsed.data.campaignId, "INVALID_REPORT_INPUT"),
    weekStart: parseWeekStart(parsed.data.weekStart),
  };
}

export async function GET(request: Request) {
  try {
    const identity = await requireServerInternalAdmin();
    const params = await parseParams(request, false);
    const supabase = createSupabaseServiceRoleClient();
    const report = await new SupabaseWeeklyReportRepository(supabase).getByCampaignWeek(
      { workspaceId: identity.workspaceId },
      params.productId,
      params.campaignId,
      params.weekStart,
    );
    if (!report) throw new Error("WEEKLY_REPORT_NOT_FOUND");
    return NextResponse.json({ report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, statusOf, KNOWN_CODES);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireServerInternalAdmin();
    const params = await parseParams(request, true);
    const supabase = createSupabaseServiceRoleClient();
    const metricRepository = new SupabaseMetricRepository(supabase);
    const learningRepository = new SupabaseLearningRepository(supabase);
    const reportRepository = new SupabaseWeeklyReportRepository(supabase);
    const [publicationRows, learningRows] = await Promise.all([
      metricRepository.listForCampaign({ workspaceId: identity.workspaceId }, params.productId, params.campaignId),
      learningRepository.listEligible({ workspaceId: identity.workspaceId }, params.productId, params.campaignId),
    ]);
    const publications = publicationRows
      .map(parseComparableSample)
      .filter((sample): sample is NonNullable<typeof sample> => sample !== null);
    const report = buildWeeklyReport({
      weekStart: params.weekStart,
      now: new Date(),
      publications,
      eligibleLearningIds: learningRows.map((learning) => learning.id),
    });
    const stored = await reportRepository.createOrReplace({
      workspaceId: identity.workspaceId,
      actor: { type: "user", id: identity.userId },
      requestId: requestId(request),
    }, {
      productId: params.productId,
      campaignId: params.campaignId,
      weekStart: params.weekStart,
      payload: report,
      sourceSnapshotIds: report.sourceSnapshotIds,
    });
    return NextResponse.json({ report: stored }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, statusOf, KNOWN_CODES);
  }
}
