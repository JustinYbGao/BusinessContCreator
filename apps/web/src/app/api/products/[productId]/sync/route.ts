import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { WorkflowJobSummarySchema } from "@social-agent/contracts/product";
import { HttpError } from "../../../../../lib/auth";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../../lib/supabase/server";
import { parseSyncRequest } from "../../../../../lib/api-inputs";

type RouteContext = { params: Promise<{ productId: string }> };

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "INVALID_SYNC_INPUT") return 400;
  if (code === "PRODUCT_NOT_FOUND" || code === "SOURCE_SCOPE_MISMATCH") return 404;
  return 500;
}

function errorResponse(error: unknown) {
  const code = codeOf(error);
  return NextResponse.json({ ok: false, error: code }, { status: statusOf(code), headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireServerInternalAdmin();
    const { productId } = await context.params;
    let body: unknown = {};
    const contentType = request.headers.get("content-type");
    if (contentType) {
      try {
        body = contentType.includes("application/json") ? await request.json() : Object.fromEntries((await request.formData()).entries());
      } catch {
        throw new Error("INVALID_SYNC_INPUT");
      }
    }
    const input = parseSyncRequest(body);
    const supabase = createSupabaseServiceRoleClient();
    const { data: product, error: productError } = await supabase.from("products").select("id").eq("workspace_id", identity.workspaceId).eq("id", productId).is("deleted_at", null).maybeSingle();
    if (productError || !product) throw new Error("PRODUCT_NOT_FOUND");

    let sourceIds = input.sourceIds;
    if (sourceIds.length > 0) {
      const { data: sources, error: sourceError } = await supabase.from("product_sources").select("id").eq("workspace_id", identity.workspaceId).eq("product_id", productId).in("id", sourceIds);
      if (sourceError || (sources?.length ?? 0) !== sourceIds.length) throw new Error("SOURCE_SCOPE_MISMATCH");
    } else {
      const { data: sources, error: sourceError } = await supabase.from("product_sources").select("id").eq("workspace_id", identity.workspaceId).eq("product_id", productId).order("created_at");
      if (sourceError) throw new Error("SOURCES_UNAVAILABLE");
      sourceIds = (sources ?? []).map((source) => source.id);
    }

    sourceIds = [...sourceIds].sort();
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || `sync-product:${productId}:${sourceIds.join(",")}`;
    const { data: job, error: jobError } = await supabase.from("workflow_jobs").insert({ workspace_id: identity.workspaceId, product_id: productId, kind: "sync_product", idempotency_key: idempotencyKey, payload: { sourceIds }, status: "queued" }).select("id,status").single();
    if (jobError?.code === "23505") {
      const existing = await supabase.from("workflow_jobs").select("id,status").eq("workspace_id", identity.workspaceId).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existing.error || !existing.data) throw new Error("SYNC_JOB_UNAVAILABLE");
      return NextResponse.json({ job: WorkflowJobSummarySchema.parse(existing.data) }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    if (jobError || !job) throw new Error("SYNC_JOB_UNAVAILABLE");
    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    const { error: auditError } = await supabase.rpc("append_audit_event", {
      p_workspace_id: identity.workspaceId,
      p_event: { product_id: productId, actor_type: "user", actor_id: identity.userId, action: "workflow_job.enqueued", entity_type: "workflow_job", entity_id: job.id, request_id: requestId, payload: { kind: "sync_product", idempotencyKey, sourceIds } },
    });
    if (auditError) {
      await supabase.from("workflow_jobs").delete()
        .eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", job.id).eq("status", "queued");
      throw new Error("AUDIT_WRITE_FAILED");
    }
    return NextResponse.json({ job: WorkflowJobSummarySchema.parse(job) }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
