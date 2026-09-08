import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "../../../lib/workspace-context";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../lib/supabase/server";
import { parseCreateContentRequest } from "../../../lib/api-inputs";

const TopicRowSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  product_id: z.string().uuid(),
  title: z.string().min(1),
  angle: z.string().min(1),
  pillar: z.string().min(1),
  fact_ids: z.array(z.string().uuid()),
  selected: z.boolean(),
}).strict();

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function errorStatus(code: string): number {
  if (code === "INVALID_CONTENT_INPUT" || code === "IDEMPOTENCY_KEY_INVALID") return 400;
  if (code === "TOPIC_NOT_SELECTED" || code === "CAMPAIGN_NOT_FOUND" || code === "PRODUCT_NOT_FOUND") return 404;
  if (code === "VERIFIED_FACT_REQUIRED" || code === "FACT_SCOPE_MISMATCH") return 409;
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

function idempotencyKeyFrom(request: Request, bodyKey?: string): string {
  const headerKey = request.headers.get("idempotency-key")?.trim();
  const key = headerKey || bodyKey?.trim() || request.headers.get("x-request-id")?.trim() || randomUUID();
  if (key.length > 200) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return key;
}

function contentRecord(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    productId: String(row.product_id),
    campaignId: String(row.campaign_id),
    topicId: String(row.topic_id),
    status: String(row.status),
  };
}

