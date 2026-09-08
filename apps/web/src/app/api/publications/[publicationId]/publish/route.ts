import { SupabasePublicationRepository } from "@social-agent/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  errorResponse,
  parseUuid,
  requestId,
} from "../../../../../lib/analytics-route";
import {
  createSupabaseServiceRoleClient,
  requireServerInternalWorkspace,
} from "../../../../../lib/supabase/server";

const PublishInputSchema = z.object({
  publicUrl: z.string().trim().url().max(2_000),
  publishedAt: z.string().trim().min(1).max(100),
}).strict();

const KNOWN_CODES = [
  "REQUEST_ID_INVALID",
  "INVALID_PUBLICATION_ID",
  "INVALID_PUBLICATION_INPUT",
  "PUBLICATION_NOT_FOUND",
  "PUBLICATION_URL_INVALID",
  "PUBLISHED_AT_REQUIRED",
  "ACTOR_REQUIRED",
  "REQUEST_ID_REQUIRED",
  "PUBLISHER_DEVICE_ACTOR_NOT_ALLOWED",
  "PUBLICATION_REGISTRATION_CONFLICT",
  "PUBLICATION_STATE_INVALID",
  "PUBLICATION_DEVICE_CLAIMED",
];

type RouteContext = { params: Promise<{ publicationId: string }> };

function statusOf(code: string): number {
  if (code === "INVALID_PUBLICATION_ID" || code === "INVALID_PUBLICATION_INPUT" || code === "REQUEST_ID_INVALID") return 400;
  if (code === "PUBLICATION_NOT_FOUND") return 404;
  if (code === "PUBLICATION_URL_INVALID" || code === "PUBLISHED_AT_REQUIRED" || code === "ACTOR_REQUIRED" || code === "REQUEST_ID_REQUIRED") return 400;
  if (code === "PUBLICATION_REGISTRATION_CONFLICT" || code === "PUBLICATION_STATE_INVALID" || code === "PUBLICATION_DEVICE_CLAIMED" || code === "PUBLISHER_DEVICE_ACTOR_NOT_ALLOWED") return 409;
  return 500;
}

function allowedPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "www.xiaohongshu.com" || url.hostname === "xhslink.com")
      && !url.username
      && !url.password
      && !url.port;
  } catch {
    return false;
  }
}

function normalizePublishedAt(value: string): string {
  if (z.string().datetime({ offset: true }).safeParse(value).success) return value;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return `${value}+08:00`;
  throw new Error("INVALID_PUBLICATION_INPUT");
}

async function parsePublishBody(request: Request): Promise<unknown> {
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      return await request.json();
    } catch {
      throw new Error("INVALID_PUBLICATION_INPUT");
    }
  }
  const form = await request.formData();
  return {
    publicUrl: form.get("publicUrl"),
    publishedAt: form.get("publishedAt"),
  };
}

export async function POST(request: Request, routeContext: RouteContext) {
  try {
    const context = await requireServerInternalWorkspace();
    const { publicationId: rawPublicationId } = await routeContext.params;
    const publicationId = parseUuid(rawPublicationId, "INVALID_PUBLICATION_ID");
    const body = await parsePublishBody(request);
    const parsed = PublishInputSchema.safeParse(body);
    if (!parsed.success || !allowedPublicUrl(parsed.data?.publicUrl ?? "")) {
      throw new Error(parsed.success ? "PUBLICATION_URL_INVALID" : "INVALID_PUBLICATION_INPUT");
    }
    const publishedAt = normalizePublishedAt(parsed.data.publishedAt);
    const supabase = createSupabaseServiceRoleClient();
    const publication = await new SupabasePublicationRepository(supabase).registerPublished({
      workspaceId: context.workspaceId,
      actor: { type: "user", id: context.actorId },
      requestId: requestId(request),
    }, publicationId, {
      publicUrl: parsed.data.publicUrl,
      publishedAt,
    });
    return NextResponse.json({
      publicationId: publication.id,
      status: publication.status,
      publicUrl: publication.publicUrl,
      publishedAt: publication.publishedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, statusOf, KNOWN_CODES);
  }
}
