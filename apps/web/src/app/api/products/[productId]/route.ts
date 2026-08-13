import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CampaignRecordSchema, ChannelRecordSchema, ProductRecordSchema, ProductSourceRecordSchema, WorkflowJobSummarySchema } from "@social-agent/contracts/product";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../lib/supabase/server";
import { HttpError } from "../../../../lib/auth";

type RouteContext = { params: Promise<{ productId: string }> };

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error && error.code === "23505") return "PRODUCT_ALREADY_EXISTS";
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "PRODUCT_NOT_FOUND" || code === "PRODUCT_SCOPE_MISMATCH") return 404;
  if (code === "PRODUCT_NAME_CONFIRMATION_REQUIRED" || code === "IDEMPOTENCY_KEY_INVALID") return 400;
  if (code === "PRODUCT_NOT_SOFT_DELETED") return 409;
  return 500;
}

function errorResponse(error: unknown) {
  const code = codeOf(error);
  return NextResponse.json({ ok: false, error: code }, { status: statusOf(code), headers: { "Cache-Control": "no-store" } });
}

function idempotencyKeyFrom(request: Request, productId: string): string {
  const value = request.headers.get("idempotency-key")?.trim() || `purge-product:${productId}`;
  if (value.length > 200) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return value;
}

async function findDeletionAudit(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  productId: string,
  requestId: string,
): Promise<string> {
  const current = await supabase.from("audit_events")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .eq("request_id", requestId)
    .eq("action", "product.soft_deleted")
    .eq("entity_type", "product")
    .eq("entity_id", productId)
    .limit(1)
    .maybeSingle();
  if (current.error) throw new Error("PURGE_CONFIRMATION_UNAVAILABLE");
  if (current.data?.id) return String(current.data.id);

  const prior = await supabase.from("audit_events")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .eq("action", "product.soft_deleted")
    .eq("entity_type", "product")
    .eq("entity_id", productId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prior.error || !prior.data?.id) throw new Error("PURGE_CONFIRMATION_UNAVAILABLE");
  return String(prior.data.id);
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const identity = await requireServerInternalAdmin();
    const { productId } = await context.params;
    const supabase = createSupabaseServiceRoleClient();
    const [productResult, channelResult, sourceResult, campaignResult] = await Promise.all([
      supabase.from("products").select("id,workspace_id,name,slug,positioning,brand_profile,deleted_at,created_at").eq("workspace_id", identity.workspaceId).eq("id", productId).is("deleted_at", null).maybeSingle(),
      supabase.from("channels").select("id,workspace_id,product_id,kind,status,settings,created_at").eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("kind", "xiaohongshu").maybeSingle(),
      supabase.from("product_sources").select("id,workspace_id,product_id,kind,locator,last_synced_at,created_at").eq("workspace_id", identity.workspaceId).eq("product_id", productId).order("created_at"),
      supabase.from("campaigns").select("id,workspace_id,product_id,channel_id,name,goal,audience,pillar_quotas,starts_on,ends_on,created_at").eq("workspace_id", identity.workspaceId).eq("product_id", productId).order("created_at"),
    ]);
    if (productResult.error || !productResult.data) throw new Error("PRODUCT_NOT_FOUND");
    if (channelResult.error || sourceResult.error || campaignResult.error) throw new Error("PRODUCT_UNAVAILABLE");
    return NextResponse.json({
      product: ProductRecordSchema.parse(productResult.data),
      channel: channelResult.data ? ChannelRecordSchema.parse(channelResult.data) : null,
      sources: (sourceResult.data ?? []).map((row) => ProductSourceRecordSchema.parse(row)),
      campaigns: (campaignResult.data ?? []).map((row) => CampaignRecordSchema.parse(row)),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const identity = await requireServerInternalAdmin();
    const { productId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("PRODUCT_NAME_CONFIRMATION_REQUIRED");
    }
    const exactName = body && typeof body === "object" && "exactName" in body && typeof body.exactName === "string" ? body.exactName : "";
    if (!exactName.trim()) throw new Error("PRODUCT_NAME_CONFIRMATION_REQUIRED");
    const supabase = createSupabaseServiceRoleClient();
    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    const deleteResult = await supabase.rpc("soft_delete_product", {
      p_workspace_id: identity.workspaceId,
      p_product_id: productId,
      p_exact_name: exactName,
      p_audit_event: { product_id: productId, actor_type: "user", actor_id: identity.userId, action: "product.soft_deleted", entity_type: "product", entity_id: productId, request_id: requestId, payload: { exactNameConfirmed: true } },
    });
    let product = deleteResult.data;
    if (deleteResult.error || !product) {
      if (!deleteResult.error?.message.includes("PRODUCT_NOT_FOUND")) throw new Error("PRODUCT_DELETE_FAILED");
      const existingProduct = await supabase.from("products")
        .select("id,workspace_id,name,slug,positioning,brand_profile,deleted_at,created_at")
        .eq("workspace_id", identity.workspaceId).eq("id", productId).maybeSingle();
      if (existingProduct.error || !existingProduct.data || existingProduct.data.name !== exactName || !existingProduct.data.deleted_at) {
        throw new Error("PRODUCT_NOT_FOUND");
      }
      product = existingProduct.data;
    }
    const productRecord = ProductRecordSchema.parse(product);

    const deletionAudit = await findDeletionAudit(supabase, identity.workspaceId, productId, requestId);

    const idempotencyKey = idempotencyKeyFrom(request, productId);
    let purgeJob;
    let createdPurgeJob = false;
    const { data: insertedPurgeJob, error: jobError } = await supabase.from("workflow_jobs").insert({ workspace_id: identity.workspaceId, product_id: productId, kind: "purge_product", idempotency_key: idempotencyKey, payload: { reason: "operator-requested-product-purge", confirmationAuditId: deletionAudit }, status: "queued" }).select("id,status").single();
    if (jobError?.code === "23505") {
      const existing = await supabase.from("workflow_jobs").select("id,status").eq("workspace_id", identity.workspaceId).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existing.error || !existing.data) throw new Error("PURGE_JOB_UNAVAILABLE");
      purgeJob = WorkflowJobSummarySchema.parse(existing.data);
    } else {
      if (jobError || !insertedPurgeJob) throw new Error("PURGE_JOB_UNAVAILABLE");
      purgeJob = WorkflowJobSummarySchema.parse(insertedPurgeJob);
      createdPurgeJob = true;
    }
    const { error: auditError } = await supabase.rpc("append_audit_event", {
      p_workspace_id: identity.workspaceId,
      p_event: { product_id: productId, actor_type: "user", actor_id: identity.userId, action: "workflow_job.enqueued", entity_type: "workflow_job", entity_id: purgeJob.id, request_id: requestId, payload: { kind: "purge_product", idempotencyKey } },
    });
    if (auditError) {
      if (createdPurgeJob) {
        await supabase.from("workflow_jobs").delete()
          .eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", purgeJob.id).eq("status", "queued");
      }
      throw new Error("AUDIT_WRITE_FAILED");
    }
    return NextResponse.json({ product: productRecord, purgeJob }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