async function findIdempotentContent(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  idempotencyKey: string,
) {
  const { data: audit, error: auditError } = await supabase
    .from("audit_events")
    .select("entity_id")
    .eq("workspace_id", workspaceId)
    .eq("request_id", idempotencyKey)
    .eq("action", "content.created")
    .eq("entity_type", "content")
    .limit(1)
    .maybeSingle();
  if (auditError) throw new Error("CONTENT_IDEMPOTENCY_LOOKUP_FAILED");
  if (!audit?.entity_id) return null;
  const { data: content, error } = await supabase
    .from("contents")
    .select("id,workspace_id,product_id,campaign_id,topic_id,status")
    .eq("workspace_id", workspaceId)
    .eq("id", audit.entity_id)
    .maybeSingle();
  if (error || !content) throw new Error("CONTENT_IDEMPOTENCY_LOOKUP_FAILED");
  return contentRecord(content as Record<string, unknown>);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function learningSummary(row: Record<string, unknown>) {
  const payload = asRecord(row.payload);
  const summary = typeof payload.summary === "string" ? payload.summary : JSON.stringify(payload);
  const samples = typeof payload.samples === "number" && Number.isFinite(payload.samples) ? payload.samples : 0;
  return { id: String(row.id), summary, samples };
}

const PAGE_CONSTRAINTS = [
  { page: 1, purpose: "hook", constraint: "用具体场景提出问题，不夸大结果。" },
  { page: 2, purpose: "context", constraint: "补充目标用户和真实使用背景。" },
  { page: 3, purpose: "product-proof", constraint: "只展示可由 Fact 或真实 source asset 支持的产品能力。" },
  { page: 4, purpose: "steps", constraint: "给出清晰、可执行的使用步骤。" },
  { page: 5, purpose: "boundary", constraint: "明确限制，不把未来或 blocked 能力说成已有。" },
  { page: 6, purpose: "takeaway", constraint: "总结用户能带走的具体方法。" },
  { page: 7, purpose: "interaction", constraint: "使用 desired CTA 引导真实互动，不引导站外联系。" },
] as const;

function buildBrief(input: {
  campaign: { id: string; goal: string; audience: string };
  topic: { id: string; title: string; angle: string; pillar: string };
  brandProfile: Record<string, unknown>;
  factIds: string[];
  assetIds: string[];
  learningIds: string[];
  desiredCta: string;
}) {
  return {
    version: "brief-v1",
    goal: input.campaign.goal,
    audience: input.campaign.audience,
    brandProfile: input.brandProfile,
    angle: input.topic.angle,
    topicId: input.topic.id,
    topicTitle: input.topic.title,
    pillar: input.topic.pillar,
    factIds: input.factIds,
    assetIds: input.assetIds,
    learningIds: input.learningIds,
    desiredCta: input.desiredCta,
    pages: PAGE_CONSTRAINTS,
  };
}

export async function POST(request: Request) {
  try {
    const context = await requireServerInternalWorkspace();
    let body: unknown;
    try {
      body = await requestBody(request);
    } catch {
      throw new Error("INVALID_CONTENT_INPUT");
    }
    const input = parseCreateContentRequest(body);
    const idempotencyKey = idempotencyKeyFrom(request, input.idempotencyKey);
    const requestId = idempotencyKey;
    const supabase = createSupabaseServiceRoleClient();
    const existing = await findIdempotentContent(supabase, context.workspaceId, idempotencyKey);
    if (existing) return NextResponse.json({ content: existing }, { headers: { "Cache-Control": "no-store" } });

    const { data: topicRow, error: topicError } = await supabase
      .from("topic_candidates")
      .select("id,campaign_id,product_id,title,angle,pillar,fact_ids,selected")
      .eq("workspace_id", context.workspaceId)
      .eq("campaign_id", input.campaignId)
      .eq("id", input.topicId)
      .eq("selected", true)
      .maybeSingle();
    if (topicError) throw new Error("TOPIC_UNAVAILABLE");
    if (!topicRow) throw new Error("TOPIC_NOT_SELECTED");
    const topic = TopicRowSchema.parse(topicRow);
    if (topic.campaign_id !== input.campaignId) throw new Error("TOPIC_SCOPE_MISMATCH");

    const [{ data: campaign, error: campaignError }, { data: product, error: productError }] = await Promise.all([
      supabase.from("campaigns").select("id,product_id,goal,audience").eq("workspace_id", context.workspaceId).eq("id", input.campaignId).maybeSingle(),
      supabase.from("products").select("id,brand_profile").eq("workspace_id", context.workspaceId).eq("id", topic.product_id).is("deleted_at", null).maybeSingle(),
    ]);
    if (campaignError || !campaign || campaign.product_id !== topic.product_id) throw new Error("CAMPAIGN_NOT_FOUND");
    if (productError || !product) throw new Error("PRODUCT_NOT_FOUND");

    if (topic.fact_ids.length === 0) throw new Error("VERIFIED_FACT_REQUIRED");
    if (new Set(topic.fact_ids).size !== topic.fact_ids.length) throw new Error("FACT_SCOPE_MISMATCH");
    const { data: factRows, error: factsError } = await supabase
      .from("product_facts")
      .select("id,statement,category,status,public_use_allowed")
      .eq("workspace_id", context.workspaceId)
      .eq("product_id", topic.product_id)
      .eq("status", "verified")
      .eq("public_use_allowed", true)
      .in("id", topic.fact_ids);
    if (factsError) throw new Error("FACTS_UNAVAILABLE");
    const factMap = new Map((factRows ?? []).map((row) => [row.id, row]));
    if (topic.fact_ids.some((factId) => !factMap.has(factId))) throw new Error("FACT_SCOPE_MISMATCH");

    const [assetsResult, learningsResult] = await Promise.all([
      supabase.from("assets").select("id,kind,source_locator").eq("workspace_id", context.workspaceId).eq("product_id", topic.product_id).is("content_version_id", null).eq("provenance", "source").eq("verification_status", "verified").eq("public_use_allowed", true).order("created_at"),
      supabase.from("learnings").select("id,payload").eq("workspace_id", context.workspaceId).eq("product_id", topic.product_id).order("created_at"),
    ]);
    if (assetsResult.error) throw new Error("ASSETS_UNAVAILABLE");
    if (learningsResult.error) throw new Error("LEARNINGS_UNAVAILABLE");

    const facts = topic.fact_ids.map((factId) => factMap.get(factId)!);
    const assets = (assetsResult.data ?? []).map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      description: asset.source_locator ?? asset.kind,
    }));
    const learnings = (learningsResult.data ?? []).map((row) => learningSummary(row as Record<string, unknown>));
    const brief = buildBrief({
      campaign: { id: campaign.id, goal: campaign.goal, audience: campaign.audience },
      topic,
      brandProfile: asRecord(product.brand_profile),
      factIds: facts.map((fact) => fact.id),
      assetIds: assets.map((asset) => asset.id),
      learningIds: learnings.map((learning) => learning.id),
      desiredCta: input.desiredCta ?? "欢迎分享你的真实使用场景",
    });

    const { data: contentRow, error: contentError } = await supabase.rpc("create_content_with_brief", {
      p_workspace_id: context.workspaceId,
      p_product_id: topic.product_id,
      p_campaign_id: campaign.id,
      p_topic_id: topic.id,
      p_brief: brief,
      p_created_by: context.actorId,
      p_idempotency_key: idempotencyKey,
      p_actor_type: "user",
      p_request_id: requestId,
    });
    if (contentError || !contentRow) throw new Error("CONTENT_CREATE_FAILED");
    return NextResponse.json({ content: contentRecord(contentRow as Record<string, unknown>) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
