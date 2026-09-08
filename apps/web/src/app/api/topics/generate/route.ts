import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { WorkflowJobSummarySchema } from "@social-agent/contracts/product";
import { HttpError } from "../../../../lib/workspace-context";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../lib/supabase/server";
import { parseGenerateTopicsRequest, scopeTopicGenerationIdempotencyKey } from "../../../../lib/api-inputs";

function idempotencyKeyFrom(request: Request, bodyKey?: string): string {
  const headerKey = request.headers.get("idempotency-key")?.trim();
  const key = headerKey || bodyKey?.trim();
  if (!key || key.length > 200) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  return key;
}

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "INVALID_TOPIC_GENERATION_INPUT" || code === "IDEMPOTENCY_KEY_REQUIRED") return 400;
  if (code === "CAMPAIGN_NOT_FOUND") return 404;
  return 500;
}

function errorResponse(error: unknown) {
  const code = codeOf(error);
  return NextResponse.json({ ok: false, error: code }, { status: statusOf(code), headers: { "Cache-Control": "no-store" } });
}

async function requestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function POST(request: Request) {
  try {
    const context = await requireServerInternalWorkspace();
    let body: unknown;
    try {
      body = await requestBody(request);
    } catch {
      throw new Error("INVALID_TOPIC_GENERATION_INPUT");
    }
    const input = parseGenerateTopicsRequest(body);
    const idempotencyKey = idempotencyKeyFrom(request, input.idempotencyKey);
    const supabase = createSupabaseServiceRoleClient();
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id,product_id")
      .eq("workspace_id", context.workspaceId)
      .eq("id", input.campaignId)
      .maybeSingle();
    if (campaignError || !campaign) throw new Error("CAMPAIGN_NOT_FOUND");
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id")
      .eq("workspace_id", context.workspaceId)
      .eq("id", campaign.product_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (productError || !product) throw new Error("CAMPAIGN_NOT_FOUND");
    const jobIdempotencyKey = scopeTopicGenerationIdempotencyKey(campaign.id, idempotencyKey);

    const { data: job, error: jobError } = await supabase
      .from("workflow_jobs")
      .insert({
        workspace_id: context.workspaceId,
        product_id: campaign.product_id,
        kind: "generate_topics",
        idempotency_key: jobIdempotencyKey,
        payload: { campaignId: campaign.id },
        status: "queued",
      })
      .select("id,status")
      .single();

    if (jobError?.code === "23505") {
      const existing = await supabase
        .from("workflow_jobs")
        .select("id,status")
        .eq("workspace_id", context.workspaceId)
        .eq("product_id", campaign.product_id)
        .eq("kind", "generate_topics")
        .eq("idempotency_key", jobIdempotencyKey)
        .maybeSingle();
      if (existing.error || !existing.data) throw new Error("TOPIC_JOB_UNAVAILABLE");
      return NextResponse.json({ job: WorkflowJobSummarySchema.parse(existing.data) }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    if (jobError || !job) throw new Error("TOPIC_JOB_UNAVAILABLE");

    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    const { error: auditError } = await supabase.rpc("append_audit_event", {
      p_workspace_id: context.workspaceId,
      p_event: {
        product_id: campaign.product_id,
        actor_type: "user",
        actor_id: context.actorId,
        action: "workflow_job.enqueued",
        entity_type: "workflow_job",
        entity_id: job.id,
        request_id: requestId,
        payload: { kind: "generate_topics", campaignId: campaign.id, idempotencyKey, jobIdempotencyKey },
      },
    });
    if (auditError) {
      await supabase.from("workflow_jobs").delete()
        .eq("workspace_id", context.workspaceId)
        .eq("product_id", campaign.product_id)
        .eq("id", job.id)
        .eq("status", "queued");
      throw new Error("AUDIT_WRITE_FAILED");
    }

    return NextResponse.json({ job: WorkflowJobSummarySchema.parse(job) }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
