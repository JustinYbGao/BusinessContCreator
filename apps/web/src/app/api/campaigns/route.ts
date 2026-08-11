import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CampaignCreateInputSchema, CampaignRecordSchema } from "@social-agent/contracts/product";
import { HttpError } from "../../../lib/auth";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../lib/supabase/server";

function validateCampaignInput(input: unknown) {
  const parsed = CampaignCreateInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_CAMPAIGN_INPUT");
  const parseDate = (value: string) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date.getTime();
  };
  const startsAt = parseDate(parsed.data.startsOn);
  const endsAt = parseDate(parsed.data.endsOn);
  const { pain_solution, product_proof, region_timing, founder_story } = parsed.data.pillarQuotas;
  if (startsAt === null || endsAt === null || (endsAt - startsAt) / (24 * 60 * 60 * 1_000) !== 27
    || pain_solution !== 5 || product_proof !== 4 || region_timing !== 2 || founder_story !== 1) {
    throw new Error("INVALID_CAMPAIGN_INPUT");
  }
  return parsed.data;
}

export function parseCampaignRequest(input: unknown) {
  return validateCampaignInput(input);
}

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error && error.code === "23505") return "CAMPAIGN_ALREADY_EXISTS";
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "INVALID_CAMPAIGN_INPUT" || code === "IDEMPOTENCY_KEY_INVALID") return 400;
  if (code === "PRODUCT_NOT_FOUND" || code === "CHANNEL_SCOPE_MISMATCH") return 404;
  if (code === "CAMPAIGN_ALREADY_EXISTS") return 409;
  return 500;
}

function errorResponse(error: unknown) {
  const code = codeOf(error);
  return NextResponse.json({ ok: false, error: code }, { status: statusOf(code), headers: { "Cache-Control": "no-store" } });
}

function idempotencyKeyFrom(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (value.length > 200) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return value || null;
}

async function findIdempotentCampaign(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  idempotencyKey: string,
) {
  const { data: audit, error: auditError } = await supabase
    .from("audit_events")
    .select("entity_id")
    .eq("workspace_id", workspaceId)
    .eq("request_id", idempotencyKey)
    .eq("action", "campaign.created")
    .eq("entity_type", "campaign")
    .limit(1)
    .maybeSingle();
  if (auditError) throw new Error("CAMPAIGN_IDEMPOTENCY_LOOKUP_FAILED");
  if (!audit?.entity_id) return null;
  const { data: campaign, error } = await supabase.from("campaigns")
    .select("id,workspace_id,product_id,channel_id,name,goal,audience,pillar_quotas,starts_on,ends_on,created_at")
    .eq("workspace_id", workspaceId).eq("id", audit.entity_id).maybeSingle();
  if (error || !campaign) throw new Error("CAMPAIGN_IDEMPOTENCY_LOOKUP_FAILED");
  return { campaign: CampaignRecordSchema.parse(campaign) };
}

export async function GET(request: Request) {
  try {
    const identity = await requireServerInternalAdmin();
    const productId = new URL(request.url).searchParams.get("productId");
    const supabase = createSupabaseServiceRoleClient();
    let query = supabase.from("campaigns").select("id,workspace_id,product_id,channel_id,name,goal,audience,pillar_quotas,starts_on,ends_on,created_at").eq("workspace_id", identity.workspaceId).order("created_at");
    if (productId) {
      const { data: product, error: productError } = await supabase.from("products").select("id").eq("workspace_id", identity.workspaceId).eq("id", productId).is("deleted_at", null).maybeSingle();
      if (productError || !product) throw new Error("PRODUCT_NOT_FOUND");
      query = query.eq("product_id", productId);
    } else {
      const { data: products, error: productError } = await supabase.from("products").select("id").eq("workspace_id", identity.workspaceId).is("deleted_at", null);
      if (productError) throw new Error("PRODUCTS_UNAVAILABLE");
      const ids = (products ?? []).map((product) => product.id);
      if (ids.length === 0) return NextResponse.json({ campaigns: [] }, { headers: { "Cache-Control": "no-store" } });
      query = query.in("product_id", ids);
    }
    const { data, error } = await query;
    if (error) throw new Error("CAMPAIGNS_UNAVAILABLE");
    return NextResponse.json({ campaigns: (data ?? []).map((row) => CampaignRecordSchema.parse(row)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireServerInternalAdmin();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_CAMPAIGN_INPUT");
    }
    const input = parseCampaignRequest(body);
    const supabase = createSupabaseServiceRoleClient();
    const { data: product, error: productError } = await supabase.from("products").select("id").eq("workspace_id", identity.workspaceId).eq("id", input.productId).is("deleted_at", null).maybeSingle();
    if (productError || !product) throw new Error("PRODUCT_NOT_FOUND");
    const { data: channel, error: channelError } = await supabase.from("channels").select("id").eq("workspace_id", identity.workspaceId).eq("product_id", input.productId).eq("id", input.channelId).eq("kind", "xiaohongshu").eq("status", "active").maybeSingle();
    if (channelError || !channel) throw new Error("CHANNEL_SCOPE_MISMATCH");
    const idempotencyKey = idempotencyKeyFrom(request);
    const requestId = idempotencyKey || request.headers.get("x-request-id")?.trim() || randomUUID();
    if (idempotencyKey) {
      const existing = await findIdempotentCampaign(supabase, identity.workspaceId, idempotencyKey);
      if (existing) return NextResponse.json(existing, { headers: { "Cache-Control": "no-store" } });
    }
    const { data: campaign, error: campaignError } = await supabase.from("campaigns").insert({ workspace_id: identity.workspaceId, product_id: input.productId, channel_id: input.channelId, name: input.name, goal: input.goal, audience: input.audience, starts_on: input.startsOn, ends_on: input.endsOn, pillar_quotas: input.pillarQuotas }).select("id,workspace_id,product_id,channel_id,name,goal,audience,pillar_quotas,starts_on,ends_on,created_at").single();
    if (campaignError || !campaign) throw new Error(campaignError?.code === "23505" ? "CAMPAIGN_ALREADY_EXISTS" : "CAMPAIGN_CREATE_FAILED");
    const campaignRecord = CampaignRecordSchema.parse(campaign);
    const { error: auditError } = await supabase.rpc("append_audit_event", {
      p_workspace_id: identity.workspaceId,
      p_event: { product_id: input.productId, actor_type: "user", actor_id: identity.userId, action: "campaign.created", entity_type: "campaign", entity_id: campaignRecord.id, request_id: requestId, payload: { channelId: input.channelId, idempotencyKey } },
    });
    if (auditError) {
      const { error: rollbackError } = await supabase.from("campaigns").delete()
        .eq("workspace_id", identity.workspaceId).eq("product_id", input.productId).eq("id", campaignRecord.id);
      if (rollbackError) throw new Error("CAMPAIGN_ROLLBACK_FAILED");
      throw new Error("AUDIT_WRITE_FAILED");
    }
    return NextResponse.json({ campaign: campaignRecord }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
