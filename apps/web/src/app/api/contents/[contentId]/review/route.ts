import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ContentDraftSchema } from "@social-agent/contracts/content";
import { OpenAiCompatibleClient } from "@social-agent/llm";
import { buildReviewContext, reviewContent, type ReviewFact, type ReviewSourceAsset } from "@social-agent/review-engine";
import { z } from "zod";
import { HttpError } from "../../../../../lib/auth";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../../lib/supabase/server";
import { parseReviewContentRequest } from "../../../../../lib/api-inputs";

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function errorStatus(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "INVALID_REVIEW_INPUT" || code === "CONTENT_ID_INVALID") return 400;
  if (code === "CONTENT_NOT_FOUND" || code === "CONTENT_VERSION_REQUIRED" || code === "CONTENT_VERSION_NOT_FOUND") return 404;
  if (code === "CONTENT_VERSION_IMMUTABLE" || code === "CONTENT_SCOPE_MISMATCH") return 409;
  if (code === "REVIEW_CONTEXT_CHANGED") return 409;
  if (code === "LLM_NOT_CONFIGURED" || code === "LLM_UNAVAILABLE") return 503;
  return 500;
}

function errorResponse(error: unknown) {
  const code = errorCode(error);
  return NextResponse.json(
    { ok: false, error: code },
    { status: errorStatus(code), headers: { "Cache-Control": "no-store" } },
  );
}

async function requestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

function requestId(request: Request, idempotencyKey?: string): string {
  const value = request.headers.get("x-request-id")?.trim() || idempotencyKey?.trim() || randomUUID();
  return value.length <= 200 ? value : randomUUID();
}

async function getContentAndVersion(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  contentId: string,
  requestedVersionId?: string,
) {
  if (!z.string().uuid().safeParse(contentId).success) throw new Error("CONTENT_ID_INVALID");
  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id,workspace_id,product_id,status")
    .eq("workspace_id", workspaceId)
    .eq("id", contentId)
    .maybeSingle();
  if (contentError) throw new Error("CONTENT_UNAVAILABLE");
  if (!content) throw new Error("CONTENT_NOT_FOUND");

  let versionQuery = supabase
    .from("content_versions")
    .select("id,workspace_id,product_id,content_id,version,payload,content_sha256,status")
    .eq("workspace_id", workspaceId)
    .eq("content_id", contentId);
  if (requestedVersionId) versionQuery = versionQuery.eq("id", requestedVersionId);
  else versionQuery = versionQuery.order("version", { ascending: false }).limit(1);
  const { data: version, error: versionError } = await versionQuery.maybeSingle();
  if (versionError) throw new Error("CONTENT_VERSION_UNAVAILABLE");
  if (!version) throw new Error(requestedVersionId ? "CONTENT_VERSION_NOT_FOUND" : "CONTENT_VERSION_REQUIRED");
  if (version.product_id !== content.product_id) throw new Error("CONTENT_SCOPE_MISMATCH");
  if (version.status === "approved") throw new Error("CONTENT_VERSION_IMMUTABLE");
  return { content, version };
}

async function getReviewInputs(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  productId: string,
  contentVersionId: string,
  payload: unknown,
) {
  const [factsResult, assetsResult, recentResult] = await Promise.all([
    supabase.from("product_facts")
      .select("id,workspace_id,product_id,statement,status,public_use_allowed")
      .eq("workspace_id", workspaceId)
      .eq("product_id", productId),
    supabase.from("assets")
      .select("id,workspace_id,product_id,content_version_id,kind,source_locator,provenance,verification_status,public_use_allowed")
      .eq("workspace_id", workspaceId)
      .eq("product_id", productId)
      .is("content_version_id", null),
    supabase.from("content_versions")
      .select("id,content_id,payload,created_at")
      .eq("workspace_id", workspaceId)
      .eq("product_id", productId)
      .eq("status", "approved")
      .neq("id", contentVersionId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(30),
  ]);
  if (factsResult.error) throw new Error("FACTS_UNAVAILABLE");
  if (assetsResult.error) throw new Error("ASSETS_UNAVAILABLE");
  if (recentResult.error) throw new Error("APPROVED_CONTENTS_UNAVAILABLE");

  const facts: ReviewFact[] = (factsResult.data ?? []).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    productId: row.product_id,
    statement: row.statement,
    status: row.status,
    publicUseAllowed: row.public_use_allowed,
  }));
  const sourceAssets: ReviewSourceAsset[] = (assetsResult.data ?? []).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    productId: row.product_id,
    contentVersionId: row.content_version_id,
    kind: row.kind,
    sourceLocator: row.source_locator,
    provenance: row.provenance,
    verificationStatus: row.verification_status,
    publicUseAllowed: row.public_use_allowed,
  }));
  const recentApprovedContents = (recentResult.data ?? []).flatMap((row) => {
    const draft = ContentDraftSchema.safeParse(row.payload);
    return draft.success ? [{ id: row.content_id, contentVersionId: row.id, draft: draft.data }] : [];
  });
  const reviewContext = buildReviewContext({
    contentVersionId,
    payload,
    facts: factsResult.data ?? [],
    sourceAssets: assetsResult.data ?? [],
    recentApprovedContents: recentResult.data ?? [],
  });
  return { facts, sourceAssets, recentApprovedContents, reviewContext };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ contentId: string }> },
) {
  try {
    const identity = await requireServerInternalAdmin();
    const { contentId } = await params;
    let body: unknown;
    try {
      body = await requestBody(request);
    } catch {
      throw new Error("INVALID_REVIEW_INPUT");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_REVIEW_INPUT");
    const input = parseReviewContentRequest(body);
    const supabase = createSupabaseServiceRoleClient();
    const { content, version } = await getContentAndVersion(supabase, identity.workspaceId, contentId, input.contentVersionId);
    const reviewInputs = await getReviewInputs(supabase, identity.workspaceId, content.product_id, version.id, version.payload);
    const result = await reviewContent({
      workspaceId: identity.workspaceId,
      productId: content.product_id,
      contentVersionId: version.id,
      draft: version.payload,
      ...reviewInputs,
    }, new OpenAiCompatibleClient());
    const findings = result.findings.map(({ code, severity, message }) => ({ code, severity, message }));
    const { data: reviewRun, error: reviewRunError } = await supabase.rpc("replace_current_review_run_with_context", {
      p_workspace_id: identity.workspaceId,
      p_content_version_id: version.id,
      p_findings: findings,
      p_review_context: reviewInputs.reviewContext,
      p_actor_type: "user",
      p_actor_id: identity.userId,
      p_request_id: requestId(request, input.idempotencyKey),
    });
    if (reviewRunError?.message.includes("REVIEW_CONTEXT_CHANGED")) throw new Error("REVIEW_CONTEXT_CHANGED");
    if (reviewRunError || !reviewRun) throw new Error("REVIEW_RUN_CREATE_FAILED");
    return NextResponse.json({
      reviewRun: {
        id: String(reviewRun.id),
        contentVersionId: version.id,
        runNumber: Number(reviewRun.run_number),
        isCurrent: Boolean(reviewRun.is_current),
        result: String(reviewRun.result),
      },
      review: result,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
