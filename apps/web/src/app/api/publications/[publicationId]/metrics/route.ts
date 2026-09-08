import {
  calculateRates,
  MetricWindowSchema,
  summarizeConversions,
  type MetricWindow,
} from "@social-agent/analytics";
import { SupabaseMetricRepository, SupabasePublicationRepository } from "@social-agent/db";
import { NextResponse } from "next/server";
import {
  errorResponse,
  metricWindowDue,
  parseMetricSnapshot,
  parseUuid,
} from "../../../../../lib/analytics-route";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../../lib/supabase/server";

type RouteContext = { params: Promise<{ publicationId: string }> };

const WINDOWS: MetricWindow[] = ["24h", "72h", "7d"];
const KNOWN_CODES = [
  "INVALID_PUBLICATION_ID",
  "PUBLICATION_NOT_FOUND",
  "ANALYTICS_DATA_INVALID",
];

function statusOf(code: string): number {
  if (code === "INVALID_PUBLICATION_ID") return 400;
  if (code === "PUBLICATION_NOT_FOUND") return 404;
  return 500;
}

export async function GET(_request: Request, routeContext: RouteContext) {
  try {
    const context = await requireServerInternalWorkspace();
    const { publicationId: rawPublicationId } = await routeContext.params;
    const publicationId = parseUuid(rawPublicationId, "INVALID_PUBLICATION_ID");
    const supabase = createSupabaseServiceRoleClient();
    const publicationRepository = new SupabasePublicationRepository(supabase);
    const metricRepository = new SupabaseMetricRepository(supabase);
    const publication = await publicationRepository.getAnalytics({ workspaceId: context.workspaceId }, publicationId);
    if (!publication) throw new Error("PUBLICATION_NOT_FOUND");

    const snapshots = (await metricRepository.listByPublication({ workspaceId: context.workspaceId }, publicationId))
      .map(parseMetricSnapshot);
    const snapshotsByWindow = new Map<MetricWindow, ReturnType<typeof parseMetricSnapshot>>();
    for (const snapshot of snapshots) {
      if (!MetricWindowSchema.safeParse(snapshot.window).success || snapshotsByWindow.has(snapshot.window)) {
        throw new Error("ANALYTICS_DATA_INVALID");
      }
      snapshotsByWindow.set(snapshot.window, snapshot);
    }

    const windows = WINDOWS.map((window) => {
      const snapshot = snapshotsByWindow.get(window);
      if (snapshot) {
        return {
          window,
          state: "captured" as const,
          snapshot: {
            id: snapshot.id,
            capturedAt: snapshot.capturedAt,
            metrics: snapshot.metrics,
            rates: calculateRates(snapshot.metrics),
            productConversion: snapshot.productConversion,
            conversions: summarizeConversions(snapshot.productConversion),
          },
        };
      }
      return {
        window,
        state: metricWindowDue(window, publication.publishedAt) ? "missing" as const : "not_yet_due" as const,
        snapshot: null,
      };
    });

    return NextResponse.json({
      publication: {
        id: publication.id,
        productId: publication.productId,
        campaignId: publication.campaignId,
        status: publication.status,
        publicUrl: publication.publicUrl,
        publishedAt: publication.publishedAt,
      },
      windows,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, statusOf, KNOWN_CODES);
  }
}
