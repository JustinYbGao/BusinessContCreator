import {
  buildRetrospective,
  MetricWindowSchema,
} from "@social-agent/analytics";
import {
  SupabaseLearningRepository,
  SupabaseMetricRepository,
  SupabasePublicationRepository,
} from "@social-agent/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  errorResponse,
  parseComparableSample,
  parseUuid,
  requestId,
} from "../../../../../lib/analytics-route";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../../lib/supabase/server";

const QualitativeObservationSchema = z.object({
  code: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(1_000),
  evidence: z.object({
    kind: z.enum(["metric", "snapshot", "qualitative"]),
    key: z.string().trim().min(1).max(100),
    value: z.unknown(),
  }).strict(),
}).strict();

const RetrospectiveInputSchema = z.object({
  window: MetricWindowSchema,
  qualitativeObservations: z.array(QualitativeObservationSchema).max(100).default([]),
}).strict();

const KNOWN_CODES = [
  "INVALID_PUBLICATION_ID",
  "INVALID_RETROSPECTIVE_INPUT",
  "PUBLICATION_NOT_FOUND",
  "PUBLICATION_STATE_INVALID",
  "ANALYTICS_DATA_INVALID",
  "EVIDENCE_WINDOW_INCOMPLETE",
  "PUBLICATION_TRANSITION_CONFLICT",
  "LEARNING_CONFIDENCE_MISMATCH",
  "EVIDENCE_WINDOW_INVALID",
  "LEARNING_PAYLOAD_INVALID",
];

type RouteContext = { params: Promise<{ publicationId: string }> };

function statusOf(code: string): number {
  if (code === "INVALID_PUBLICATION_ID" || code === "INVALID_RETROSPECTIVE_INPUT") return 400;
  if (code === "PUBLICATION_NOT_FOUND") return 404;
  if (code === "PUBLICATION_STATE_INVALID" || code === "EVIDENCE_WINDOW_INCOMPLETE" || code === "PUBLICATION_TRANSITION_CONFLICT" || code === "LEARNING_CONFIDENCE_MISMATCH") return 409;
  return 500;
}

export async function POST(request: Request, routeContext: RouteContext) {
  try {
    const context = await requireServerInternalWorkspace();
    const { publicationId: rawPublicationId } = await routeContext.params;
    const publicationId = parseUuid(rawPublicationId, "INVALID_PUBLICATION_ID");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_RETROSPECTIVE_INPUT");
    }
    const parsed = RetrospectiveInputSchema.safeParse(body);
    if (!parsed.success) throw new Error("INVALID_RETROSPECTIVE_INPUT");

    const supabase = createSupabaseServiceRoleClient();
    const publicationRepository = new SupabasePublicationRepository(supabase);
    const metricRepository = new SupabaseMetricRepository(supabase);
    const learningRepository = new SupabaseLearningRepository(supabase);
    const publication = await publicationRepository.getAnalytics({ workspaceId: context.workspaceId }, publicationId);
    if (!publication) throw new Error("PUBLICATION_NOT_FOUND");
    if (!publication.publishedAt || !["PUBLISHED", "MEASURING", "RETROSPECTED"].includes(publication.status)) {
      throw new Error("PUBLICATION_STATE_INVALID");
    }

    const campaignRows = await metricRepository.listForCampaign(
      { workspaceId: context.workspaceId },
      publication.productId,
      publication.campaignId,
    );
    const samples = campaignRows
      .map(parseComparableSample)
      .filter((sample): sample is NonNullable<typeof sample> => sample !== null);
    const currentSample = samples.find((sample) => sample.publicationId === publicationId);
    if (!currentSample) throw new Error("PUBLICATION_NOT_FOUND");
    const currentSnapshot = currentSample.snapshots.find((snapshot) => snapshot.window === parsed.data.window) ?? null;
    const retrospective = buildRetrospective({
      currentPublication: currentSample,
      currentSnapshot,
      comparableSamples: samples,
      qualitativeObservations: parsed.data.qualitativeObservations,
    });

    if (!retrospective.eligibleForLearning) {
      return NextResponse.json({ retrospective, learningId: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const ctx = {
      workspaceId: context.workspaceId,
      actor: { type: "user" as const, id: context.actorId },
      requestId: requestId(request),
    };
    if (publication.status === "PUBLISHED") {
      await publicationRepository.transition(ctx, publicationId, "PUBLISHED", "MEASURING");
    }
    const learning = await learningRepository.create(ctx, {
      productId: publication.productId,
      publicationId,
      evidenceWindow: retrospective.evidenceWindow,
      payload: retrospective,
    });
    if (publication.status === "PUBLISHED" || publication.status === "MEASURING") {
      await publicationRepository.transition(ctx, publicationId, "MEASURING", "RETROSPECTED");
    }
    return NextResponse.json({ retrospective, learningId: learning.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, statusOf, KNOWN_CODES);
  }
}
