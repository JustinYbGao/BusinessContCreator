import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ContentDraftSchema } from "@social-agent/contracts/content";
import { findApprovalRevalidationFindings, type ReviewFact, type ReviewSourceAsset } from "@social-agent/review-engine";
import { z } from "zod";
import { HttpError } from "../../../../../lib/auth";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../../lib/supabase/server";
import { parseApproveContentRequest } from "../../../../../lib/api-inputs";

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function errorStatus(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "INVALID_APPROVE_INPUT") return 400;
  if (code === "CONTENT_VERSION_NOT_FOUND" || code === "CONTENT_NOT_FOUND") return 404;
  if (code === "CONTENT_VERSION_IMMUTABLE" || code === "CURRENT_REVIEW_REQUIRED" || code === "CURRENT_REVIEW_NOT_PASSED" || code === "CURRENT_REVIEW_UNAVAILABLE" || code === "CONTENT_VERSION_CHANGED" || code === "ACTOR_ID_INVALID") return 409;
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

async function getApprovalRevalidationInputs(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  productId: string,
  contentVersionId: string,
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
      .select("id,content_id,payload")
      .eq("workspace_id", workspaceId)
      .eq("product_id", productId)
      .eq("status", "approved")
      .neq("id", contentVersionId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (factsResult.error || assetsResult.error || recentResult.error) throw new Error("CURRENT_REVIEW_UNAVAILABLE");

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
  return { facts, sourceAssets, recentApprovedContents };
}

function requestId(request: Request, idempotencyKey?: string): string {
  const value = request.headers.get("x-request-id")?.trim() || idempotencyKey?.trim() || randomUUID();
  return value.length <= 200 ? value : randomUUID();
}

function contentVersionResponse(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    productId: String(row.product_id),
    contentId: String(row.content_id),
    version: Number(row.version),
    payload: row.payload,
    contentSha256: String(row.content_sha256),
    status: String(row.status),
    approvedBy: row.approved_by === null || row.approved_by === undefined ? null : String(row.approved_by),
    approvedAt: row.approved_at === null || row.approved_at === undefined ? null : String(row.approved_at),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ contentId: string }> },
) {
  try {
    const identity = await requireServerInternalAdmin();
    const { contentId } = await params;
    const body = await requestBody(request).catch(() => { throw new Error("INVALID_APPROVE_INPUT"); });
    const input = parseApproveContentRequest(body);
    if (!z.string().uuid().safeParse(contentId).success) throw new Error("INVALID_APPROVE_INPUT");
    if (!z.string().uuid().safeParse(identity.userId).success) throw new Error("ACTOR_ID_INVALID");

    const supabase = createSupabaseServiceRoleClient();
    const { data: version, error: versionError } = await supabase
      .from("content_versions")
      .select("id,workspace_id,product_id,content_id,version,payload,content_sha256,status,approved_by,approved_at")
      .eq("workspace_id", identity.workspaceId)
      .eq("content_id", contentId)
      .eq("id", input.contentVersionId)
      .maybeSingle();
    if (versionError) throw new Error("CONTENT_VERSION_UNAVAILABLE");
    if (!version) throw new Error("CONTENT_VERSION_NOT_FOUND");
    if (version.status === "approved") throw new Error("CONTENT_VERSION_IMMUTABLE");

    const revalidationInputs = await getApprovalRevalidationInputs(
      supabase,
      identity.workspaceId,
      version.product_id,
      version.id,
    );
    const revalidationFindings = findApprovalRevalidationFindings({
      workspaceId: identity.workspaceId,
      productId: version.product_id,
      draft: version.payload,
      ...revalidationInputs,
    });
    if (revalidationFindings.some((finding) => finding.severity === "blocking")) {
      throw new Error("CURRENT_REVIEW_NOT_PASSED");
    }

    const { data: currentRun, error: runError } = await supabase
      .from("review_runs")
      .select("id,result,is_current")
      .eq("content_version_id", version.id)
      .eq("is_current", true)
      .maybeSingle();
    if (runError) throw new Error("CURRENT_REVIEW_UNAVAILABLE");
    if (!currentRun || currentRun.is_current !== true) throw new Error("CURRENT_REVIEW_REQUIRED");

    const { data: findings, error: findingsError } = await supabase
      .from("review_findings")
      .select("severity")
      .eq("review_run_id", currentRun.id);
    if (findingsError) throw new Error("CURRENT_REVIEW_UNAVAILABLE");
    if (currentRun.result !== "passed" || (findings ?? []).some((finding) => finding.severity === "blocking")) {
      throw new Error("CURRENT_REVIEW_NOT_PASSED");
    }

    const { data: approved, error: approveError } = await supabase.rpc("approve_content_version", {
      p_workspace_id: identity.workspaceId,
      p_content_version_id: version.id,
      p_expected_payload: version.payload,
      p_expected_sha256: version.content_sha256,
      p_approved_by: identity.userId,
      p_actor_type: "user",
      p_request_id: requestId(request, input.idempotencyKey),
    });
    if (approveError || !approved) {
      const message = approveError?.message ?? "";
      if (message.includes("CONTENT_VERSION_CHANGED")) throw new Error("CONTENT_VERSION_CHANGED");
      if (message.includes("CURRENT_REVIEW_NOT_PASSED")) throw new Error("CURRENT_REVIEW_NOT_PASSED");
      throw new Error("CONTENT_APPROVAL_FAILED");
    }
    return NextResponse.json({ version: contentVersionResponse(approved as Record<string, unknown>) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
