import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ContentDraftSchema, type ContentDraft } from "@social-agent/contracts/content";
import { WorkflowJobSummarySchema } from "@social-agent/contracts/product";
import { sha256 } from "@social-agent/content-engine/hash";
import { z } from "zod";
import { HttpError } from "../../../../../lib/auth";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../../lib/supabase/server";

const GenerateContentRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

const ContentEditRequestSchema = z.object({
  action: z.literal("edit"),
  editReason: z.string().trim().min(1).max(1_000),
  payload: ContentDraftSchema,
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

export function parseGenerateContentRequest(input: unknown) {
  const parsed = GenerateContentRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_CONTENT_GENERATION_INPUT");
  return parsed.data;
}

export function parseContentEditRequest(input: unknown) {
  const parsed = ContentEditRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_CONTENT_EDIT_INPUT");
  return parsed.data;
}

export function scopeContentGenerationIdempotencyKey(contentId: string, idempotencyKey: string): string {
  return `generate_content:${contentId}:${idempotencyKey}`;
}

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function errorStatus(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code.startsWith("INVALID_CONTENT") || code === "EDIT_REASON_REQUIRED" || code === "IDEMPOTENCY_KEY_INVALID") return 400;
  if (code === "CONTENT_NOT_FOUND" || code === "CONTENT_VERSION_REQUIRED") return 404;
  if (code === "CONTENT_VERSION_INVALID" || code === "CONTENT_FACT_SCOPE_MISMATCH" || code === "CONTENT_ASSET_SCOPE_MISMATCH" || code === "CONTENT_PAGES_INVALID") return 409;
  return 500;
}

function errorResponse(error: unknown) {
  const code = errorCode(error);
  return NextResponse.json({ ok: false, error: code }, { status: errorStatus(code), headers: { "Cache-Control": "no-store" } });
}

async function requestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(input: Record<string, unknown>, name: string, fallback: string): string {
  const value = input[name];
  return typeof value === "string" ? value : fallback;
}

function parseFormHashtags(input: Record<string, unknown>, fallback: string[]): string[] {
  const value = input.hashtags;
  if (typeof value !== "string") return fallback;
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

export function parseContentEditForm(input: unknown, current: ContentDraft) {
  const record = asRecord(input);
  const payload = {
    ...current,
    titleCandidates: Array.from({ length: 5 }, (_, index) => stringField(record, `titleCandidate${index + 1}`, current.titleCandidates[index] ?? "")),
    recommendedTitle: stringField(record, "recommendedTitle", current.recommendedTitle),
    body: stringField(record, "body", current.body),
    hashtags: parseFormHashtags(record, current.hashtags),
    interactionPrompt: stringField(record, "interactionPrompt", current.interactionPrompt),
    pages: current.pages.map((page) => ({
      ...page,
      headline: stringField(record, `page${page.page}Headline`, page.headline),
      body: stringField(record, `page${page.page}Body`, page.body),
    })),
  };
  const parsed = ContentDraftSchema.safeParse(payload);
  const editReason = record.editReason;
  const idempotencyKey = record.idempotencyKey;
  if (!parsed.success || typeof editReason !== "string" || !editReason.trim() || editReason.length > 1_000
    || (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 200))) {
    throw new Error("INVALID_CONTENT_EDIT_INPUT");
  }
  return { action: "edit" as const, editReason: editReason.trim(), payload: parsed.data, ...(typeof idempotencyKey === "string" ? { idempotencyKey: idempotencyKey.trim() } : {}) };
}

function contentVersionResponse(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    productId: String(row.product_id),
    campaignId: String(row.campaign_id),
    contentId: String(row.content_id),
    topicId: String(row.topic_id),
    briefId: String(row.brief_id),
    version: Number(row.version),
    payload: row.payload,
    promptVersion: String(row.prompt_version),
    modelName: String(row.model_name),
    contentSha256: String(row.content_sha256),
    status: String(row.status),
    editReason: row.edit_reason === null || row.edit_reason === undefined ? null : String(row.edit_reason),
    createdBy: String(row.created_by),
  };
}

async function getContent(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  contentId: string,
) {
  const { data, error } = await supabase
    .from("contents")
    .select("id,workspace_id,product_id,campaign_id,topic_id,status")
    .eq("workspace_id", workspaceId)
    .eq("id", contentId)
    .maybeSingle();
  if (error) throw new Error("CONTENT_UNAVAILABLE");
  if (!data) throw new Error("CONTENT_NOT_FOUND");
  return data;
}

async function getLatestVersion(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  contentId: string,
) {
  const { data, error } = await supabase
    .from("content_versions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("content_id", contentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("CONTENT_VERSIONS_UNAVAILABLE");
  return data;
}

async function validateDraftScope(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  productId: string,
  draft: ContentDraft,
) {
  if (draft.pages.length !== 7 || draft.pages.some((page, index) => page.page !== index + 1)) throw new Error("CONTENT_PAGES_INVALID");
  const [{ data: facts, error: factsError }, { data: assets, error: assetsError }] = await Promise.all([
    supabase.from("product_facts").select("id").eq("workspace_id", workspaceId).eq("product_id", productId).eq("status", "verified").eq("public_use_allowed", true),
    supabase.from("assets").select("id").eq("workspace_id", workspaceId).eq("product_id", productId).is("content_version_id", null).eq("provenance", "source").eq("verification_status", "verified").eq("public_use_allowed", true),
  ]);
  if (factsError) throw new Error("FACTS_UNAVAILABLE");
  if (assetsError) throw new Error("ASSETS_UNAVAILABLE");
  const factIds = new Set((facts ?? []).map((fact) => fact.id));
  const assetIds = new Set((assets ?? []).map((asset) => asset.id));
  if (draft.claims.some((claim) => !factIds.has(claim.factId))) throw new Error("CONTENT_FACT_SCOPE_MISMATCH");
  if (draft.pages.some((page) => page.sourceAssetId !== null && !assetIds.has(page.sourceAssetId))) throw new Error("CONTENT_ASSET_SCOPE_MISMATCH");
}

async function editContent(
  request: Request,
  identity: { userId: string; workspaceId: string },
  contentId: string,
  input: { editReason: string; payload: ContentDraft; idempotencyKey?: string | undefined },
) {
  const supabase = createSupabaseServiceRoleClient();
  const content = await getContent(supabase, identity.workspaceId, contentId);
  const current = await getLatestVersion(supabase, identity.workspaceId, contentId);
  if (!current) throw new Error("CONTENT_VERSION_REQUIRED");
  const currentPayload = ContentDraftSchema.safeParse(current.payload);
  if (!currentPayload.success) throw new Error("CONTENT_VERSION_INVALID");
  const payload = ContentDraftSchema.parse(input.payload);
  await validateDraftScope(supabase, identity.workspaceId, content.product_id, payload);
  const requestId = input.idempotencyKey || request.headers.get("idempotency-key")?.trim() || request.headers.get("x-request-id")?.trim() || randomUUID();
  const { data: priorAudit, error: priorAuditError } = await supabase.from("audit_events")
    .select("entity_id")
    .eq("workspace_id", identity.workspaceId)
    .eq("request_id", requestId)
    .eq("action", "content_version.edited")
    .eq("entity_type", "content_version")
    .limit(1)
    .maybeSingle();
  if (priorAuditError) throw new Error("CONTENT_EDIT_IDEMPOTENCY_LOOKUP_FAILED");
  if (priorAudit?.entity_id) {
    const { data: priorVersion, error: priorVersionError } = await supabase.from("content_versions").select("*")
      .eq("workspace_id", identity.workspaceId).eq("id", priorAudit.entity_id).maybeSingle();
    if (priorVersionError || !priorVersion) throw new Error("CONTENT_EDIT_IDEMPOTENCY_LOOKUP_FAILED");
    return NextResponse.json({ version: contentVersionResponse(priorVersion as Record<string, unknown>) }, { headers: { "Cache-Control": "no-store" } });
  }
  const contentSha256 = sha256(payload);
  const { data: version, error: versionError } = await supabase.rpc("create_content_version", {
    p_workspace_id: identity.workspaceId,
    p_input: {
      product_id: content.product_id,
      campaign_id: content.campaign_id,
      content_id: content.id,
      topic_id: content.topic_id,
      brief_id: current.brief_id,
      payload,
      prompt_version: current.prompt_version,
      model_name: current.model_name,
      content_sha256: contentSha256,
      edit_reason: input.editReason,
      created_by: identity.userId,
    },
    p_actor_type: "user",
    p_actor_id: identity.userId,
    p_request_id: requestId,
  });
  if (versionError || !version) throw new Error("CONTENT_VERSION_CREATE_FAILED");
  const { error: auditError } = await supabase.rpc("append_audit_event", {
    p_workspace_id: identity.workspaceId,
    p_event: {
      product_id: content.product_id,
      actor_type: "user",
      actor_id: identity.userId,
      action: "content_version.edited",
      entity_type: "content_version",
      entity_id: (version as Record<string, unknown>).id,
      request_id: requestId,
      payload: { editReason: input.editReason, sourceVersionId: current.id, contentSha256 },
    },
  });
  if (auditError) throw new Error("AUDIT_WRITE_FAILED");
  return NextResponse.json({ version: { ...contentVersionResponse(version as Record<string, unknown>), editReason: input.editReason } }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ contentId: string }> }) {
  try {
    const identity = await requireServerInternalAdmin();
    const { contentId } = await params;
    let body: unknown;
    try {
      body = await requestBody(request);
    } catch {
      throw new Error("INVALID_CONTENT_GENERATION_INPUT");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_CONTENT_GENERATION_INPUT");
    const record = body as Record<string, unknown>;
    if (record.action === "edit") {
      const supabase = createSupabaseServiceRoleClient();
      const content = await getContent(supabase, identity.workspaceId, contentId);
      const current = await getLatestVersion(supabase, identity.workspaceId, contentId);
      if (!current) throw new Error("CONTENT_VERSION_REQUIRED");
      const currentPayload = ContentDraftSchema.safeParse(current.payload);
      if (!currentPayload.success) throw new Error("CONTENT_VERSION_INVALID");
      const edit = "payload" in record ? parseContentEditRequest(record) : parseContentEditForm(record, currentPayload.data);
      return editContent(request, identity, contentId, edit);
    }

    const input = parseGenerateContentRequest(body);
    const baseKey = request.headers.get("idempotency-key")?.trim() || input.idempotencyKey?.trim() || request.headers.get("x-request-id")?.trim() || randomUUID();
    if (baseKey.length > 200) throw new Error("IDEMPOTENCY_KEY_INVALID");
    const jobIdempotencyKey = scopeContentGenerationIdempotencyKey(contentId, baseKey);
    const supabase = createSupabaseServiceRoleClient();
    const content = await getContent(supabase, identity.workspaceId, contentId);
    const { data: brief, error: briefError } = await supabase.from("content_briefs")
      .select("id")
      .eq("workspace_id", identity.workspaceId)
      .eq("product_id", content.product_id)
      .eq("campaign_id", content.campaign_id)
      .eq("topic_id", content.topic_id)
      .maybeSingle();
    if (briefError || !brief) throw new Error("CONTENT_BRIEF_REQUIRED");

    const { data: job, error: jobError } = await supabase
      .from("workflow_jobs")
      .insert({
        workspace_id: identity.workspaceId,
        product_id: content.product_id,
        kind: "generate_content",
        idempotency_key: jobIdempotencyKey,
        payload: { contentId: content.id, campaignId: content.campaign_id, topicId: content.topic_id, briefId: brief.id },
        status: "queued",
      })
      .select("id,status")
      .single();
    if (jobError?.code === "23505") {
      const existing = await supabase.from("workflow_jobs").select("id,status").eq("workspace_id", identity.workspaceId).eq("idempotency_key", jobIdempotencyKey).maybeSingle();
      if (existing.error || !existing.data) throw new Error("CONTENT_JOB_UNAVAILABLE");
      return NextResponse.json({ job: WorkflowJobSummarySchema.parse(existing.data) }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    if (jobError || !job) throw new Error("CONTENT_JOB_UNAVAILABLE");
    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    const { error: auditError } = await supabase.rpc("append_audit_event", {
      p_workspace_id: identity.workspaceId,
      p_event: {
        product_id: content.product_id,
        actor_type: "user",
        actor_id: identity.userId,
        action: "workflow_job.enqueued",
        entity_type: "workflow_job",
        entity_id: job.id,
        request_id: requestId,
        payload: { kind: "generate_content", contentId: content.id, idempotencyKey: baseKey, jobIdempotencyKey },
      },
    });
    if (auditError) {
      await supabase.from("workflow_jobs").delete().eq("workspace_id", identity.workspaceId).eq("id", job.id).eq("status", "queued");
      throw new Error("AUDIT_WRITE_FAILED");
    }
    return NextResponse.json({ job: WorkflowJobSummarySchema.parse(job) }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
